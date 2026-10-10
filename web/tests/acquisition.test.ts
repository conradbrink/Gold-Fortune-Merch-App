// The Acquisition pages' rules: the periods, how an application's first visit
// becomes a channel, the tallies, and the funnel with its biggest drop.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acquisitionStages,
  buildFunnel,
  byNameAndPeriod,
  change,
  channelOf,
  formatChange,
  percent,
  periods,
  readRange,
  sourceOf,
  tallyApplications,
  type ApplicationRow,
  type CompanyFacts,
} from "@/lib/acquisition";

test("the period is the last N South African days, and the N before", () => {
  // 10 Oct 2026, 23:30 SAST = 21:30 UTC.
  const p = periods("7d", new Date("2026-10-10T21:30:00Z"));
  assert.deepEqual(p.current, { startDate: "2026-10-04", endDate: "2026-10-10", from: "2026-10-03T22:00:00.000Z", to: "2026-10-10T22:00:00.000Z" });
  assert.deepEqual(p.previous, { startDate: "2026-09-27", endDate: "2026-10-03", from: "2026-09-26T22:00:00.000Z", to: "2026-10-03T22:00:00.000Z" });
  // 00:30 SAST on the 11th is already the 11th.
  assert.equal(periods("7d", new Date("2026-10-10T22:30:00Z")).current.endDate, "2026-10-11");
  assert.equal(periods("12m", new Date("2026-10-10T12:00:00Z")).current.startDate, "2025-10-11");
});

test("the range in the address is read strictly", () => {
  assert.equal(readRange("90d"), "90d");
  assert.equal(readRange("1y"), "30d");
  assert.equal(readRange(["7d"]), "30d");
});

test("changes, and nothing to compare with", () => {
  assert.equal(formatChange(change(118, 100)), "+18%");
  assert.equal(formatChange(change(90, 100)), "-10%");
  assert.equal(change(5, 0), null);
  assert.equal(change(null, 3), null);
  assert.equal(percent(1, 8), "13%");
  assert.equal(percent(3, 400), "0.8%");
  assert.equal(percent(1, 0), "n/a");
});

test("a first visit becomes Google's channel name", () => {
  assert.equal(channelOf(null), "Direct");
  assert.equal(channelOf({ landing_page: "/" }), "Direct");
  assert.equal(channelOf({ utm_source: "facebook", utm_medium: "paid_social", click_id: "fbclid" }), "Paid Social");
  assert.equal(channelOf({ click_id: "fbclid", referrer: "l.facebook.com" }), "Organic Social");
  assert.equal(channelOf({ utm_source: "google", utm_medium: "cpc" }), "Paid Search");
  assert.equal(channelOf({ click_id: "gclid" }), "Paid Search");
  assert.equal(channelOf({ referrer: "www.google.co.za" }), "Organic Search");
  assert.equal(channelOf({ referrer: "lm.facebook.com" }), "Organic Social");
  assert.equal(channelOf({ referrer: "www.sabusiness.co.za" }), "Referral");
  assert.equal(channelOf({ utm_source: "newsletter", utm_medium: "email" }), "Email");
  assert.equal(channelOf({ utm_campaign: "founding-oct" }), "Unassigned");
});

test("a source is one plain word", () => {
  assert.equal(sourceOf({ utm_source: "Facebook" }), "facebook");
  assert.equal(sourceOf({ referrer: "l.facebook.com" }), "facebook");
  assert.equal(sourceOf({ referrer: "www.google.co.za" }), "google");
  assert.equal(sourceOf({ referrer: "news.ycombinator.com" }), "ycombinator");
  assert.equal(sourceOf({ click_id: "gclid" }), "google");
  assert.equal(sourceOf(null), "direct");
});

const companies = new Map<string, CompanyFacts>([
  ["org-1", { id: "org-1", name: "Ndlovu Plumbing", freePeriod: true, activated: true }],
  ["org-2", { id: "org-2", name: "Mokoena Cleaning", freePeriod: false, activated: false }],
]);
const apps: ApplicationRow[] = [
  { id: "a1", created_at: "2026-10-05T08:00:00Z", attribution: { utm_source: "facebook", utm_medium: "paid_social", utm_campaign: "founding-oct" }, organization_id: "org-1" },
  { id: "a2", created_at: "2026-10-06T08:00:00Z", attribution: { utm_source: "facebook", utm_medium: "paid_social", utm_campaign: "founding-oct" }, organization_id: null },
  { id: "a3", created_at: "2026-10-07T08:00:00Z", attribution: null, organization_id: "org-2" },
];

test("applications are tallied with what came of them", () => {
  const byChannel = tallyApplications(apps, (a) => channelOf(a.attribution), companies);
  assert.deepEqual(byChannel.get("Paid Social"), { applications: 2, companies: 1, freePeriods: 1 });
  assert.deepEqual(byChannel.get("Direct"), { applications: 1, companies: 1, freePeriods: 0 });
  const byCampaign = tallyApplications(apps, (a) => a.attribution?.utm_campaign ?? null, companies);
  assert.deepEqual([...byCampaign.keys()], ["founding-oct"]);
});

