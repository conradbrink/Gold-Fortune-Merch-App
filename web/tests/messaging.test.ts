// Stage 8.1 and 8.2: signed links in emails, the email layout, Brevo's
// answers, and the people at a site. The database side is
// supabase/tests/messaging.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { signLink, verifyLink } from "@/lib/email/links";
import { escapeHtml, renderEmail } from "@/lib/email/templates";
import { sendViaBrevo } from "@/lib/email/brevo";
import { checkContact, contactPhone, EMPTY_CONTACT } from "@/lib/site-contacts";

process.env.MESSAGE_LINK_SECRET = "test-secret";
const id = "6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4";

test("a signed link opens only for its own id and purpose", () => {
  const token = signLink("unsubscribe", id);
  assert.equal(verifyLink("unsubscribe", token), id);
  assert.equal(verifyLink("report", token), null);
  assert.equal(verifyLink("unsubscribe", token.replace(/.$/, (c) => (c === "A" ? "B" : "A"))), null);
  assert.equal(verifyLink("unsubscribe", `00000000-0000-0000-0000-000000000000.${token.split(".")[1]}`), null);
  assert.equal(verifyLink("unsubscribe", "not-a-token"), null);
  assert.equal(verifyLink("unsubscribe", ""), null);
});

test("emails escape what a company typed, and carry the stop link only when given", () => {
  assert.equal(escapeHtml(`<b>"Tom" & 'Jerry'</b>`), "&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;");
  const withStop = renderEmail("test", {}, { companyName: "Clean <Co>", unsubscribeUrl: "https://x/c/unsubscribe/t" })!;
  assert.match(withStop.html, /Clean &lt;Co&gt;/);
  assert.match(withStop.html, /Stop these emails/);
  assert.match(withStop.text, /Stop these emails: https:\/\/x\/c\/unsubscribe\/t/);
  const without = renderEmail("test", {}, { companyName: "Clean Co", unsubscribeUrl: null })!;
  assert.doesNotMatch(without.html, /Stop these emails/);
  assert.equal(without.subject, "Test email from Clean Co");
  assert.equal(renderEmail("nonsense", {}, { companyName: "X", unsubscribeUrl: null }), null);
  assert.doesNotMatch(withStop.html + withStop.text, /[–—]/);
});

function fakeFetch(status: number, body: unknown) {
  return (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}
const message = {
  to: { email: "a@example.com", name: "A" },
  sender: { email: "reports@tickd.co.za", name: "Clean Co" },
  subject: "S",
  html: "<p>H</p>",
  text: "H",
};

test("Brevo: a message id is success; a bad request is permanent; a rate limit or an outage is not", async () => {
  process.env.BREVO_API_KEY = "k";
  assert.deepEqual(await sendViaBrevo(message, fakeFetch(201, { messageId: "<m1>" })), { ok: true, messageId: "<m1>" });
  // Accepted without an id is still accepted: retrying would send it twice.
  assert.deepEqual(await sendViaBrevo(message, fakeFetch(202, {})), { ok: true, messageId: null });
  const bad = await sendViaBrevo(message, fakeFetch(400, { message: "invalid email" }));
  assert.equal(bad.ok, false);
  assert.equal(!bad.ok && bad.permanent, true);
  const busy = await sendViaBrevo(message, fakeFetch(429, { message: "slow down" }));
  assert.equal(!busy.ok && busy.permanent, false);
  const down = await sendViaBrevo(message, fakeFetch(502, {}));
  assert.equal(!down.ok && down.permanent, false);
  const offline = await sendViaBrevo(message, (async () => {
    throw new Error("network");
  }) as unknown as typeof fetch);
  assert.equal(!offline.ok && offline.permanent, false);
  delete process.env.BREVO_API_KEY;
  const noKey = await sendViaBrevo(message, fakeFetch(201, { messageId: "x" }));
  assert.equal(noKey.ok, false);
});

test("a contact's phone may be a landline, kept in international form", () => {
  assert.equal(contactPhone("011 555 0142", "ZA"), "+27115550142");
  assert.equal(contactPhone("082 555 0142", "ZA"), "+27825550142");
  assert.equal(contactPhone("00267 71 234 567", "ZA"), "+26771234567");
  assert.equal(contactPhone("12", "ZA"), null);
  assert.equal(contactPhone("", "ZA"), null);
});

test("a contact needs a name and an email or a phone, each valid", () => {
  assert.deepEqual(checkContact({ ...EMPTY_CONTACT, name: "Nomsa", email: " Nomsa@Example.com " }, "ZA"), {
    ok: true,
    row: { name: "Nomsa", email: "nomsa@example.com", phone: null, role: null, receives_reports: true, receives_accounts: false },
  });
  const accounts = checkContact({ ...EMPTY_CONTACT, name: "Accounts", email: "a@b.com", receivesReports: false, receivesAccounts: true }, "ZA");
  assert.ok(accounts.ok && accounts.row.receives_accounts && !accounts.row.receives_reports);
  const none = checkContact({ ...EMPTY_CONTACT, name: "Nomsa" }, "ZA");
  assert.equal(none.ok, false);
  assert.ok(!none.ok && none.errors.email);
  const bad = checkContact({ ...EMPTY_CONTACT, name: "", email: "nope", phone: "12" }, "ZA");
  assert.ok(!bad.ok && bad.errors.name && bad.errors.email && bad.errors.phone);
});

test("a contact's email and role fit the database's limits", () => {
  const long = checkContact({ ...EMPTY_CONTACT, name: "N", email: `${"a".repeat(250)}@example.com`, role: "r".repeat(61) }, "ZA");
  assert.ok(!long.ok && long.errors.email && long.errors.role);
});
