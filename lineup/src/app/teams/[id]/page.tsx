import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import * as svc from "@/lib/service";
import { appUrl } from "@/lib/notify";
import { prettyWhen } from "@/lib/dates";
import { broadcastTeam, inviteMembers, saveGame, saveTeamSettings, updateMember } from "../../actions";
import ImportForm from "../../ImportForm";
import CalendarCta from "../../CalendarCta";

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const user = await requireUser();
  const team = svc.getTeam(id);
  const role = svc.roleOf(id, user.id);
  if (!team || !role) notFound();
  const cap = role === "captain";
  const games = svc.upcomingGames(id);
  const members = svc.membersOf(id);

  return (
    <>
      <h1>{team.name}</h1>
      <p className="mute">{team.sport} · {team.format} · {team.lines} lines · you are {role}</p>
      {team.league_id && <p><Link href={`/league/${team.league_id}`}>🏆 League standings →</Link></p>}
      <CalendarCta teamId={id} calToken={svc.calToken(user.id)} />

      {svc.announcementsFor(id).length > 0 && (<>
        <h2>Announcements</h2>
        {svc.announcementsFor(id).map((a) => (
          <div key={a.id} className="card"><b>{a.subject}</b> {a.urgent ? <span className="pill maybe">urgent</span> : null}
            <div style={{ whiteSpace: "pre-wrap" }}>{a.body}</div><div className="mute">{a.author} · {a.created_at.slice(0, 10)}</div></div>
        ))}</>)}

      <h2>Upcoming games</h2>
      {games.length === 0 && <p className="mute">No games yet.{cap && " Import your schedule below."}</p>}
      {games.map((g) => {
        return (
          <div key={g.id} className="card row">
            <div className="grow"><b>{prettyWhen(g.starts_at)}</b> vs {g.opponent || "TBD"}
              <div className="mute">{g.location || "location TBD"}{g.notes && ` · ${g.notes}`}</div></div>
            {cap ? <Link className="btn ghost" href={`/teams/${id}/games/${g.id}`}>Manage</Link> :
              <span className="pill">{g.request_sent ? "availability requested" : "not yet requested"}</span>}
          </div>
        );
      })}

      {cap && (<>
        <h2>Message the team</h2>
        <form action={broadcastTeam.bind(null, id)} className="card">
          <input name="subject" placeholder="Subject (e.g. Court change this Monday)" style={{ width: "100%" }} required />
          <label>Message</label><textarea name="body" style={{ minHeight: 80, fontFamily: "inherit" }} required />
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" name="urgent" style={{ width: "auto" }} /> Urgent: also text everyone who opted in</label>
          <p><button>Send to {members.length} people</button></p>
        </form>

        <h2>Import schedule</h2>
        <ImportForm teamId={id} />

        <h2>Roster & ranking</h2>
        <p className="mute">Rank 1 is your strongest player. When more people are in than there are spots, lowest ranks sit out. Spares are contacted only when you're short.</p>
        <div className="card"><table><tbody>
          {members.map((m) => (
            <tr key={m.id}><td colSpan={2}>
              <form action={updateMember.bind(null, id, m.id)} className="row">
                <span className="grow">{m.name || m.email}<div className="mute">{m.email}{m.phone && ` · ${m.phone}${m.sms_opt_in ? " (SMS ok)" : ""}`}</div></span>
                <input name="rank" type="number" defaultValue={m.rank} style={{ width: 70 }} title="rank" />
                <select name="role" defaultValue={m.role}><option value="captain">captain</option><option value="player">player</option><option value="spare">spare</option></select>
                <button>Save</button><button name="remove" value="1" className="ghost">Remove</button>
              </form></td></tr>
          ))}
        </tbody></table></div>

        <h3>Invite players</h3>
        <form action={inviteMembers.bind(null, id)} className="card">
          <p className="mute">Share this link: <code>{appUrl()}/join/{team.invite_code}</code></p>
          <label>…or add by email (comma or space separated)</label>
          <div className="row"><input className="grow" name="emails" placeholder="a@x.com, b@x.com" /><button>Add</button></div>
        </form>

        <h2>Settings</h2>
        <form action={saveTeamSettings.bind(null, id)} className="card">
          <label>Team name</label><input name="name" defaultValue={team.name} />
          <div className="row">
            <div><label>Format</label><select name="format" defaultValue={team.format}><option>singles</option><option>doubles</option></select></div>
            <div><label>Lines</label><input name="lines" type="number" defaultValue={team.lines} style={{ width: 80 }} /></div>
          </div>
          <label>Send availability request (business days before the match)</label><input name="request_business_days" type="number" defaultValue={team.request_business_days} />
          <label>Remind non-responders (days before)</label><input name="reminder_days" type="number" defaultValue={team.reminder_days} />
          <label>Start contacting spares if short (days before)</label><input name="spares_days" type="number" defaultValue={team.spares_days} />
          <label>Send final lineup summary (days before)</label><input name="summary_days" type="number" defaultValue={team.summary_days} />
          <label>Spare mode</label>
          <select name="spare_mode" defaultValue={team.spare_mode}>
            <option value="rolling">Rolling – ask spares one at a time in rank order</option>
            <option value="first_come">First come, first served – ask all spares at once</option>
          </select>
          <label>Rolling: hours a spare has to answer before we move on</label><input name="spare_expiry_hours" type="number" defaultValue={team.spare_expiry_hours} />
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" name="auto_spares" defaultChecked={!!team.auto_spares} style={{ width: "auto" }} /> Contact spares automatically</label>
          <p><button>Save settings</button></p>
        </form>
      </>)}
    </>
  );
}
