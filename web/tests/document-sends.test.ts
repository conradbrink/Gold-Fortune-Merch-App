// Sending money documents by email (Stage 8.10): the sentences the dialogs
// and the "Sent" lines show, the people a document goes to, and the starting
// wording of a payment reminder. The database side is
// supabase/migrations/20261009250000_send_documents.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addAddresses,
  documentSubject,
  indexSummaries,
  isEmailAddress,
  newAddresses,
  parseOverdueInvoices,
  parseSendResult,
  parseSendRows,
  parseSendSummaries,
  recipientDefaults,
  relativeTime,
  rememberedSentence,
  reminderMessage,
  sendErrorText,
  sendLine,
  sendResultSentence,
  sentCell,
  shortDate,
  splitAddresses,
  suggestedTone,
  summaryForClient,
  type ReminderTone,
  type SendRow,
} from "@/lib/document-sends";

// Local noon, so the reader's own timezone cannot move the calendar day.
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);
const NOW = at(2026, 10, 9);

test("the result sentence counts addresses and names the ones that cannot be emailed", () => {
  assert.equal(sendResultSentence({ queued: 2, suppressed: [] }), "Sent to 2 addresses.");
  assert.equal(sendResultSentence({ queued: 1, suppressed: [] }), "Sent to 1 address.");
  assert.equal(
    sendResultSentence({ queued: 1, suppressed: ["x@y.com"] }),
    "Sent to 1 address. x@y.com can't be emailed (they asked us to stop, or it bounced)."
  );
  assert.equal(
    sendResultSentence({ queued: 1, suppressed: ["a@b.com", "c@d.com", "e@f.com"] }),
    "Sent to 1 address. a@b.com, c@d.com and e@f.com can't be emailed (they asked us to stop, or it bounced)."
  );
  assert.equal(
    sendResultSentence({ queued: 0, suppressed: ["x@y.com"] }),
    "Nothing was sent. x@y.com can't be emailed (they asked us to stop, or it bounced)."
  );
  assert.equal(sendResultSentence({ queued: 0, suppressed: [] }), "Nothing was sent.");
});

test("remembering an address says what happened, and a failure says why", () => {
  assert.equal(rememberedSentence(["a@b.com"], "Nomsa Traders", { ok: true }), "We will remember a@b.com for Nomsa Traders.");
  assert.equal(
    rememberedSentence(["a@b.com", "c@d.com"], "Nomsa Traders", { ok: false, message: "Only a manager can change contacts." }),
    "We could not remember those addresses for Nomsa Traders. Only a manager can change contacts."
  );
});

test("a date reads 9 Oct, with the year only when it is not this year", () => {
  assert.equal(shortDate(at(2026, 10, 9), NOW), "9 Oct");
  assert.equal(shortDate(at(2026, 1, 1), NOW), "1 Jan");
  assert.equal(shortDate(at(2025, 12, 31), NOW), "31 Dec 2025");
  assert.equal(shortDate("not a date", NOW), "");
});

test("relative time is today, yesterday, days ago, and from a week on the date", () => {
  assert.equal(relativeTime(at(2026, 10, 9, 0), NOW), "today");
  assert.equal(relativeTime(at(2026, 10, 9, 23), NOW), "today");
  assert.equal(relativeTime(at(2026, 10, 8, 23), NOW), "yesterday");
  assert.equal(relativeTime(at(2026, 10, 6), NOW), "3 days ago");
  assert.equal(relativeTime(at(2026, 10, 3), NOW), "6 days ago");
  assert.equal(relativeTime(at(2026, 10, 2), NOW), "2 Oct");
  assert.equal(relativeTime(at(2025, 10, 2), NOW), "2 Oct 2025");
  // A clock a little ahead is still today.
  assert.equal(relativeTime(at(2026, 10, 10), NOW), "today");
  assert.equal(relativeTime("nonsense", NOW), "");
});

test("a month end and a month start are a day apart, not a month", () => {
  const now = at(2026, 11, 1);
  assert.equal(relativeTime(at(2026, 10, 31), now), "yesterday");
});

const row = (over: Partial<SendRow>): SendRow => ({
  id: "1",
  to: "a@b.com",
  sentOn: at(2026, 10, 9).toISOString(),
  status: "sent",
  sentAt: at(2026, 10, 9).toISOString(),
  error: null,
  openedAt: null,
  openCount: 0,
  ...over,
});

