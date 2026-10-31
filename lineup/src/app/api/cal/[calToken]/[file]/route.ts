import { NextRequest } from "next/server";
import { db, type Team, type User } from "@/lib/db";
import { upcomingGames } from "@/lib/service";
import { buildIcs } from "@/lib/ics";
import { appUrl } from "@/lib/notify";

export const dynamic = "force-dynamic";

// /api/cal/<personal token>/<teamId>.ics  — subscribe (webcal://) or download. Token identifies a team member.
export async function GET(req: NextRequest, { params }: { params: Promise<{ calToken: string; file: string }> }) {
  const { calToken, file } = await params;
  const teamId = Number(file.replace(/\.ics$/, ""));
  const user = db().prepare("SELECT * FROM users WHERE cal_token=?").get(calToken) as User | undefined;
  const member = user && db().prepare("SELECT 1 FROM members WHERE team_id=? AND user_id=?").get(teamId, user.id);
  const team = db().prepare("SELECT * FROM teams WHERE id=?").get(teamId) as Team | undefined;
  if (!user || !member || !team) return new Response("Not found", { status: 404 });
  const body = buildIcs(team, upcomingGames(teamId), team.name, appUrl());
  const dl: Record<string, string> = req.nextUrl.searchParams.get("download") ? { "content-disposition": `attachment; filename="${team.name.replace(/[^\w]+/g, "-")}.ics"` } : {};
  return new Response(body, { headers: { "content-type": "text/calendar; charset=utf-8", ...dl } });
}
