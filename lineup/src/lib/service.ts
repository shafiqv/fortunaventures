import { db, type Game, type Member, type Team, type User } from "./db";
import { newToken } from "./auth";
import { appUrl, notifyUser } from "./notify";
import { buildLineup, spotsNeeded, type Status } from "./lineup";
import { nextToOffer, type Offer } from "./spares";
import { businessDaysBefore, daysBefore, fmtLocal, parseLocal, prettyWhen } from "./dates";
import type { ParsedGame } from "./csv";

/** Personal secret for calendar-feed URLs (created on first use). */
export function calToken(userId: number): string {
  const r = db().prepare("SELECT cal_token FROM users WHERE id=?").get(userId) as { cal_token: string | null };
  if (r.cal_token) return r.cal_token;
  const t = newToken(18);
  db().prepare("UPDATE users SET cal_token=? WHERE id=?").run(t, userId);
  return t;
}

// ---------- teams & members ----------
export const getTeam = (id: number) => db().prepare("SELECT * FROM teams WHERE id=?").get(id) as Team | undefined;
export const getGame = (id: number) => db().prepare("SELECT * FROM games WHERE id=?").get(id) as Game | undefined;

export function membersOf(teamId: number): Member[] {
  return db().prepare(
    `SELECT u.*, m.role, m.rank FROM members m JOIN users u ON u.id=m.user_id
     WHERE m.team_id=? ORDER BY CASE m.role WHEN 'spare' THEN 1 ELSE 0 END, m.rank, u.name, u.email`,
  ).all(teamId) as Member[];
}

export function roleOf(teamId: number, userId: number) {
  const org = db().prepare("SELECT 1 FROM teams t JOIN leagues l ON l.id=t.league_id WHERE t.id=? AND l.organizer_id=?").get(teamId, userId);
  if (org) return "captain"; // league organizers can manage every team in their league
  return (db().prepare("SELECT role FROM members WHERE team_id=? AND user_id=?").get(teamId, userId) as { role: string } | undefined)?.role ?? null;
}
export const isCaptain = (teamId: number, userId: number) => roleOf(teamId, userId) === "captain";

export function createTeam(owner: User, name: string, sport: string, format: "singles" | "doubles", lines: number) {
  const code = newToken(6);
  const r = db().prepare("INSERT INTO teams (name, sport, format, lines, invite_code) VALUES (?,?,?,?,?)")
    .run(name, sport, format, lines, code);
  db().prepare("INSERT INTO members (team_id, user_id, role, rank) VALUES (?,?, 'captain', 1)").run(r.lastInsertRowid, owner.id);
  return Number(r.lastInsertRowid);
}

export function joinTeam(teamId: number, userId: number) {
  const next = (db().prepare("SELECT COALESCE(MAX(rank),0)+1 AS n FROM members WHERE team_id=? AND role!='spare'").get(teamId) as { n: number }).n;
  db().prepare("INSERT OR IGNORE INTO members (team_id, user_id, role, rank) VALUES (?,?, 'player', ?)").run(teamId, userId, next);
}

/** Captain can pre-add a player by email; they get an invite email. */
export async function inviteByEmail(team: Team, email: string) {
  email = email.trim().toLowerCase();
  if (!email) return;
  db().prepare("INSERT OR IGNORE INTO users (email) VALUES (?)").run(email);
  const u = db().prepare("SELECT * FROM users WHERE email=?").get(email) as User;
  joinTeam(team.id, u.id);
  await notifyUser(u, `You've been added to ${team.name}`,
    `You've been added to ${team.name} on Lineup. Sign in with this email address to set your phone/text preferences:\n${appUrl()}`);
}

// ---------- games ----------
export function importGames(teamId: number, games: ParsedGame[]) {
  const ins = db().prepare(
    "INSERT OR IGNORE INTO games (team_id, starts_at, opponent, location, notes) VALUES (?,?,?,?,?)",
  );
  let added = 0;
  db().transaction(() => {
    for (const g of games) added += ins.run(teamId, g.startsAt, g.opponent, g.location, g.notes).changes;
  })();
  return { added, skipped: games.length - added };
}

