/** Schedule import: CSV / tab-separated paste, and iCalendar (.ics) feeds. */
import { fmtLocal } from "./dates";

export interface ParsedGame {
  startsAt: string; // YYYY-MM-DDTHH:MM
  opponent: string;
  location: string;
  notes: string;
}

function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { out.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

export function parseTime(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3]?.toLowerCase().replace(/\./g, "");
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function parseDate(s: string, defaultYear: number): string | null {
  s = s.trim().replace(/^[A-Za-z]{3,9},?\s+(?=[A-Za-z0-9])/, (m) => (/^[A-Za-z]+/.test(m) && /^(mon|tue|wed|thu|fri|sat|sun)/i.test(m) ? "" : m));
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); // M/D/YYYY (North American)
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  const d = new Date(/\d{4}/.test(s) ? s : `${s} ${defaultYear}`);
  if (isNaN(d.getTime())) return null;
  return fmtLocal(d).slice(0, 10);
}

export function parseScheduleText(text: string, defaultYear = new Date().getFullYear()) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { games: [] as ParsedGame[], errors: ["Need a header row plus at least one game."] };
  const delim = lines[0].includes("\t") ? "\t" : ",";
  const header = splitLine(lines[0], delim).map((h) => h.toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const iDate = col("date");
  const iTime = col("time", "start");
  const iOpp = col("opponent", "vs", "team", "club", "away");
  const iLoc = col("location", "venue", "court", "where");
  const iNotes = col("note", "comment");
  const errors: string[] = [];
  if (iDate < 0) errors.push('Missing a "Date" column.');
  if (iOpp < 0) errors.push('Missing an "Opponent" column.');
  if (errors.length) return { games: [], errors };

  const games: ParsedGame[] = [];
  lines.slice(1).forEach((line, idx) => {
    const c = splitLine(line, delim);
    const date = parseDate(c[iDate] ?? "", defaultYear);
    const time = iTime >= 0 ? parseTime(c[iTime] ?? "") : "19:00";
    if (!date) return errors.push(`Row ${idx + 2}: couldn't read date "${c[iDate] ?? ""}".`);
    if (!time) return errors.push(`Row ${idx + 2}: couldn't read time "${c[iTime] ?? ""}".`);
    games.push({
      startsAt: `${date}T${time}`,
      opponent: c[iOpp] ?? "",
      location: iLoc >= 0 ? c[iLoc] ?? "" : "",
      notes: iNotes >= 0 ? c[iNotes] ?? "" : "",
    });
  });
  return { games, errors };
}

function unescapeIcs(s: string) {
  return s.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\;/g, ";").replace(/\\\\/g, "\\").trim();
}

export function parseIcs(text: string) {
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const games: ParsedGame[] = [];
  for (const block of unfolded.split("BEGIN:VEVENT").slice(1)) {
    const get = (key: string) => {
      const m = block.match(new RegExp(`^${key}(?:;[^:\\r\\n]*)?:(.*)$`, "mi"));
      return m ? m[1].trim() : "";
    };
    const dt = get("DTSTART");
    const m = dt.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
    if (!m) continue;
    let start = `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? "19"}:${m[5] ?? "00"}`;
    if (dt.endsWith("Z")) {
      // Convert UTC to server-local (club-local) time
      const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0)));
      start = fmtLocal(d);
    }
    games.push({
      startsAt: start,
      opponent: unescapeIcs(get("SUMMARY")),
      location: unescapeIcs(get("LOCATION")),
      notes: unescapeIcs(get("DESCRIPTION")).slice(0, 300),
    });
  }
  return { games, errors: games.length ? [] : ["No events found in that calendar."] };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * LeagueTO-style paste (copied from a team's "Upcoming Matches" page):
 *   Sat, Oct 31, 26 @1:40pm / on Court / (H) Mayfair Lakeshore / (A) Donalda Club
 * Our team is whichever name appears in every block (or `ownName` if given). Home/away comes from (H)/(A).
 */
export function parseLeagueTo(text: string, ownName?: string) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const dateRe = /^(?:[A-Za-z]{3,9},?\s+)?([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{2,4})\s*@\s*(\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)/i;
  type Block = { startsAt: string; home?: string; away?: string; note: string };
  const blocks: Block[] = [];
  const errors: string[] = [];
  let cur: Block | null = null;
  for (const line of lines) {
    const d = line.match(dateRe);
    if (d) {
      const mi = MONTHS.indexOf(d[1].slice(0, 3).toLowerCase());
      const time = parseTime(d[4]);
      if (mi < 0 || !time) { errors.push(`Couldn't read "${line}".`); cur = null; continue; }
      const y = d[3].length === 2 ? 2000 + Number(d[3]) : Number(d[3]);
      cur = { startsAt: `${y}-${String(mi + 1).padStart(2, "0")}-${d[2].padStart(2, "0")}T${time}`, note: "" };
      blocks.push(cur);
      continue;
    }
    if (!cur) continue;
    const t = line.match(/^\(([HA])\)\s*(.+)$/i);
    if (t) { if (t[1].toUpperCase() === "H") cur.home = t[2].trim(); else cur.away = t[2].trim(); continue; }
    const on = line.match(/^on\s+(.+)$/i);
    if (on && !/^court$/i.test(on[1].trim())) cur.note = `Court: ${on[1].trim()}`;
  }
  const complete = blocks.filter((b) => b.home && b.away);
  if (!complete.length) return { games: [] as ParsedGame[], errors: errors.length ? errors : ["Couldn't find any matches in that text."] };

  let own = ownName?.trim();
  if (!own) {
    const counts = new Map<string, number>();
    for (const b of complete) for (const n of [b.home!, b.away!]) counts.set(n, (counts.get(n) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    if (complete.length > 1 && top[0][1] === complete.length && top[1]?.[1] !== top[0][1]) own = top[0][0];
    else errors.push("Couldn't tell which team is yours — type your team's name exactly as it appears on the league site.");
  }
  if (!own) return { games: [], errors };

  const games: ParsedGame[] = [];
  for (const b of complete) {
    const isHome = b.home!.toLowerCase() === own.toLowerCase();
    const isAway = b.away!.toLowerCase() === own.toLowerCase();
    if (!isHome && !isAway) { errors.push(`${b.startsAt.slice(0, 10)}: your team "${own}" isn't in this match.`); continue; }
    const opp = isHome ? b.away! : b.home!;
    games.push({ startsAt: b.startsAt, opponent: opp, location: isHome ? "Home" : `Away – at ${opp}`, notes: b.note });
  }
  return { games, errors };
}
