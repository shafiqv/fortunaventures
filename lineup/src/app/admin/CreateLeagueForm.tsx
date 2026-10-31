"use client";
import { useActionState } from "react";
import { createLeague } from "../actions";

export default function CreateLeagueForm() {
  const [state, action, pending] = useActionState(createLeague, { error: "" });
  return (
    <form action={action} className="card">
      <label>League name</label><input name="name" placeholder="Men's Fall League 2026" required />
      <div className="row">
        <div><label>Courts per matchup</label><input name="courts" type="number" min={1} defaultValue={3} style={{ width: 90 }} /></div>
        <div><label>Usual start time</label><input name="time" type="time" defaultValue="19:00" /></div>
      </div>
      <label>Team rosters — paste straight from Excel/Sheets (team name rows, then player names), or upload the .xlsx</label>
      <textarea name="roster" placeholder={"The Conclave 🔵\nMichael Hutchinson\tAlan Mihic\tJeremy Butteriss\n…"} />
      <input type="file" name="file" accept=".xlsx,.csv,.txt" />
      <p className="mute">Players are created by name. You'll add their emails/phones on the next screen (or let them sign in with the invite link).</p>
      <p><button disabled={pending}>{pending ? "Creating…" : "Create league"}</button> <span className="out">{state.error}</span></p>
    </form>
  );
}
