// The operator's "Add company" form: what it refuses, what it sends to
// `create_company`, and how it reads `template_defaults()`. The database checks
// everything again (supabase/tests/template_creation.sql); these pin the form's
// half, so the operator hears about a mistake before a login is made for it.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addCompanyProblems,
  choicesPayload,
  companyPayload,
  editableSetting,
  generatePassword,
  parseTemplateDefaults,
  settingFromText,
  settingToText,
  toggleModule,
  type AddCompanyInput,
  type ModuleDependency,
} from "@/lib/add-company";

const deps: ModuleDependency[] = [{ module: "warehouse", requires: "distribution" }];

function valid(): AddCompanyInput {
  return {
    company: {
      name: " Sparkle Cleaning ",
      legalName: "Sparkle Cleaning (Pty) Ltd",
      countryCode: "za",
      timezone: "Africa/Johannesburg",
      currencyCode: "zar",
      vatNumber: "",
      address: "",
      phone: "",
      supportEmail: "",
    },
    templates: ["cleaning", "maintenance"],
    modules: ["recurring_jobs", "checklists_forms", "reports"],
    terms: { staff: { one: "Cleaner", many: "Cleaners", article: null }, unit: { one: "hour", many: "hours", article: "an" } },
    settings: { short_visit_minutes: 15 },
    checklists: ["office_clean"],
    forms: [],
    owner: { fullName: "Thandi Owner", email: " Thandi@Example.com ", password: "abcd2345" },
  };
}

test("a complete form has no problems", () => {
  assert.deepEqual(addCompanyProblems(valid(), deps), []);
});

test("country and currency are required ISO codes", () => {
  const i = valid();
  i.company.countryCode = "";
  i.company.currencyCode = "";
  assert.deepEqual(addCompanyProblems(i, deps), [
    "The country is a two-letter code, such as ZA or BW.",
    "The currency is a three-letter code, such as ZAR or BWP.",
  ]);
  i.company.countryCode = "ZAF";
  i.company.currencyCode = "R";
  assert.equal(addCompanyProblems(i, deps).length, 2);
});

test("name, timezone, industries and the company email are checked", () => {
  const i = valid();
  i.company.name = "  ";
  i.company.timezone = "";
  i.company.supportEmail = "not-an-email";
  i.templates = [];
  assert.deepEqual(addCompanyProblems(i, deps), [
    "The company needs a name.",
    "Choose the company's timezone.",
    "The company's email address is not valid.",
    "Choose at least one industry.",
  ]);
});

test("the owner needs a name, a valid email and a password of 8 or more", () => {
  const i = valid();
  i.owner = { fullName: "", email: "nobody", password: "1234567" };
  assert.deepEqual(addCompanyProblems(i, deps), [
    "The owner needs a name.",
    "The owner's email address is not valid.",
    "The owner's starting password needs at least 8 characters.",
  ]);
  i.owner = { fullName: "A", email: "a@b.co", password: "12345678" };
  assert.deepEqual(addCompanyProblems(i, deps), []);
});

test("a module without what it needs is refused", () => {
  const i = valid();
  i.modules = ["warehouse"];
  assert.deepEqual(addCompanyProblems(i, deps), ["The warehouse module needs distribution switched on too."]);
  i.modules = ["distribution", "warehouse"];
  assert.deepEqual(addCompanyProblems(i, deps), []);
});

test("words must be 1 to 40 characters without markup, each reported once", () => {
  const i = valid();
  i.terms = { staff: { one: "", many: "", article: null }, site: { one: "<b>", many: "x".repeat(41), article: null } };
  assert.deepEqual(addCompanyProblems(i, deps), [
    'The word for "staff" needs 1 to 40 characters.',
    'The word for "site" cannot contain < > { }.',
    'The word for "site" needs 1 to 40 characters.',
  ]);
});

test("the company payload is trimmed, codes upper-cased and the owner's email lower-cased", () => {
  const p = companyPayload(valid());
  assert.equal(p.name, "Sparkle Cleaning");
  assert.equal(p.country_code, "ZA");
  assert.equal(p.currency_code, "ZAR");
  assert.deepEqual(p.owner, { full_name: "Thandi Owner", email: "thandi@example.com" });
  // The password never goes to the database.
  assert.ok(!JSON.stringify(p).includes("abcd2345"));
});

test("the choices keep each word's article and every pick", () => {
  const i = valid();
  i.terms.staff.one = "  Cleaner ";
  const c = choicesPayload(i);
  assert.deepEqual(c.terms, {
    staff: { one: "Cleaner", many: "Cleaners", article: null },
    unit: { one: "hour", many: "hours", article: "an" },
  });
  assert.deepEqual(c.modules, i.modules);
  assert.deepEqual(c.settings, { short_visit_minutes: 15 });
  assert.deepEqual(c.checklists, ["office_clean"]);
  assert.deepEqual(c.forms, []);
});

