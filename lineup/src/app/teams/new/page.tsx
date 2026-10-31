import { requireUser } from "@/lib/auth";
import { createTeam } from "../../actions";

export default async function NewTeam() {
  await requireUser();
  return (
    <>
      <h1>Create a team</h1>
      <form action={createTeam} className="card">
        <label>Team name</label><input name="name" placeholder="Tuesday Squash – Division 2" required />
        <label>Sport</label><select name="sport"><option value="squash">Squash</option><option value="tennis">Tennis</option></select>
        <label>Format</label><select name="format"><option value="singles">Singles</option><option value="doubles">Doubles</option></select>
        <label>Lines per match (squash is typically 4 singles; tennis e.g. 3–4 lines)</label>
        <input name="lines" type="number" min={1} max={10} defaultValue={4} />
        <p><button>Create team</button></p>
      </form>
    </>
  );
}
