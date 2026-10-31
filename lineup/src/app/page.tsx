import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { db, type Team } from "@/lib/db";
import { upcomingGames } from "@/lib/service";
import { prettyWhen } from "@/lib/dates";
import LoginForm from "./LoginForm";

export default async function Home({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  const user = await currentUser();
  const sp = await searchParams;
  if (!user)
    return (
      <>
        <h1>Team availability, without the group-chat chaos.</h1>
        <p className="mute">Captains import the schedule. Players tap In or Out. Spares are called automatically when you're short.</p>
        {sp.expired && <div className="banner">That sign-in link expired or was already used. Request a new one.</div>}
        <LoginForm />
      </>
    );

  const teams = db().prepare(
    "SELECT t.*, m.role FROM teams t JOIN members m ON m.team_id=t.id WHERE m.user_id=? ORDER BY t.name",
  ).all(user.id) as (Team & { role: string })[];

  return (
    <>
      <h1>Your teams</h1>
      {teams.length === 0 && <p className="mute">You're not on a team yet. Create one, or open an invite link from your captain.</p>}
      {teams.map((t) => {
        const next = upcomingGames(t.id)[0];
        return (
          <Link key={t.id} href={`/teams/${t.id}`} style={{ textDecoration: "none", color: "inherit" }}>
            <div className="card row">
              <div className="grow"><b>{t.name}</b> <span className="pill">{t.sport}</span> <span className="pill">{t.role}</span>
                <div className="mute">{next ? `Next: ${prettyWhen(next.starts_at)} vs ${next.opponent || "TBD"}` : "No upcoming games"}</div></div>
              <span>→</span>
            </div>
          </Link>
        );
      })}
      <p><Link className="btn" href="/teams/new">+ Create a team</Link></p>
      {!user.name && <div className="banner">Add your name and phone in your <Link href="/profile">profile</Link> so teammates know who you are and you can get texts.</div>}
    </>
  );
}
