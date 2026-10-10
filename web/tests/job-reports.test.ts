// Stage 8.3: the job report emails to a company's clients. The database side
// is supabase/tests/job_reports.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CLIENT_TEMPLATES, REPORT_TEMPLATES, renderEmail, type ReportLine } from "@/lib/email/templates";

const line = (o: Partial<ReportLine>): ReportLine => ({
  url: "https://app.tickd.co.za/c/report/abc.def",
  siteName: "Sandton Office Park",
  staffName: "Thandi Mokoena",
  day: "2026-10-09",
  timeIn: "07:58",
  timeOut: "09:12",
  photos: 3,
  onSite: true,
  jobWord: "Clean",
  ...o,
});
const ctx = { companyName: "Sparkle Cleaning", unsubscribeUrl: "https://app.tickd.co.za/c/unsubscribe/x.y" };

test("one job: the site, the day, who and when, and the button to see and sign", () => {
  const e = renderEmail("job_report", { reports: [line({})] }, ctx)!;
  assert.equal(e.subject, "Clean done at Sandton Office Park, 2026-10-09");
  assert.match(e.html, /07:58 to 09:12/);
  assert.match(e.html, /Thandi Mokoena/);
  assert.match(e.html, /On site/);
  assert.match(e.html, /Photos<\/td><td[^>]*>3</);
  assert.match(e.html, /See the report and sign/);
  assert.match(e.html, /href="https:\/\/app\.tickd\.co\.za\/c\/report\/abc\.def"/);
  assert.match(e.text, /See the report and sign: https:\/\/app\.tickd\.co\.za\/c\/report\/abc\.def/);
  assert.match(e.html, /Stop these emails/);
});

test("a site's day lists every job with its own link", () => {
  const e = renderEmail(
    "job_reports_day",
    { reports: [line({}), line({ url: "https://x/2", staffName: null, onSite: null, photos: 1, timeIn: "13:05", timeOut: "13:40" })] },
    ctx
  )!;
  assert.equal(e.subject, "Sandton Office Park: 2 cleans done on 2026-10-09");
  assert.match(e.html, /13:05 to 13:40, 1 photo\./);
  assert.equal((e.html.match(/See and sign/g) ?? []).length, 2);
  assert.match(e.text, /See and sign: https:\/\/x\/2/);
});

test("jobs from two days (one finished after last night's email) say each day", () => {
  const e = renderEmail("job_reports_day", { reports: [line({ day: "2026-10-08", timeIn: "17:10", timeOut: "18:40" }), line({ url: "https://x/2" })] }, ctx)!;
  assert.equal(e.subject, "Sandton Office Park: 2 cleans done since the last report");
  assert.match(e.html, /2026-10-08, 17:10 to 18:40/);
  assert.match(e.text, /- 2026-10-09, 07:58 to 09:12/);
});

test("away from the site is said plainly; what a company typed is escaped", () => {
  const e = renderEmail("job_report", { reports: [line({ onSite: false, siteName: "A & <B>" })] }, ctx)!;
  assert.match(e.html, /Away from the site/);
  assert.match(e.html, /A &amp; &lt;B&gt;/);
});

test("a report email with nothing left to report is not sent", () => {
  assert.throws(() => renderEmail("job_report", { reports: [] }, ctx));
  assert.throws(() => renderEmail("job_reports_day", {}, ctx));
});

test("report emails go to clients, so they carry the stop link and are looked up when sent", () => {
  for (const t of ["job_report", "job_reports_day"]) {
    assert.ok(CLIENT_TEMPLATES.has(t), t);
    assert.ok(REPORT_TEMPLATES.has(t), t);
  }
  assert.ok(!CLIENT_TEMPLATES.has("test"));
});