export function upcomingGames(teamId: number): Game[] {
  const now = new Date(Date.now() - 6 * 3600_000);
  const cutoff = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T00:00`;
  return db().prepare("SELECT * FROM games WHERE team_id=? AND starts_at>=? ORDER BY starts_at").all(teamId, cutoff) as Game[];
}

// ---------- availability ----------
type ResponseRow = { user_id: number; status: Status; token: string };

export function responsesFor(gameId: number): (ResponseRow & { name: string; email: string; rank: number; role: string })[] {
  const g = getGame(gameId)!;
  return db().prepare(
    `SELECT r.user_id, r.status, r.token, u.name, u.email, COALESCE(m.rank,99) AS rank, COALESCE(m.role,'player') AS role
     FROM responses r JOIN users u ON u.id=r.user_id
     LEFT JOIN members m ON m.user_id=r.user_id AND m.team_id=?
     WHERE r.game_id=? ORDER BY rank`,
  ).all(g.team_id, gameId) as never;
}

export function setStatus(gameId: number, userId: number, status: Status) {
  db().prepare(
    `INSERT INTO responses (game_id, user_id, status, token) VALUES (?,?,?,?)
     ON CONFLICT(game_id,user_id) DO UPDATE SET status=excluded.status, updated_at=datetime('now')`,
  ).run(gameId, userId, status, newToken());
}

export function gameState(gameId: number) {
  const game = getGame(gameId)!;
  const team = getTeam(game.team_id)!;
  const rows = responsesFor(gameId);
  const played = new Map<number, number>();
  const bySkill = team.lineup_policy === "rating" || team.lineup_policy === "rotation_rating";
  const useRotation = team.lineup_policy === "rotation" || team.lineup_policy === "rotation_rating";
  const ratings = bySkill ? ratingsForTeam(team) : new Map<number, { rating: number; games: number }>();
  if (useRotation)
    for (const r of db().prepare(
      "SELECT r.user_id u, COUNT(*) c FROM responses r JOIN games g ON g.id=r.game_id WHERE g.team_id=? AND r.played=1 AND g.id!=? GROUP BY r.user_id",
    ).all(game.team_id, gameId) as { u: number; c: number }[]) played.set(r.u, r.c);
  const lineup = buildLineup(
    rows.map((r) => ({ userId: r.user_id, rank: r.rank, status: r.status, priority: useRotation ? played.get(r.user_id) ?? 0 : 0, skill: bySkill ? ratings.get(r.user_id)?.rating ?? seedOf(team.id, r.user_id) : undefined })),
    game.lines ?? team.lines, team.format, bySkill);
  const manual = db().prepare("SELECT position, user_id FROM lineup_slots WHERE game_id=?").all(gameId) as { position: number; user_id: number | null }[];
  if (manual.length) {
    // Organizer-curated lineup: a placed player who later says "out" leaves an OPEN slot (so spares get called).
    const perLine = team.format === "doubles" ? 2 : 1;
    const placed = new Map(manual.map((m) => [m.position, m.user_id]));
    const statusOf = (uid: number) => rows.find((r) => r.user_id === uid)?.status ?? "none";
    const slots = Array.from({ length: lineup.total }, (_, i) => {
      const u = placed.get(i + 1) ?? null;
      return { position: i + 1, line: Math.floor(i / perLine) + 1, userId: u && statusOf(u) !== "out" ? u : null };
    });
    const placedIds = new Set(manual.map((m) => m.user_id).filter(Boolean) as number[]);
    lineup.slots = slots;
    lineup.bench = rows.filter((r) => r.status === "in" && !placedIds.has(r.user_id)).map((r) => r.user_id);
    lineup.shortage = slots.filter((x) => !x.userId).length;
  }
  return { game, team, rows, lineup };
}

// ---------- results & ratings ----------
const seedOf = (teamId: number, userId: number) =>
  (db().prepare("SELECT seed FROM members WHERE team_id=? AND user_id=?").get(teamId, userId) as { seed: number } | undefined)?.seed ?? START_RATING;

/** Ratings for everyone in a team's league, rebuilt from all saved results in date order. */
export function ratingsForTeam(team: Team) {
  if (!team.league_id) return new Map<number, { rating: number; games: number }>();
  return leagueRatings(team.league_id);
}

export function leagueRatings(leagueId: number) {
  const d = db();
  const seeds = new Map<number, number>();
  for (const m of d.prepare("SELECT m.user_id u, m.seed s FROM members m JOIN teams t ON t.id=m.team_id WHERE t.league_id=?").all(leagueId) as { u: number; s: number }[]) seeds.set(m.u, m.s);
  const games = d.prepare(
    `SELECT g.id, g.matchup_id, g.starts_at FROM games g JOIN teams t ON t.id=g.team_id
     WHERE t.league_id=? AND g.matchup_id IS NOT NULL AND EXISTS (SELECT 1 FROM results r WHERE r.game_id=g.id) ORDER BY g.starts_at, g.matchup_id, g.id`,
  ).all(leagueId) as { id: number; matchup_id: number; starts_at: string }[];
  const byMatchup = new Map<number, number[]>();
  for (const g of games) byMatchup.set(g.matchup_id, [...(byMatchup.get(g.matchup_id) ?? []), g.id]);
  const rows = d.prepare("SELECT court, for_score, against_score, p1, p2 FROM results WHERE game_id=?");
  const matchups: CourtResult[][] = [];
  for (const [, ids] of byMatchup) {
    if (ids.length < 2) continue;
    const A = rows.all(ids[0]) as { court: number; for_score: number; against_score: number; p1: number | null; p2: number | null }[];
    const B = rows.all(ids[1]) as typeof A;
    matchups.push(A.map((a) => {
      const b = B.find((x) => x.court === a.court);
      return { a: [a.p1, a.p2].filter(Boolean) as number[], b: b ? ([b.p1, b.p2].filter(Boolean) as number[]) : [], aScore: a.for_score, bScore: a.against_score };
    }));
  }
  return computeRatings(seeds, matchups);
}

/** Save court scores from one team's point of view; mirror them (swapped) onto the opposing team's game. Snapshots who played. */
export function saveResults(gameId: number, scores: { court: number; forScore: number; againstScore: number }[]) {
  const d = db();
  const g = getGame(gameId)!;
  const sib = g.matchup_id ? (d.prepare("SELECT id FROM games WHERE matchup_id=? AND id!=?").get(g.matchup_id, gameId) as { id: number } | undefined) : undefined;
  const snap = (gid: number) => {
    const { lineup, team } = gameState(gid);
    const per = team.format === "doubles" ? 2 : 1;
    return (court: number) => lineup.slots.filter((s) => s.line === court).slice(0, per).map((s) => s.userId);
  };
  const mine = snap(gameId), theirs = sib ? snap(sib.id) : () => [null, null];
  const ins = d.prepare("INSERT OR REPLACE INTO results (game_id,court,for_score,against_score,p1,p2) VALUES (?,?,?,?,?,?)");
  d.transaction(() => {
    for (const s of scores) {
      const [a1, a2] = mine(s.court);
      ins.run(gameId, s.court, s.forScore, s.againstScore, a1 ?? null, a2 ?? null);
      if (sib) { const [b1, b2] = theirs(s.court); ins.run(sib.id, s.court, s.againstScore, s.forScore, b1 ?? null, b2 ?? null); }
    }
  })();
}
export const resultsFor = (gameId: number) =>
  db().prepare("SELECT court, for_score, against_score FROM results WHERE game_id=? ORDER BY court").all(gameId) as { court: number; for_score: number; against_score: number }[];

// ---------- manual lineups ----------
export const hasManualLineup = (gameId: number) => !!db().prepare("SELECT 1 FROM lineup_slots WHERE game_id=? LIMIT 1").get(gameId);

/** Save the organizer's chosen players per slot (array index = position-1; null = empty). */
export function saveLineup(gameId: number, userIds: (number | null)[]) {
  const d = db();
  d.transaction(() => {
    d.prepare("DELETE FROM lineup_slots WHERE game_id=?").run(gameId);
    const seen = new Set<number>();
    userIds.forEach((u, i) => {
      if (u && !seen.has(u)) { seen.add(u); d.prepare("INSERT INTO lineup_slots (game_id,position,user_id) VALUES (?,?,?)").run(gameId, i + 1, u); }
      else d.prepare("INSERT INTO lineup_slots (game_id,position,user_id) VALUES (?,?,NULL)").run(gameId, i + 1);
    });
  })();
}
export const resetLineup = (gameId: number) => void db().prepare("DELETE FROM lineup_slots WHERE game_id=?").run(gameId);

/** Freeze the current automatic suggestion into an editable manual lineup. */
export function freezeAutoLineup(gameId: number) {
  resetLineup(gameId);
  const { lineup } = gameState(gameId);
  saveLineup(gameId, lineup.slots.map((s) => s.userId));
}

/** Put a player into the first empty (or vacated-by-"out") slot of a manual lineup. */
export function fillOpenSlot(gameId: number, userId: number) {
  if (!hasManualLineup(gameId)) return;
  const d = db();
  const slots = d.prepare("SELECT position, user_id FROM lineup_slots WHERE game_id=? ORDER BY position").all(gameId) as { position: number; user_id: number | null }[];
  if (slots.some((x) => x.user_id === userId)) return;
  const statusOf = (u: number) => (d.prepare("SELECT status FROM responses WHERE game_id=? AND user_id=?").get(gameId, u) as { status: string } | undefined)?.status;
  const open = slots.find((x) => !x.user_id || statusOf(x.user_id) === "out");
  if (open) d.prepare("UPDATE lineup_slots SET user_id=? WHERE game_id=? AND position=?").run(userId, gameId, open.position);
}

/** Add a one-off sub by name (email optional) — they join the team as a spare and are marked "in" for this game. */
export function addSub(gameId: number, name: string, email: string) {
  const g = getGame(gameId)!;
  const d = db();
  const e = email.trim().toLowerCase();
  let u = e ? (d.prepare("SELECT * FROM users WHERE email=?").get(e) as User | undefined) : undefined;
  if (!u) {
    const em = e || `pending-${newToken(8).toLowerCase()}@placeholder.invalid`;
    d.prepare("INSERT INTO users (email, name) VALUES (?,?)").run(em, name.trim());
    u = d.prepare("SELECT * FROM users WHERE email=?").get(em) as User;
  }
  d.prepare("INSERT OR IGNORE INTO members (team_id,user_id,role,rank) VALUES (?,?, 'spare', 99)").run(g.team_id, u.id);
  setStatus(gameId, u.id, "in");
  fillOpenSlot(gameId, u.id);
  return u.id;
}

// ---------- outbound messages ----------
function gameLine(g: Game) {
  return `${prettyWhen(g.starts_at)} vs ${g.opponent || "TBD"}${g.location ? ` @ ${g.location}` : ""}`;
}

async function sendAvailabilityRequest(team: Team, game: Game, user: User, token: string, reminder: boolean) {
  const link = `${appUrl()}/r/${token}`;
  const subject = `${reminder ? "Reminder: " : ""}${team.name} – are you in? ${prettyWhen(game.starts_at)}`;
  const body = `${team.name}\n${gameLine(game)}${game.notes ? `\nNote: ${game.notes}` : ""}\n\nLet us know if you're in, out, or maybe:\n${link}`;
  await notifyUser(user, subject, body, `${team.name}: ${gameLine(game)}. In or out? ${link}`);
}

