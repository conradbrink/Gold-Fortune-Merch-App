// /founding's form for the new sales process (25 Oct 2026): the new answers,
// the owner's Telegram or WhatsApp message and the row for their Google Sheet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applicationEmail, checkApplication, consentAnswer, foundingIssues, inputFromBody, repsLabel, type FoundingInput } from "@/lib/founding";
import { SHEET_HEADERS, alertOwnerOnTelegram, alertOwnerOnWhatsapp, alertText, saTime, sheetRow, telegramCard } from "@/lib/lead-alerts";

const callForm: FoundingInput = {
  name: " Thandi Nkosi ",
  businessName: " Nkosi Snacks ",
  whatsapp: "+26771234567",
  email: "",
  distributes: "",
  role: "owner",
  contactOk: true,
  trade: "distribution",
  teamSize: "3-5",
  town: "",
  howRun: "",
  biggestCost: "",
  wholeTeam: "",
  videoReview: "",
  marketingOk: false,
  source: "",
  attribution: { utm_source: "meta", utm_campaign: "distributors-oct", utm_content: "H07", click_id: "fbclid" },
};

const at = new Date("2026-10-25T08:14:03.250Z");

test("the new bands and roles are taken, and the consent is kept with its time", () => {
  for (const teamSize of ["1-2", "3-5", "6-10", "11-15", "16-30", "31+", "1-4", "20-50+"]) {
    assert.deepEqual(foundingIssues({ ...callForm, teamSize }), [], teamSize);
  }
  assert.deepEqual(
    foundingIssues({ ...callForm, role: "boss" }).map((i) => i.field),
    ["role"]
  );
  const r = checkApplication(callForm, at);
  assert.ok(r.ok);
  assert.equal(r.application.role, "owner");
  assert.equal(r.application.contact_consent_at, "2026-10-25T08:14:03.250Z");
  assert.equal(r.application.whatsapp, "26771234567");
  assert.equal(r.application.email, null);
  assert.equal(r.application.distributes, null);
});

test("the main page's form, without a role or consent, still gets through", () => {
  const r = checkApplication({ ...callForm, role: "", contactOk: null, teamSize: "5-10" }, at);
  assert.ok(r.ok);
  assert.equal(r.application.role, null);
  assert.equal(r.application.contact_consent_at, null);
});

test("the body's role and consent are read, and only a real true is consent", () => {
  assert.equal(inputFromBody({ role: "sales_manager", contactOk: true }).role, "sales_manager");
  assert.equal(inputFromBody({ contactOk: true }).contactOk, true);
  assert.equal(inputFromBody({ contactOk: false }).contactOk, false);
  // Not asked (the main page's form) or not a real yes or no: null, never a "No".
  assert.equal(inputFromBody({}).contactOk, null);
  assert.equal(inputFromBody({ contactOk: "true" }).contactOk, null);
  assert.equal(inputFromBody({ role: 3 }).role, "");
});

test("the owner's email shows the role and the consent", () => {
  const r = checkApplication(callForm, at);
  assert.ok(r.ok);
  const mail = applicationEmail(r.application, null, false);
  assert.ok(mail.text.includes("Role: Owner or MD"));
  assert.ok(mail.text.includes("Agreed to be contacted about the pilot: Yes"));
});

test("the owner's message says who, how big, where from, and how to answer", () => {
  const r = checkApplication(callForm, at);
  assert.ok(r.ok);
  assert.equal(
    alertText(r.application, false),
    [
      "New Founding lead: Thandi Nkosi, Nkosi Snacks",
      "Reps: 3 to 5 · Owner or MD",
      "WhatsApp: +26771234567",
      "From: meta, campaign distributors-oct, ad H07, clicked from Facebook or Instagram",
      "Answer: https://wa.me/26771234567",
    ].join("\n")
  );
  assert.ok(alertText(r.application, true).startsWith("Waiting list: "));
});

test("the sheet's time is South African, to the second", () => {
  assert.equal(saTime(at), "2026-10-25 10:14:03");
});

