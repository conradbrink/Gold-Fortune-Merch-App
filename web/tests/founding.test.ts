// The Founding 10 application: checking, the number tidy-up, who may call the
// endpoint from a browser, and the owner's email. The database side is
// supabase/tests/founding.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applicationEmail,
  checkApplication,
  corsOrigin,
  foundingIssues,
  inputFromBody,
  normaliseWhatsapp,
  type FoundingInput,
} from "@/lib/founding";

const good: FoundingInput = {
  name: " Thandi ",
  whatsapp: "082 123 4567",
  businessName: " Shine Cleaning ",
  trade: "cleaning",
  teamSize: "3-5",
  headache: " Staff say they were there. ",
  source: "WhatsApp",
};

test("a South African number typed the way an owner types it becomes international digits", () => {
  assert.equal(normaliseWhatsapp("082 123 4567"), "27821234567");
  assert.equal(normaliseWhatsapp("+27 82 123 4567"), "27821234567");
  assert.equal(normaliseWhatsapp("0027821234567"), "27821234567");
  assert.equal(normaliseWhatsapp("27821234567"), "27821234567");
  assert.equal(normaliseWhatsapp("+267 71 234 567"), "26771234567");
  assert.equal(normaliseWhatsapp("(082) 123-4567"), "27821234567");
});

test("something that cannot be a number is refused", () => {
  assert.equal(normaliseWhatsapp(""), null);
  assert.equal(normaliseWhatsapp("hello"), null);
  assert.equal(normaliseWhatsapp("0821"), null);
  assert.equal(normaliseWhatsapp("+0 1234 5678 9"), null);
  assert.equal(normaliseWhatsapp("1".repeat(20)), null);
});

test("a good application is trimmed and ready to save", () => {
  const r = checkApplication(good);
  assert.ok(r.ok);
  assert.deepEqual(r.application, {
    name: "Thandi",
    whatsapp: "27821234567",
    business_name: "Shine Cleaning",
    trade: "cleaning",
    team_size: "3-5",
    headache: "Staff say they were there.",
    source: "whatsapp",
  });
});

test("the headache is optional, and a strange source is dropped, not refused", () => {
  const r = checkApplication({ ...good, headache: "  ", source: "a b!" });
  assert.ok(r.ok);
  assert.equal(r.application.headache, null);
  assert.equal(r.application.source, null);
});

test("every problem is named, in the order the form shows the fields", () => {
  const issues = foundingIssues({ name: "", whatsapp: "x", businessName: "", trade: "Cleaning", teamSize: "9", headache: "", source: "" });
  assert.deepEqual(
    issues.map((i) => i.field),
    ["name", "whatsapp", "businessName", "trade", "teamSize"]
  );
  assert.deepEqual(foundingIssues(good), []);
  assert.equal(foundingIssues({ ...good, headache: "x".repeat(1001) })[0]?.field, "headache");
});

test("a body that is not an object, or has the wrong types, never throws", () => {
  for (const body of [null, undefined, "x", 5, [], { name: 5, trade: {} }]) {
    const input = inputFromBody(body);
    assert.equal(typeof input.name, "string");
    assert.ok(foundingIssues(input).length > 0);
  }
});

test("only the sales site may call from a browser; localhost only outside production", () => {
  assert.equal(corsOrigin("https://tickd.co.za", true), "https://tickd.co.za");
  assert.equal(corsOrigin("https://www.tickd.co.za", true), "https://www.tickd.co.za");
  assert.equal(corsOrigin("https://evil.example", true), null);
  assert.equal(corsOrigin("https://tickd.co.za.evil.example", true), null);
  assert.equal(corsOrigin("http://localhost:3100", true), null);
  assert.equal(corsOrigin("http://localhost:3100", false), "http://localhost:3100");
  assert.equal(corsOrigin(null, true), null);
});

test("the owner's email escapes what the visitor typed and links to WhatsApp", () => {
  const ok = checkApplication({ ...good, headache: `<script>alert("x")</script> & more`, businessName: `Tom's <b>Pools</b>` });
  assert.ok(ok.ok);
  const mail = applicationEmail(ok.application, "Pools", false);
  assert.ok(!mail.html.includes("<script>"));
  assert.ok(!mail.html.includes("<b>Pools"));
  assert.ok(mail.html.includes("&lt;script&gt;"));
  assert.ok(mail.html.includes("https://wa.me/27821234567"));
  assert.ok(mail.subject.startsWith("New Founding application: "));
  assert.ok(mail.text.includes("+27821234567"));
  assert.ok(applicationEmail(ok.application, "Pools", true).subject.startsWith("Waiting list: "));
});
