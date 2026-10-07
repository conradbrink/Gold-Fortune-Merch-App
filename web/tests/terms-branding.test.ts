// Terminology and branding: the company's words and colours reach every screen,
// export and PDF through these helpers, so a wrong plural or an unescaped
// colour would show up everywhere at once.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TERMS,
  TERM_KEYS,
  count,
  lower,
  parseTerms,
  possessive,
  title,
  withArticle,
} from "@/lib/terms";
import {
  DEFAULT_ACCENT,
  DEFAULT_PRIMARY,
  brandStyleSheet,
  logoUrl,
  parseBranding,
  readableOn,
} from "@/lib/branding";
import { parseCompanyConfig } from "@/lib/use-company-config";

const goldFortune = parseTerms({
  site: { one: "Store", many: "Stores", article: null },
  staff: { one: "Rep", many: "Reps", article: null },
  job: { one: "Visit", many: "Visits", article: null },
  schedule_cycle: { one: "Call cycle", many: "Call cycles", article: null },
});

test("a company's words win; anything missing falls back to the neutral default", () => {
  assert.equal(goldFortune.site.one, "Store");
  assert.equal(goldFortune.staff.many, "Reps");
  assert.equal(goldFortune.client.one, "Client");
  for (const key of TERM_KEYS) {
    assert.ok(goldFortune[key].one.length > 0, key);
  }
});

test("a broken payload never reaches the screen as undefined or blank", () => {
  const t = parseTerms({ site: { one: "  ", many: 3 }, job: "Visit", nonsense: {} });
  assert.deepEqual(t.site, DEFAULT_TERMS.site);
  assert.deepEqual(t.job, DEFAULT_TERMS.job);
  assert.deepEqual(parseTerms(null), DEFAULT_TERMS);
});

test("counts pick singular or plural", () => {
  assert.equal(count(goldFortune, "site", 1), "1 store");
  assert.equal(count(goldFortune, "site", 3), "3 stores");
  assert.equal(count(goldFortune, "site", 0), "0 stores");
  assert.equal(count(goldFortune, "staff", 2, { label: true }), "2 Reps");
  assert.equal(count(DEFAULT_TERMS, "staff", 1), "1 staff member");
});

test("articles follow the first letter unless the company overrides", () => {
  assert.equal(withArticle(goldFortune, "site"), "a store");
  assert.equal(withArticle(DEFAULT_TERMS, "territory"), "an area");
  const outlet = parseTerms({ site: { one: "Outlet", many: "Outlets" } });
  assert.equal(withArticle(outlet, "site"), "an outlet");
  const unit = parseTerms({ site: { one: "Unit", many: "Units", article: "a" } });
  assert.equal(withArticle(unit, "site"), "a unit");
});

test("lower keeps acronyms, title capitalises each word, possessive handles plurals", () => {
  assert.equal(lower("Call cycle"), "call cycle");
  assert.equal(lower("ATM site"), "ATM site");
  assert.equal(title("Call cycle"), "Call Cycle");
  assert.equal(possessive("Store"), "Store's");
  assert.equal(possessive("Reps"), "Reps'");
});

test("branding parses colours strictly and falls back to the product palette", () => {
  const gf = parseBranding({ name: "Gold Fortune ", primary: "#16224f", accent: "#E0B84B" });
  assert.equal(gf.name, "Gold Fortune");
  assert.equal(gf.primary, "#16224F");
  const bad = parseBranding({ primary: "red;}</style><script>", accent: "#12345" });
  assert.equal(bad.primary, DEFAULT_PRIMARY);
  assert.equal(bad.accent, DEFAULT_ACCENT);
});

test("the style sheet carries only validated colours and cannot close its tag", () => {
  const css = brandStyleSheet({ primary: "#16224F", accent: "</style><script>alert(1)</script>" });
  assert.ok(css.startsWith(":root:not(.dark){"));
  assert.ok(css.includes("--primary:#16224F;"));
  assert.ok(!css.includes("<"));
  assert.ok(css.includes(`--gold:${DEFAULT_ACCENT};`));
});

test("text on a brand colour stays readable", () => {
  assert.equal(readableOn("#16224F"), "#FFFFFF"); // navy
  assert.equal(readableOn("#E0B84B"), "#0F172A"); // gold
  assert.equal(readableOn("#FFFFFF"), "#0F172A");
});

test("a logo URL is built only for a path in the company's own folder shape", () => {
  const org = "71170c8a-d53c-4a07-bdd4-97704a3cf4bc";
  assert.equal(
    logoUrl("https://x.supabase.co/", `${org}/logo-v1.png`),
    `https://x.supabase.co/storage/v1/object/public/branding/${org}/logo-v1.png`
  );
  assert.equal(logoUrl("https://x.supabase.co", "../../etc/passwd"), null);
  assert.equal(logoUrl("https://x.supabase.co", `${org}/logo.svg`), null);
  assert.equal(parseBranding({ logo_path: `${org}/logo.svg` }).logoPath, null);
});

test("the config carries terms and branding", () => {
  const c = parseCompanyConfig({
    org_id: "o",
    terms: { site: { one: "Store", many: "Stores" } },
    branding: { name: "Gold Fortune", primary: "#16224F", accent: "#E0B84B" },
  });
  assert.equal(c?.terms.site.one, "Store");
  assert.equal(c?.terms.job.one, "Job");
  assert.equal(c?.branding.primary, "#16224F");
});
