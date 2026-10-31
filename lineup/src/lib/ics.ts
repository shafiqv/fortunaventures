import type { Game, Team } from "./db";
import { parseLocal } from "./dates";

const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

function fold(line: string) {
  const out: string[] = [];
  for (let i = 0; i < line.length; i += 70) out.push((i ? " " : "") + line.slice(i, i + 70));
  return out.join("\r\n");
}

/** Build an iCalendar file. Times are converted to UTC so phones show the right local time anywhere. */
export function buildIcs(team: Pick<Team, "name">, games: Game[], calName: string, appUrl: string) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Lineup//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(calName)}`, "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H"];
  for (const g of games) {
    const start = parseLocal(g.starts_at);
    const end = new Date(start.getTime() + 2 * 3600_000);
    lines.push("BEGIN:VEVENT",
      `UID:game-${g.id}@lineup`,
      `DTSTAMP:${utc(new Date())}`,
      `DTSTART:${utc(start)}`,
      `DTEND:${utc(end)}`,
      `SUMMARY:${esc(`${team.name}${g.opponent ? ` vs ${g.opponent}` : ""}`)}`,
      ...(g.location ? [`LOCATION:${esc(g.location)}`] : []),
      `DESCRIPTION:${esc(`${g.notes ? g.notes + "\n" : ""}Availability & lineup: ${appUrl}`)}`,
      "BEGIN:VALARM", "TRIGGER:-PT2H", "ACTION:DISPLAY", `DESCRIPTION:${esc(team.name + " match")}`, "END:VALARM",
      "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
