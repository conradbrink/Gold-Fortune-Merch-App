// Settings: the customer sets up their business, Tickd sets up the software
// (owner, 22 Oct 2026).
//
// The database is the boundary for Tickd's own settings
// (supabase/tests/settings_audience.sql); these pin the web's half: every
// setting has a place, either on the customer's Settings or in the Control
// Centre; no customer screen writes one of Tickd's; old links still land;
// the alert switches map onto the settings the database reads; the Plan page
// lists features in words, and the Control Centre checks what it saves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHECKIN_DISTANCES,
  CONTROL_CENTRE_OWNER_SETTINGS,
  ENGINE_SETTINGS,
  INTERNAL_SETTINGS,
  SETTINGS_PAGES,
  TICKD_RULES,
  checkinChoices,
  settingsPathFromQuery,
  termShown,
} from "@/lib/settings-tabs";
import {
  CONTROL_CENTRE_SETTINGS,
  customerAlsoSets,
  groupSettings,
  operatorMayChange,
  patternChoices,
  parseCompanyRecord,
  parseSettingValue,
  RECORD_FIELDS,
  type RecordField,
} from "@/lib/control-centre";
import { IMPORTANT_DEFAULT, alertSwitches, applyAlertSwitches, rulesFromSetting } from "@/lib/alerts";
import { PLAN_FEATURES, planIncludes } from "@/lib/plan-features";
import { permissionsForCompany } from "@/lib/access";
import { toModuleSet } from "@/lib/modules";

