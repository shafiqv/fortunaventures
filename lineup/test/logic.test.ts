import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLineup } from "../src/lib/lineup";
import { nextToOffer } from "../src/lib/spares";
import { parseScheduleText, parseIcs } from "../src/lib/csv";
import { businessDaysBefore, parseLocal } from "../src/lib/dates";

test("lineup fills by rank and benches extras", () => {
  const r = buildLineup(
    [1, 2, 3, 4, 5, 6].map((i) => ({ userId: i, rank: i, status: "in" as const })),
    2, "doubles",
  );
  assert.equal(r.total, 4);
  assert.deepEqual(r.slots.map((s) => s.userId), [1, 2, 3, 4]);
  assert.deepEqual(r.slots.map((s) => s.line), [1, 1, 2, 2]);
  assert.deepEqual(r.bench, [5, 6]);
  assert.equal(r.shortage, 0);
});

test("lineup reports shortage; ignores out/maybe/none", () => {
  const r = buildLineup(
    [
      { userId: 1, rank: 1, status: "in" },
      { userId: 2, rank: 2, status: "maybe" },
      { userId: 3, rank: 3, status: "out" },
      { userId: 4, rank: 4, status: "none" },
    ],
    4, "singles",
  );
  assert.equal(r.shortage, 3);
  assert.equal(r.slots[0].userId, 1);
  assert.equal(r.slots[1].userId, null);
});

test("spares: rolling asks one per open spot, first_come asks everyone", () => {
  assert.deepEqual(nextToOffer("rolling", 1, [10, 11, 12], []), [10]);
  assert.deepEqual(nextToOffer("rolling", 2, [10, 11, 12], [{ userId: 10, status: "pending" }]), [11]);
  assert.deepEqual(nextToOffer("rolling", 1, [10, 11, 12], [{ userId: 10, status: "declined" }]), [11]);
  assert.deepEqual(nextToOffer("rolling", 0, [10], []), []);
  assert.deepEqual(nextToOffer("first_come", 1, [10, 11, 12], [{ userId: 10, status: "pending" }]), [11, 12]);
});

test("business days skip weekends", () => {
  // Wed 2026-11-11 minus 5 business days = Wed 2026-11-04
  const d = businessDaysBefore(parseLocal("2026-11-11T13:00"), 5);
  assert.equal(d.getDate(), 4);
  // Mon 2026-11-09 minus 4 business days = Tue 2026-11-03
  assert.equal(businessDaysBefore(parseLocal("2026-11-09T13:00"), 4).getDate(), 3);
});

test("csv import handles varied headers, times and dates", () => {
  const { games, errors } = parseScheduleText(
    'Date,Time,Opponent,Location\n2026-11-05,1:40 PM,"Granite Club, A",Away\nNov 12 2026,13:00,Badminton & Racquet,Home\n',
  );
  assert.deepEqual(errors, []);
  assert.equal(games[0].startsAt, "2026-11-05T13:40");
  assert.equal(games[0].opponent, "Granite Club, A");
  assert.equal(games[1].startsAt, "2026-11-12T13:00");
});

test("ics import", () => {
  const ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20261105T134000\r\nSUMMARY:vs Granite\r\nLOCATION:Granite Club\\, Toronto\r\nEND:VEVENT\r\nEND:VCALENDAR";
  const { games } = parseIcs(ics);
  assert.equal(games[0].startsAt, "2026-11-05T13:40");
  assert.equal(games[0].location, "Granite Club, Toronto");
});
