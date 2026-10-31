/**
 * Demo data: a FAKE 4-team doubles league (made-up names, example.com emails) with a season in progress.
 *   npm run seed:demo   →  ./data/demo.db        npm run demo  →  app on that database
 * Organizer login: demo-organizer@example.com (the sign-in link is shown on screen in dev mode).
 */
process.env.DATABASE_PATH ??= "./data/demo.db";
import fs from "node:fs";
import Database from "better-sqlite3";
import { db, type User } from "../src/lib/db";
import * as svc from "../src/lib/service";
import { fmtLocal } from "../src/lib/dates";

// Safety: this script WIPES the database. Refuse if it holds anything other than demo data.
if (fs.existsSync(process.env.DATABASE_PATH!)) {
  const probe = new Database(process.env.DATABASE_PATH!, { readonly: true, fileMustExist: true });
  let real = 0;
  try { real = (probe.prepare("SELECT COUNT(*) c FROM users WHERE email NOT LIKE '%@example.com' AND email NOT LIKE '%@placeholder.invalid'").get() as { c: number }).c; } catch { /* empty/new db */ }
  probe.close();
  if (real > 0 && process.env.SEED_WIPE !== "1") {
    console.error(`Refusing to wipe ${process.env.DATABASE_PATH}: it contains ${real} real (non-example.com) user(s). Set SEED_WIPE=1 to override.`);
    process.exit(1);
  }
}
for (const ext of ["", "-wal", "-shm"]) fs.rmSync(process.env.DATABASE_PATH + ext, { force: true });

let seed = 20261031;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const first = ["Alex", "Sam", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Jamie", "Drew", "Chris", "Pat", "Lee", "Robin", "Devon", "Quinn", "Avery", "Cameron", "Reese", "Skyler", "Dana", "Kai", "Noel", "Rory", "Blair", "Shay", "Emerson", "Finley", "Harper", "Logan", "Parker", "Sage", "Teagan", "Wynn", "Ari", "Bryn", "Cory", "Dale", "Eden", "Gale", "Hollis"];
const last = ["Archer", "Bishop", "Calloway", "Dunmore", "Ellery", "Fairbank", "Garrity", "Hollander", "Ingram", "Jessup", "Kendrick", "Lockhart", "Mercer", "Nolan", "Ostrander", "Pemberton", "Quill", "Radcliffe", "Sterling", "Thackeray", "Underhill", "Vance", "Whitlock", "Yarrow", "Zeller", "Ashdown", "Brennan", "Cobb", "Draper", "Fenwick", "Gillis", "Hartley", "Iverson", "Jarvis", "Kimball", "Larkin", "Maddox", "Norwood", "Osgood", "Prescott"];
const teamNames = ["Net Gains 🔵", "Baseline Bandits 🟡", "Lob Squad ⚪", "Drop Shot Dynasty 🟢"];

const org = db().prepare("INSERT INTO users (email,name) VALUES ('demo-organizer@example.com','Demo Organizer') RETURNING *").get() as User;
const sizes = [10, 9, 10, 11];
let n = 0;
const roster = teamNames.map((t, ti) => {
  const players = Array.from({ length: sizes[ti] }, () => { const i = n++; return `${first[i]} ${last[i]}`; });
  const rows: string[] = [t + "\t\t"];
  for (let i = 0; i < players.length; i += 3) rows.push(players.slice(i, i + 3).join("\t"));
  return rows.join("\n");
}).join("\n");

const { id: leagueId } = svc.createLeagueFromRoster(org, "Demo Men's Fall League", 3, "19:00", roster);
const league = svc.getLeague(leagueId)!;
const teams = svc.leagueTeams(leagueId);

// Everyone gets an example.com email (+ some phones), a seed rating (stronger/weaker players), and the first player per team is captain.
for (const p of svc.leaguePlayers(leagueId)) {
  const slug = p.name.toLowerCase().replace(/[^a-z]+/g, ".");
  svc.setContact(p.id, `${slug}@example.com`, rnd() < 0.5 ? `+1416555${String(1000 + p.id).slice(-4)}` : "");
  if (rnd() < 0.5) db().prepare("UPDATE users SET sms_opt_in=1 WHERE id=? AND phone!=''").run(p.id);
  svc.setSeed(p.id, leagueId, Math.round(880 + rnd() * 300));
}
for (const t of teams) db().prepare("UPDATE members SET role='captain' WHERE team_id=? AND rank=1").run(t.id);

// Season: 10 Mondays ending in the future; Thanksgiving-style holiday in week 2. Start so that ~3 nights are already played.
const today = new Date();
const nextMon = new Date(today.getFullYear(), today.getMonth(), today.getDate() + ((8 - today.getDay()) % 7 || 7));
const start = new Date(nextMon.getFullYear(), nextMon.getMonth(), nextMon.getDate() - 28);
const startStr = fmtLocal(start).slice(0, 10);
const holiday = fmtLocal(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7)).slice(0, 10);
svc.generateLeagueSeason(league, startStr, 10, [holiday], "19:00", 3);

const winProb = (a: number, b: number) => 1 / (1 + Math.pow(10, (b - a) / 400));
const seedOf = (uid: number | null) => (uid ? (db().prepare("SELECT seed FROM members WHERE user_id=? LIMIT 1").get(uid) as { seed: number }).seed : 1000);
const now = Date.now();