test("each send reads by its status", () => {
  assert.deepEqual(sendLine(row({ openedAt: at(2026, 10, 10).toISOString() }), at(2026, 10, 11)), {
    text: "Sent to a@b.com on 9 Oct · Opened 10 Oct",
    problem: false,
  });
  assert.equal(sendLine(row({}), NOW).text, "Sent to a@b.com on 9 Oct · Not opened yet");
  assert.equal(sendLine(row({ status: "queued", sentAt: null }), NOW).text, "Waiting to send to a@b.com");
  assert.equal(sendLine(row({ status: "sending", sentAt: null }), NOW).text, "Waiting to send to a@b.com");
  assert.deepEqual(sendLine(row({ status: "failed", error: "mailbox full" }), NOW), {
    text: "Couldn't be delivered to a@b.com: mailbox full",
    problem: true,
  });
  assert.equal(sendLine(row({ status: "failed" }), NOW).text, "Couldn't be delivered to a@b.com");
  assert.deepEqual(sendLine(row({ status: "suppressed" }), NOW), { text: "Blocked address: a@b.com", problem: true });
  assert.equal(sendLine(row({ status: "cancelled" }), NOW).problem, true);
});

test("a long provider error is cut short and tidied", () => {
  const text = sendLine(row({ status: "failed", error: `no\n\n  such   ${"x".repeat(300)}` }), NOW).text;
  assert.ok(text.startsWith("Couldn't be delivered to a@b.com: no such xxx"));
  assert.ok(text.length < 170);
});

test("addresses are checked the way the database checks them", () => {
  assert.ok(isEmailAddress("nomsa@example.com"));
  assert.ok(isEmailAddress("  Nomsa.K+accounts@mail.example.co.za "));
  assert.ok(!isEmailAddress("nomsa@example"));
  assert.ok(!isEmailAddress("nomsa example.com"));
  assert.ok(!isEmailAddress("a@b@c.com"));
  assert.ok(!isEmailAddress("<a@b.com>"));
  assert.ok(!isEmailAddress(`${"a".repeat(250)}@b.com`));
});

test("typed addresses split at commas, semicolons and spaces, in lower case", () => {
  assert.deepEqual(splitAddresses(" A@B.com, c@d.com;e@f.com  g@h.com\n"), ["a@b.com", "c@d.com", "e@f.com", "g@h.com"]);
  assert.deepEqual(splitAddresses("  ,, "), []);
});

test("adding an address keeps the list, drops repeats and says what is wrong", () => {
  assert.deepEqual(addAddresses([], "Nomsa@Example.com"), { addresses: ["nomsa@example.com"], error: null });
  assert.deepEqual(addAddresses(["a@b.com"], "a@b.com, c@d.com"), { addresses: ["a@b.com", "c@d.com"], error: null });
  assert.deepEqual(addAddresses(["a@b.com"], "nope"), { addresses: ["a@b.com"], error: "nope is not an email address." });
  // Nothing is added when any piece is wrong.
  assert.deepEqual(addAddresses([], "a@b.com, nope"), { addresses: [], error: "nope is not an email address." });
  assert.deepEqual(addAddresses(["a@b.com"], ""), { addresses: ["a@b.com"], error: null });
});

test("at most five addresses", () => {
  const five = ["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com"];
  assert.deepEqual(addAddresses(five, "a@x.com"), { addresses: five, error: null });
  assert.deepEqual(addAddresses(five, "f@x.com"), {
    addresses: five,
    error: "Send to at most 5 addresses at a time.",
  });
  assert.equal(addAddresses(five.slice(0, 4), "e@x.com").addresses.length, 5);
});

test("the document's own address comes first, then the people who get the accounts", () => {
  const contacts = [
    { email: "Reports@Site.co.za", receives_accounts: false },
    { email: "accounts@site.co.za", receives_accounts: true },
    { email: null, receives_accounts: true },
    { email: "not an address", receives_accounts: true },
    { email: "accounts@site.co.za", receives_accounts: true },
  ];
  assert.deepEqual(recipientDefaults("Pay@Client.com", contacts), {
    addresses: ["pay@client.com"],
    known: ["reports@site.co.za", "accounts@site.co.za"],
  });
  assert.deepEqual(recipientDefaults(null, contacts).addresses, ["accounts@site.co.za"]);
  assert.deepEqual(recipientDefaults("  ", contacts).addresses, ["accounts@site.co.za"]);
  assert.deepEqual(recipientDefaults("broken", contacts).addresses, ["accounts@site.co.za"]);
  // Nobody to send to: the box stays empty for the person to type.
  assert.deepEqual(recipientDefaults(null, []), { addresses: [], known: [] });
});

