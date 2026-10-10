// A contract's periods as the database computes them (Stage 7 Part 1b): the
// same cases as the money suite (supabase/tests/money.sql N12).
import { test } from "node:test";
import assert from "node:assert/strict";
import { firstBilledPeriod, firstPeriodStart, invoiceDate, periodEnd, periodLabel } from "@/lib/contract-periods";

test("billing starts with the first whole month", () => {
  assert.equal(firstPeriodStart("2026-01-01"), "2026-01-01");
  assert.equal(firstPeriodStart("2026-01-15"), "2026-02-01");
  assert.equal(firstPeriodStart("2026-12-31"), "2027-01-01");
});

test("months and quarters end on their last day", () => {
  assert.equal(periodEnd("2026-02-01", "monthly"), "2026-02-28");
  assert.equal(periodEnd("2028-02-01", "monthly"), "2028-02-29");
  assert.equal(periodEnd("2026-11-01", "quarterly"), "2027-01-31");
});

test("invoiced in the first month (in advance) or the month after (in arrears)", () => {
  const advance = { period: "monthly" as const, billing: "advance" as const, invoiceDay: 1 };
  const arrears = { period: "quarterly" as const, billing: "arrears" as const, invoiceDay: 5 };
  assert.equal(invoiceDate("2026-11-01", "2026-11-30", advance), "2026-11-01");
  assert.equal(invoiceDate("2026-11-01", "2027-01-31", arrears), "2027-02-05");
});

test("nothing before the contract was entered is billed by itself", () => {
  const terms = { period: "monthly" as const, billing: "advance" as const, invoiceDay: 1 };
  assert.deepEqual(firstBilledPeriod("2026-01-01", terms, "2026-10-08"), {
    start: "2026-11-01",
    end: "2026-11-30",
    invoiceOn: "2026-11-01",
  });
  assert.equal(firstBilledPeriod("2026-01-01", terms, "2026-10-01")?.start, "2026-10-01");
  // In arrears, last month is still to be invoiced on its day this month.
  const arrears = { period: "monthly" as const, billing: "arrears" as const, invoiceDay: 10 };
  assert.equal(firstBilledPeriod("2026-01-01", arrears, "2026-10-08")?.start, "2026-09-01");
});

test("period labels", () => {
  assert.equal(periodLabel("2026-10-01", "2026-10-31"), "October 2026");
  assert.equal(periodLabel("2026-10-01", "2026-12-31"), "Oct–Dec 2026");
  assert.equal(periodLabel("2026-11-01", "2027-01-31"), "Nov 2026–Jan 2027");
  // A last period cut short by the contract's end date names its days.
  assert.equal(periodLabel("2026-03-01", "2026-03-15"), "1–15 March 2026");
  assert.equal(periodLabel("2026-01-01", "2026-02-01"), "1 Jan–1 Feb 2026");
  assert.equal(periodLabel("2026-12-01", "2027-01-10"), "1 Dec 2026–10 Jan 2027");
  assert.equal(periodLabel("2028-02-01", "2028-02-29"), "February 2028");
});

// The Finance menu follows the company's switches: Contracts only when it uses
// them, the price list only when it quotes or invoices services. Both are tabs
// on Invoices.
import { reachablePages, visibleNavGroups } from "@/components/layout/nav-items";
import { toModuleSet } from "@/lib/modules";
import { toPermissionSet } from "@/lib/permissions";
import { parseCompanyConfig } from "@/lib/company-config";

test("the Finance menu follows the company's switches", () => {
  const admin = toPermissionSet(["admin"]);
  const settings = (s: Record<string, unknown>) =>
    parseCompanyConfig({ org_id: "o", settings: s, modules: {} })!.settings;
  const money = (modules: Record<string, boolean>, s: Record<string, unknown>) =>
    reachablePages(
      visibleNavGroups(admin, toModuleSet(modules), undefined, settings(s)).filter((g) => g.label === "Finance")
    ).map((p) => p.href);
  const cleaner = money({ invoicing: true }, { money_workflow: "contract_extras", money_contracts: true });
  assert.ok(cleaner.includes("/contracts") && cleaner.includes("/price-list"), cleaner.join(","));
  const distributor = money(
    { invoicing: true, distribution: true },
    { money_workflow: "order_invoice", money_invoice_from_jobs: false, money_invoice_direct: false, money_contracts: false }
  );
  assert.ok(!distributor.includes("/contracts") && !distributor.includes("/price-list"), distributor.join(","));
  assert.ok(distributor.includes("/invoices") && distributor.includes("/owed"));
});
