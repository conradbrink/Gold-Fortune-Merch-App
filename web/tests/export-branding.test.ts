// Exports and PDFs: whose name is on the file, whose logo is on the page, and
// whose words are in the headings. Gold Fortune's files must read as they did
// before the platform opened to other companies; everyone else's must not
// carry Gold Fortune's words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { exportFileName, fileSlug } from "@/lib/export-filename";
import { fitBox, loadLogoImage } from "@/lib/pdf-logo";
import { DEFAULT_TERMS, parseTerms } from "@/lib/terms";
import { REPORT_TAB_VALUES, reportTabs } from "@/lib/report-tabs";
import { findMetric, metricDefinitions, metricsForFieldType } from "@/lib/metrics";

const goldFortune = parseTerms({
  site: { one: "Store", many: "Stores" },
  staff: { one: "Rep", many: "Reps" },
  job: { one: "Visit", many: "Visits" },
});

const day = new Date("2026-08-27T09:00:00Z");

test("the file name is the company, the report and the date", () => {
  assert.equal(exportFileName("Gold Fortune ", "visits", "xlsx", day), "gold-fortune-visits-2026-08-27.xlsx");
  assert.equal(exportFileName("Acme Cleaning", "perfect-Site", "pdf", day), "acme-cleaning-perfect-site-2026-08-27.pdf");
});

test("a company with no usable name exports as 'export'", () => {
  assert.equal(exportFileName("", "visits", "csv", day), "export-visits-2026-08-27.csv");
  assert.equal(exportFileName("★ ☆", "visits", "csv", day), "export-visits-2026-08-27.csv");
});

test("slugs keep only safe characters, fold accents and stay short", () => {
  assert.equal(fileSlug("Café Royal (Pty) Ltd."), "cafe-royal-pty-ltd");
  assert.equal(fileSlug("../../etc/passwd"), "etc-passwd");
  assert.equal(fileSlug("O'Brien & Sons"), "o-brien-sons");
  assert.equal(fileSlug("Staff member scorecard"), "staff-member-scorecard");
  const long = fileSlug("A very long company name that keeps going and going and going");
  assert.ok(long.length <= 40, long);
  assert.ok(!long.endsWith("-"), long);
});

test("the logo keeps its proportions inside the header box", () => {
  assert.deepEqual(fitBox(400, 100, 120, 36), { width: 120, height: 30 });
  assert.deepEqual(fitBox(100, 100, 120, 36), { width: 36, height: 36 });
  assert.deepEqual(fitBox(0, 100, 120, 36), { width: 0, height: 0 });
});

test("no logo, or one that cannot be fetched, is no logo rather than a failed export", async () => {
  assert.equal(await loadLogoImage(null), null);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  try {
    assert.equal(await loadLogoImage("https://example.invalid/logo.png"), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("report tabs read in the company's words", () => {
  // Gold Fortune's `report_tabs` is today's eight; its labels are unchanged.
  const gf = reportTabs(goldFortune, REPORT_TAB_VALUES.slice(0, 8));
  assert.deepEqual(
    gf.map((t) => t.label),
    ["Perfect Store", "Out of stock", "Coverage", "Adherence", "Reps", "Trends", "Form", "Photos"]
  );
  assert.deepEqual(
    reportTabs(goldFortune).map((t) => t.value),
    [...REPORT_TAB_VALUES]
  );
  const neutral = reportTabs(DEFAULT_TERMS);
  assert.equal(neutral[0].label, "Perfect Site");
  assert.equal(neutral[4].label, "Staff");
});

test("metric descriptions name the company's sites", () => {
  assert.ok(findMetric("in_stock", goldFortune)?.feeds.includes("Availability (Perfect Store)"));
  assert.ok(findMetric("in_stock", DEFAULT_TERMS)?.feeds.includes("Availability (Perfect Site)"));
  assert.match(findMetric("damaged_expired", goldFortune)?.invertedNote ?? "", /against the store/);
  assert.equal(metricsForFieldType("boolean", DEFAULT_TERMS).length, 5);
  for (const m of metricDefinitions(DEFAULT_TERMS)) {
    assert.doesNotMatch(JSON.stringify(m), /store/i, m.key);
  }
});
