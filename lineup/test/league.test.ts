process.env.DATABASE_PATH = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";
import { db, type User } from "../src/lib/db";
import * as svc from "../src/lib/service";
import { parseRoster } from "../src/lib/roster";
import { leagueWorkbook, xlsxToText } from "../src/lib/excel";
import ExcelJS from "exceljs";

const SHEET = [
  "The Conclave 🔵\t\t",
  "Michael Hutchinson\tAlan  Mihic\tJeremy Butteriss",
  "Alexander McDonald\tAndrew Kalra\tMichael Paisley",
  "\tDrew McDonald\tMichael Feldman",
  "\tPeter Jackson\t",
  "The Dirtballers 🟡\t\t",
  "Ara Sahakian\tMichael Vettese\tAnthony Bird",
  "Michael Dennis\tMichael Tanaka\tMark Dunn",
  "Sanjay Nakra\tKevin Gauci\tJohn Dill",
].join("\n");

test("roster paste in the organizer's sheet layout", () => {
  const { teams, errors } = parseRoster(SHEET);
  assert.deepEqual(errors, []);
  assert.deepEqual(teams.map((t) => [t.name, t.players.length]), [["The Conclave 🔵", 9], ["The Dirtballers 🟡", 9]]);
  assert.ok(teams[0].players.includes("Peter Jackson"));
});

test("league: rounds, per-matchup courts/time, fair rotation, placeholders, excel", async () => {
  const org = db().prepare("INSERT INTO users (email,name) VALUES ('org@x.com','Org') RETURNING *").get() as User;
  const { id } = svc.createLeagueFromRoster(org, "Men's Fall", 3, "19:00", SHEET);
  assert.ok(id);
  const teams = svc.leagueTeams(id);
  assert.equal(teams.length, 2);
  assert.equal(svc.isOrganizer(id, org.id), true);
  assert.equal(svc.roleOf(teams[0].id, org.id), "captain"); // organizer manages all teams

  // reduced-courts week at an odd time, then a normal week
  assert.equal(svc.createRound(svc.getLeague(id)!, "2030-09-28", [{ a: teams[0].id, b: teams[1].id, time: "18:30", courts: 2 }]), 1);
  assert.equal(svc.createRound(svc.getLeague(id)!, "2030-10-05", [{ a: teams[0].id, b: teams[1].id, time: "19:00", courts: 3 }]), 1);
  const rounds = svc.leagueRounds(id);
  assert.equal(rounds.length, 2);
  const w1 = rounds[0].matchups[0];
  assert.equal(w1.games.length, 2);
  assert.equal(svc.gameState(w1.games[0].id).lineup.total, 4); // 2 courts doubles
  svc.updateMatchup(w1.id, "20:00", 3);
  assert.equal(svc.gameState(w1.games[0].id).game.starts_at, "2030-09-28T20:00");
  assert.equal(svc.gameState(w1.games[1].id).lineup.total, 6); // both teams updated

  // Conclave: all 11 say in for week 1 → 6 play, 5 bench. Rotation: next week the 5 who sat play first.
  const g1 = w1.games.find((g) => g.team_id === teams[0].id)!;
  const rows = svc.membersOf(teams[0].id);
  for (const m of rows) { svc.setStatus(g1.id, m.id, "in"); }
  const first = svc.gameState(g1.id).lineup;
  assert.equal(first.slots.filter((s) => s.userId).length, 6);
  const benched = first.bench;
  assert.equal(benched.length, 3);
  db().prepare("UPDATE games SET starts_at='2000-01-01T19:00' WHERE id=?").run(g1.id); // pretend it was played
  svc.recordPlayed();
  const g2 = rounds[1].matchups[0].games.find((g) => g.team_id === teams[0].id)!;
  for (const m of rows) svc.setStatus(g2.id, m.id, "in");
  const second = svc.gameState(g2.id).lineup;
  const playing2 = second.slots.map((s) => s.userId);
  for (const b of benched) assert.ok(playing2.includes(b), "everyone who sat out plays next week");

  // placeholder → real email, and merge with an existing account
  const ph = svc.leaguePlayers(id)[0];
  assert.ok(svc.isPlaceholderEmail(ph.email));
  svc.setContact(ph.id, "mike@x.com", "+14165550000");
  assert.equal((db().prepare("SELECT email FROM users WHERE id=?").get(ph.id) as { email: string }).email, "mike@x.com");
  const existing = db().prepare("INSERT INTO users (email,name) VALUES ('real@x.com','') RETURNING *").get() as User;
  const ph2 = svc.leaguePlayers(id)[1];
  svc.setContact(ph2.id, "real@x.com", "");
  assert.equal(svc.roleOf(teams[0].id, existing.id), "player");

  // excel round trip: export has both sheets; the Rosters sheet re-imports with the same parser
  const buf = await leagueWorkbook(svc.getLeague(id)!);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ["Rosters", "Lineups"]);
  const text = await xlsxToText(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const again = parseRoster(text);
  assert.equal(again.teams.length, 2);
  assert.equal(again.teams[0].players.length, 9);
});

