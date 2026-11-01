"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { endSession, requestLogin, requireUser } from "@/lib/auth";
import * as svc from "@/lib/service";
import { parseIcs, parseLeagueTo, parseScheduleText } from "@/lib/csv";
import type { Status } from "@/lib/lineup";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string, d: number) => { const n = Number(f.get(k)); return Number.isFinite(n) && f.get(k) !== null && f.get(k) !== "" ? n : d; };

async function captainOf(teamId: number) {
  const u = await requireUser();
  if (!svc.isCaptain(teamId, u.id)) throw new Error("Captains only");
  return u;
}

export async function login(_: unknown, f: FormData): Promise<{ sent: boolean; devLink?: string | null; error?: string }> {
  const r = await requestLogin(str(f, "email"));
  if (!r.ok) return { sent: false, error: "Enter a valid email address." };
  return { sent: true, devLink: r.devLink };
}

export async function logout() { await endSession(); redirect("/"); }

export async function saveProfile(f: FormData) {
  const u = await requireUser();
  db().prepare("UPDATE users SET name=?, phone=?, sms_opt_in=? WHERE id=?")
    .run(str(f, "name"), str(f, "phone"), f.get("sms") ? 1 : 0, u.id);
  revalidatePath("/profile");
}

export async function createTeam(f: FormData) {
  const u = await requireUser();
  const format = str(f, "format") === "doubles" ? "doubles" : "singles";
  const id = svc.createTeam(u, str(f, "name") || "My team", str(f, "sport") || "tennis", format, Math.max(1, num(f, "lines", 4)));
  redirect(`/teams/${id}`);
}

export async function saveTeamSettings(teamId: number, f: FormData) {
  await captainOf(teamId);
  db().prepare(`UPDATE teams SET name=?, lines=?, format=?, request_business_days=?, reminder_days=?, spares_days=?, summary_days=?,
    spare_mode=?, spare_expiry_hours=?, auto_spares=? WHERE id=?`).run(
    str(f, "name"), Math.max(1, num(f, "lines", 4)), str(f, "format") === "doubles" ? "doubles" : "singles",
    num(f, "request_business_days", 5), num(f, "reminder_days", 3), num(f, "spares_days", 2), num(f, "summary_days", 1),
    str(f, "spare_mode") === "first_come" ? "first_come" : "rolling", num(f, "spare_expiry_hours", 12), f.get("auto_spares") ? 1 : 0, teamId);
  revalidatePath(`/teams/${teamId}`);
}

export async function inviteMembers(teamId: number, f: FormData) {
  await captainOf(teamId);
  const team = svc.getTeam(teamId)!;
  for (const e of str(f, "emails").split(/[\s,;]+/).filter(Boolean)) await svc.inviteByEmail(team, e);
  revalidatePath(`/teams/${teamId}`);
}

export async function updateMember(teamId: number, userId: number, f: FormData) {
  await captainOf(teamId);
  if (f.get("remove")) db().prepare("DELETE FROM members WHERE team_id=? AND user_id=?").run(teamId, userId);
  else {
    const role = ["captain", "player", "spare"].includes(str(f, "role")) ? str(f, "role") : "player";
    db().prepare("UPDATE members SET role=?, rank=? WHERE team_id=? AND user_id=?").run(role, num(f, "rank", 99), teamId, userId);
  }
  revalidatePath(`/teams/${teamId}`);
}

