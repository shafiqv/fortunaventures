/** Date helpers. Game times are stored as naive local strings "YYYY-MM-DDTHH:MM" (club-local time). */

export function parseLocal(s: string): Date {
  const [d, t = "00:00"] = s.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [hh, mm] = t.split(":").map(Number);
  return new Date(y, m - 1, day, hh, mm || 0, 0, 0);
}

export function fmtLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Subtract N business days (Mon-Fri) from a date, keeping time-of-day at 09:00. */
export function businessDaysBefore(date: Date, n: number): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9, 0, 0, 0);
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() - 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return d;
}

/** Calendar days before the game, at 09:00. */
export function daysBefore(date: Date, n: number): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

export function prettyWhen(s: string): string {
  const d = parseLocal(s);
  return d.toLocaleString("en-CA", {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}
