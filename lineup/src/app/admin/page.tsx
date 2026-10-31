import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { leaguesOf, leagueTeams } from "@/lib/service";

export default async function Admin() {
  const u = await requireUser();
  const leagues = leaguesOf(u.id);
  return (
    <>
      <h1>Organizer admin</h1>
      <p className="mute">Run a multi-team league from one place: rosters in from Excel, schedules and lineups out to players, results back to Excel.</p>
      {leagues.map((l) => (
        <Link key={l.id} href={`/admin/leagues/${l.id}`} style={{ textDecoration: "none", color: "inherit" }}>
          <div className="card row"><div className="grow"><b>{l.name}</b><div className="mute">{leagueTeams(l.id).length} teams · {l.courts_per_matchup} courts per matchup</div></div><span>→</span></div>
        </Link>
      ))}
      <p><Link className="btn" href="/admin/leagues/new">+ New league from Excel</Link></p>
    </>
  );
}
