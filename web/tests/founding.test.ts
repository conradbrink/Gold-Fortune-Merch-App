// The Founding 10 application: checking, the number tidy-up, who may call the
// endpoint from a browser, and the owner's email. The database side is
// supabase/tests/founding.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applicationEmail,
  checkAttribution,
  describeAttribution,
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
  email: "owner@example.com",
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
    email: "owner@example.com",
    trade: "cleaning",
    team_size: "5-10",
    town: "Gaborone",
    how_run: "whatsapp",
    biggest_cost: "Staff say they were there.",
    whole_team: true,
    video_review: false,
    marketing_ok: true,
    source: "facebook",
    attribution: null,
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
    email: "owner@example.com",
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

test("attribution keeps what the site recorded, checked field by field", () => {
  const now = new Date("2026-10-12T10:00:00Z");
  assert.deepEqual(
    checkAttribution(
      {
        utm_source: "facebook",
        utm_medium: "paid_social",
        utm_campaign: "Founding Oct",
        referrer: "L.Facebook.com",
        landing_page: "/founding",
        click_id: "fbclid",
        first_seen_at: "2026-10-11T08:30:00.000Z",
      },
      now
    ),
    {
      utm_source: "facebook",
      utm_medium: "paid_social",
      utm_campaign: "Founding Oct",
      referrer: "l.facebook.com",
      landing_page: "/founding",
      click_id: "fbclid",
      first_seen_at: "2026-10-11T08:30:00.000Z",
    }
  );
});

test("odd attribution is dropped, never an error", () => {
  const now = new Date("2026-10-12T10:00:00Z");
  assert.equal(checkAttribution(null, now), null);
  assert.equal(checkAttribution("facebook", now), null);
  assert.equal(checkAttribution(["facebook"], now), null);
  assert.equal(
    checkAttribution(
      {
        utm_source: "x".repeat(101),
        utm_term: "a\nb",
        referrer: "https://evil.example/path",
        landing_page: "/founding?name=Thabo",
        click_id: "abc123",
        first_seen_at: "2031-01-01T00:00:00Z",
        name: "Thabo",
      },
      now
    ),
    null
  );
  assert.deepEqual(checkAttribution({ landing_page: "/", first_seen_at: "not a date" }, now), { landing_page: "/" });
});

test("an application carries its attribution, and works without one", () => {
  const withIt = checkApplication({ ...good, attribution: { utm_source: "google", landing_page: "/" } });
  assert.ok(withIt.ok);
  assert.deepEqual(withIt.application.attribution, { utm_source: "google", landing_page: "/" });
  const without = checkApplication(good);
  assert.ok(without.ok);
  assert.equal(without.application.attribution, null);
  assert.deepEqual(inputFromBody({ attribution: { utm_source: "x" } }).attribution, { utm_source: "x" });
});

test("the owner reads where an applicant came from in one line", () => {
  assert.equal(
    describeAttribution({ utm_source: "facebook", utm_medium: "paid_social", utm_campaign: "founding-oct", click_id: "fbclid", landing_page: "/founding", first_seen_at: "2026-10-11T08:30:00.000Z" }),
    "facebook / paid_social, campaign founding-oct, clicked from Facebook or Instagram, first page /founding, first seen 2026-10-11"
  );
  assert.equal(describeAttribution({ landing_page: "/" }), "came straight to the site, first page /");
  assert.equal(describeAttribution({ referrer: "www.google.com", landing_page: "/" }), "sent by www.google.com, first page /");
  assert.equal(describeAttribution(null), null);
});

import { validEmail } from "@/lib/founding";

test("an application's email is kept in lower case, checked when given, and never turns an applicant away when it is missing", () => {
  assert.equal(validEmail("a@b.co.za"), true);
  for (const bad of ["", "a", "a@b", "a b@c.de", "@b.co", "a@b."]) assert.equal(validEmail(bad), false, bad);
  // Given but wrong: the visitor hears about it. Missing: the application still goes through.
  assert.ok(foundingIssues({ ...good, email: "not an email" }).some((i) => i.field === "email"));
  assert.ok(!foundingIssues({ ...good, email: "" }).some((i) => i.field === "email"));
  const checked = checkApplication({ ...good, email: " Owner@Example.COM " });
  assert.ok(checked.ok && checked.application.email === "owner@example.com");
  const none = checkApplication({ ...good, email: "  " });
  assert.ok(none.ok && none.application.email === null);
});
