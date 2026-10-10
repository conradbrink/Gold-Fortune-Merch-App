// Company settings: owners configure their business, not the software.
//
// The database is the boundary for Tickd's own settings
// (supabase/tests/settings_audience.sql); these pin the web's half: every
// business setting has a place on a settings screen, no customer screen
// writes one of Tickd's, old links still land, and permissions for a module a
// company lacks are not offered.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHECKIN_DISTANCES,
  INTERNAL_SETTINGS,
  SETTINGS_TABS,
  settingsTabFromQuery,
  termShown,
} from "@/lib/settings-tabs";
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

/** The screens a customer configures their company on. */
const customerSettingsFiles = [
  ...files(join(web, "components", "settings")),
  ...files(join(web, "app", "(dashboard)", "settings")),
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

test("old settings links still open the right tab", () => {
  assert.equal(settingsTabFromQuery("details"), "company");
  assert.equal(settingsTabFromQuery("field"), "operations");
  assert.equal(settingsTabFromQuery("money"), "billing");
  assert.equal(settingsTabFromQuery("dashboard"), "operations");
  assert.equal(settingsTabFromQuery("emails"), "communications");
  assert.equal(settingsTabFromQuery("alerts"), "communications");
  assert.equal(settingsTabFromQuery("team"), "people");
  assert.equal(settingsTabFromQuery("billing"), "billing");
  assert.equal(settingsTabFromQuery(""), "company");
  assert.equal(settingsTabFromQuery("nonsense"), "company");
  assert.deepEqual(
    SETTINGS_TABS.map((t) => t.label),
    ["Company", "Operations", "Billing", "Communications", "Branding", "Plan"]
  );
});

test("the web's list of Tickd's own settings is the migration's", () => {
  const sql = readFileSync(join(repo, "supabase", "migrations", "20261010390000_internal_settings.sql"), "utf8");
  const block = sql.slice(sql.indexOf("set audience = 'internal'"), sql.indexOf(");", sql.indexOf("set audience = 'internal'")));
  const keys = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).filter((k) => k !== "internal");
  assert.deepEqual([...keys].sort(), [...INTERNAL_SETTINGS].sort());
});

test("no customer settings screen writes one of Tickd's own settings", () => {
  for (const key of INTERNAL_SETTINGS) {
    const writes = new RegExp(`key:\\s*"${key}"`);
    for (const f of customerSettingsFiles) {
      assert.ok(!writes.test(readFileSync(f, "utf8")), `${f.slice(web.length)} writes ${key}`);
    }
  }
});

test("every business setting has a place on a settings screen", () => {
  const internal = new Set<string>(INTERNAL_SETTINGS);
  const missing = knownSettings().filter((key) => !internal.has(key) && !customerSettingsSource.includes(key));
  assert.deepEqual(missing, [], `settings nobody can change: ${missing.join(", ")}`);
});

test("check-in distances are plain choices inside what the database allows", () => {
  for (const d of CHECKIN_DISTANCES) {
    assert.ok(d.metres >= 10 && d.metres <= 5000, `${d.metres} m`);
    assert.ok(!/radius|GPS/i.test(d.label), d.label);
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

test("terminology offers a word only for something the company has", () => {
  assert.equal(termShown("prospect", toModuleSet({ invoicing: true })), false);
  assert.equal(termShown("prospect", toModuleSet({ distribution: true })), true);
  assert.equal(termShown("site", toModuleSet({})), true);
});
