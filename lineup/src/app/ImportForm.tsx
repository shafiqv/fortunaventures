"use client";
import { useActionState } from "react";
import { importSchedule } from "./actions";

export default function ImportForm({ teamId }: { teamId: number }) {
  const [state, action, pending] = useActionState(importSchedule.bind(null, teamId), { msg: "" });
  return (
    <form action={action} className="card">
      <p className="mute">Paste the "Upcoming Matches" text straight from LeagueTO (home/away is detected), or rows with Date, Time, Opponent, Location columns. You can also upload a CSV/.ics file or give a calendar feed URL.</p>
      <textarea name="text" placeholder={"Date,Time,Opponent,Location\n2026-11-05,1:40 PM,Granite Club,Away"} />
      <div className="row"><input type="file" name="file" accept=".csv,.ics,.txt" /><input className="grow" name="url" placeholder="…or calendar URL (https:// or webcal://)" /></div>
      <label>Your team's name on the league site (only needed if it can't be detected)</label><input name="own_name" placeholder="Donalda Club" />
      <p><button disabled={pending}>{pending ? "Importing…" : "Import games"}</button> <span className="mute">{state.msg}</span></p>
    </form>
  );
}