export async function sendRequests(game: Game, onlyNone: boolean) {
  const team = getTeam(game.team_id)!;
  const players = membersOf(team.id).filter((m) => m.role !== "spare");
  for (const p of players) {
    db().prepare("INSERT OR IGNORE INTO responses (game_id,user_id,status,token) VALUES (?,?, 'none', ?)").run(game.id, p.id, newToken());
    const r = db().prepare("SELECT status, token FROM responses WHERE game_id=? AND user_id=?").get(game.id, p.id) as ResponseRow;
    if (onlyNone && r.status !== "none") continue;
    await sendAvailabilityRequest(team, game, p, r.token, onlyNone);
  }
}

export async function sendSummary(game: Game) {
  const { team, rows, lineup } = gameState(game.id);
  const name = (id: number | null) => {
    if (id == null) return "— OPEN —";
    const r = rows.find((x) => x.user_id === id)!;
    return r.name || r.email;
  };
  const lines = lineup.slots.map((s) => `  Line ${s.line}: ${name(s.userId)}`).join("\n");
  const out = rows.filter((r) => r.status === "out").map((r) => r.name || r.email);
  const pending = rows.filter((r) => r.status === "none" || r.status === "maybe").map((r) => `${r.name || r.email} (${r.status === "none" ? "no reply" : "maybe"})`);
  const body =
    `${team.name} – ${gameLine(game)}\n\nLineup:\n${lines}\n` +
    (lineup.bench.length ? `\nSitting out this week (extra players): ${lineup.bench.map(name).join(", ")}\n` : "") +
    (lineup.shortage ? `\n⚠ ${lineup.shortage} spot(s) still open.\n` : "") +
    (out.length ? `\nOut: ${out.join(", ")}\n` : "") +
    (pending.length ? `\nStill waiting on: ${pending.join(", ")}\n` : "");
  for (const m of membersOf(team.id)) {
    if (m.role === "spare" && !rows.some((r) => r.user_id === m.id) && !spareOffer(game.id, m.id)) continue;
    await notifyUser(m, `${team.name} lineup – ${prettyWhen(game.starts_at)}`, body,
      `${team.name} lineup for ${prettyWhen(game.starts_at)} is set. ${lineup.shortage ? lineup.shortage + " spot(s) open." : "Full."} ${appUrl()}`);
  }
}

