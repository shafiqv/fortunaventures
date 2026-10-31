import type { StandingRow } from "@/lib/service";

export default function StandingsTable({ rows }: { rows: StandingRow[] }) {
  return (
    <div className="card"><table>
      <thead><tr><th>#</th><th>Team</th><th>Pts</th><th>W</th><th>L</th><th>D</th><th>Games</th></tr></thead>
      <tbody>{rows.map((r, i) => (
        <tr key={r.teamId}><td>{i + 1}</td><td>{r.name}</td><td><b>{r.courtsWon}</b></td><td>{r.won}</td><td>{r.lost}</td><td>{r.drawn}</td>
          <td className="mute">{r.gamesFor}–{r.gamesAgainst}</td></tr>
      ))}</tbody>
    </table>
    <p className="mute">Points = courts won. W/L/D = team matchups. Ties broken by game difference.</p></div>
  );
}
