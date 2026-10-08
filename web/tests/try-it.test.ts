// "Try it yourself" (Stage 7 Part 2c): the owner's own login for the phone app.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSetup } from "@/lib/setup";
import { canAccessPath, toPermissionSet } from "@/lib/permissions";
import { fillTermTokens } from "@/lib/onboarding";
import { DEFAULT_TERMS } from "@/lib/terms";

test("my_setup(): which login is the owner's test login", () => {
  assert.equal(parseSetup({ owner_test_id: "6f1c2d3e-0000-4000-8000-000000000001" }).ownerTestId, "6f1c2d3e-0000-4000-8000-000000000001");
  assert.equal(parseSetup({ owner_test_id: null }).ownerTestId, null);
  assert.equal(parseSetup({}).ownerTestId, null);
  assert.equal(parseSetup({ owner_test_id: 42 }).ownerTestId, null);
  assert.equal(parseSetup({ owner_test_id: "" }).ownerTestId, null);
});

test("/try-it makes a login, so it is the administrator's", () => {
  assert.equal(canAccessPath(toPermissionSet(["admin"]), "/try-it"), true);
  assert.equal(canAccessPath(toPermissionSet(["company_settings"]), "/try-it"), false);
  assert.equal(canAccessPath(toPermissionSet(["field_ops", "team"]), "/try-it"), false);
});

test("the first getting-started step, in the company's words", () => {
  // As the migration writes it (20261009100000_try_it_yourself).
  const description = "Start a {workday.one|lower} on your phone, then see it on your map. About 10 minutes.";
  const text = fillTermTokens(description, {
    ...DEFAULT_TERMS,
    workday: { one: "Shift", many: "Shifts", article: null },
  });
  assert.equal(text, "Start a shift on your phone, then see it on your map. About 10 minutes.");
  assert.doesNotMatch(text, /watch/i);
});
