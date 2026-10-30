// Expired batches are never reserved (20261030175300), so a short line says how
// many at the location have expired: otherwise a full shelf reads short with no
// reason given.
import { test } from "node:test";
import assert from "node:assert/strict";
import { expiredNote } from "@/lib/orders";

test("a short line names the expired stock beside it", () => {
  assert.equal(expiredNote({ qty_expired: 40 }), " (40 expired)");
  assert.equal(expiredNote({ qty_expired: 1 }), " (1 expired)");
});

test("nothing is added when nothing has expired", () => {
  assert.equal(expiredNote({ qty_expired: 0 }), "");
});

test("a database without the column yet adds nothing", () => {
  assert.equal(expiredNote({} as { qty_expired: number }), "");
});
