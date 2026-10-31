/**
 * Doubles rating (Elo-style). A court result is pair A vs pair B with games/points scored by each side.
 *  - team strength = average of the two players' ratings, so partner AND opponent strength both matter
 *  - actual outcome S = share of games won (so a 6-1 win counts for more than 6-4)
 *  - each player moves by K * (S - expected); beating a stronger pair is worth more than beating a weaker one
 *  - new players (few games) move faster
 * Matchups are processed chronologically; within a matchup all courts use the ratings from before that night.
 */
export interface CourtResult { a: number[]; b: number[]; aScore: number; bScore: number }
export interface Rated { rating: number; games: number; skill?: number; penalty?: number; lateCancels?: number; noShows?: number }

/**
 * Games won/lost on a court from best-of-3 sets. The 3rd set is normally a 10-point match tie-break,
 * which counts as ONE game for the winner (unless all four agreed to play a full third set).
 */
export function gamesFromSets(sets: [number, number][], thirdIsTiebreak: boolean) {
  let f = 0, a = 0;
  sets.forEach(([x, y], i) => {
    if (i === 2 && thirdIsTiebreak) { if (x > y) f += 1; else if (y > x) a += 1; }
    else { f += x; a += y; }
  });
  return { for: f, against: a };
}

/** Reliability: the first late cancellation and the first no-show are warnings; repeats cost rating. */
export const LATE_CANCEL_PENALTY = 15;
export const NO_SHOW_PENALTY = 40;
export function reliabilityPenalty(lateCancels: number, noShows: number) {
  return Math.max(0, lateCancels - 1) * LATE_CANCEL_PENALTY + Math.max(0, noShows - 1) * NO_SHOW_PENALTY;
}

export const START_RATING = 1000;

const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

export function computeRatings(seeds: Map<number, number>, matchups: CourtResult[][]): Map<number, Rated> {
  const out = new Map<number, Rated>();
  const get = (id: number): Rated => {
    if (!out.has(id)) out.set(id, { rating: seeds.get(id) ?? START_RATING, games: 0 });
    return out.get(id)!;
  };
  for (const courts of matchups) {
    const delta = new Map<number, number>();
    const played = new Set<number>();
    for (const c of courts) {
      if (!c.a.length || !c.b.length) continue;
      const ra = avg(c.a.map((p) => get(p).rating)), rb = avg(c.b.map((p) => get(p).rating));
      const expected = 1 / (1 + Math.pow(10, (rb - ra) / 400));
      const total = c.aScore + c.bScore;
      const actual = total > 0 ? c.aScore / total : 0.5;
      for (const [players, sign] of [[c.a, 1], [c.b, -1]] as const)
        for (const p of players) {
          const k = get(p).games < 4 ? 40 : 24;
          delta.set(p, (delta.get(p) ?? 0) + sign * k * (actual - expected));
          played.add(p);
        }
    }
    for (const [p, d] of delta) get(p).rating += d;
    for (const p of played) get(p).games += 1;
  }
  return out;
}
