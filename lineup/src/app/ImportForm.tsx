"use client";
import { useActionState } from "react";
import { importSchedule } from "./actions";

export default function ImportForm({ teamId }: { teamId: number }) {
  const [state, action, pending] = useActionState(importSchedule.bind(null, teamId), { msg: "" });
  return (
    <form action={action} className="card">
      <p className="mute">Three ways in: paste rows copied from your league site (needs Date, Time, Opponent, Location columns), upload a CSV/.ics file, or give a calendar feed URL if the site has one.</p>
      <textarea name="text" placeholder={"Date,Time,Opponent,Location\n2026-11-05,1:40 PM,Granite Club,Away"} />
      <div className="row"><input type="file" name="file" accept=".csv,.ics,.txt" /><input className="grow" name="url" placeholder="…or calendar URL (https:// or webcal://)" /></div>
      <p><button disabled={pending}>{pending ? "Importing…" : "Import games"}</button> <span className="mute">{state.msg}</span></p>
    </form>
  );
}
