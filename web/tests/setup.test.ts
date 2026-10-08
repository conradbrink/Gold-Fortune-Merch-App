// The set-up wizard's rules (Stage 7 Part 2): what my_setup() says, where it
// opens, and which document it ends on for each way of getting paid.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bankDetailsBoxes,
  bankDetailsText,
  firstDocument,
  nextStep,
  openingStep,
  parseSetup,
  previousStep,
  SETUP_STEPS,
  stepText,
} from "@/lib/setup";
import { MONEY_WORKFLOWS, workflowPreset } from "@/lib/money-workflow";
import { DEFAULT_TERMS } from "@/lib/terms";

test("my_setup(): a new trial, as the database sends it", () => {
  const s = parseSetup({
    show: true,
    step: null,
    finished_at: null,
    industries: [{ code: "cleaning", name: "Cleaning" }],
    trade_workflow: "contract_extras",
    counts: { sites: 0, people: 2, checklists: 3, items: 6, priced_items: 0, products: 0, quotes: 0, contracts: 0, checkins: 0 },
    places: { used: 2, limit: 10 },
    country_code: "ZA",
    vat_rate_default: 15,
  });
  assert.equal(s.show, true);
  assert.equal(s.step, null);
  assert.deepEqual(s.industries, [{ code: "cleaning", name: "Cleaning" }]);
  assert.equal(s.tradeWorkflow, "contract_extras");
  assert.equal(s.counts.items, 6);
  assert.deepEqual(s.places, { used: 2, limit: 10 });
  assert.equal(s.countryCode, "ZA");
  assert.equal(s.vatRateDefault, 15);
});

test("my_setup(): a missing or odd payload never shows the wizard by accident", () => {
  const s = parseSetup(null);
  assert.equal(s.show, false);
  assert.equal(s.places, null);
  assert.equal(s.vatRateDefault, null);
  assert.equal(parseSetup({ show: "yes", step: "nowhere", places: null, vat_rate_default: null }).show, false);
  assert.equal(parseSetup({ step: "nowhere" }).step, null);
  assert.equal(parseSetup({ trade_workflow: "barter" }).tradeWorkflow, null);
  assert.equal(parseSetup({ vat_rate_default: 15.5 }).vatRateDefault, 15.5);
});

test("it opens where the address asks, else where it was left, else at the start", () => {
  assert.equal(openingStep("team", "company"), "team");
  assert.equal(openingStep(null, "company"), "company");
  assert.equal(openingStep("nowhere", null), "welcome");
  assert.equal(nextStep("welcome"), "company");
  assert.equal(nextStep("done"), "done");
  assert.equal(previousStep("welcome"), "welcome");
  assert.equal(previousStep("done"), "team");
  assert.equal(SETUP_STEPS.length, 8);
});

test("step words come from the company's terms", () => {
  const terms = {
    ...DEFAULT_TERMS,
    site: { one: "Property", many: "Properties", article: null },
    staff: { one: "Cleaner", many: "Cleaners", article: null },
  };
  assert.equal(stepText("sites", terms, { products: false, trade: "Cleaning" }).title, "Your properties");
  assert.match(stepText("team", terms, { products: false, trade: "Cleaning" }).subtitle, /each cleaner a login/);
  assert.match(stepText("welcome", terms, { products: false, trade: "Garden & landscaping" }).subtitle, /^Set up for garden & landscaping\./);
  assert.equal(stepText("prices", terms, { products: true, trade: "" }).title, "Your products");
});

test("the last step opens the document the company sends first", () => {
  const sw = (w: (typeof MONEY_WORKFLOWS)[number]) => workflowPreset(w, DEFAULT_TERMS).switches;
  assert.equal(firstDocument("contract_extras", sw("contract_extras"), "s1").href, "/contracts/new?site=s1");
  assert.equal(firstDocument("contract_jobs", sw("contract_jobs"), null).href, "/contracts/new");
  assert.equal(firstDocument("quote_job_invoice", sw("quote_job_invoice"), "s1").href, "/quotes/new?site=s1");
  assert.equal(firstDocument("quote_deposit_final", sw("quote_deposit_final"), null).kind, "quote");
  assert.equal(firstDocument("jobs_monthly", sw("jobs_monthly"), null).kind, "quote");
  assert.equal(firstDocument("flexible", sw("flexible"), null).kind, "quote");
  assert.equal(firstDocument("jobs_monthly", { ...sw("jobs_monthly"), quotes: false }, null).href, "/invoices/new");
  // Contracts switched off on a contract route: a quote, not a dead end.
  assert.equal(firstDocument("contract_extras", { ...sw("contract_extras"), contracts: false }, null).kind, "quote");
});

test("bank details: four boxes to the printed lines and back", () => {
  const boxes = { bank: "FNB", accountName: "Sparkle Clean (Pty) Ltd", accountNumber: "62812345678", branchCode: "250655" };
  const text = bankDetailsText(boxes);
  assert.equal(text, "Bank: FNB\nAccount name: Sparkle Clean (Pty) Ltd\nAccount number: 62812345678\nBranch code: 250655");
  assert.deepEqual(bankDetailsBoxes(text), boxes);
  assert.equal(bankDetailsText({ bank: " ", accountName: "", accountNumber: "1", branchCode: "" }), "Account number: 1");
  // Typed by hand on the settings page: kept whole, never split wrongly.
  assert.deepEqual(bankDetailsBoxes("FNB 62812345678"), { bank: "FNB 62812345678", accountName: "", accountNumber: "", branchCode: "" });
  assert.deepEqual(bankDetailsBoxes(null), { bank: "", accountName: "", accountNumber: "", branchCode: "" });
});
