import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import * as svc from "@/lib/service";
import { prettyWhen } from "@/lib/dates";
import { captainSetStatus, deleteGame, gameAction, saveGame } from "../../../../actions";
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
  const act = (a: "request" | "remind" | "spares" | "summary") => gameAction.bind(null, teamId, gameId, a);

  return (
    <>
      <p><Link href={`/teams/${teamId}`}>← {team.name}</Link></p>
      <h1>{prettyWhen(game.starts_at)} vs {game.opponent || "TBD"}</h1>
      <p className="mute">{game.location || "location TBD"}</p>

      {lineup.shortage > 0 && <div className="banner">⚠ {lineup.shortage} spot(s) open. {game.request_sent ? "" : "Availability hasn't been requested yet."}</div>}

      <h2>Lineup</h2>
      <div className="card"><table><tbody>
        {lineup.slots.map((s) => <tr key={s.position}><td>Line {s.line}</td><td>{nm(s.userId)}</td></tr>)}
        {lineup.bench.length > 0 && <tr><td>Sitting out</td><td>{lineup.bench.map((b, i) => <span key={b}>{i > 0 && ", "}{nm(b)}</span>)}</td></tr>}
      </tbody></table></div>

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
        <label>Location (e.g. Home, or club name & drive time)</label><input name="location" defaultValue={game.location} />
        <label>Notes</label><input name="notes" defaultValue={game.notes} />
        <p className="row"><button>Save</button></p>
      </form>
      <form action={deleteGame.bind(null, teamId, gameId)}><button className="red">Delete game</button></form>
    </>
  );
}
