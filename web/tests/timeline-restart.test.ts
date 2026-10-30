// A rep who tapped End by mistake and restarted the day (the phone's Restart
// workday, 30 Oct 2026): the day's timeline says so, rather than ending at the
// mistaken End and then carrying on with no explanation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { timelineOf, type DayPing, type RepDay } from "@/lib/tracking";

const ping = (recordedAt: string, source: DayPing["source"]): DayPing => ({
  lat: -33.9,
  lng: 18.6,
  recordedAt,
  source,
  accuracyM: 10,
});

const day = (pings: DayPing[]): RepDay => ({
  pings,
  visits: [],
  orders: [],
  distanceM: null,
  activeSeconds: null,
  dayOpen: true,
});

test("a second start the same day reads as a restart", () => {
  const entries = timelineOf(
    day([
      ping("2026-10-30T06:00:00Z", "workday_start"),
      ping("2026-10-30T08:00:00Z", "workday_end"),
      ping("2026-10-30T08:03:00Z", "workday_start"),
    ])
  ).filter((e) => e.kind === "start" || e.kind === "end");
  assert.deepEqual(
    entries.map((e) => e.text),
    ["Started the day", "Ended the day", "Restarted the day"]
  );
});

test("one start is just the start, whatever order the pings came in", () => {
  const entries = timelineOf(
    day([ping("2026-10-30T09:00:00Z", "interval"), ping("2026-10-30T06:00:00Z", "workday_start")])
  );
  assert.deepEqual(
    entries.filter((e) => e.kind === "start").map((e) => e.text),
    ["Started the day"]
  );
});
