// `/api/reps/[id]` sets passwords, moves sign-in addresses and deletes
// accounts. A manager must not take over an account that holds more than they
// do: the seeded Operations Manager lacks `hr`, the seeded CFO holds it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { accessBeyond, toPermissionSet } from "@/lib/permissions";

const opsManager = toPermissionSet([
  "dashboard", "insights", "sales_coverage", "field_ops", "team", "resources",
  "warehouse", "warehouse_approve", "workday", "invoicing",
]);

test("an operations manager cannot take over the CFO", () => {
  const cfo = ["warehouse", "warehouse_approve", "hr", "workday", "invoicing"];
  assert.deepEqual(accessBeyond(opsManager, cfo), ["hr"]);
});

test("an operations manager can still manage field staff and the clerk", () => {
  assert.deepEqual(accessBeyond(opsManager, ["workday"]), []);
  assert.deepEqual(accessBeyond(opsManager, ["warehouse", "workday", "invoicing"]), []);
  assert.deepEqual(accessBeyond(opsManager, []), []);
});

test("an administrator holds everything", () => {
  const admin = toPermissionSet(["admin"]);
  assert.deepEqual(accessBeyond(admin, ["hr", "hr_settings", "company_settings"]), []);
});
