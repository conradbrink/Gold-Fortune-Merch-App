// The Field team card opened up as a page (13 Oct 2026): its tiles count the
// card's dots, so "now" uses the same freshness line as the card and the maps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nowGroups } from "@/lib/field-team";
import { fieldTeamHref, rangeFromQuery } from "@/lib/dashboard-links";
import type { LiveReps, RepPosition } from "@/lib/live-reps";

const at = (minutesAgo: number, now: number) => new Date(now - minutesAgo * 60_000).toISOString();

function position(repId: string, recordedAt: string): RepPosition {
  return { repId, repName: repId, lat: 0, lng: 0, accuracyM: null, recordedAt, source: "interval", dayOpen: true, storeName: null };
}

test("fresh is live, older is quiet, nothing in 24 hours is silent", () => {
  const now = Date.parse("2026-10-13T10:00:00Z");
  const live: LiveReps = {
    positions: [position("a", at(10, now)), position("b", at(45, now)), position("c", at(300, now))],
    missing: [{ repId: "d", repName: "d", dayOpen: false }],
  };
  // A 5-minute interval: fresh within 20 minutes, as the card's green dot.
  const g = nowGroups(live, 5, now);
  assert.equal(g.get("a"), "live");
  assert.equal(g.get("b"), "quiet");
  assert.equal(g.get("c"), "quiet");
  assert.equal(g.get("d"), "silent");
});

test("the page opens over the dashboard's dates", () => {
  const href = fieldTeamHref({ from: "2026-09-14", to: "2026-10-14" });
  assert.equal(href, "/tracking/team?from=2026-09-14&to=2026-10-14");
  assert.ok(rangeFromQuery(new URLSearchParams(href.split("?")[1])));
  assert.equal(fieldTeamHref(), "/tracking/team");
});
