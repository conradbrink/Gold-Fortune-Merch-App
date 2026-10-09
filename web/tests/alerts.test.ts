// Stage 8.4: alerts in words, their links, their emails and their settings.
// The database side is supabase/tests/alerts.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALERT_RULES,
  alertHref,
  alertText,
  distanceText,
  minutesText,
  ruleLabels,
  rulesFromSetting,
  rulesSetting,
  type AlertItem,
} from "@/lib/alerts";
import { ALERT_TEMPLATES, CLIENT_TEMPLATES, REPORT_TEMPLATES, renderEmail } from "@/lib/email/templates";
import { DEFAULT_TERMS, type Terms } from "@/lib/terms";
import { toModuleSet } from "@/lib/modules";
import { parseCompanyConfig } from "@/lib/company-config";
import { editableSetting } from "@/lib/add-company";

/** As tests/no-hardcoded-words.test.ts has it (imported, its own test would run twice). */
const BUSINESS_WORDS =
  /\b(stores?|visits?|reps?|representatives?|chains?|territor(?:y|ies)|customers?|outlets?|shops?|merchandis\w*|call cycles?|gold fortune)\b/i;

const cleaning: Terms = {
  ...DEFAULT_TERMS,
  site: { one: "Site", many: "Sites", article: null },
  job: { one: "Clean", many: "Cleans", article: null },
  staff: { one: "Cleaner", many: "Cleaners", article: null },
};
const tz = "Africa/Johannesburg";

const alert = (o: Partial<AlertItem>): AlertItem => ({
  id: "a1",
  rule: "off_site_checkin",
  // 08:00 in Johannesburg.
  occurred_at: "2026-10-08T06:00:00Z",
  day: "2026-10-08",
  visit_id: "v1",
  route_id: null,
  store_id: "s1",
  profile_id: "p1",
  site_name: "Sandton Office Park",
  staff_name: "Thandi Mokoena",
  detail: { distance_m: 640, radius_m: 100 },
  ...o,
});

test("the setting reads known rules once, in order, and writes them back the same way", () => {
  assert.deepEqual(rulesFromSetting("no_gps,short_job,bogus,short_job"), ["short_job", "no_gps"]);
  assert.deepEqual(rulesFromSetting(""), []);
  assert.deepEqual(rulesFromSetting(null), []);
  assert.equal(rulesSetting(["no_gps", "off_site_checkin"]), "off_site_checkin,no_gps");
  assert.equal(rulesSetting([]), "");
  // The database's pattern accepts exactly this shape.
  const pattern = new RegExp(
    "^((off_site_checkin|short_job|missed_planned|patrol_gap|no_gps)(,(off_site_checkin|short_job|missed_planned|patrol_gap|no_gps))*)?$"
  );
  assert.ok(pattern.test(rulesSetting([...ALERT_RULES])));
  assert.ok(pattern.test(rulesSetting([])));
});

test("each rule reads as a plain sentence in the company's words", () => {
  const off = alertText(alert({}), cleaning, tz);
  assert.equal(off.title, "Checked in away from the site");
  assert.equal(off.body, "Thandi Mokoena checked in 640 m from Sandton Office Park, outside its 100 m radius. Thu 8 Oct at 08:00.");

  const short = alertText(alert({ rule: "short_job", detail: { seconds: 120, limit_minutes: 5 } }), cleaning, tz);
  assert.equal(short.title, "Short clean");
  assert.match(short.body, /finished at Sandton Office Park after 2 min, under the 5 minutes you set/);

  const missed = alertText(alert({ rule: "missed_planned", detail: { cutoff: "17:30" } }), cleaning, tz);
  assert.equal(missed.title, "Planned clean not done");
  assert.equal(missed.body, "Thandi Mokoena's clean at Sandton Office Park planned for Thu 8 Oct was not done by the end of the day.");

  const gap = alertText(
    alert({ rule: "patrol_gap", detail: { gap_minutes: 150, from: "2026-10-08T07:00:00Z", to: "2026-10-08T09:30:00Z" } }),
    cleaning,
    tz
  );
  assert.equal(gap.title, "Long gap between cleans");
  assert.equal(gap.body, "Sandton Office Park went 2 h 30 min without a check-in, 09:00 to 11:30, Thu 8 Oct.");

  const nogps = alertText(alert({ rule: "no_gps", detail: {} }), cleaning, tz);
  assert.equal(nogps.title, "Check-in without GPS");
  assert.match(nogps.body, /with no GPS position/);
});

test("missing names and details still read", () => {
  const a = alertText(alert({ staff_name: null, site_name: null, detail: null }), cleaning, tz);
  assert.equal(a.body, "Someone checked in away from the site. Thu 8 Oct at 08:00.");
  const m = alertText(alert({ rule: "missed_planned", staff_name: null }), cleaning, tz);
  assert.match(m.body, /^The clean at Sandton Office Park/);
});