// ---------- spares ----------
const spareOffer = (gameId: number, userId: number) =>
  db().prepare("SELECT * FROM spare_offers WHERE game_id=? AND user_id=?").get(gameId, userId) as
    | { id: number; status: Offer["status"]; token: string; expires_at: number } | undefined;

export function offersFor(gameId: number) {
  return db().prepare(
    `SELECT o.*, u.name, u.email FROM spare_offers o JOIN users u ON u.id=o.user_id WHERE o.game_id=? ORDER BY o.offered_at`,
  ).all(gameId) as { id: number; user_id: number; status: Offer["status"]; token: string; name: string; email: string; expires_at: number }[];
}

/** Run the spare engine for one game: expire stale offers, cancel if filled, send new offers if short. */
export async function runSpares(gameId: number) {
  const { game, team, lineup } = gameState(gameId);
  const d = db();
  d.prepare("UPDATE spare_offers SET status='expired' WHERE game_id=? AND status='pending' AND expires_at<?").run(gameId, Date.now());

  const needed = lineup.shortage;
  if (needed <= 0) {
    d.prepare("UPDATE spare_offers SET status='cancelled' WHERE game_id=? AND status='pending'").run(gameId);
    return;
  }
  const spares = membersOf(team.id).filter((m) => m.role === "spare");
  const offers = offersFor(gameId);
  const toAsk = nextToOffer(team.spare_mode, needed, spares.map((s) => s.id), offers.map((o) => ({ userId: o.user_id, status: o.status })));
  for (const uid of toAsk) {
    const u = spares.find((s) => s.id === uid)!;
    const token = newToken();
    const now = Date.now();
    d.prepare("INSERT INTO spare_offers (game_id,user_id,token,status,offered_at,expires_at) VALUES (?,?,?, 'pending', ?, ?)")
      .run(gameId, uid, token, now, now + team.spare_expiry_hours * 3600_000);
    const link = `${appUrl()}/s/${token}`;
    await notifyUser(u, `${team.name} needs a spare – ${prettyWhen(game.starts_at)}`,
      `${team.name} is short a player.\n${gameLine(game)}\n\nCan you play? ${team.spare_mode === "first_come" ? "First to accept gets the spot." : `Please reply within ${team.spare_expiry_hours}h.`}\n${link}`,
      `${team.name} needs a spare: ${gameLine(game)}. Can you play? ${link}`);
  }
}

