import { db } from "@/lib/db";
import { getGame, getTeam } from "@/lib/service";
import { buildIcs } from "@/lib/ics";
import { appUrl } from "@/lib/notify";

export const dynamic = "force-dynamic";

// /api/game-ics/<response-or-offer token>.ics — one match, from an email/SMS link.
export async function GET(_: Request, { params }: { params: Promise<{ file: string }> }) {
  const token = (await params).file.replace(/\.ics$/, "");
  const r = (db().prepare("SELECT game_id FROM responses WHERE token=?").get(token) ??
    db().prepare("SELECT game_id FROM spare_offers WHERE token=?").get(token)) as { game_id: number } | undefined;
  const game = r && getGame(r.game_id);
  const team = game && getTeam(game.team_id);
  if (!game || !team) return new Response("Not found", { status: 404 });
  return new Response(buildIcs(team, [game], team.name, appUrl()), {
    headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="match-${game.id}.ics"` },
  });
}
