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
  /** The numbers "Your numbers" shows, comma-separated codes (lib/kpis.ts). */
  dashboard_cards: string;
  /** The cards a new user's dashboard starts with, comma-separated widget ids. */
  dashboard_layout: string;
  /** The Reports page's tabs, in order, comma-separated ids (lib/report-tabs.ts). */
  report_tabs: string;
  /** The Hours report marks a finished workday shorter or longer than these; 0 = no mark. */
  report_short_day_hours: number;
  report_long_day_hours: number;
  /** Hours report overtime: past these hours a day or ISO week; 0 = no rule (lib/staff-hours.ts). */
  report_day_normal_hours: number;
  report_week_normal_hours: number;
  /** Every Sunday hour is overtime. */
  report_sunday_is_overtime: boolean;
  /** The staff score's parts and weights, "code:weight,…" adding to 100 (lib/staff-score.ts). */
  staff_score_weights: string;
  /** When clients get the job reports (Stage 8.3): immediate, evening or manual. */
  job_report_send: JobReportSend;
  /** The evening email's time, "HH:MM" on the company's clock. */
  job_report_send_time: string;
};

export type JobReportSend = "immediate" | "evening" | "manual";

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
  dashboard_cards: "jobs_done_pct,missed,gps_verified_pct,owed",
  dashboard_layout: "headline,sales,pipeline,field_team,store_health,live_reps",
  report_tabs: "score,oos,coverage,adherence,reps,trends,form,photos",
  report_short_day_hours: 0,
  report_long_day_hours: 0,
  report_day_normal_hours: 0,
  report_week_normal_hours: 0,
  report_sunday_is_overtime: false,
  staff_score_weights: "sales:35,visits:25,coverage:15,merchandising:15,compliance:10",
  job_report_send: "manual",
  job_report_send_time: "18:00",
};

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/** A comma list of codes, as the setting's pattern allows; anything else is the default. */
function list(v: unknown, fallback: string): string {
  return typeof v === "string" && /^([a-z0-9_]+(,[a-z0-9_]+)*)?$/.test(v) ? v : fallback;
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
      dashboard_cards: list(s.dashboard_cards, f.dashboard_cards),
      dashboard_layout: list(s.dashboard_layout, f.dashboard_layout),
      report_tabs: list(s.report_tabs, f.report_tabs),
      report_short_day_hours: int(s.report_short_day_hours, f.report_short_day_hours),
      report_long_day_hours: int(s.report_long_day_hours, f.report_long_day_hours),
      report_day_normal_hours: int(s.report_day_normal_hours, f.report_day_normal_hours),
      report_week_normal_hours: int(s.report_week_normal_hours, f.report_week_normal_hours),
      report_sunday_is_overtime: bool(s.report_sunday_is_overtime, f.report_sunday_is_overtime),
      staff_score_weights:
        typeof s.staff_score_weights === "string" && /^([a-z_]+:\d{1,3}(,[a-z_]+:\d{1,3})*)?$/.test(s.staff_score_weights)
          ? s.staff_score_weights
          : f.staff_score_weights,
      job_report_send:
        s.job_report_send === "immediate" || s.job_report_send === "evening" || s.job_report_send === "manual"
          ? s.job_report_send
          : f.job_report_send,
      job_report_send_time:
        typeof s.job_report_send_time === "string" && /^\d{2}:\d{2}/.test(s.job_report_send_time)
          ? s.job_report_send_time.slice(0, 5)
          : f.job_report_send_time,
    },
    timezone: typeof r.timezone === "string" && r.timezone !== "" ? r.timezone : "UTC",
    vatRate: Number.isFinite(Number(r.vat_rate)) ? Number(r.vat_rate) : 0,
    terms: parseTerms(r.terms),
    branding: parseBranding(r.branding),
  };
}