/** Accept/decline a spare offer. Accept is atomic: only succeeds while a spot is still open. */
export function respondToOffer(token: string, accept: boolean): "accepted" | "declined" | "filled" | "expired" | "invalid" {
  const d = db();
  const o = d.prepare("SELECT * FROM spare_offers WHERE token=?").get(token) as
    | { id: number; game_id: number; user_id: number; status: string; expires_at: number } | undefined;
  if (!o) return "invalid";
  if (o.status === "accepted") return "accepted";
  if (o.status !== "pending") return o.status === "declined" ? "declined" : o.status === "expired" ? "expired" : "filled";
  if (!accept) {
    d.prepare("UPDATE spare_offers SET status='declined' WHERE id=?").run(o.id);
    runSparesLater(o.game_id);
    return "declined";
  }
  return d.transaction(() => {
    const { lineup } = gameState(o.game_id);
    if (lineup.shortage <= 0) {
      d.prepare("UPDATE spare_offers SET status='cancelled' WHERE id=?").run(o.id);
      return "filled" as const;
    }
    d.prepare("UPDATE spare_offers SET status='accepted' WHERE id=?").run(o.id);
    setStatus(o.game_id, o.user_id, "in");
    fillOpenSlot(o.game_id, o.user_id);
    return "accepted" as const;
  })();
}

