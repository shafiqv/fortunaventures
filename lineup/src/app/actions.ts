"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { endSession, requestLogin, requireUser } from "@/lib/auth";
import * as svc from "@/lib/service";
import { parseIcs, parseScheduleText } from "@/lib/csv";
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
  const parsed = text.includes("BEGIN:VCALENDAR") ? parseIcs(text) : parseScheduleText(text);
  const res = parsed.games.length ? svc.importGames(teamId, parsed.games) : { added: 0, skipped: 0 };
  revalidatePath(`/teams/${teamId}`);
  return { msg: `Added ${res.added} game(s), skipped ${res.skipped} duplicate(s).${parsed.errors.length ? " Problems: " + parsed.errors.join(" ") : ""}` };
}

export async function saveGame(teamId: number, gameId: number, f: FormData) {
  await captainOf(teamId);
  const startsAt = `${str(f, "date")}T${str(f, "time") || "19:00"}`;
  db().prepare("UPDATE games SET starts_at=?, opponent=?, location=?, notes=? WHERE id=? AND team_id=?")
    .run(startsAt, str(f, "opponent"), str(f, "location"), str(f, "notes"), gameId, teamId);
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
  svc.setStatus(r.game_id, r.user_id, status);
  svc.runSparesLater(r.game_id);
  revalidatePath(`/r/${token}`);
}

export async function respondSpare(token: string, accept: boolean) {
  svc.respondToOffer(token, accept);
  revalidatePath(`/s/${token}`);
}
