/**
 * Lineup logic. Players are ranked (1 = best). Each game has N playing spots
 * (lines * players-per-line). Confirmed "in" players fill spots in rank order;
 * anyone beyond N sits out. If fewer than N confirm, `shortage` > 0 and spares are needed.
 */

export type Status = "none" | "in" | "out" | "maybe";

export interface Candidate {
  userId: number;
  rank: number;
  status: Status;
}

export interface Slot {
  position: number; // 1..N
  line: number; // 1..lines
  userId: number | null;
}

export function spotsNeeded(lines: number, format: "singles" | "doubles"): number {
  return lines * (format === "doubles" ? 2 : 1);
}

export function buildLineup(
  candidates: Candidate[],
  lines: number,
  format: "singles" | "doubles",
) {
  const perLine = format === "doubles" ? 2 : 1;
  const total = lines * perLine;
  const ins = candidates
    .filter((c) => c.status === "in")
    .sort((a, b) => a.rank - b.rank || a.userId - b.userId);

  const playing = ins.slice(0, total);
  const bench = ins.slice(total).map((c) => c.userId);

  const slots: Slot[] = [];
  for (let i = 0; i < total; i++) {
    slots.push({
      position: i + 1,
      line: Math.floor(i / perLine) + 1,
      userId: playing[i]?.userId ?? null,
    });
  }
  return { slots, bench, shortage: Math.max(0, total - playing.length), total };
}
