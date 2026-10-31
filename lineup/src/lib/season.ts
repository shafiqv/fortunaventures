/** Round-robin season generator. Each slot is a Monday (or whatever weekday `start` is); holidays occupy a slot but don't advance the cycle. */
import { fmtLocal } from "./dates";

/** Round-robin pairings (circle method). Even team counts only; odd counts get a bye (null opponent dropped). */
export function roundRobin(teamIds: number[]): [number, number][][] {
  // First team meets the 2nd, 3rd, 4th… in order (matches the usual printed schedule).
  const t = [teamIds[0], ...teamIds.slice(1).reverse()];
  if (t.length % 2) t.splice(1, 0, 0); // 0 = bye
  const n = t.length;
  const rounds: [number, number][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [number, number][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = t[i], b = t[n - 1 - i];
      if (a && b) pairs.push([a, b]);
    }
    rounds.push(pairs);
    t.splice(1, 0, t.pop()!); // rotate all but the first
  }
  return rounds;
}

export interface SeasonWeek { date: string; week: number; holiday: boolean; pairs: [number, number][] }

export function generateSeason(teamIds: number[], start: string, weeks: number, holidays: string[]): SeasonWeek[] {
  const cycle = roundRobin(teamIds);
  const [y, m, d] = start.split("-").map(Number);
  const out: SeasonWeek[] = [];
  let k = 0;
  for (let w = 0; w < weeks; w++) {
    const date = fmtLocal(new Date(y, m - 1, d + 7 * w, 12)).slice(0, 10);
    const holiday = holidays.includes(date);
    out.push({ date, week: w + 1, holiday, pairs: holiday ? [] : cycle[k++ % cycle.length] });
  }
  return out;
}