const web = fileURLToPath(new URL("..", import.meta.url));
const repo = join(web, "..");

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (/\.(tsx?|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

/** The screens a customer configures their company on: Settings and the set-up wizard. */
const customerSettingsFiles = [
  ...files(join(web, "components", "settings")),
  ...files(join(web, "app", "(dashboard)", "settings")),
  ...files(join(web, "components", "setup")),
  join(web, "lib", "money-settings.ts"),
  join(web, "components", "dashboard", "customise-dashboard.tsx"),
];
const customerSettingsSource = customerSettingsFiles.map((f) => readFileSync(f, "utf8")).join("\n");

/** Every setting the web knows, from the CompanySettings type. */
function knownSettings(): string[] {
  const src = readFileSync(join(web, "lib", "company-config.ts"), "utf8");
  const block = src.slice(src.indexOf("export type CompanySettings = {"), src.indexOf("};", src.indexOf("export type CompanySettings = {")));
  return [...block.matchAll(/^\s+([a-z_]+):/gm)].map((m) => m[1]);
}

/** The keys a migration switches to `internal`. */
function internalKeysIn(migration: string): string[] {
  const sql = readFileSync(join(repo, "supabase", "migrations", migration), "utf8");
  const at = sql.indexOf("set audience = 'internal'");
  const block = sql.slice(at, sql.indexOf(");", at));
  return [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).filter((k) => k !== "internal");
}

test("Settings is four pages, in the owner's order", () => {
  assert.deepEqual(
    SETTINGS_PAGES.map((p) => p.label),
    ["Business", "Team & Work", "Notifications", "Plan"]
  );
  for (const p of SETTINGS_PAGES) {
    const page = join(web, "app", "(dashboard)", ...p.href.split("/").filter(Boolean), "page.tsx");
    assert.ok(statSync(page).isFile(), `${p.href} has no page`);
  }
});

test("old settings links still open the right page", () => {
  assert.equal(settingsPathFromQuery("company"), "/settings/business");
  assert.equal(settingsPathFromQuery("details"), "/settings/business");
  assert.equal(settingsPathFromQuery("branding"), "/settings/business");
  assert.equal(settingsPathFromQuery("billing"), "/settings/business");
  assert.equal(settingsPathFromQuery("money"), "/settings/business");
  assert.equal(settingsPathFromQuery("operations"), "/settings/team");
  assert.equal(settingsPathFromQuery("field"), "/settings/team");
  assert.equal(settingsPathFromQuery("dashboard"), "/settings/team");
  assert.equal(settingsPathFromQuery("communications"), "/settings/notifications");
  assert.equal(settingsPathFromQuery("emails"), "/settings/notifications");
  assert.equal(settingsPathFromQuery("alerts"), "/settings/notifications");
  assert.equal(settingsPathFromQuery("plan"), "/settings/plan");
  assert.equal(settingsPathFromQuery("team"), "/settings/users");
  assert.equal(settingsPathFromQuery(""), "/settings/business");
  assert.equal(settingsPathFromQuery(null), "/settings/business");
  assert.equal(settingsPathFromQuery("nonsense"), "/settings/business");
});

test("the web's lists of Tickd's own settings are the migrations'", () => {
  assert.deepEqual([...ENGINE_SETTINGS].sort(), internalKeysIn("20261010390000_internal_settings.sql").sort());
  assert.deepEqual([...TICKD_RULES].sort(), internalKeysIn("20261022230000_tickd_sets_up_the_rules.sql").sort());
  // The rollback puts back exactly what the migration moved.
  const down = readFileSync(join(repo, "supabase", "rollback", "20261022230000_tickd_sets_up_the_rules.down.sql"), "utf8");
  const at = down.indexOf("where key in");
  const back = [...down.slice(at, down.indexOf(");", at)).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(back.sort(), [...TICKD_RULES].sort());
});

test("no customer screen writes one of Tickd's own settings", () => {
  for (const key of INTERNAL_SETTINGS) {
    const writes = new RegExp(`key:\\s*"${key}"`);
    for (const f of customerSettingsFiles) {
      assert.ok(!writes.test(readFileSync(f, "utf8")), `${f.slice(web.length)} writes ${key}`);
    }
  }
});

test("a setting the customer still writes is not one the database will refuse", () => {
  for (const key of CONTROL_CENTRE_OWNER_SETTINGS) {
    assert.ok(!(INTERNAL_SETTINGS as readonly string[]).includes(key), key);
  }
  // Notifications writes the alert switches and the report choice, Team &
  // Work the check-in rules, and the wizard the money switches.
  for (const key of ["alerts_on", "alerts_email", "job_report_send", "checkin_radius_m", "auto_end_enabled", "money_workflow"]) {
    assert.match(customerSettingsSource, new RegExp(`key:\\s*"${key}"`), `${key} is no longer written`);
  }
});

test("every setting has a place: on the customer's Settings or in the Control Centre", () => {
  const controlCentre = new Set<string>([...INTERNAL_SETTINGS, ...CONTROL_CENTRE_SETTINGS]);
  const missing = knownSettings().filter((key) => !controlCentre.has(key) && !customerSettingsSource.includes(key));
  assert.deepEqual(missing, [], `settings nobody can change: ${missing.join(", ")}`);
});

test("the Control Centre may change Tickd's settings and the moved rules, not the customer's own", () => {
  assert.equal(operatorMayChange("gps_ping_interval_minutes", "internal"), true);
  // Before the migration is applied the moved rules are still `owner`; the
  // operator can change them either way.
  assert.equal(operatorMayChange("report_day_normal_hours", "owner"), true);
  assert.equal(operatorMayChange("money_quotes", "owner"), true);
  assert.equal(operatorMayChange("alerts_on", "owner"), true);
  assert.equal(operatorMayChange("brand_primary_color", "owner"), false);
  assert.equal(operatorMayChange("checkin_radius_m", "owner"), false);
  // The operator is told which ones the company can change too, and where.
  assert.match(customerAlsoSets("alerts_on")!, /Notifications/);
  assert.match(customerAlsoSets("money_quotes")!, /wizard/);
  assert.equal(customerAlsoSets("report_day_normal_hours"), null);
  for (const key of CONTROL_CENTRE_OWNER_SETTINGS) assert.ok(customerAlsoSets(key), key);
});

test("the Control Centre groups every setting it shows", () => {
  const keys = [...INTERNAL_SETTINGS, ...CONTROL_CENTRE_SETTINGS, "range_history_days", "range_big_pct"];
  const groups = groupSettings(keys.map((key) => ({ key })));
  assert.ok(!groups.some((g) => g.id === "other"), JSON.stringify(groups.find((g) => g.id === "other")));
  const where = (key: string) => groups.find((g) => g.settings.some((s) => s.key === key))?.id;
  assert.equal(where("report_sunday_is_overtime"), "hours");
  assert.equal(where("report_day_normal_hours"), "hours");
  assert.equal(where("report_tabs"), "dashboard");
  assert.equal(where("short_visit_minutes"), "visits");
  assert.equal(where("alerts_digest_time"), "alerts");
  assert.equal(where("range_lapse_days"), "orders");
  assert.equal(where("money_invoice_orders"), "money");
  assert.equal(where("document_style"), "documents");
  assert.deepEqual(groupSettings([{ key: "something_new" }]).map((g) => g.id), ["other"]);
});

test("the Control Centre reads a typed value by the setting's type", () => {
  assert.deepEqual(parseSettingValue("integer", " 8 "), { value: 8 });
  assert.ok("error" in parseSettingValue("integer", "8.5"));
  assert.deepEqual(parseSettingValue("boolean", "true"), { value: true });
  assert.deepEqual(parseSettingValue("boolean", "false"), { value: false });
  assert.ok("error" in parseSettingValue("boolean", "yes"));
  assert.deepEqual(parseSettingValue("time", "17:30"), { value: "17:30" });
  // A time field can send seconds; the setting keeps HH:MM.
  assert.deepEqual(parseSettingValue("time", "17:30:00"), { value: "17:30" });
  assert.ok("error" in parseSettingValue("time", "25:00"));
  assert.deepEqual(parseSettingValue("text", "off_site_checkin,short_job"), { value: "off_site_checkin,short_job" });
});

test("a setting whose pattern is a plain list is a choice for the operator", () => {
  assert.deepEqual(patternChoices("^(classic|bold|clean)$"), ["classic", "bold", "clean"]);
  assert.deepEqual(patternChoices("^(instant|digest|off)$"), ["instant", "digest", "off"]);
  assert.equal(patternChoices("^((off_site_checkin|short_job)(,(off_site_checkin|short_job))*)?$"), null);
  assert.equal(patternChoices(null), null);
});

test("the company record is checked as the customer's screens checked it", () => {
  const good: Record<RecordField, string> = {
    industry: "",
    registration_number: " 2020/123456/07 ",
    tax_number: "",
    vat_number: "4123",
    vat_rate: "15",
    prices_include_vat: "true",
    invoice_terms_days: "30",
    invoice_prefix: "inv",
    quote_prefix: "QT",
    quote_validity_days: "14",
    invoice_footer: "",
    bank_details: "FNB 123",
    default_visit_frequency: "biweekly",
  };
  assert.deepEqual([...RECORD_FIELDS].sort(), Object.keys(good).sort());
  const ok = parseCompanyRecord((k) => good[k]);
  assert.ok("update" in ok);
  assert.equal(ok.update.registration_number, "2020/123456/07");
  assert.equal(ok.update.industry, null);
  assert.equal(ok.update.vat_rate, 15);
  assert.equal(ok.update.prices_include_vat, true);
  assert.equal(ok.update.invoice_prefix, "INV");
  assert.equal(ok.update.default_visit_frequency, "biweekly");
  const bad = (k: RecordField, v: string) => parseCompanyRecord((x) => (x === k ? v : good[x]));
  assert.ok("error" in bad("vat_rate", "101"));
  assert.ok("error" in bad("vat_rate", ""));
  assert.ok("error" in bad("invoice_prefix", "I"));
  assert.ok("error" in bad("quote_prefix", "QUOTES1"));
  assert.ok("error" in bad("invoice_terms_days", "400"));
  assert.ok("error" in bad("quote_validity_days", "-1"));
  assert.ok("error" in bad("default_visit_frequency", "daily"));
});

test("the alert switches read the settings the database uses", () => {
  assert.deepEqual(alertSwitches(rulesFromSetting("off_site_checkin,short_job,missed_planned"), "digest"), {
    missed: true,
    important: true,
    summary: true,
  });
  // Gold Fortune: no alert rules on.
  assert.deepEqual(alertSwitches(rulesFromSetting(""), "digest"), { missed: false, important: false, summary: true });
  assert.deepEqual(alertSwitches(rulesFromSetting("patrol_gap"), "instant"), { missed: false, important: true, summary: false });
});

test("the alert switches write the settings the database uses, keeping what Tickd set", () => {
  const security = { rules: rulesFromSetting("off_site_checkin,short_job,missed_planned,patrol_gap"), email: "digest" as const };
  // Missed alerts off: the important rules, the security company's patrol gap among them, stay.
  assert.deepEqual(applyAlertSwitches(security, { missed: false, important: true, summary: true }), {
    rules: ["off_site_checkin", "short_job", "patrol_gap"],
    email: "digest",
  });
  // Important off, then on again before saving: nothing lost.
  assert.deepEqual(applyAlertSwitches(security, { missed: true, important: true, summary: true }).rules, security.rules);
  assert.deepEqual(applyAlertSwitches(security, { missed: true, important: false, summary: true }).rules, ["missed_planned"]);
  // A company with none gets the usual pair.
  assert.deepEqual(applyAlertSwitches({ rules: [], email: "digest" }, { missed: false, important: true, summary: true }).rules, [
    ...IMPORTANT_DEFAULT,
  ]);
  // The summary off stops the emails; one-by-one emails Tickd set are left alone.
  assert.equal(applyAlertSwitches(security, { missed: true, important: true, summary: false }).email, "off");
  assert.equal(applyAlertSwitches({ rules: security.rules, email: "instant" }, { missed: true, important: true, summary: false }).email, "instant");
  assert.equal(applyAlertSwitches({ rules: security.rules, email: "off" }, { missed: true, important: true, summary: true }).email, "digest");
});

test("the Plan page lists what the company has, in words", () => {
  assert.deepEqual(planIncludes(toModuleSet({})), ["Field tracking", "Check-ins"]);
  const gf = planIncludes(
    toModuleSet({ distribution: true, deliveries: true, warehouse: true, hr: true, reports: true, recurring_jobs: true })
  );
  assert.deepEqual(gf, ["Field tracking", "Check-ins", "Scheduling", "Reports", "Distribution", "Deliveries", "Stock control", "HR"]);
  for (const f of PLAN_FEATURES.flatMap((x) => x.labels)) {
    assert.ok(!/_|module|enabled/i.test(f), f);
  }
});

test("check-in distances are the four plain choices, and a company's own value is kept", () => {
  assert.deepEqual([...CHECKIN_DISTANCES], [50, 100, 250, 500]);
  for (const d of CHECKIN_DISTANCES) assert.ok(d >= 10 && d <= 5000, `${d} m`);
  assert.deepEqual(checkinChoices(100), [50, 100, 250, 500]);
  assert.deepEqual(checkinChoices(150), [50, 100, 150, 250, 500]);
  assert.deepEqual(checkinChoices(null), [50, 100, 250, 500]);
});

test("the customer's Settings use no internal words", () => {
  const pages = [
    ...files(join(web, "app", "(dashboard)", "settings")).filter((f) => !f.includes("users")),
    join(web, "components", "settings", "branding-section.tsx"),
    join(web, "components", "billing", "billing-panel.tsx"),
  ];
  const text = pages.map((f) => readFileSync(f, "utf8")).join("\n");
  // Visible strings only: JSX text and quoted labels, not code or comments.
  const visible = [...text.matchAll(/>([^<>{}]+)</g), ...text.matchAll(/(?:label|title|description|hint)[=:]\s*"([^"]+)"/g)]
    .map((m) => m[1].trim())
    .filter(Boolean)
    .join(" | ");
  for (const word of ["module", "feature flag", "radius_m", "trade's", "Reset to", "Not in your plan", "GPS", "KPI"]) {
    assert.ok(!visible.toLowerCase().includes(word.toLowerCase()), `"${word}" shown on Settings`);
  }
});

test("permissions for a module the company lacks are not offered", () => {
  const p = (code: string) => ({ code, label: code, description: "", area: "", data_enforced: false, sort_order: 0 });
  const all = ["dashboard", "insights", "hr", "hr_settings", "invoicing", "warehouse", "warehouse_approve", "resources"].map(p);
  const codes = (m: Record<string, boolean>) => permissionsForCompany(all, toModuleSet(m)).map((x) => x.code);
  assert.deepEqual(codes({ invoicing: true, reports: true }), ["dashboard", "insights", "invoicing", "resources"]);
  assert.deepEqual(codes({ distribution: true, warehouse: true, hr: true, invoicing: true }), all.map((x) => x.code));
  // Before the modules are known, nothing is hidden.
  assert.equal(permissionsForCompany(all, null).length, all.length);
});

test("the Control Centre offers a word only for something the company has", () => {
  assert.equal(termShown("prospect", toModuleSet({ invoicing: true })), false);
  assert.equal(termShown("prospect", toModuleSet({ distribution: true })), true);
  assert.equal(termShown("site", toModuleSet({})), true);
});
