// How a short visit's length reads on the dashboard's short-visits list. The
// rule itself (which visits count) lives in the `short_visits` database
// function; this is only the wording of the number.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatVisitMinutes } from "@/lib/dashboard";

test("whole minutes are floored, never rounded up past the limit", () => {
  assert.equal(formatVisitMinutes(3.1), "3 min");
  assert.equal(formatVisitMinutes(4.99), "4 min");
  assert.equal(formatVisitMinutes(1), "1 min");
});

test("under a minute says so rather than '0 min'", () => {
  assert.equal(formatVisitMinutes(0), "under a minute");
  assert.equal(formatVisitMinutes(0.6), "under a minute");
});
