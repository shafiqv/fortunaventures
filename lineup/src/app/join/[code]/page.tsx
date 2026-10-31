import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { db, type Team } from "@/lib/db";
import { joinTeam } from "@/lib/service";
import LoginForm from "../../LoginForm";

export default async function Join({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const team = db().prepare("SELECT * FROM teams WHERE invite_code=?").get(code) as Team | undefined;
  if (!team) return <p>This invite link isn't valid.</p>;
  const user = await currentUser();
  if (!user)
    return (<><h1>Join {team.name}</h1><p className="mute">Sign in with your email to join.</p><LoginForm /><p className="mute">After signing in, open this invite link again.</p></>);
  joinTeam(team.id, user.id);
  redirect(`/teams/${team.id}`);
}
