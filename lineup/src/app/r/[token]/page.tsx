import { db } from "@/lib/db";
import * as svc from "@/lib/service";
import { prettyWhen } from "@/lib/dates";
import { respond } from "../../actions";

export const dynamic = "force-dynamic";

export default async function RespondPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = db().prepare("SELECT game_id, user_id, status FROM responses WHERE token=?").get(token) as { game_id: number; user_id: number; status: string } | undefined;
  if (!r) return <p>This link isn't valid anymore.</p>;
  const { game, team, rows, lineup } = svc.gameState(r.game_id);
  const ins = rows.filter((x) => x.status === "in").length;
  return (
    <>
      <h1>{team.name}</h1>
      <div className="card">
        <b>{prettyWhen(game.starts_at)}</b> vs {game.opponent || "TBD"}
        <div className="mute">{game.location || "location TBD"}{game.notes && ` · ${game.notes}`}</div>
      </div>
      <p>Your answer: <b className={r.status}>{r.status === "none" ? "not answered yet" : r.status}</b></p>
      <div className="row">
        <form action={respond.bind(null, token, "in")} style={{ display: "contents" }}><button className="big">✅ I'm in</button></form>
        <form action={respond.bind(null, token, "maybe")} style={{ display: "contents" }}><button className="big amber">🤔 Maybe</button></form>
        <form action={respond.bind(null, token, "out")} style={{ display: "contents" }}><button className="big red">❌ I'm out</button></form>
      </div>
      <p className="mute">{ins} in so far · {lineup.shortage ? `${lineup.shortage} spot(s) still open` : "lineup is full"}. You can change your answer any time with this link.</p>
      <p><a className="btn ghost" href={`/api/game-ics/${token}.ics`}>📅 Add this match to my calendar</a></p>
    </>
  );
}
