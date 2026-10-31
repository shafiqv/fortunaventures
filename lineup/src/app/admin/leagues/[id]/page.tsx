import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import * as svc from "@/lib/service";
import { prettyWhen } from "@/lib/dates";
import { createRound, editMatchup, generateSeason, publishRound, saveContacts } from "../../../actions";

export default async function LeagueAdmin({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const u = await requireUser();
  const league = svc.getLeague(id);
  if (!league || !svc.isOrganizer(id, u.id)) notFound();
  const teams = svc.leagueTeams(id);
  const players = svc.leaguePlayers(id);
  const missing = players.filter((p) => svc.isPlaceholderEmail(p.email)).length;
  const rounds = svc.leagueRounds(id);
  const matchupSlots = Math.max(1, Math.floor(teams.length / 2));

  return (
    <>
      <p><Link href="/admin">← Admin</Link></p>
      <h1>{league.name}</h1>
      <div className="row">
        <a className="btn" href={`/api/admin/league/${id}`}>⬇ Download Excel (rosters + lineups)</a>
        <span className="mute">{teams.length} teams · {players.length} players · {league.courts_per_matchup} courts/matchup ({league.courts_per_matchup * 2} players per team)</span>
      </div>

      <h2>Generate the whole season</h2>
      <form action={generateSeason.bind(null, id)} className="card">
        <p className="mute">Every team plays every other team in a repeating cycle. Holiday weeks take a slot but don't advance the cycle.</p>
        <div className="row">
          <div><label>First night</label><input type="date" name="start" required /></div>
          <div><label>Weeks</label><input type="number" name="weeks" min={1} max={40} defaultValue={10} style={{ width: 80 }} /></div>
          <div><label>Time</label><input type="time" name="time" defaultValue={league.default_time} /></div>
          <div><label>Courts</label><input type="number" name="courts" min={1} defaultValue={league.courts_per_matchup} style={{ width: 70 }} /></div>
        </div>
        <label>No-match dates (YYYY-MM-DD, comma separated — e.g. Thanksgiving)</label><input name="holidays" placeholder="2026-10-12" style={{ width: "100%" }} />
        <p><button>Generate schedule</button></p>
      </form>

      <h2>Schedule a single week</h2>
      <form action={createRound.bind(null, id)} className="card">
        <label>Date</label><input type="date" name="date" required />
        {Array.from({ length: matchupSlots }, (_, i) => (
          <div key={i} className="row" style={{ marginTop: 8 }}>
            <select name={`a${i}`} defaultValue=""><option value="">Team…</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
            <span>vs</span>
            <select name={`b${i}`} defaultValue=""><option value="">Team…</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
            <input type="time" name={`t${i}`} defaultValue={league.default_time} />
            <input type="number" name={`c${i}`} min={1} defaultValue={league.courts_per_matchup} style={{ width: 70 }} title="courts" /> <span className="mute">courts</span>
          </div>
        ))}
        <p><button>Add week</button></p>
      </form>

      <h2>Weeks & lineups</h2>
      {rounds.length === 0 && <p className="mute">No weeks scheduled yet.</p>}
      {rounds.map((r) => (
        <div key={r.day} className="card">
          <div className="row"><b className="grow">{prettyWhen(r.day + "T00:00").split(",").slice(0, 2).join(",")}</b>
            <form action={publishRound.bind(null, id, r.day)}><button>Send availability requests to all players</button></form></div>
          {r.matchups.map((m) => {
            const first = m.games[0];
            return (
              <div key={m.id} style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                <form action={editMatchup.bind(null, id, m.id)} className="row">
                  <b className="grow">{m.games.map((g) => g.team_name).join(" vs ")}</b>
                  <input type="time" name="time" defaultValue={first.starts_at.slice(11)} />
                  <input type="number" name="courts" min={1} defaultValue={first.lines ?? league.courts_per_matchup} style={{ width: 70 }} /> <span className="mute">courts</span>
                  <button className="ghost">Update</button>
                </form>
                {m.games.map((g) => {
                  const st = svc.gameState(g.id);
                  const ins = st.rows.filter((x) => x.status === "in").length;
                  return (
                    <div key={g.id} className="row mute" style={{ marginTop: 4 }}>
                      <span className="grow">{g.team_name}: {ins} in · {st.rows.filter((x) => x.status === "none").length} no reply · {st.lineup.shortage ? <b className="out">{st.lineup.shortage} spot(s) open</b> : <b className="in">lineup full</b>}{st.lineup.bench.length ? ` · ${st.lineup.bench.length} on bench` : ""}</span>
                      <Link href={`/teams/${g.team_id}/games/${g.id}`}>Lineup →</Link>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      ))}

      <h2>Players — add emails & phones {missing > 0 && <span className="pill maybe">{missing} still need an email</span>}</h2>
      <p className="mute">Nobody gets messages until they have an email. Paste them in here, or send players the team invite links below.</p>
      <form action={saveContacts.bind(null, id)} className="card">
        <table><thead><tr><th>Team</th><th>Player</th><th>Email</th><th>Mobile</th></tr></thead><tbody>
          {players.map((p) => (
            <tr key={p.id}><td className="mute">{p.team}</td><td>{p.name}</td>
              <td><input name={`email_${p.id}`} type="email" defaultValue={svc.isPlaceholderEmail(p.email) ? "" : p.email} placeholder="email" style={{ width: "100%" }} /></td>
              <td><input name={`phone_${p.id}`} type="tel" defaultValue={p.phone} placeholder="+1…" style={{ width: 130 }} /></td></tr>
          ))}
        </tbody></table>
        <p><button>Save contacts</button></p>
      </form>

      <h2>Teams</h2>
      {teams.map((t) => <div key={t.id} className="card row"><Link className="grow" href={`/teams/${t.id}`}>{t.name}</Link><span className="mute">invite link: /join/{t.invite_code}</span></div>)}
    </>
  );
}