test("an address is offered to be remembered only for a known place and only when new", () => {
  const known = ["a@b.com"];
  assert.deepEqual(newAddresses("store-1", ["a@b.com", "c@d.com"], known), ["c@d.com"]);
  assert.deepEqual(newAddresses(null, ["c@d.com"], known), []);
  assert.deepEqual(newAddresses("store-1", ["a@b.com"], known), []);
});

test("the subject names the document and the company", () => {
  assert.equal(documentSubject("invoice", { number: "INV-0042", company: "Gold Fortune" }), "Invoice INV-0042 from Gold Fortune");
  assert.equal(documentSubject("quote", { number: "Q-0007", company: "Gold Fortune" }), "Quote Q-0007 from Gold Fortune");
  assert.equal(
    documentSubject("statement", { company: "Gold Fortune", period: "1 Sep to 30 Sep 2026" }),
    "Statement from Gold Fortune, 1 Sep to 30 Sep 2026"
  );
  assert.equal(documentSubject("statement", { company: "Gold Fortune" }), "Statement from Gold Fortune");
  assert.equal(
    documentSubject("reminder", { company: "Gold Fortune", total: "R3,450.00" }),
    "Payment reminder from Gold Fortune: R3,450.00 overdue"
  );
  assert.equal(
    documentSubject("reminder", { company: "Gold Fortune", total: "R3,450.00", final: true }),
    "Final notice from Gold Fortune: R3,450.00 overdue"
  );
  assert.equal(documentSubject("invoice", { number: "INV-1", company: "" }), "Invoice INV-1");
});

const facts = {
  client: "Nomsa Traders",
  invoices: [
    { number: "INV-0040", daysOverdue: 41 },
    { number: "INV-0042", daysOverdue: 12 },
  ],
  total: "R3,450.00",
};
const one = { client: "Nomsa Traders", invoices: [{ number: "INV-0042", daysOverdue: 1 }], total: "R450.00" };

test("every tone names the client, the invoices and the total, and asks for payment or a call", () => {
  for (const tone of ["friendly", "firm", "final"] as ReminderTone[]) {
    const m = reminderMessage(tone, facts);
    assert.ok(m.startsWith("Hi Nomsa Traders,\n\n"), tone);
    assert.ok(m.includes("INV-0040 (41 days)") && m.includes("INV-0042 (12 days)"), tone);
    assert.ok(m.includes("R3,450.00"), tone);
    assert.ok(/pay/.test(m) && /get in touch|call us/.test(m), tone);
    assert.ok(m.includes("\n\n"), tone);
  }
});

test("the tones get firmer", () => {
  assert.match(reminderMessage("friendly", facts), /friendly reminder/);
  assert.match(reminderMessage("friendly", facts), /if you have already paid, thank you/i);
  assert.match(reminderMessage("firm", facts), /Please pay it this week/);
  assert.match(reminderMessage("firm", facts), /overdue for 41 days/);
  assert.match(reminderMessage("final", facts), /final notice/);
  assert.match(reminderMessage("final", facts), /within 7 days/);
  assert.match(reminderMessage("final", facts), /call us/);
  assert.doesNotMatch(reminderMessage("friendly", facts), /this week|7 days|final notice/);
});

test("one invoice is named plainly, with its days in the singular", () => {
  const m = reminderMessage("friendly", one);
  assert.match(m, /Invoice INV-0042 is 1 day overdue\./);
  assert.doesNotMatch(m, /oldest/);
  assert.match(reminderMessage("firm", one), /Invoice INV-0042 is 1 day overdue\./);
});

test("a long list of invoices is cut to six and says how many more", () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ number: `INV-${i + 1}`, daysOverdue: 10 + i }));
  const m = reminderMessage("firm", { client: "X", invoices: many, total: "R1.00" });
  assert.match(m, /INV-1 \(10 days\)/);
  assert.match(m, /INV-6 \(15 days\)/);
  assert.doesNotMatch(m, /INV-7/);
  assert.match(m, /and 3 more\./);
});

test("the messages are plain South African English: no dashes, no bill, no clipped phrasing", () => {
  for (const tone of ["friendly", "firm", "final"] as ReminderTone[]) {
    for (const f of [facts, one]) {
      const m = reminderMessage(tone, f);
      assert.doesNotMatch(m, /[–—]/, "no en or em dash");
      assert.doesNotMatch(m, /\bbills?\b/i);
      assert.doesNotMatch(m, /customer|shop|store|visit/i, "no trade word: the same message serves any trade");
    }
  }
});

test("the tone to start from depends on how old the oldest invoice is", () => {
  assert.equal(suggestedTone(0), "friendly");
  assert.equal(suggestedTone(30), "friendly");
  assert.equal(suggestedTone(31), "firm");
  assert.equal(suggestedTone(400), "firm");
});