test("the sheet row lines up with the headers, with the owner's columns left empty", () => {
  const r = checkApplication({ ...callForm, distributes: "Groceries", email: "t@example.com" }, at);
  assert.ok(r.ok);
  const row = sheetRow(r.application, false, at);
  assert.equal(row.length, SHEET_HEADERS.length);
  const cell = (h: (typeof SHEET_HEADERS)[number]) => row[SHEET_HEADERS.indexOf(h)];
  assert.equal(cell("Submitted (SA time)"), "2026-10-25 10:14:03");
  assert.equal(cell("Name"), "Thandi Nkosi");
  assert.equal(cell("WhatsApp"), "+26771234567");
  assert.equal(cell("Reps"), "3-5");
  assert.equal(cell("Role"), "Owner or MD");
  assert.equal(cell("What they distribute"), "Groceries");
  assert.equal(cell("Email"), "t@example.com");
  assert.equal(cell("Agreed to be contacted"), "Yes");
  assert.equal(cell("List"), "Founding");
  assert.equal(cell("Source"), "meta");
  assert.equal(cell("Campaign"), "distributors-oct");
  assert.equal(cell("Ad set"), "");
  assert.equal(cell("Ad"), "H07");
  for (const h of ["First call at", "Reached", "Score", "Sales call booked", "Notes"] as const) assert.equal(cell(h), "");
});

test("the Telegram alert stays off until the bot is set up, then sends the message to the owner's chat", async () => {
  const r = checkApplication(callForm, at);
  assert.ok(r.ok);
  const realFetch = globalThis.fetch;
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  try {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    assert.equal(await alertOwnerOnTelegram("id-1", r.application, false, at), null);
    assert.equal(calls.length, 0);

    // As pasted into Vercel, with a stray space and line break.
    process.env.TELEGRAM_BOT_TOKEN = " 123:abc\n";
    process.env.TELEGRAM_CHAT_ID = "4567 ";
    assert.deepEqual(await alertOwnerOnTelegram("id-1", r.application, false, at), { ok: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.telegram.org/bot123:abc/sendMessage");
    assert.equal(calls[0].body.chat_id, "4567");
    assert.equal(calls[0].body.text, telegramCard(r.application, false, at));
    assert.equal(calls[0].body.parse_mode, "HTML");
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  }
});

test("a failed Telegram alert never throws, and never logs the bot's token", async () => {
  const r = checkApplication(callForm, at);
  assert.ok(r.ok);
  const realFetch = globalThis.fetch;
  const realError = console.error;
  const logged: string[] = [];
  console.error = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
  globalThis.fetch = (async (url: string | URL) => {
    throw new TypeError(`fetch failed for ${String(url)}`);
  }) as typeof fetch;
  try {
    process.env.TELEGRAM_BOT_TOKEN = "123:secret-token";
    process.env.TELEGRAM_CHAT_ID = "4567";
    const result = await alertOwnerOnTelegram("id-2", r.application, false, at);
    assert.equal(logged.length, 1);
    assert.ok(!logged[0].includes("secret-token"), logged[0]);
    // What the route notes on the application: why, never the token.
    assert.equal(result?.ok, false);
    assert.ok(result && !result.ok && !result.error.includes("secret-token"), JSON.stringify(result));
  } finally {
    globalThis.fetch = realFetch;
    console.error = realError;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  }
});

test("the Telegram card has every answer, when, where from, and a WhatsApp link with a first message", () => {
  const r = checkApplication(
    {
      ...callForm,
      distributes: "Groceries, Liquor",
      email: "t@example.com",
      attribution: { utm_source: "meta", utm_campaign: "distributors-oct", utm_term: "Broad SA", utm_content: "H07" },
    },
    at
  );
  assert.ok(r.ok);
  const hello = encodeURIComponent(
    "Hi Thandi, it's Conrad from Tickd. Thanks for applying for the free 14-day pilot. Is now a good time for a quick call?"
  ).replace(/'/g, "%27");
  assert.equal(
    telegramCard(r.application, false, at),
    [
      "🔔 <b>New Founding lead</b>",
      "<b>Thandi Nkosi</b> · Nkosi Snacks",
      "",
      "Role: Owner or MD",
      "Reps: 3 to 5",
      "Distributes: Groceries, Liquor",
      "WhatsApp: +26771234567",
      "Email: t@example.com",
      "Agreed to be contacted: Yes",
      "Applied: 2026-10-25 10:14:03 (SA time)",
      "Came from: meta · campaign distributors-oct · ad set Broad SA · ad H07",
      "",
      `💬 <a href="https://wa.me/26771234567?text=${hello}">WhatsApp Thandi</a>`,
    ].join("\n")
  );
});

test("the card leaves out what wasn't asked, and escapes what the applicant typed", () => {
  const r = checkApplication(
    { ...callForm, name: "<b>Tom</b> & Co", businessName: "A<script>", role: "", contactOk: null, attribution: undefined },
    at
  );
  assert.ok(r.ok);
  const card = telegramCard(r.application, true, at);
  assert.ok(card.startsWith("🕒 <b>Waiting list</b>"));
  assert.ok(card.includes("<b>&lt;b&gt;Tom&lt;/b&gt; &amp; Co</b> · A&lt;script&gt;"));
  assert.ok(!card.includes("Role:"));
  assert.ok(!card.includes("Email:"));
  assert.ok(!card.includes("Agreed to be contacted"));
  assert.ok(card.includes("Came from: not known"));
  assert.ok(!card.includes("<script>"));
});

test("the rep bands read the way the form shows them", () => {
  assert.equal(repsLabel("1-2"), "1 to 2");
  assert.equal(repsLabel("16-30"), "16 to 30");
  assert.equal(repsLabel("31+"), "More than 30");
  assert.equal(repsLabel("20-50+"), "20 to 50+");
});

test("an unticked consent on /founding's form reads No everywhere, so nobody calls them", () => {
  const r = checkApplication({ ...callForm, contactOk: false }, at);
  assert.ok(r.ok);
  assert.equal(consentAnswer(r.application), "No");
  assert.ok(telegramCard(r.application, false, at).includes("⚠️ <b>Agreed to be contacted: No</b> (they unticked it)"));
  assert.ok(applicationEmail(r.application, null, false).text.includes("Agreed to be contacted about the pilot: No"));
  assert.equal(sheetRow(r.application, false, at)[SHEET_HEADERS.indexOf("Agreed to be contacted")], "No");
  // Ticked: Yes. The main page's form (no role) never asked: null.
  const ticked = checkApplication(callForm, at);
  assert.ok(ticked.ok);
  assert.equal(consentAnswer(ticked.application), "Yes");
  assert.equal(consentAnswer({ contact_consent: null, contact_consent_at: null }), null);
  // A role without the consent box (a form that asks one but not the other) is not a "No".
  const roleOnly = checkApplication({ ...callForm, contactOk: null }, at);
  assert.ok(roleOnly.ok);
  assert.equal(consentAnswer(roleOnly.application), null);
});

test("Telegram says why it didn't send, for the applications list", async () => {
  const r = checkApplication(callForm, at);
  assert.ok(r.ok);
  const realFetch = globalThis.fetch;
  const realError = console.error;
  console.error = () => {};
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ ok: false, description: "Bad Request: chat not found" }), { status: 400 })) as typeof fetch;
  try {
    process.env.TELEGRAM_BOT_TOKEN = "123:abc";
    process.env.TELEGRAM_CHAT_ID = "4567";
    assert.deepEqual(await alertOwnerOnTelegram("id-3", r.application, false, at), { ok: false, error: "Bad Request: chat not found" });
  } finally {
    globalThis.fetch = realFetch;
    console.error = realError;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  }
});

