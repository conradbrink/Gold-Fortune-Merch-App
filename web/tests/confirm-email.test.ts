// The email a new trial's owner gets: one button to confirm the address,
// which lets the company email its clients (20261010250000).
import { test } from "node:test";
import assert from "node:assert/strict";
import { CLIENT_TEMPLATES, renderEmail } from "@/lib/email/templates";

const ctx = { companyName: "Sparkle Cleaning", unsubscribeUrl: null, attached: false, canReply: false };

test("the confirmation email carries its link and says what waits on it", () => {
  const email = renderEmail("confirm_email", { url: "https://app.tickd.co.za/c/confirm/abc.def" }, ctx);
  assert.ok(email);
  assert.equal(email.subject, "Confirm your email address for Tickd");
  assert.match(email.html, /https:\/\/app\.tickd\.co\.za\/c\/confirm\/abc\.def/);
  assert.match(email.text, /Confirm my email address: https:\/\/app\.tickd\.co\.za\/c\/confirm\/abc\.def/);
  assert.match(email.text, /cannot email invoices, quotes, statements or job reports to clients/);
});

test("without its link the confirmation email is refused, not sent blank", () => {
  assert.throws(() => renderEmail("confirm_email", {}, ctx));
});

test("it is Tickd's own message, so it carries no client unsubscribe link", () => {
  assert.equal(CLIENT_TEMPLATES.has("confirm_email"), false);
});