test("what the database returns is read defensively", () => {
  assert.deepEqual(parseSendResult({ link_id: "L", queued: 2, suppressed: ["a@b.com"], invoices: 3 }), {
    linkId: "L",
    queued: 2,
    suppressed: ["a@b.com"],
  });
  assert.deepEqual(parseSendResult(null), { linkId: "", queued: 0, suppressed: [] });
  assert.deepEqual(parseSendResult("nonsense"), { linkId: "", queued: 0, suppressed: [] });
  assert.deepEqual(parseSendResult({ queued: "3", suppressed: [1, "x@y.com", null] }), {
    linkId: "",
    queued: 3,
    suppressed: ["x@y.com"],
  });

  const rows = parseSendRows([
    { id: "1", to: "a@b.com", sent_on: "2026-10-09T08:00:00Z", status: "sent", sent_at: null, error: null, opened_at: "2026-10-10T08:00:00Z", open_count: 2 },
    { id: "2", to: null, sent_on: "2026-10-09T08:00:00Z" },
    "junk",
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].openedAt, "2026-10-10T08:00:00Z");
  assert.equal(rows[0].openCount, 2);
  assert.deepEqual(parseSendRows({ not: "a list" }), []);

  assert.deepEqual(
    parseOverdueInvoices([{ invoice_id: "i", number: "INV-1", issue_date: "2026-08-01", due_date: "2026-08-31", total: "100", outstanding: "40.5", days_overdue: 39 }]),
    [{ invoiceId: "i", number: "INV-1", issueDate: "2026-08-01", dueDate: "2026-08-31", total: 100, outstanding: 40.5, daysOverdue: 39 }]
  );
  assert.deepEqual(parseOverdueInvoices(null), []);
});

test("the latest send is found by document, by place, or by the name on the invoices", () => {
  const index = indexSummaries(
    parseSendSummaries([
      { related_id: "inv-1", store_id: null, customer_name: null, last_sent_at: "2026-10-09T08:00:00Z", last_status: "sent", last_opened_at: null, sends: 1 },
      { related_id: null, store_id: "store-1", customer_name: null, last_sent_at: "2026-10-01T08:00:00Z", last_status: "sent", last_opened_at: null, sends: 2 },
      { related_id: null, store_id: null, customer_name: "Nomsa Traders", last_sent_at: "2026-09-20T08:00:00Z", last_status: null, last_opened_at: "2026-09-21T08:00:00Z", sends: 1 },
      { last_sent_at: null },
    ])
  );
  assert.equal(index.byDocument.get("inv-1")?.sends, 1);
  assert.equal(summaryForClient(index, { storeId: "store-1", name: "Anything" })?.sends, 2);
  assert.equal(summaryForClient(index, { storeId: null, name: "  nomsa traders " })?.lastOpenedAt, "2026-09-21T08:00:00Z");
  assert.equal(summaryForClient(index, { storeId: null, name: "Someone else" }), undefined);
});

test("database errors come out in plain words", () => {
  assert.equal(sendErrorText("permission denied: invoicing is required"), "You do not have permission to send documents.");
  assert.equal(sendErrorText("TypeError: Failed to fetch"), "We could not reach the server. Check your connection and try again.");
  assert.equal(sendErrorText("INV-0042 was voided, so it cannot be sent."), "INV-0042 was voided, so it cannot be sent.");
  assert.equal(sendErrorText(""), "That did not work. Please try again.");
  assert.equal(sendErrorText(null), "That did not work. Please try again.");
});

test("the Sent column shows the date, an opened marker, and a problem when the last email never arrived", () => {
  const base = { relatedId: "i", storeId: null, customerName: null, sends: 1 };
  assert.equal(sentCell(undefined, NOW), null);
  assert.deepEqual(
    sentCell({ ...base, lastSentAt: at(2026, 10, 9).toISOString(), lastStatus: "sent", lastOpenedAt: null }, NOW),
    { date: "9 Oct", opened: false, problem: false }
  );
  assert.deepEqual(
    sentCell({ ...base, lastSentAt: at(2026, 10, 9).toISOString(), lastStatus: "sent", lastOpenedAt: at(2026, 10, 10).toISOString() }, NOW),
    { date: "9 Oct", opened: true, problem: false }
  );
  assert.equal(sentCell({ ...base, lastSentAt: at(2026, 10, 9).toISOString(), lastStatus: "failed", lastOpenedAt: null }, NOW)?.problem, true);
  assert.equal(sentCell({ ...base, lastSentAt: at(2026, 10, 9).toISOString(), lastStatus: "queued", lastOpenedAt: null }, NOW)?.problem, false);
});