test("the funnel shows each step's share and names the biggest drop", () => {
  const events = new Map([
    ["page_view", { current: 400 }],
    ["pricing_view", { current: 120 }],
    ["signup_started", { current: 12 }],
  ]);
  const { steps, leak } = buildFunnel(acquisitionStages({ events, gaMissing: "x", applications: apps, companies, range: "30d" }));
  assert.deepEqual(steps.map((s) => s.count), [400, 120, 12, 3, 2, 1, 1, null]);
  assert.equal(steps[1].ofPrevious, 0.3);
  assert.equal(steps[2].ofPrevious, 0.1);
  assert.equal(steps[0].ofPrevious, null);
  assert.equal(steps[7].ofPrevious, null, "a step not measured has no share");
  assert.equal(steps[7].note, "Billing isn't live yet.");
  assert.deepEqual(leak, { from: "Saw the prices", to: "Started an application", lost: 108, of: 120 });
});

test("without Google Analytics the website steps say why, and the rest still count", () => {
  const { steps, leak } = buildFunnel(acquisitionStages({ events: null, gaMissing: "Not connected.", applications: apps, companies, range: "7d" }));
  assert.deepEqual(steps.slice(0, 3).map((s) => [s.count, s.note]), [[null, "Not connected."], [null, "Not connected."], [null, "Not connected."]]);
  assert.equal(steps[3].ofPrevious, null);
  // 2 of 3 applicants got a company (67%), 1 of those 2 a free period (50%): the latter is the bigger drop.
  assert.deepEqual(leak, { from: "Company set up", to: "Free period started", lost: 1, of: 2 });
});

test("GA's two-period rows are read by name and period", () => {
  const rows = [
    { dimensions: ["page_view", "current"], metrics: [40] },
    { dimensions: ["page_view", "previous"], metrics: [25] },
    { dimensions: ["current"], metrics: [7] },
  ];
  const m = byNameAndPeriod(rows);
  assert.deepEqual(m.get("page_view"), { current: 40, previous: 25 });
  assert.deepEqual(m.get(""), { current: 7, previous: 0 });
});

test("review fixes: short domains, social medium", () => {
  assert.equal(sourceOf({ referrer: "app.hey.com" }), "hey");
  assert.equal(sourceOf({ referrer: "blog.abc.com" }), "abc");
  assert.equal(sourceOf({ referrer: "www.bbc.co.uk" }), "bbc");
  assert.equal(sourceOf({ referrer: "news24.com" }), "news24");
  assert.equal(channelOf({ utm_source: "cleaners_group", utm_medium: "social" }), "Organic Social");
});

test("every day of a period is laid out, so a day nobody came is 0, not missing", async () => {
  const { everyDay } = await import("@/lib/acquisition-data");
  const p = periods("7d", new Date("2026-10-10T12:00:00Z")).current;
  assert.deepEqual(everyDay(p), ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"]);
  assert.equal(everyDay(periods("12m", new Date("2026-10-10T12:00:00Z")).current).length, 365);
});

test("first job finished waits for the activation read, rather than guessing", () => {
  const unknown = new Map([...companies].map(([k, v]) => [k, { ...v, activated: null }]));
  const { steps } = buildFunnel(acquisitionStages({ events: null, gaMissing: "x", applications: apps, companies: unknown, range: "7d" }));
  assert.equal(steps[6].count, null);
  assert.equal(steps[6].note, "Needs a database update that hasn't been applied yet.");
});

test("own-count stats are read defensively, and grouped like applications", async () => {
  const { parseOwnStats, groupSources, asAttribution, eventsMap, campaignSlug } = await import("@/lib/acquisition");
  const s = parseOwnStats({
    visitors: 5, new_visitors: "3", sessions: 6, page_views: 11,
    daily: [{ day: "2026-10-10", visitors: 5, views: 11 }],
    pages: [{ path: "/founding", visitors: 4, views: 7, started: 2 }],
    events: { page_view: 5, signup_started: 2 },
    sources: [
      { utm_source: "fb", utm_medium: "paid_social", utm_campaign: "founding-oct", referrer: null, click_id: "fbclid", visitors: 3, started: 2, applied: 1 },
      { utm_source: "ig", utm_medium: "paid_social", utm_campaign: "founding-oct", referrer: null, click_id: null, visitors: 1, started: 0, applied: 0 },
      { utm_source: null, utm_medium: null, utm_campaign: null, referrer: "www.google.co.za", click_id: null, visitors: 1, started: 0, applied: 0 },
    ],
    devices: ["mobile", 3], countries: ["ZA"],
  });
  assert.equal(s.newVisitors, 3);
  assert.deepEqual(s.devices, ["mobile"]);
  assert.deepEqual(parseOwnStats(null).visitors, 0);
  const byChannel = groupSources(s.sources, (x) => channelOf(asAttribution(x)));
  assert.deepEqual(byChannel.get("Paid Social"), { visitors: 4, started: 2 });
  assert.deepEqual(byChannel.get("Organic Search"), { visitors: 1, started: 0 });
  assert.deepEqual(groupSources(s.sources, (x) => x.utm_campaign).get("founding-oct"), { visitors: 4, started: 2 });
  assert.equal(eventsMap(s).get("signup_started")?.current, 2);
  assert.equal(sourceOf({ utm_source: "ig" }), "instagram");
  assert.equal(campaignSlug("Founding October: Cleaners & Gardeners!"), "founding-october-cleaners-gardeners");
  assert.equal(campaignSlug("Café Owners"), "cafe-owners");
});
