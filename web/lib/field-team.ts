import { freshnessOf, minutesSince, type LiveReps } from "@/lib/live-reps";

/**
 * The dashboard's Field team card, opened up: where each person is now (the
 * card's list, from `fetchLiveReps`) and what each one did over the period.
 *
 * "Now" splits the team the way the card's dots do: a fresh position (the
 * green dot, within four of the company's GPS intervals), an older one (amber
 * or grey), or none in 24 hours (the red ring).
 */

export const NOW_GROUPS = ["live", "quiet", "silent"] as const;
export type NowGroup = (typeof NOW_GROUPS)[number];

export const NOW_LABELS: Record<NowGroup, string> = {
  live: "Sending positions now",
  quiet: "Gone quiet",
  silent: "No position in 24 hours",
};

/** Each person's "now", keyed by their id. */
export function nowGroups(live: LiveReps, intervalMinutes: number | null, now = Date.now()): Map<string, NowGroup> {
  const m = new Map<string, NowGroup>();
  for (const p of live.positions) {
    m.set(p.repId, freshnessOf(minutesSince(p.recordedAt, now), intervalMinutes) === "fresh" ? "live" : "quiet");
  }
  for (const x of live.missing) m.set(x.repId, "silent");
  return m;
}
