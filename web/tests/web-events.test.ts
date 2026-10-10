// Tickd's own count of website visits: what the app accepts from the site,
// robots and devices, and (from the site's own code) how a visit is grouped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkWebEvent, deviceOf, isRobot } from "@/lib/web-events";
// The site's own code (its project has no test runner): loaded by address so
// this project's type checker doesn't reach into the other project.
const site = new URL("../../site/lib/own-count.ts", import.meta.url).href;
const { arrival, currentVisit } = (await import(site)) as typeof import("../../site/lib/own-count");

const vid = "6f1c2b4e-8d3a-4c5b-9e7f-0a1b2c3d4e5f";
const sid = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

test("an event is kept field by field; odd extras are dropped, never an error", () => {
  const row = checkWebEvent(
    {
      name: "page_view",
      visitor_id: vid.toUpperCase(),
      session_id: sid,
      path: "/founding",
      section: "pricing",
      referrer_host: "L.Facebook.com",
      utm_source: "fb",
      utm_medium: "paid_social",
      utm_campaign: "Founding Oct",
      click_id: "fbclid",
      email: "someone@example.com",
      ip: "1.2.3.4",
    },
    "mobile",
    "ZA"
  );
  assert.deepEqual(row, {
    name: "page_view",
    visitor_id: vid,
    session_id: sid,
    path: "/founding",
    section: "pricing",
    referrer_host: "l.facebook.com",
    utm_source: "fb",
    utm_medium: "paid_social",
    utm_campaign: "Founding Oct",
    click_id: "fbclid",
    device: "mobile",
    country: "ZA",
  });
  assert.ok(!("email" in (row as object)) && !("ip" in (row as object)));
});

test("what can't be counted at all is refused", () => {
  const ok = { name: "page_view", visitor_id: vid, session_id: sid, path: "/" };
  assert.ok(checkWebEvent(ok, null, null));
  assert.equal(checkWebEvent({ ...ok, name: "Page View" }, null, null), null);
  assert.equal(checkWebEvent({ ...ok, visitor_id: "abc" }, null, null), null);
  assert.equal(checkWebEvent({ ...ok, path: "founding" }, null, null), null);
  assert.equal(checkWebEvent({ ...ok, path: "/founding?name=Thabo" }, null, null), null);
  assert.equal(checkWebEvent("page_view", null, null), null);
  const odd = checkWebEvent({ ...ok, click_id: "abc123", referrer_host: "https://x.com/a", section: "Pricing Table!" }, null, "za");
  assert.deepEqual([odd?.click_id, odd?.referrer_host, odd?.section, odd?.country], [null, null, null, null]);
});

test("robots and scripts aren't visitors; people in WhatsApp's browser are", () => {
  assert.equal(isRobot("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"), true);
  assert.equal(isRobot("Mozilla/5.0 ... HeadlessChrome/120.0 Safari/537.36"), true);
  assert.equal(isRobot("curl/8.4.0"), true);
  assert.equal(isRobot(null), true);
  assert.equal(isRobot("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 WhatsApp/2.24"), false);
  assert.equal(isRobot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1"), false);
});

test("the kind of device", () => {
  assert.equal(deviceOf("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148"), "mobile");
  assert.equal(deviceOf("Mozilla/5.0 (Linux; Android 14; SM-A146P) Mobile Safari"), "mobile");
  assert.equal(deviceOf("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"), "tablet");
  assert.equal(deviceOf("Mozilla/5.0 (Linux; Android 13; SM-X200) Safari"), "tablet");
  assert.equal(deviceOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15"), "desktop");
});

test("the site: how a page view arrived", () => {
  assert.deepEqual(arrival("https://tickd.co.za/founding?utm_source=fb&utm_medium=paid_social&utm_campaign=founding-oct&fbclid=IwAR0x", "https://l.facebook.com/"), {
    utm_source: "fb",
    utm_medium: "paid_social",
    utm_campaign: "founding-oct",
    click_id: "fbclid",
    referrer_host: "l.facebook.com",
  });
  assert.deepEqual(arrival("https://tickd.co.za/pricing", "https://tickd.co.za/"), {}, "a page of our own isn't an arrival");
});

test("the site: one visit until 30 minutes pass or a new advert link brings them back", () => {
  const t = 1_000_000_000;
  const first = currentVisit(null, t, { utm_source: "fb" });
  assert.equal(first.utm_source, "fb");
  const same = currentVisit(first, t + 10 * 60_000, {});
  assert.equal(same.id, first.id);
  assert.equal(same.utm_source, "fb", "the visit keeps how it arrived");
  const later = currentVisit(same, t + 45 * 60_000, {});
  assert.notEqual(later.id, first.id);
  const advert = currentVisit(same, t + 11 * 60_000, { utm_campaign: "other" });
  assert.notEqual(advert.id, first.id);
  // Events on a page whose address still has the same advert's tags are the same visit.
  const tagged = currentVisit(null, t, { utm_source: "fb", utm_campaign: "founding-oct", click_id: "fbclid" });
  const again = currentVisit(tagged, t + 60_000, { utm_source: "fb", utm_campaign: "founding-oct", click_id: "fbclid" });
  assert.equal(again.id, tagged.id);
});
