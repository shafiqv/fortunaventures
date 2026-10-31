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
  const lineup = buildLineup(rows.map((r) => ({ userId: r.user_id, rank: r.rank, status: r.status })), team.lines, team.format);
  return { game, team, rows, lineup };
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
    return "accepted" as const;
  })();
}

/** Fire-and-forget spare advance (next spare in rolling mode, or cancel leftovers when filled). */
export function runSparesLater(gameId: number) {
  runSpares(gameId).catch((e) => console.error("runSpares", e));
}

// ---------- the scheduler tick ----------
/** Idempotent: call hourly (or more often). */
export async function tick(now = new Date()) {
  const d = db();
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