/** Fire-and-forget spare advance (next spare in rolling mode, or cancel leftovers when filled). */
export function runSparesLater(gameId: number) {
  runSpares(gameId).catch((e) => console.error("runSpares", e));
}

// ---------- leagues (organizer layer) ----------
import { parseRoster } from "./roster";
import { generateSeason } from "./season";
import { computeRatings, START_RATING, type CourtResult } from "./ratings";
import { isPlaceholderEmail } from "./notify";
import type { League } from "./db";

export const getLeague = (id: number) => db().prepare("SELECT * FROM leagues WHERE id=?").get(id) as League | undefined;
export const isOrganizer = (leagueId: number, userId: number) => getLeague(leagueId)?.organizer_id === userId;
export const leaguesOf = (userId: number) => db().prepare("SELECT * FROM leagues WHERE organizer_id=? ORDER BY name").all(userId) as League[];
export const leagueTeams = (leagueId: number) => db().prepare("SELECT * FROM teams WHERE league_id=? ORDER BY id").all(leagueId) as Team[];

/** Create a league and its teams/players from a pasted roster sheet. Players get placeholder emails until the organizer fills real ones. */
export function createLeagueFromRoster(organizer: User, name: string, courts: number, defaultTime: string, rosterText: string) {
  const parsed = parseRoster(rosterText);
  if (!parsed.teams.length) return { id: 0, errors: parsed.errors };
  const d = db();
  const id = d.transaction(() => {
    const lid = Number(d.prepare("INSERT INTO leagues (name, organizer_id, courts_per_matchup, default_time) VALUES (?,?,?,?)").run(name, organizer.id, courts, defaultTime).lastInsertRowid);
    for (const t of parsed.teams) {
      const tid = Number(d.prepare(
        "INSERT INTO teams (name, sport, format, lines, invite_code, league_id, lineup_policy, spare_mode) VALUES (?, 'tennis', 'doubles', ?, ?, ?, 'rotation_rating', 'rolling')",
      ).run(t.name, courts, newToken(6), lid).lastInsertRowid);
      t.players.forEach((pname, i) => {
        const existing = d.prepare(
          "SELECT u.id FROM users u JOIN members m ON m.user_id=u.id JOIN teams tt ON tt.id=m.team_id WHERE tt.league_id=? AND lower(u.name)=lower(?)",
        ).get(lid, pname) as { id: number } | undefined;
        const uid = existing?.id ?? Number(d.prepare("INSERT INTO users (email, name) VALUES (?,?)").run(`pending-${newToken(8).toLowerCase()}@placeholder.invalid`, pname).lastInsertRowid);
        d.prepare("INSERT OR IGNORE INTO members (team_id,user_id,role,rank) VALUES (?,?, 'player', ?)").run(tid, uid, i + 1);
      });
    }
    return lid;
  })();
  return { id, errors: parsed.errors };
}

