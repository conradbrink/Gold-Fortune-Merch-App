// The answer to a Founding applicant: which statuses are real, which one sends an email.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FOUNDING_STATUSES, isFoundingStatus, outcomePayload, outcomeTemplate } from "@/lib/founding-outcome";

test("only the statuses the database allows are accepted", () => {
  for (const s of FOUNDING_STATUSES) assert.ok(isFoundingStatus(s));
  assert.ok(!isFoundingStatus("approved") && !isFoundingStatus(""));
});

test("only accepted has an email: nobody is turned down", () => {
  assert.equal(outcomeTemplate("accepted"), "founding_accepted");
  for (const s of ["new", "contacted", "declined", "waitlist"] as const) assert.equal(outcomeTemplate(s), null);
});

test("the email is filled in with the first name, business and number", () => {
  assert.deepEqual(outcomePayload({ name: "  Thandi  Nkosi ", business_name: "Shine", whatsapp: "27821234567" }), {
    first_name: "Thandi",
    business_name: "Shine",
    whatsapp: "27821234567",
  });
});