test("ticking a module ticks what it needs; unticking one unticks what needs it", () => {
  const chain: ModuleDependency[] = [
    { module: "warehouse", requires: "distribution" },
    { module: "distribution", requires: "reports" },
  ];
  assert.deepEqual(toggleModule(["hr"], "warehouse", true, chain).sort(), ["distribution", "hr", "reports", "warehouse"]);
  assert.deepEqual(toggleModule(["hr", "reports", "distribution", "warehouse"], "reports", false, chain), ["hr"]);
  // Unticking a leaf leaves what it needed alone.
  assert.deepEqual(toggleModule(["reports", "distribution", "warehouse"], "warehouse", false, chain), ["reports", "distribution"]);
  // A cycle in the data does not loop forever.
  const cycle: ModuleDependency[] = [{ module: "a", requires: "b" }, { module: "b", requires: "a" }];
  assert.deepEqual(toggleModule([], "a", true, cycle).sort(), ["a", "b"]);
});

test("the defaults step leaves out brand colours, country and currency", () => {
  assert.equal(editableSetting("gps_ping_interval_minutes"), true);
  assert.equal(editableSetting("auto_end_time"), true);
  assert.equal(editableSetting("brand_primary_color"), false);
  assert.equal(editableSetting("country_code"), false);
  assert.equal(editableSetting("currency_code"), false);
});

test("settings go to text and back as the database stores them", () => {
  assert.equal(settingToText(5), "5");
  assert.equal(settingToText(true), "true");
  assert.equal(settingToText("19:30"), "19:30");
  assert.equal(settingToText(null), "");
  assert.equal(settingFromText("integer", " 15 "), 15);
  // Not a whole number: sent as text, so the database answers with the setting's own message.
  assert.equal(settingFromText("integer", "1.5"), "1.5");
  assert.equal(settingFromText("integer", ""), "");
  assert.equal(settingFromText("boolean", "true"), true);
  assert.equal(settingFromText("boolean", "false"), false);
  assert.equal(settingFromText("time", "19:30"), "19:30");
});

test("a generated password is one readable symbol per random byte", () => {
  const p = generatePassword(new Uint8Array(Array.from({ length: 16 }, (_, i) => i * 17)));
  assert.equal(p.length, 16);
  assert.match(p, /^[a-km-np-z2-9]+$/);
  // Bytes 32 apart give the same symbol: 256 is a multiple of the alphabet.
  assert.equal(generatePassword(new Uint8Array(12).fill(3)), generatePassword(new Uint8Array(12).fill(35)));
  assert.throws(() => generatePassword(new Uint8Array(8)));
});

test("the template proposal is read field by field, with safe fallbacks", () => {
  const d = parseTemplateDefaults({
    templates: [{ code: "cleaning", name: "Cleaning", version: 1 }],
    visit_frequency: "weekly",
    modules: [
      { code: "reports", name: "Reports", built: true },
      { code: "assets", name: "Assets", built: false },
    ],
    terms: { staff: { one: "Cleaner", many: "Cleaners", article: null }, unit: { one: "hour", many: "hours", article: "an" } },
    settings: { short_visit_minutes: 15 },
    checklists: [
      {
        template: "cleaning",
        code: "office_clean",
        name: "Office clean",
        items: [{ text: "Bins emptied", required: true, photo_required: false }],
      },
    ],
    forms: [{ template: "pool", code: "water_readings", name: "Water readings", description: "", fields: [{ label: "pH", field_type: "number", required: true }] }],
  });
  assert.equal(d.visitFrequency, "weekly");
  assert.deepEqual(d.modules.map((m) => [m.code, m.built]), [["reports", true], ["assets", false]]);
  assert.deepEqual(d.terms.unit, { one: "hour", many: "hours", article: "an" });
  assert.equal(d.checklists[0].items[0].text, "Bins emptied");
  assert.equal(d.forms[0].fields[0].required, true);

  const empty = parseTemplateDefaults(null);
  assert.deepEqual(empty.templates, []);
  assert.equal(empty.visitFrequency, "monthly");
  assert.deepEqual(empty.terms, {});
  const odd = parseTemplateDefaults({ terms: { site: { one: 1, article: "the" } }, modules: [{ built: "yes" }] });
  assert.deepEqual(odd.terms.site, { one: "", many: "", article: null });
  assert.equal(odd.modules[0].built, false);
});