/** Set a player's real email/phone. If that email already belongs to a signed-up user, merge into that account. */
export function setSeed(userId: number, leagueId: number, seed: number) {
  db().prepare("UPDATE members SET seed=? WHERE user_id=? AND team_id IN (SELECT id FROM teams WHERE league_id=?)").run(seed, userId, leagueId);
}

export function setContact(userId: number, emailRaw: string, phone: string) {
  const d = db();
  const email = emailRaw.trim().toLowerCase();
  if (phone) d.prepare("UPDATE users SET phone=? WHERE id=?").run(phone.trim(), userId);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;
  const other = d.prepare("SELECT id FROM users WHERE email=? AND id!=?").get(email, userId) as { id: number } | undefined;
  if (!other) { d.prepare("UPDATE users SET email=? WHERE id=?").run(email, userId); return; }
  d.transaction(() => {
    d.prepare("UPDATE OR IGNORE members SET user_id=? WHERE user_id=?").run(other.id, userId);
    d.prepare("UPDATE OR IGNORE responses SET user_id=? WHERE user_id=?").run(other.id, userId);
    d.prepare("UPDATE users SET name=CASE WHEN name='' THEN (SELECT name FROM users WHERE id=?) ELSE name END WHERE id=?").run(userId, other.id);
    d.prepare("DELETE FROM users WHERE id=?").run(userId);
  })();
}

export function leaguePlayers(leagueId: number) {
  return db().prepare(
    `SELECT u.id, u.name, u.email, u.phone, t.name AS team, m.seed AS seed FROM members m JOIN users u ON u.id=m.user_id JOIN teams t ON t.id=m.team_id
     WHERE t.league_id=? ORDER BY t.id, m.rank`,
  ).all(leagueId) as { id: number; name: string; email: string; phone: string; team: string; seed: number }[];
}
export { isPlaceholderEmail };

/** One round = a date with several matchups; each creates a game for BOTH teams. */
export function createRound(league: League, date: string, matchups: { a: number; b: number; time: string; courts: number }[]) {
  const d = db();
  let made = 0;
  d.transaction(() => {
    for (const m of matchups) {
      if (!m.a || !m.b || m.a === m.b) continue;
      const mid = (d.prepare("SELECT COALESCE(MAX(matchup_id),0)+1 AS n FROM games").get() as { n: number }).n;
      const A = getTeam(m.a)!, B = getTeam(m.b)!;
      const starts = `${date}T${m.time || league.default_time}`;
      const ins = d.prepare("INSERT OR IGNORE INTO games (team_id, starts_at, opponent, location, lines, matchup_id) VALUES (?,?,?,?,?,?)");
      ins.run(A.id, starts, B.name, `${m.courts} courts`, m.courts, mid);
      ins.run(B.id, starts, A.name, `${m.courts} courts`, m.courts, mid);
      made++;
    }
  })();
  return made;
}

export function generateLeagueSeason(league: League, start: string, weeks: number, holidays: string[], time: string, courts: number) {
  const teams = leagueTeams(league.id).map((t) => t.id);
  const season = generateSeason(teams, start, weeks, holidays);
  let made = 0;
  for (const w of season) if (!w.holiday && w.pairs.length) made += createRound(league, w.date, w.pairs.map(([a, b]) => ({ a, b, time, courts })));
  return { weeks: season.filter((w) => !w.holiday).length, matchups: made };
}