import { generateSeason, roundRobin } from "../src/lib/season";
test("season generator reproduces the Donalda schedule (Blue,Yellow,White,Green; Thanksgiving off)", () => {
  const [B, Y, W, G] = [1, 2, 3, 4];
  const wk = generateSeason([B, Y, W, G], "2026-09-14", 10, ["2026-10-12"]);
  const pairs = (i: number) => wk[i].pairs.map(([a, b]) => `${Math.min(a, b)}v${Math.max(a, b)}`).sort().join(",");
  assert.equal(wk[0].date, "2026-09-14");
  assert.equal(pairs(0), "1v2,3v4"); // Blue-Yellow, White-Green
  assert.equal(pairs(1), "1v3,2v4"); // Blue-White,  Yellow-Green
  assert.equal(pairs(2), "1v4,2v3"); // Blue-Green,  White-Yellow
  assert.equal(pairs(3), "1v2,3v4"); // cycle repeats (week 4)
  assert.equal(wk[4].holiday, true); // Oct 12 Thanksgiving
  assert.equal(pairs(5), "1v3,2v4"); // week 6 continues cycle: Blue-White
  assert.equal(roundRobin([1, 2, 3, 4, 5, 6]).length, 5);
});

test("manual lineup: pairs, sub by name, 'out' opens the slot, spare accept fills it", async () => {
  const org = db().prepare("INSERT INTO users (email,name) VALUES ('o2@x.com','O2') RETURNING *").get() as User;
  const { id } = svc.createLeagueFromRoster(org, "L2", 3, "19:00", SHEET);
  const [A, B] = svc.leagueTeams(id);
  svc.createRound(svc.getLeague(id)!, "2031-01-05", [{ a: A.id, b: B.id, time: "19:00", courts: 3 }]);
  const g = svc.leagueRounds(id)[0].matchups[0].games.find((x) => x.team_id === A.id)!;
  const ms = svc.membersOf(A.id);
  for (const m of ms) svc.setStatus(g.id, m.id, "in");
  svc.saveLineup(g.id, ms.slice(0, 6).map((m) => m.id));
  let st = svc.gameState(g.id);
  assert.equal(st.lineup.shortage, 0);
  assert.equal(st.lineup.slots[1].line, 1); // positions 1+2 = Court 1 pair
  assert.equal(st.lineup.bench.length, 3);
  svc.setStatus(g.id, ms[0].id, "out"); // a placed player drops
  st = svc.gameState(g.id);
  assert.equal(st.lineup.shortage, 1);
  const subId = svc.addSub(g.id, "Steve Chaimberg (Sub)", ""); // fills the vacated slot
  st = svc.gameState(g.id);
  assert.equal(st.lineup.shortage, 0);
  assert.equal(st.lineup.slots[0].userId, subId);
  assert.equal(svc.membersOf(A.id).find((m) => m.id === subId)?.role, "spare");
});

import { computeRatings } from "../src/lib/ratings";
import { buildLineup } from "../src/lib/lineup";

test("ratings: zero-sum, upsets move more, partner strength matters", () => {
  const seeds = new Map([[1, 1200], [2, 1200], [3, 1000], [4, 1000]]);
  // expected result, better than expected: strong pair beats weak pair 6-0
  const exp = computeRatings(seeds, [[{ a: [1, 2], b: [3, 4], aScore: 6, bScore: 0 }]]);
  // upset: weak pair beats strong pair 6-2
  const ups = computeRatings(seeds, [[{ a: [1, 2], b: [3, 4], aScore: 2, bScore: 6 }]]);
  assert.ok(exp.get(1)!.rating > 1200 && exp.get(3)!.rating < 1000);
  assert.ok(ups.get(3)!.rating - 1000 > exp.get(1)!.rating - 1200, "upset win is worth more than expected win");
  const sum = (m: Map<number, { rating: number }>) => [...m.values()].reduce((s, x) => s + x.rating, 0);
  assert.ok(Math.abs(sum(exp) - 4400) < 1e-6, "ratings are conserved");
  // partner matters: same opponents, weak player with strong partner is expected to win more → gains less than with weak partner
  const weakPartner = computeRatings(new Map([[1, 1000], [2, 1000], [3, 1000], [4, 1400]]), [[{ a: [1, 2], b: [3, 4], aScore: 6, bScore: 4 }]]);
  assert.ok(weakPartner.get(1)!.rating > 1000 + 0 && weakPartner.get(4)!.rating < 1400);
});