test("no alert text carries a business word or a long dash, whatever the company calls things", () => {
  for (const rule of ALERT_RULES) {
    const { title, body } = alertText(alert({ rule }), DEFAULT_TERMS, tz);
    for (const s of [title, body]) {
      assert.doesNotMatch(s.replace("Sandton Office Park", ""), BUSINESS_WORDS);
      assert.doesNotMatch(s, /[–—]/);
    }
  }
  for (const { label, explain } of Object.values(ruleLabels(DEFAULT_TERMS))) {
    assert.doesNotMatch(`${label} ${explain}`, BUSINESS_WORDS);
    assert.doesNotMatch(`${label} ${explain}`, /[–—]/);
  }
});

test("numbers read the way a person says them", () => {
  assert.equal(distanceText(640), "640 m");
  assert.equal(distanceText(4490), "4.5 km");
  assert.equal(minutesText(0.5), "under a minute");
  assert.equal(minutesText(45), "45 min");
  assert.equal(minutesText(120), "2 h");
});

test("each alert links to where its facts are", () => {
  const withReports = toModuleSet({ reports: true });
  assert.equal(alertHref(alert({}), withReports), "/tracking/p1?date=2026-10-08");
  assert.equal(
    alertHref(alert({ rule: "patrol_gap" }), withReports),
    "/reports?tab=service_log&from=2026-10-08&to=2026-10-09"
  );
  // Without the reports module, the person's day instead.
  assert.equal(alertHref(alert({ rule: "patrol_gap" }), toModuleSet({})), "/tracking/p1?date=2026-10-08");
  assert.equal(alertHref(alert({ profile_id: null }), withReports), "/visits");
});

test("the alert emails: to the company's own people, no unsubscribe link, links into the app", () => {
  assert.ok(ALERT_TEMPLATES.has("alert") && ALERT_TEMPLATES.has("alerts_digest"));
  assert.ok(!CLIENT_TEMPLATES.has("alert") && !CLIENT_TEMPLATES.has("alerts_digest"));
  assert.ok(!REPORT_TEMPLATES.has("alert"));
  const ctx = { companyName: "Sparkle Cleaning", unsubscribeUrl: null };
  const terms = { job: { one: "Clean", many: "Cleans" } };
  const one = renderEmail("alert", { terms, timezone: tz, app_url: "https://app.tickd.co.za/", alerts: [alert({})] }, ctx)!;
  assert.equal(one.subject, "Checked in away from the site: Sandton Office Park");
  assert.match(one.html, /640 m from Sandton Office Park/);
  assert.match(one.html, /href="https:\/\/app\.tickd\.co\.za\/tracking\/p1\?date=2026-10-08"/);
  assert.doesNotMatch(one.html, /Stop these emails/);
  assert.match(one.text, /See it in Tickd: https:\/\/app\.tickd\.co\.za\/tracking\/p1/);

  const day = renderEmail(
    "alerts_digest",
    {
      terms,
      timezone: tz,
      day: "2026-10-08",
      total: 3,
      app_url: "https://app.tickd.co.za",
      alerts: [alert({}), alert({ id: "a2", rule: "no_gps", site_name: "A & <B>" })],
    },
    ctx
  )!;
  assert.equal(day.subject, "Sparkle Cleaning: 3 things to check, Thu 8 Oct");
  assert.equal((day.html.match(/See it<\/a>/g) ?? []).length, 2);
  assert.match(day.html, /A &amp; &lt;B&gt;/);
  assert.match(day.html, /And 1 more in Tickd\./);
  assert.doesNotMatch(day.html, /Stop these emails/);
  assert.doesNotMatch(day.html + day.text, /[–—]/);
});

test("an alert email with nothing to show is not sent", () => {
  const ctx = { companyName: "Sparkle Cleaning", unsubscribeUrl: null };
  assert.throws(() => renderEmail("alert", { alerts: [] }, ctx));
  assert.throws(() => renderEmail("alerts_digest", { alerts: [] }, ctx));
});

test("the alert settings are read from the config and kept out of the generic lists", () => {
  const c = parseCompanyConfig({
    org_id: "o1",
    settings: { alerts_on: "short_job", alerts_email: "instant", alerts_digest_time: "18:15:00", alerts_patrol_gap_minutes: 60 },
  })!;
  assert.equal(c.settings.alerts_on, "short_job");
  assert.equal(c.settings.alerts_email, "instant");
  assert.equal(c.settings.alerts_digest_time, "18:15");
  assert.equal(c.settings.alerts_patrol_gap_minutes, 60);
  const bad = parseCompanyConfig({ org_id: "o1", settings: { alerts_email: "hourly", alerts_on: "Not a list" } })!;
  assert.equal(bad.settings.alerts_email, "digest");
  assert.equal(bad.settings.alerts_on, "off_site_checkin,short_job,missed_planned");
  for (const key of ["alerts_on", "alerts_email", "alerts_digest_time", "alerts_patrol_gap_minutes"]) {
    assert.equal(editableSetting(key), false, key);
  }
});
