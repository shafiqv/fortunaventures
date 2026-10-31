import { currentUser } from "@/lib/auth";
import { getLeague, isOrganizer } from "@/lib/service";
import { leagueWorkbook } from "@/lib/excel";

export const dynamic = "force-dynamic";

// Organizer-only: download rosters + lineups as .xlsx
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const user = await currentUser();
  const league = getLeague(id);
  if (!user || !league || !isOrganizer(id, user.id)) return new Response("Not found", { status: 404 });
  const buf = await leagueWorkbook(league);
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${league.name.replace(/[^\w]+/g, "-")}-lineups.xlsx"`,
    },
  });
}
