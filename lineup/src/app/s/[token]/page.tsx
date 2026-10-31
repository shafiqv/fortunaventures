import { db } from "@/lib/db";
import * as svc from "@/lib/service";
import { prettyWhen } from "@/lib/dates";
import { respondSpare } from "../../actions";

export const dynamic = "force-dynamic";

export default async function SparePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const o = db().prepare("SELECT game_id, status FROM spare_offers WHERE token=?").get(token) as { game_id: number; status: string } | undefined;
  if (!o) return <p>This link isn't valid anymore.</p>;
  const { game, team, lineup } = svc.gameState(o.game_id);
  return (
    <>
      <h1>{team.name} needs a spare</h1>
      <div className="card"><b>{prettyWhen(game.starts_at)}</b> vs {game.opponent || "TBD"}<div className="mute">{game.location}</div></div>
      {o.status === "pending" && lineup.shortage > 0 ? (
        <div className="row">
          <form action={respondSpare.bind(null, token, true)} style={{ display: "contents" }}><button className="big">✅ I can play</button></form>
          <form action={respondSpare.bind(null, token, false)} style={{ display: "contents" }}><button className="big red">❌ Can't make it</button></form>
        </div>
      ) : o.status === "accepted" ? (
        <><p className="in"><b>You're in — thanks!</b></p><a className="btn" href={`/api/game-ics/${token}.ics`}>📅 Add to my calendar</a></>
      ) : (
        <p className="mute">{o.status === "declined" ? "You declined this one. Thanks for letting us know." : "This spot has been filled or the offer expired. Thanks anyway!"}</p>
      )}
    </>
  );
}