test("lineup by skill: best two on court 1, bench chosen by rotation", () => {
  const cands = [
    { userId: 1, rank: 1, status: "in" as const, skill: 900, priority: 0 },
    { userId: 2, rank: 2, status: "in" as const, skill: 1300, priority: 0 },
    { userId: 3, rank: 3, status: "in" as const, skill: 1100, priority: 0 },
    { userId: 4, rank: 4, status: "in" as const, skill: 1500, priority: 0 },
    { userId: 5, rank: 5, status: "in" as const, skill: 1000, priority: 0 },
    { userId: 6, rank: 6, status: "in" as const, skill: 1200, priority: 0 },
    { userId: 7, rank: 7, status: "in" as const, skill: 1600, priority: 3 }, // played a lot lately → sits
  ];
  const r = buildLineup(cands, 3, "doubles", true);
  assert.deepEqual(r.bench, [7]);
  assert.deepEqual(r.slots.map((s) => s.userId), [4, 2, 6, 3, 5, 1]); // court1: 4,2  court2: 6,3  court3: 5,1
  assert.deepEqual(r.slots.map((s) => s.line), [1, 1, 2, 2, 3, 3]);
});

test("league e2e: scores mirror to opponent, ratings change, next week court 1 = best two available", () => {
  const org = db().prepare("INSERT INTO users (email,name) VALUES ('o3@x.com','O3') RETURNING *").get() as User;
  const { id } = svc.createLeagueFromRoster(org, "L3", 3, "19:00", SHEET);
  const [A, B] = svc.leagueTeams(id);
  const lg = svc.getLeague(id)!;
  svc.createRound(lg, "2031-02-03", [{ a: A.id, b: B.id, time: "19:00", courts: 3 }]);
  svc.createRound(lg, "2031-02-10", [{ a: A.id, b: B.id, time: "19:00", courts: 3 }]);
  const r = svc.leagueRounds(id);
  const gA1 = r[0].matchups[0].games.find((g) => g.team_id === A.id)!, gB1 = r[0].matchups[0].games.find((g) => g.team_id === B.id)!;
  const ma = svc.membersOf(A.id), mb = svc.membersOf(B.id);
  for (const m of ma) svc.setStatus(gA1.id, m.id, "in");
  for (const m of mb) svc.setStatus(gB1.id, m.id, "in");
  svc.saveLineup(gA1.id, ma.slice(0, 6).map((m) => m.id));
  svc.saveLineup(gB1.id, mb.slice(0, 6).map((m) => m.id));
  svc.saveResults(gA1.id, [{ court: 1, forScore: 6, againstScore: 1 }, { court: 2, forScore: 6, againstScore: 2 }, { court: 3, forScore: 5, againstScore: 6 }]);
  assert.equal(svc.resultsFor(gB1.id)[0].for_score, 1); // mirrored & swapped
  const ratings = svc.leagueRatings(id);
  assert.ok(ratings.get(ma[0].id)!.rating > 1000, "court-1 winners go up");
  assert.ok(ratings.get(mb[0].id)!.rating < 1000, "court-1 losers go down");
  assert.ok(ratings.get(ma[4].id)!.rating < 1000, "court-3 loser (our side) goes down");

  // week 2: everyone available → team A selected by rotation (benched 3 first), slotted by rating
  const gA2 = r[1].matchups[0].games.find((g) => g.team_id === A.id)!;
  db().prepare("UPDATE games SET starts_at='2000-01-01T19:00' WHERE id IN (?,?)").run(gA1.id, gB1.id);
  svc.recordPlayed();
  for (const m of ma) svc.setStatus(gA2.id, m.id, "in");
  const st = svc.gameState(gA2.id);
  const benchedLastTime = ma.slice(6).map((m) => m.id);
  for (const b of benchedLastTime) assert.ok(st.lineup.slots.some((s) => s.userId === b), "benched players play next");
  const order = st.lineup.slots.map((s) => ratings.get(s.userId!)?.rating ?? 1000);
  assert.deepEqual(order, [...order].sort((x, y) => y - x), "court order follows rating");
});