export async function importSchedule(teamId: number, _: unknown, f: FormData): Promise<{ msg: string }> {
  await captainOf(teamId);
  let text = str(f, "text");
  const url = str(f, "url");
  const file = f.get("file");
  if (file instanceof File && file.size) text = await file.text();
  else if (url) {
    try {
      const r = await fetch(url.replace(/^webcal:/i, "https:"), { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return { msg: `Couldn't fetch that URL (${r.status}).` };
      text = await r.text();
    } catch { return { msg: "Couldn't fetch that URL." }; }
  }
  if (!text) return { msg: "Paste a schedule, upload a file, or give a calendar URL." };
  const parsed = text.includes("BEGIN:VCALENDAR") ? parseIcs(text)
    : /^\s*\([HA]\)\s/im.test(text) ? parseLeagueTo(text, str(f, "own_name"))
    : parseScheduleText(text);
  const res = parsed.games.length ? svc.importGames(teamId, parsed.games) : { added: 0, skipped: 0 };
  revalidatePath(`/teams/${teamId}`);
  return { msg: `Added ${res.added} game(s), skipped ${res.skipped} duplicate(s).${parsed.errors.length ? " Problems: " + parsed.errors.join(" ") : ""}` };
}

export async function saveGame(teamId: number, gameId: number, f: FormData) {
  await captainOf(teamId);
  const startsAt = `${str(f, "date")}T${str(f, "time") || "19:00"}`;
  db().prepare("UPDATE games SET starts_at=?, opponent=?, location=?, address=?, notes=? WHERE id=? AND team_id=?")
    .run(startsAt, str(f, "opponent"), str(f, "location"), str(f, "address"), str(f, "notes"), gameId, teamId);
  revalidatePath(`/teams/${teamId}`);
}

export async function deleteGame(teamId: number, gameId: number) {
  await captainOf(teamId);
  db().prepare("DELETE FROM games WHERE id=? AND team_id=?").run(gameId, teamId);
  redirect(`/teams/${teamId}`);
}

export async function captainSetStatus(teamId: number, gameId: number, userId: number, status: Status) {
  await captainOf(teamId);
  svc.setStatus(gameId, userId, status);
  revalidatePath(`/teams/${teamId}/games/${gameId}`);
}

export async function gameAction(teamId: number, gameId: number, action: "request" | "remind" | "spares" | "summary") {
  await captainOf(teamId);
  const g = svc.getGame(gameId)!;
  if (action === "request") { await svc.sendRequests(g, false); db().prepare("UPDATE games SET request_sent=1 WHERE id=?").run(gameId); }
  if (action === "remind") await svc.sendRequests(g, true);
  if (action === "spares") { await svc.runSpares(gameId); db().prepare("UPDATE games SET spares_started=1 WHERE id=?").run(gameId); }
  if (action === "summary") await svc.sendSummary(g);
  revalidatePath(`/teams/${teamId}/games/${gameId}`);
}

export async function respond(token: string, status: Status) {
  const r = db().prepare("SELECT game_id, user_id FROM responses WHERE token=?").get(token) as { game_id: number; user_id: number } | undefined;
  if (!r || !["in", "out", "maybe"].includes(status)) return;
  await svc.respondAndNotify(r.game_id, r.user_id, status); // player's own answer: late cancels tracked, promoted bench players told
  svc.runSparesLater(r.game_id);
  revalidatePath(`/r/${token}`);
}

export async function respondSpare(token: string, accept: boolean) {
  svc.respondToOffer(token, accept);
  revalidatePath(`/s/${token}`);
}

// ---------- organizer (league admin) ----------
import { xlsxToText } from "@/lib/excel";

async function organizerOf(leagueId: number) {
  const u = await requireUser();
  if (!svc.isOrganizer(leagueId, u.id)) throw new Error("Organizers only");
  return u;
}

export async function createLeague(_: unknown, f: FormData): Promise<{ error: string }> {
  const u = await requireUser();
  let text = str(f, "roster");
  const file = f.get("file");
  if (file instanceof File && file.size) text = file.name.toLowerCase().endsWith(".xlsx") ? await xlsxToText(await file.arrayBuffer()) : await file.text();
  if (!text) return { error: "Paste the roster from Excel, or upload the file." };
  const r = svc.createLeagueFromRoster(u, str(f, "name") || "League", Math.max(1, num(f, "courts", 3)), str(f, "time") || "19:00", text);
  if (!r.id) return { error: r.errors.join(" ") };
  redirect(`/admin/leagues/${r.id}`);
}

export async function saveContacts(leagueId: number, f: FormData) {
  await organizerOf(leagueId);
  for (const p of svc.leaguePlayers(leagueId)) {
    const email = str(f, `email_${p.id}`), phone = str(f, `phone_${p.id}`);
    if (email || phone) svc.setContact(p.id, email, phone);
    const seed = Number(f.get(`seed_${p.id}`));
    if (Number.isFinite(seed) && seed >= 100 && seed <= 3000 && seed !== p.seed) svc.setSeed(p.id, leagueId, Math.round(seed));
  }
  revalidatePath(`/admin/leagues/${leagueId}`);
}

export async function createRound(leagueId: number, f: FormData) {
  await organizerOf(leagueId);
  const league = svc.getLeague(leagueId)!;
  const ms = [0, 1, 2, 3].map((i) => ({ a: num(f, `a${i}`, 0), b: num(f, `b${i}`, 0), time: str(f, `t${i}`) || league.default_time, courts: Math.max(1, num(f, `c${i}`, league.courts_per_matchup)) }));
  svc.createRound(league, str(f, "date"), ms);
  revalidatePath(`/admin/leagues/${leagueId}`);
}

export async function editMatchup(leagueId: number, matchupId: number, f: FormData) {
  await organizerOf(leagueId);
  svc.updateMatchup(matchupId, str(f, "time"), Math.max(1, num(f, "courts", 3)));
  revalidatePath(`/admin/leagues/${leagueId}`);
}

export async function publishRound(leagueId: number, day: string) {
  await organizerOf(leagueId);
  const games = db().prepare("SELECT g.* FROM games g JOIN teams t ON t.id=g.team_id WHERE t.league_id=? AND substr(g.starts_at,1,10)=?").all(leagueId, day) as import("@/lib/db").Game[];
  for (const g of games) { await svc.sendRequests(g, false); db().prepare("UPDATE games SET request_sent=1 WHERE id=?").run(g.id); }
  revalidatePath(`/admin/leagues/${leagueId}`);
}

export async function generateSeason(leagueId: number, f: FormData) {
  await organizerOf(leagueId);
  const league = svc.getLeague(leagueId)!;
  const holidays = str(f, "holidays").split(/[\s,;]+/).filter(Boolean);
  svc.generateLeagueSeason(league, str(f, "start"), Math.min(40, Math.max(1, num(f, "weeks", 10))), holidays, str(f, "time") || league.default_time, Math.max(1, num(f, "courts", league.courts_per_matchup)));
  revalidatePath(`/admin/leagues/${leagueId}`);
}

export async function saveLineupAction(teamId: number, gameId: number, total: number, f: FormData) {
  await captainOf(teamId);
  const ids = Array.from({ length: total }, (_, i) => { const v = Number(f.get(`slot_${i + 1}`)); return v > 0 ? v : null; });
  svc.saveLineup(gameId, ids);
  revalidatePath(`/teams/${teamId}/games/${gameId}`);
}

export async function lineupMode(teamId: number, gameId: number, mode: "auto" | "freeze") {
  await captainOf(teamId);
  if (mode === "auto") svc.resetLineup(gameId); else svc.freezeAutoLineup(gameId);
  revalidatePath(`/teams/${teamId}/games/${gameId}`);
}

export async function addSubAction(teamId: number, gameId: number, f: FormData) {
  await captainOf(teamId);
  if (str(f, "name")) svc.addSub(gameId, str(f, "name"), str(f, "email"));
  revalidatePath(`/teams/${teamId}/games/${gameId}`);
}

export async function saveResultsAction(teamId: number, gameId: number, courts: number, f: FormData) {
  await captainOf(teamId);
  const n = (k: string) => { const v = f.get(k); return v === null || v === "" ? null : Math.max(0, Math.round(Number(v))); };
  const scores: svc.CourtScore[] = [];
  for (let c = 1; c <= courts; c++) {
    const sets: [number, number][] = [];
    for (const i of [1, 2, 3]) {
      const x = n(`s${i}f_${c}`), y = n(`s${i}a_${c}`);
      if (x !== null && y !== null) sets.push([x, y]);
    }
    if (sets.length) scores.push({ court: c, sets, tiebreak: !f.get(`full3_${c}`) });
  }
  if (scores.length) svc.saveResults(gameId, scores);
  const { rows } = svc.gameState(gameId);
  svc.setNoShows(gameId, rows.filter((r) => f.get(`noshow_${r.user_id}`)).map((r) => r.user_id));
  revalidatePath(`/teams/${teamId}/games/${gameId}`);
}

export async function forgiveEvent(teamId: number, gameId: number, eventId: number) {
  await captainOf(teamId);
  svc.deleteEvent(eventId);
  revalidatePath(`/teams/${teamId}/games/${gameId}`);
}

export async function setLineupPolicy(leagueId: number, f: FormData) {
  await organizerOf(leagueId);
  const pol = ["rotation_rating", "rating", "rotation"].includes(str(f, "policy")) ? str(f, "policy") : "rotation_rating";
  db().prepare("UPDATE teams SET lineup_policy=? WHERE league_id=?").run(pol, leagueId);
  revalidatePath(`/admin/leagues/${leagueId}`);
}

export async function broadcastTeam(teamId: number, f: FormData) {
  const u = await captainOf(teamId);
  if (str(f, "subject") && str(f, "body")) await svc.sendBroadcast(u, { teamId }, str(f, "subject"), str(f, "body"), !!f.get("urgent"));
  revalidatePath(`/teams/${teamId}`);
}

export async function broadcastLeague(leagueId: number, f: FormData) {
  const u = await organizerOf(leagueId);
  if (str(f, "subject") && str(f, "body")) await svc.sendBroadcast(u, { leagueId }, str(f, "subject"), str(f, "body"), !!f.get("urgent"));
  revalidatePath(`/admin/leagues/${leagueId}`);
}
