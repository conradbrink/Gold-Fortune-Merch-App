import { toModuleSet, type ModuleSet } from "@/lib/modules";
import { parseTerms, type Terms } from "@/lib/terms";
import { parseBranding, type Branding } from "@/lib/branding";
import { isMoneyWorkflow, type MoneyWorkflow } from "@/lib/money-workflow";

/**
 * The shape of `my_company_config()` and the parser for it, with nothing
 * React or browser in sight.
 *
 * Kept apart from `use-company-config.ts` because that module is "use client":
 * a route handler or server component importing it receives client references
 * rather than functions, so the server could not parse the payload it fetched
 * itself. The hook re-exports everything here, so its callers are unchanged.
 */

export type CompanySettings = {
  gps_ping_interval_minutes: number;
  short_visit_minutes: number;
  auto_end_enabled: boolean;
  auto_end_time: string;
  checkin_radius_m: number;
  off_site_distance_m: number;
  invalid_gps_distance_m: number;
  currency_code: string;
  /** ISO 3166-1 alpha-2, or "" for no country (lib/geocode-country.ts). */
  country_code: string;
  /** How the company gets paid, and its switches (lib/money-workflow.ts). */
  money_workflow: MoneyWorkflow;
  money_quotes: boolean;
  money_deposits: boolean;
  money_invoice_from_jobs: boolean;
  money_invoice_direct: boolean;
  money_contracts: boolean;
};

export type CompanyConfig = {
  orgId: string;
  modules: ModuleSet;
  settings: CompanySettings;
  timezone: string;
  vatRate: number;
  terms: Terms;
  branding: Branding;
};

/**
 * The setting definitions' own defaults (`setting_definitions.default_value`),
 * used only for a field the payload is missing or got wrong. The database
 * always sends every key; this is for a payload that is not what it should
 * be, which must not reach the screens as `undefined`.
 */
const SETTING_FALLBACK: CompanySettings = {
  gps_ping_interval_minutes: 5,
  short_visit_minutes: 5,
  auto_end_enabled: true,
  auto_end_time: "19:30",
  checkin_radius_m: 100,
  off_site_distance_m: 500,
  invalid_gps_distance_m: 5000,
  currency_code: "BWP",
  country_code: "",
  money_workflow: "flexible",
  money_quotes: true,
  money_deposits: false,
  money_invoice_from_jobs: true,
  money_invoice_direct: true,
  money_contracts: false,
};

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function int(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isInteger(v) ? v : fallback;
}

/** The RPC payload, checked field by field rather than asserted. */
export function parseCompanyConfig(raw: unknown): CompanyConfig | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.org_id !== "string") return null;
  const s = obj(r.settings);
  const f = SETTING_FALLBACK;
  return {
    orgId: r.org_id,
    modules: toModuleSet(obj(r.modules)),
    settings: {
      gps_ping_interval_minutes: int(s.gps_ping_interval_minutes, f.gps_ping_interval_minutes),
      short_visit_minutes: int(s.short_visit_minutes, f.short_visit_minutes),
      auto_end_enabled:
        typeof s.auto_end_enabled === "boolean" ? s.auto_end_enabled : f.auto_end_enabled,
      auto_end_time:
        typeof s.auto_end_time === "string" && /^\d{2}:\d{2}$/.test(s.auto_end_time)
          ? s.auto_end_time
          : f.auto_end_time,
      checkin_radius_m: int(s.checkin_radius_m, f.checkin_radius_m),
      off_site_distance_m: int(s.off_site_distance_m, f.off_site_distance_m),
      invalid_gps_distance_m: int(s.invalid_gps_distance_m, f.invalid_gps_distance_m),
      currency_code:
        typeof s.currency_code === "string" && /^[A-Z]{3}$/.test(s.currency_code)
          ? s.currency_code
          : f.currency_code,
      country_code:
        typeof s.country_code === "string" && /^([A-Z]{2})?$/.test(s.country_code)
          ? s.country_code
          : f.country_code,
      money_workflow: isMoneyWorkflow(s.money_workflow) ? s.money_workflow : f.money_workflow,
      money_quotes: bool(s.money_quotes, f.money_quotes),
      money_deposits: bool(s.money_deposits, f.money_deposits),
      money_invoice_from_jobs: bool(s.money_invoice_from_jobs, f.money_invoice_from_jobs),
      money_invoice_direct: bool(s.money_invoice_direct, f.money_invoice_direct),
      money_contracts: bool(s.money_contracts, f.money_contracts),
    },
    timezone: typeof r.timezone === "string" && r.timezone !== "" ? r.timezone : "UTC",
    vatRate: Number.isFinite(Number(r.vat_rate)) ? Number(r.vat_rate) : 0,
    terms: parseTerms(r.terms),
    branding: parseBranding(r.branding),
  };
}
