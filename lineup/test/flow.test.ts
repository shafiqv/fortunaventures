process.env.DATABASE_PATH = ":memory:";
import { test } from "node:test";
import assert from "node:assert/strict";
import { db, type User } from "../src/lib/db";
import * as svc from "../src/lib/service";
import { fmtLocal } from "../src/lib/dates";

const mkUser = (email: string, phone = "") => {
  db().prepare("INSERT INTO users (email,name,phone,sms_opt_in) VALUES (?,?,?,?)").run(email, email.split("@")[0], phone, phone ? 1 : 0);
  return db().prepare("SELECT * FROM users WHERE email=?").get(email) as User;
};

test("end to end: request → responses → shortage → rolling spares → filled", async () => {
  const cap = mkUser("cap@x.com");
  const teamId = svc.createTeam(cap, "Squash A", "squash", "singles", 4);
  const players = [1, 2, 3, 4, 5].map((i) => mkUser(`p${i}@x.com`, i === 1 ? "+14165550101" : ""));
  players.forEach((p) => svc.joinTeam(teamId, p.id));
  const spares = [1, 2].map((i) => mkUser(`s${i}@x.com`));
  spares.forEach((s) => {
    svc.joinTeam(teamId, s.id);
    db().prepare("UPDATE members SET role='spare', rank=? WHERE team_id=? AND user_id=?").run(50, teamId, s.id);
  });

  // game 4 days from now → inside the 5-business-day window; captain (rank1) is also a player
  const when = new Date(Date.now() + 4 * 86400_000);
  when.setHours(13, 40, 0, 0);
  svc.importGames(teamId, [{ startsAt: fmtLocal(when), opponent: "Granite", location: "Away", notes: "" }]);
  const game = db().prepare("SELECT * FROM games").get() as never as { id: number };

  const log = await svc.tick();
  assert.ok(log.some((l) => l.startsWith("request")));
  assert.equal((db().prepare("SELECT COUNT(*) c FROM responses").get() as { c: number }).c, 6); // 5 players + captain

  // Everyone says out except 2 → shortage of 2
  for (const r of svc.responsesFor(game.id)) svc.setStatus(game.id, r.user_id, "out");
  svc.setStatus(game.id, players[0].id, "in");
  svc.setStatus(game.id, players[1].id, "in");
  assert.equal(svc.gameState(game.id).lineup.shortage, 2);

  await svc.runSpares(game.id);
  let offers = svc.offersFor(game.id);
  assert.equal(offers.length, 2); // rolling: one per open spot

  // first declines → rolling has nobody else, second accepts
  assert.equal(svc.respondToOffer(offers[0].token, false), "declined");
  assert.equal(svc.respondToOffer(offers[1].token, true), "accepted");
  assert.equal(svc.gameState(game.id).lineup.shortage, 1);

  // someone else flips to "in" → full; late spare is told it's filled
  svc.setStatus(game.id, players[2].id, "in");
  assert.equal(svc.gameState(game.id).lineup.shortage, 0);
  await svc.runSpares(game.id);
  assert.equal(svc.offersFor(game.id).filter((o) => o.status === "pending").length, 0);
});

test("first_come: only as many acceptances as open spots", async () => {
  const cap = mkUser("cap2@x.com");
  const teamId = svc.createTeam(cap, "Tennis B", "tennis", "doubles", 1);
  db().prepare("UPDATE teams SET spare_mode='first_come' WHERE id=?").run(teamId);
  const sp = [1, 2, 3].map((i) => mkUser(`fs${i}@x.com`));
  sp.forEach((s) => { svc.joinTeam(teamId, s.id); db().prepare("UPDATE members SET role='spare' WHERE team_id=? AND user_id=?").run(teamId, s.id); });
  svc.importGames(teamId, [{ startsAt: "2030-01-01T10:00", opponent: "X", location: "", notes: "" }]);
  const g = db().prepare("SELECT id FROM games WHERE team_id=?").get(teamId) as { id: number };
  svc.setStatus(g.id, cap.id, "in"); // doubles, 1 line → need 2; have 1
  await svc.runSpares(g.id);
  const offers = svc.offersFor(g.id);
  assert.equal(offers.length, 3);
  assert.equal(svc.respondToOffer(offers[2].token, true), "accepted");
  assert.equal(svc.respondToOffer(offers[0].token, true), "filled");
});
