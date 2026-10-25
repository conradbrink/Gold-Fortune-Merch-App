// /founding's form for the new sales process (25 Oct 2026): the new answers,
// the owner's WhatsApp message and the row for their Google Sheet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applicationEmail, checkApplication, foundingIssues, inputFromBody, type FoundingInput } from "@/lib/founding";
import { SHEET_HEADERS, saTime, sheetRow, whatsappAlertText } from "@/lib/lead-alerts";

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
  const r = checkApplication({ ...callForm, role: "", contactOk: false, teamSize: "5-10" }, at);
  assert.ok(r.ok);
  assert.equal(r.application.role, null);
  assert.equal(r.application.contact_consent_at, null);
});

test("the body's role and consent are read, and only a real true is consent", () => {
  assert.equal(inputFromBody({ role: "sales_manager", contactOk: true }).role, "sales_manager");
  assert.equal(inputFromBody({ contactOk: true }).contactOk, true);
  assert.equal(inputFromBody({ contactOk: "true" }).contactOk, false);
  assert.equal(inputFromBody({ role: 3 }).role, "");
});

test("the owner's email shows the role and the consent", () => {
  const r = checkApplication(callForm, at);
  assert.ok(r.ok);
  const mail = applicationEmail(r.application, null, false);
  assert.ok(mail.text.includes("Role: Owner or MD"));
  assert.ok(mail.text.includes("Agreed to be contacted about the pilot: Yes"));
});

test("the WhatsApp message says who, how big, where from, and how to answer", () => {
  const r = checkApplication(callForm, at);
  assert.ok(r.ok);
  assert.equal(
    whatsappAlertText(r.application, false),
    [
      "New Founding lead: Thandi Nkosi, Nkosi Snacks",
      "Reps: 3-5 · Owner or MD",
      "WhatsApp: +26771234567",
      "From: meta, campaign distributors-oct, clicked from Facebook or Instagram",
      "Answer: https://wa.me/26771234567",
    ].join("\n")
  );
  assert.ok(whatsappAlertText(r.application, true).startsWith("Waiting list: "));
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
