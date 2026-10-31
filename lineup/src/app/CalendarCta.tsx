import { appUrl } from "@/lib/notify";

/** Subscribe (stays in sync) or download (.ics) the team schedule on phone/desktop. */
export default function CalendarCta({ teamId, calToken }: { teamId: number; calToken: string }) {
  const path = `/api/cal/${calToken}/${teamId}.ics`;
  const https = appUrl() + path;
  return (
    <div className="card row">
      <b className="grow">📅 Get the schedule on your phone</b>
      <a className="btn" href={https.replace(/^https?:/, "webcal:")}>Subscribe (auto-updates)</a>
      <a className="btn ghost" href={`${path}?download=1`}>Download .ics</a>
    </div>
  );
}