test("the WhatsApp alert warns about an unticked consent, like the Telegram card", () => {
  const r = checkApplication({ ...callForm, contactOk: false }, at);
  assert.ok(r.ok);
  assert.ok(alertText(r.application, false).includes("⚠️ Agreed to be contacted: No (they unticked it)"));
  const ticked = checkApplication(callForm, at);
  assert.ok(ticked.ok);
  assert.ok(!alertText(ticked.application, false).includes("Agreed to be contacted"));
});

test("a failed WhatsApp alert never logs CallMeBot's key", async () => {
  const r = checkApplication(callForm, at);
  assert.ok(r.ok);
  const realFetch = globalThis.fetch;
  const realError = console.error;
  const logged: string[] = [];
  console.error = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
  globalThis.fetch = (async (url: string | URL) => {
    throw new TypeError(`Failed to parse URL from ${String(url)}`);
  }) as typeof fetch;
  try {
    process.env.CALLMEBOT_PHONE = "26776642259";
    process.env.CALLMEBOT_APIKEY = "secret-key-123";
    await alertOwnerOnWhatsapp("id-4", r.application, false);
    assert.equal(logged.length, 1);
    assert.ok(!logged[0].includes("secret-key-123"), logged[0]);
  } finally {
    globalThis.fetch = realFetch;
    console.error = realError;
    delete process.env.CALLMEBOT_PHONE;
    delete process.env.CALLMEBOT_APIKEY;
  }
});
