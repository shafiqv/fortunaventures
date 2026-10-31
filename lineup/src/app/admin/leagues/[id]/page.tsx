import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import * as svc from "@/lib/service";
import { prettyWhen } from "@/lib/dates";
import { createRound, editMatchup, generateSeason, publishRound, saveContacts, setLineupPolicy } from "../../../actions";

export default async function LeagueAdmin({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const u = await requireUser();
  const league = svc.getLeague(id);
  if (!league || !svc.isOrganizer(id, u.id)) notFound();
  const teams = svc.leagueTeams(id);
  const players = svc.leaguePlayers(id);
  const missing = players.filter((p) => svc.isPlaceholderEmail(p.email)).length;
  const rounds = svc.leagueRounds(id);
  const ratings = svc.leagueRatings(id);
  const ranked = [...players].sort((a, b) => (ratings.get(b.id)?.rating ?? b.seed) - (ratings.get(a.id)?.rating ?? a.seed));
  const matchupSlots = Math.max(1, Math.floor(teams.length / 2));

  return (
    <>
      <p><Link href="/admin">← Admin</Link></p>
      <h1>{league.name}</h1>
      <div className="row">
        <a className="btn" href={`/api/admin/league/${id}`}>⬇ Download Excel (rosters + lineups)</a>
        <span className="mute">{teams.length} teams · {players.length} players · {league.courts_per_matchup} courts/matchup ({league.courts_per_matchup * 2} players per team)</span>
      </div>

      <h2>How lineups are chosen</h2>
      <form action={setLineupPolicy.bind(null, id)} className="card row">
        <select name="policy" defaultValue={teams[0]?.lineup_policy ?? "rotation_rating"} className="grow">
          <option value="rotation_rating">Fair rotation decides who plays; rating decides the court (court 1 = best two)</option>
          <option value="rating">Best-rated available players play; rating decides the court</option>
          <option value="rotation">Fair rotation only (court order by roster order)</option>
        </select>
        <button>Save</button>
      </form>

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
        <table><thead><tr><th>Team</th><th>Player</th><th>Start rating</th><th>Email</th><th>Mobile</th></tr></thead><tbody>
          {players.map((p) => (
            <tr key={p.id}><td className="mute">{p.team}</td><td>{p.name}</td>
              <td><input name={`seed_${p.id}`} type="number" defaultValue={p.seed} style={{ width: 80 }} /></td>
              <td><input name={`email_${p.id}`} type="email" defaultValue={svc.isPlaceholderEmail(p.email) ? "" : p.email} placeholder="email" style={{ width: "100%" }} /></td>
              <td><input name={`phone_${p.id}`} type="tel" defaultValue={p.phone} placeholder="+1…" style={{ width: 130 }} /></td></tr>
          ))}
        </tbody></table>
        <p><button>Save contacts</button></p>
      </form>

      <h2>Player ratings</h2>
      <div className="card"><table><thead><tr><th>#</th><th>Player</th><th>Team</th><th>Rating</th><th>Matches</th><th>Late cancels</th><th>No-shows</th></tr></thead><tbody>
        {ranked.map((p, i) => { const r = ratings.get(p.id); return (
          <tr key={p.id}><td>{i + 1}</td><td>{p.name}</td><td className="mute">{p.team}</td><td><b>{Math.round(r?.rating ?? p.seed)}</b></td><td className="mute">{r?.games ?? 0}</td><td className="mute">{r?.lateCancels ?? 0}</td><td className="mute">{r?.noShows ?? 0}{r?.penalty ? <span className="out"> (−{r.penalty} rating)</span> : null}</td></tr>); })}
      </tbody></table>
      <p className="mute">Ratings start from the number above (default 1000) and move after every scored court, based on games won, your partner's rating and your opponents' ratings. The first late cancellation (within 48h) and first no-show are warnings; repeats lower the rating used for court order (−15 and −40 each).</p></div>

      <h2>Teams</h2>
      {teams.map((t) => <div key={t.id} className="card row"><Link className="grow" href={`/teams/${t.id}`}>{t.name}</Link><span className="mute">invite link: /join/{t.invite_code}</span></div>)}
    </>
  );
}
