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
  businessName: " Shine Cleaning ",
  whatsapp: "082 123 4567",
  trade: "cleaning",
  teamSize: "5-10",
  town: " Gaborone ",
  howRun: "whatsapp",
  biggestCost: " Staff say they were there. ",
  wholeTeam: "yes",
  videoReview: "no",
  marketingOk: true,
  source: "Facebook",
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
    business_name: "Shine Cleaning",
    whatsapp: "27821234567",
    trade: "cleaning",
    team_size: "5-10",
    town: "Gaborone",
    how_run: "whatsapp",
    biggest_cost: "Staff say they were there.",
    whole_team: true,
    video_review: false,
    marketing_ok: true,
    source: "facebook",
  });
});

test("a strange source is dropped, not refused", () => {
  const r = checkApplication({ ...good, source: "a b!" });
  assert.ok(r.ok);
  assert.equal(r.application.source, null);
});

test("every field is required, and the marketing box must be ticked", () => {
  const empty: FoundingInput = {
    name: "",
    businessName: "",
    whatsapp: "x",
    trade: "Cleaning",
    teamSize: "9",
    town: "",
    howRun: "post",
    biggestCost: "",
    wholeTeam: "",
    videoReview: "maybe",
    marketingOk: false,
    source: "",
  };
  assert.deepEqual(
    foundingIssues(empty).map((i) => i.field),
    ["name", "businessName", "whatsapp", "trade", "teamSize", "town", "howRun", "biggestCost", "wholeTeam", "videoReview", "marketingOk"]
  );
  assert.deepEqual(foundingIssues(good), []);
  assert.equal(foundingIssues({ ...good, biggestCost: "x".repeat(1001) })[0]?.field, "biggestCost");
  assert.equal(foundingIssues({ ...good, marketingOk: false })[0]?.field, "marketingOk");
});

test("the team sizes and ways of running jobs are exactly the form's", () => {
  for (const size of ["1-4", "5-10", "11-25", "26-50", "50+"]) assert.deepEqual(foundingIssues({ ...good, teamSize: size }), []);
  for (const how of ["whatsapp", "paper", "app", "memory"]) assert.deepEqual(foundingIssues({ ...good, howRun: how }), []);
  assert.equal(foundingIssues({ ...good, teamSize: "1-2" })[0]?.field, "teamSize");
});

test("a body that is not an object, or has the wrong types, never throws", () => {
  for (const body of [null, undefined, "x", 5, [], { name: 5, trade: {}, marketingOk: "true" }]) {
    const input = inputFromBody(body);
    assert.equal(typeof input.name, "string");
    assert.equal(input.marketingOk, false);
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

test("the owner's email escapes what the visitor typed, lists every answer and links to WhatsApp", () => {
  const ok = checkApplication({ ...good, biggestCost: `<script>alert("x")</script> & more`, businessName: `Tom's <b>Pools</b>` });
  assert.ok(ok.ok);
  const mail = applicationEmail(ok.application, "Pools", false);
  assert.ok(!mail.html.includes("<script>"));
  assert.ok(!mail.html.includes("<b>Pools"));
  assert.ok(mail.html.includes("&lt;script&gt;"));
  assert.ok(mail.html.includes("https://wa.me/27821234567"));
  assert.ok(mail.subject.startsWith("New Founding application: "));
  assert.ok(mail.subject.includes("Gaborone"));
  for (const bit of ["+27821234567", "WhatsApp", "5-10", "Whole team", "video and Google review", "marketing"]) {
    assert.ok(mail.text.includes(bit), bit);
  }
  assert.ok(applicationEmail(ok.application, "Pools", true).subject.startsWith("Waiting list: "));
});