export function updateMatchup(matchupId: number, time: string, courts: number) {
  const g = db().prepare("SELECT starts_at FROM games WHERE matchup_id=? LIMIT 1").get(matchupId) as { starts_at: string } | undefined;
  if (!g) return;
  db().prepare("UPDATE games SET starts_at=?, lines=?, location=? WHERE matchup_id=?").run(`${g.starts_at.slice(0, 10)}T${time}`, courts, `${courts} courts`, matchupId);
}

export function leagueRounds(leagueId: number) {
  const games = db().prepare(
    `SELECT g.*, t.name AS team_name FROM games g JOIN teams t ON t.id=g.team_id WHERE t.league_id=? AND g.starts_at>=? ORDER BY g.starts_at, g.matchup_id, g.id`,
  ).all(leagueId, fmtLocal(new Date(Date.now() - 12 * 3600_000))) as (Game & { team_name: string })[];
  const byDate = new Map<string, Map<number, (Game & { team_name: string })[]>>();
  for (const g of games) {
    const day = g.starts_at.slice(0, 10);
    if (!byDate.has(day)) byDate.set(day, new Map());
    const mm = byDate.get(day)!;
    const key = g.matchup_id ?? g.id;
    mm.set(key, [...(mm.get(key) ?? []), g]);
  }
  return [...byDate.entries()].map(([day, mm]) => ({ day, matchups: [...mm.entries()].map(([id, gs]) => ({ id, games: gs })) }));
}

/** After a game starts, remember who actually played, so the next lineup rotates fairly. */
export function recordPlayed(now = new Date()) {
  const d = db();
  const past = d.prepare("SELECT id, starts_at FROM games WHERE played_recorded=0 AND starts_at<?").all(fmtLocal(now)) as { id: number; starts_at: string }[];
  for (const g of past) {
    const { lineup } = gameState(g.id);
    for (const sl of lineup.slots) if (sl.userId) d.prepare("UPDATE responses SET played=1 WHERE game_id=? AND user_id=?").run(g.id, sl.userId);
    d.prepare("UPDATE games SET played_recorded=1 WHERE id=?").run(g.id);
  }
}

// ---------- the scheduler tick ----------
/** Idempotent: call hourly (or more often). */
export async function tick(now = new Date()) {
  const d = db();
  recordPlayed(now);
  const games = d.prepare("SELECT * FROM games WHERE starts_at >= ? ORDER BY starts_at")
    .all(fmtLocal(new Date(now.getTime() - 3600_000))) as Game[];
  const log: string[] = [];
  for (const g of games) {
    const team = getTeam(g.team_id)!;
    const start = parseLocal(g.starts_at);
    if (start.getTime() < now.getTime()) continue;

    if (!g.request_sent && now >= businessDaysBefore(start, team.request_business_days)) {
      await sendRequests(g, false);
      d.prepare("UPDATE games SET request_sent=1 WHERE id=?").run(g.id);
      log.push(`request → game ${g.id}`);
    }
    if (g.request_sent && !g.reminder_sent && now >= daysBefore(start, team.reminder_days)) {
      await sendRequests(g, true);
      d.prepare("UPDATE games SET reminder_sent=1 WHERE id=?").run(g.id);
      log.push(`reminder → game ${g.id}`);
    }
    if (g.request_sent && team.auto_spares && now >= daysBefore(start, team.spares_days)) {
      if (!g.spares_started) d.prepare("UPDATE games SET spares_started=1 WHERE id=?").run(g.id);
      await runSpares(g.id); // also advances rolling offers / expires stale ones on every tick
      log.push(`spares check → game ${g.id}`);
    }
    if (g.request_sent && !g.summary_sent && now >= daysBefore(start, team.summary_days)) {
      await sendSummary(g);
      d.prepare("UPDATE games SET summary_sent=1 WHERE id=?").run(g.id);
      log.push(`summary → game ${g.id}`);
    }
  }
  return log;
}

export { spotsNeeded };
