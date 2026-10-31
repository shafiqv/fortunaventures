import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import * as svc from "@/lib/service";
import StandingsTable from "../../StandingsTable";

export default async function LeagueStandings({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const u = await requireUser();
  const league = svc.getLeague(id);
  const member = db().prepare("SELECT 1 FROM members m JOIN teams t ON t.id=m.team_id WHERE t.league_id=? AND m.user_id=?").get(id, u.id);
  if (!league || !(member || svc.isOrganizer(id, u.id))) notFound();
  return (<><p><Link href="/">← Home</Link></p><h1>{league.name} – standings</h1><StandingsTable rows={svc.standings(id)} /></>);
}
