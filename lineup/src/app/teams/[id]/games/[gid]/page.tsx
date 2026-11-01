import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import * as svc from "@/lib/service";
import { prettyWhen } from "@/lib/dates";
import { addSubAction, captainSetStatus, deleteGame, forgiveEvent, gameAction, lineupMode, saveGame, saveLineupAction, saveResultsAction } from "../../../../actions";
import type { Status } from "@/lib/lineup";

export default async function GamePage({ params }: { params: Promise<{ id: string; gid: string }> }) {
  const { id: sid, gid: sg } = await params;
  const teamId = Number(sid), gameId = Number(sg);
  const user = await requireUser();
  if (!svc.isCaptain(teamId, user.id)) notFound();
  const game = svc.getGame(gameId);
  if (!game || game.team_id !== teamId) notFound();
  const { team, rows, lineup } = svc.gameState(gameId);
  const offers = svc.offersFor(gameId);
  const nm = (uid: number | null) => { if (uid == null) return <i className="out">OPEN</i>; const r = rows.find((x) => x.user_id === uid)!; return <>{r.name || r.email}</>; };
  const [date, time] = game.starts_at.split("T");
  const rated = svc.ratingsForTeam(team);
  const saved = svc.resultsFor(gameId);
  const events = svc.eventsFor(gameId);
  const courts = lineup.total / (team.format === "doubles" ? 2 : 1);
  const act = (a: "request" | "remind" | "spares" | "summary") => gameAction.bind(null, teamId, gameId, a);

  return (
    <>
      <p><Link href={`/teams/${teamId}`}>← {team.name}</Link></p>
      <h1>{prettyWhen(game.starts_at)} vs {game.opponent || "TBD"}</h1>
      <p className="mute">{game.location || "location TBD"}</p>

      {lineup.shortage > 0 && <div className="banner">⚠ {lineup.shortage} spot(s) open. {game.request_sent ? "" : "Availability hasn't been requested yet."}</div>}

      <h2>Lineup {svc.hasManualLineup(gameId) ? <span className="pill">manual</span> : <span className="pill">automatic</span>}</h2>
      <form action={saveLineupAction.bind(null, teamId, gameId, lineup.total)} className="card">
        <table><tbody>
          {Array.from({ length: lineup.total / (team.format === "doubles" ? 2 : 1) }, (_, li) => {
            const per = team.format === "doubles" ? 2 : 1;
            return (
              <tr key={li}><td style={{ whiteSpace: "nowrap" }}>{team.league_id ? "Court" : "Line"} {li + 1}</td>
                {Array.from({ length: per }, (_, k) => {
                  const pos = li * per + k + 1;
                  const cur = lineup.slots[pos - 1].userId;
                  return (
                    <td key={k}><select name={`slot_${pos}`} defaultValue={cur ?? ""} style={{ width: "100%" }}>
                      <option value="">— open —</option>
                      {[...rows].sort((a, b) => (a.status === "in" ? 0 : 1) - (b.status === "in" ? 0 : 1) || a.rank - b.rank).map((r) => (
                        <option key={r.user_id} value={r.user_id}>{r.name || r.email} ({r.status === "none" ? "no reply" : r.status}){rated.get(r.user_id) ? ` · ${Math.round(rated.get(r.user_id)!.rating)}` : ""}</option>
                      ))}
                    </select></td>
                  );
                })}</tr>
            );
          })}
          {lineup.bench.length > 0 && <tr><td>Sitting out</td><td colSpan={2}>{lineup.bench.map((b, i) => <span key={b}>{i > 0 && ", "}{nm(b)}</span>)}</td></tr>}
        </tbody></table>
        <p className="row"><button>Save lineup</button></p>
      </form>
      <div className="row">
        <form action={lineupMode.bind(null, teamId, gameId, "freeze")}><button className="ghost">Fill automatically, then let me edit</button></form>
        <form action={lineupMode.bind(null, teamId, gameId, "auto")}><button className="ghost">Reset to automatic</button></form>
      </div>
      <form action={addSubAction.bind(null, teamId, gameId)} className="card row">
        <b>Add a sub</b><input name="name" placeholder="Name" /><input name="email" type="email" placeholder="Email (optional)" /><button>Add</button>
      </form>

      {team.league_id && game.matchup_id && (<>
        <h2>Results</h2>
        <form action={saveResultsAction.bind(null, teamId, gameId, courts)} className="card">
          <p className="mute">Best of 3 sets, our games first. The 3rd set is a 10-point match tie-break (enter e.g. 10–7) unless all four agreed to play a full set — tick the box then. Scores update ratings, which set next week's court order.</p>
          <table><tbody>{Array.from({ length: courts }, (_, i) => {
            const c = i + 1;
            const r = saved.find((x) => x.court === c);
            const pair = lineup.slots.filter((x) => x.line === c).map((x) => nm(x.userId));
            const inp = (k: string, v: number | null | undefined) => <input name={`${k}_${c}`} type="number" min={0} defaultValue={v ?? undefined} style={{ width: 56 }} />;
            return (<tr key={c}><td style={{ whiteSpace: "nowrap" }}>Court {c}<div className="mute">{pair.map((p, k) => <span key={k}>{k > 0 && " / "}{p}</span>)}</div></td>
              <td>{inp("s1f", r?.s1f)} – {inp("s1a", r?.s1a)}</td>
              <td>{inp("s2f", r?.s2f)} – {inp("s2a", r?.s2a)}</td>
              <td>{inp("s3f", r?.s3f)} – {inp("s3a", r?.s3a)} <label style={{ display: "inline-flex", gap: 4, alignItems: "center", margin: 0 }}><input type="checkbox" name={`full3_${c}`} defaultChecked={r ? !r.s3_tb : false} style={{ width: "auto" }} />full set</label></td></tr>);
          })}</tbody></table>
          <h3>No-shows</h3>
          <p className="mute">Tick anyone scheduled who didn't turn up. The first is a warning; repeats lower their rating.</p>
          <div className="row">{rows.filter((r) => lineup.slots.some((x) => x.userId === r.user_id) || events.some((e) => e.user_id === r.user_id && e.kind === "no_show")).map((r) => (
            <label key={r.user_id} style={{ display: "inline-flex", gap: 4, alignItems: "center", margin: 0 }}><input type="checkbox" name={`noshow_${r.user_id}`} defaultChecked={events.some((e) => e.user_id === r.user_id && e.kind === "no_show")} style={{ width: "auto" }} />{r.name || r.email}</label>
          ))}</div>
          <p><button>Save results</button></p>
        </form></>)}
      {events.some((e) => e.kind === "late_cancel") && (<div className="card"><b>Late cancellations (within 48h)</b>
        {events.filter((e) => e.kind === "late_cancel").map((e) => (
          <form key={e.id} action={forgiveEvent.bind(null, teamId, gameId, e.id)} className="row" style={{ marginTop: 6 }}><span className="grow">{e.name || e.email}</span><button className="ghost">Forgive</button></form>
        ))}</div>)}

      <h2>Availability</h2>
      <div className="card"><table><tbody>
        {rows.length === 0 && <tr><td className="mute">Not requested yet.</td></tr>}
        {rows.map((r) => (
          <tr key={r.user_id}><td>#{r.rank} {r.name || r.email}</td><td className={r.status}>{r.status === "none" ? "no reply" : r.status}</td>
            <td className="row">{(["in", "out", "maybe"] as Status[]).map((s) => (
              <form key={s} className="inline" action={captainSetStatus.bind(null, teamId, gameId, r.user_id, s)}><button className="ghost" disabled={r.status === s}>{s}</button></form>
            ))}</td></tr>
        ))}
      </tbody></table></div>

      <h2>Actions</h2>
      <div className="row">
        <form action={act("request")}><button>{game.request_sent ? "Re-send request to all" : "Send availability request now"}</button></form>
        <form action={act("remind")}><button className="ghost">Nudge non-responders</button></form>
        <form action={act("spares")}><button className="ghost">Contact spares now</button></form>
        <form action={act("summary")}><button className="ghost">Email lineup to team</button></form>
      </div>
      <p className="mute">Spare mode: <b>{team.spare_mode === "rolling" ? "rolling (one at a time)" : "first come, first served"}</b>. Change it in team settings.</p>

      {offers.length > 0 && (<><h2>Spare waitlist</h2>
        <div className="card"><table><tbody>{offers.map((o) => <tr key={o.id}><td>{o.name || o.email}</td><td className={o.status === "accepted" ? "in" : o.status === "pending" ? "maybe" : "none"}>{o.status}</td></tr>)}</tbody></table></div></>)}

      <h2>Edit game</h2>
      <form action={saveGame.bind(null, teamId, gameId)} className="card">
        <div className="row"><input type="date" name="date" defaultValue={date} /><input type="time" name="time" defaultValue={time} /></div>
        <label>Opponent</label><input name="opponent" defaultValue={game.opponent} />
        <label>Location (e.g. Home, or club name &amp; drive time)</label><input name="location" defaultValue={game.location} />
        <label>Street address (powers the Directions button)</label><input name="address" defaultValue={game.address} placeholder="200 Lonsdale Rd, Toronto, ON" />
        <label>Notes</label><input name="notes" defaultValue={game.notes} />
        <p className="row"><button>Save</button></p>
      </form>
      <form action={deleteGame.bind(null, teamId, gameId)}><button className="red">Delete game</button></form>
    </>
  );
}