// Play the nights that are already in the past, in order.
const rounds = svc.leagueRounds(leagueId);
const allRounds = db().prepare("SELECT DISTINCT substr(g.starts_at,1,10) d FROM games g JOIN teams t ON t.id=g.team_id WHERE t.league_id=? ORDER BY d").all(leagueId) as { d: string }[];
void rounds;
for (const { d } of allRounds) {
  if (new Date(d + "T19:00").getTime() > now) continue;
  const games = db().prepare("SELECT g.* FROM games g JOIN teams t ON t.id=g.team_id WHERE t.league_id=? AND substr(g.starts_at,1,10)=? ORDER BY g.matchup_id, g.id").all(leagueId, d) as import("../src/lib/db").Game[];
  for (const g of games) {
    const ms = svc.membersOf(g.team_id);
    ms.forEach((m) => svc.setStatus(g.id, m.id, rnd() < 0.72 ? "in" : "out"));
    if (svc.gameState(g.id).lineup.shortage > 0) ms.slice(0, 7).forEach((m) => svc.setStatus(g.id, m.id, "in"));
    svc.freezeAutoLineup(g.id);
    db().prepare("UPDATE games SET request_sent=1, reminder_sent=1, summary_sent=1 WHERE id=?").run(g.id);
  }
  const byMatchup = new Map<number, typeof games>();
  for (const g of games) byMatchup.set(g.matchup_id!, [...(byMatchup.get(g.matchup_id!) ?? []), g]);
  for (const [, [a, b]] of byMatchup) {
    const la = svc.gameState(a.id).lineup, lb = svc.gameState(b.id).lineup;
    const scores: svc.CourtScore[] = [];
    for (let c = 1; c <= 3; c++) {
      const sa = la.slots.filter((s) => s.line === c).reduce((x, s) => x + seedOf(s.userId), 0) / 2;
      const sb = lb.slots.filter((s) => s.line === c).reduce((x, s) => x + seedOf(s.userId), 0) / 2;
      const aWins = rnd() < winProb(sa, sb);
      const loser = () => Math.floor(rnd() * 5);
      const mk = (win: boolean): [number, number] => (win ? [6, loser()] : [loser(), 6]);
      const sets: [number, number][] = [mk(aWins), mk(rnd() < 0.3 ? !aWins : aWins)];
      if (sets[0][0] > sets[0][1] !== sets[1][0] > sets[1][1]) sets.push(aWins ? [10, Math.floor(rnd() * 9)] : [Math.floor(rnd() * 9), 10]);
      scores.push({ court: c, sets, tiebreak: true });
    }
    svc.saveResults(a.id, scores);
  }
  svc.recordPlayed(new Date(new Date(d + "T23:59").getTime()));
}

// A repeat offender: two no-shows (→ rating penalty) and one late cancel on the first team.
const pastGames = db().prepare("SELECT g.id FROM games g WHERE g.team_id=? AND g.starts_at<? ORDER BY g.starts_at").all(teams[0].id, fmtLocal(new Date(now))) as { id: number }[];
const flaky = svc.membersOf(teams[0].id)[5];
if (pastGames.length >= 2) { svc.setNoShows(pastGames[0].id, [flaky.id]); svc.setNoShows(pastGames[1].id, [flaky.id]); }

// Upcoming night: requests sent, answers trickling in; team 1 is SHORT (so you can try the spares flow).
const upcoming = db().prepare("SELECT g.* FROM games g JOIN teams t ON t.id=g.team_id WHERE t.league_id=? AND g.starts_at>? ORDER BY g.starts_at, g.matchup_id, g.id LIMIT 4").all(leagueId, fmtLocal(new Date(now))) as import("../src/lib/db").Game[];
for (const g of upcoming) {
  const ms = svc.membersOf(g.team_id);
  db().prepare("UPDATE games SET request_sent=1 WHERE id=?").run(g.id);
  ms.forEach((m, i) => {
    svc.setStatus(g.id, m.id, "none");
    const short = g.team_id === teams[0].id;
    const r = rnd();
    if (short) svc.setStatus(g.id, m.id, i < 4 ? "in" : i < 8 ? "out" : "none");
    else if (r < 0.6) svc.setStatus(g.id, m.id, "in");
    else if (r < 0.8) svc.setStatus(g.id, m.id, "out");
    else if (r < 0.9) svc.setStatus(g.id, m.id, "maybe");
  });
}
// Two spares on team 1 (so "Contact spares now" has someone to ask).
for (const [i, nm] of ["Spare Sidney Vale", "Spare Terry Moss"].entries()) {
  const email = `spare${i + 1}@example.com`;
  db().prepare("INSERT INTO users (email,name) VALUES (?,?)").run(email, nm.replace("Spare ", ""));
  const u = db().prepare("SELECT id FROM users WHERE email=?").get(email) as { id: number };
  db().prepare("INSERT INTO members (team_id,user_id,role,rank) VALUES (?,?, 'spare', 50)").run(teams[0].id, u.id);
}

const ratings = svc.leagueRatings(leagueId);
const top = [...ratings.entries()].sort((a, b) => b[1].rating - a[1].rating).slice(0, 3)
  .map(([id, r]) => `${(db().prepare("SELECT name FROM users WHERE id=?").get(id) as { name: string }).name} ${Math.round(r.rating)}`);
console.log(`Demo league ready: ${teams.length} teams, ${n} players, season from ${startStr}.`);
console.log(`Standings: ${svc.standings(leagueId).map((s) => `${s.name} ${s.courtsWon}`).join(" | ")}`);
console.log(`Top ratings: ${top.join(", ")}`);
console.log(`Flaky player (2 no-shows): ${flaky.name}, penalty ${ratings.get(flaky.id)?.penalty}`);
console.log(`Organizer: demo-organizer@example.com   League id: ${leagueId}`);
