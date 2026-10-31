/**
 * Spare-offer engine (pure). Given the current state of offers, decide who to
 * contact next.
 *
 *  - "first_come": offer to every spare at once; first `needed` acceptances win.
 *  - "rolling":    offer to one spare per open spot at a time, in rank order;
 *                  when an offer is declined or expires, move to the next.
 */

export type SpareMode = "first_come" | "rolling";
export type OfferStatus = "pending" | "accepted" | "declined" | "expired" | "cancelled";

export interface Offer {
  userId: number;
  status: OfferStatus;
}

/** Returns user IDs (from the ordered spare list) who should receive a NEW offer now. */
export function nextToOffer(
  mode: SpareMode,
  needed: number, // open spots still to fill (after counting accepted spares)
  orderedSpares: number[], // spare userIds in priority order
  offers: Offer[],
): number[] {
  if (needed <= 0) return [];
  const alreadyOffered = new Set(offers.map((o) => o.userId));
  const pending = offers.filter((o) => o.status === "pending").length;
  const untouched = orderedSpares.filter((id) => !alreadyOffered.has(id));

  if (mode === "first_come") {
    return pending === 0 ? untouched : untouched; // everyone not yet asked
  }
  const slotsToFill = needed - pending;
  return slotsToFill > 0 ? untouched.slice(0, slotsToFill) : [];
}
