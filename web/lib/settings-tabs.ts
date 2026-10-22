import { moduleEnabled, type ModuleSet } from "@/lib/modules";

/**
 * Settings: the customer sets up their business, Tickd sets up the software
 * (owner, 22 Oct 2026).
 *
 * Four pages, each a question an owner can answer without knowing how Tickd
 * works: who the business is and how it looks, how the team works, what
 * Tickd should tell them, and what they pay for. HR settings and the
 * warehouse setup keep their own pages, shown as tabs beside these
 * (`nav-items.ts`) to the companies that have them, because their
 * permissions differ.
 *
 * Everything else a company is configured with (overtime rules, order
 * timing, ranges, dashboard numbers, invoice numbering, VAT, terminology,
 * the exact alert rules) is set by Tickd from the Control Centre
 * (`/platform/companies/[id]`). Those settings keep working exactly as
 * before; only who changes them moved.
 */

export const SETTINGS_PAGES = [
  { id: "business", href: "/settings/business", label: "Business" },
  { id: "team", href: "/settings/team", label: "Team & Work" },
  { id: "notifications", href: "/settings/notifications", label: "Notifications" },
  { id: "plan", href: "/settings/plan", label: "Plan" },
] as const;

export type SettingsPage = (typeof SETTINGS_PAGES)[number]["id"];

function href(id: SettingsPage): string {
  return SETTINGS_PAGES.find((p) => p.id === id)!.href;
}

/**
 * Where an old `/settings/company?tab=` link lands, so a bookmark, an email
 * or a help answer from before still opens the right page. Tabs whose
 * settings moved to Tickd open the page nearest to them. "team" was Team
 * members, which became People & permissions.
 */
const LEGACY_TABS: Record<string, string> = {
  company: href("business"),
  details: href("business"),
  branding: href("business"),
  billing: href("business"),
  money: href("business"),
  operations: href("team"),
  field: href("team"),
  dashboard: href("team"),
  communications: href("notifications"),
  emails: href("notifications"),
  alerts: href("notifications"),
  plan: href("plan"),
  team: "/settings/users",
};

/** The page an old `/settings/company?tab=` address should open. */
export function settingsPathFromQuery(raw: string | null | undefined): string {
  return LEGACY_TABS[(raw ?? "").trim()] ?? href("business");
}

/** Whether Notifications shows the alert switches. */
export function showsAlerts(modules: ModuleSet): boolean {
  return moduleEnabled(modules, "owner_notifications");
}

/**
 * Tickd's own settings: `setting_definitions.audience = 'internal'`, so the
 * database refuses a customer's write and only the Control Centre changes
 * them. The database is the authority; this copy is what the web knows
 * without asking, so tests can check that no customer screen writes one.
 *
 * How the software works (20261010390000_internal_settings).
 */
export const ENGINE_SETTINGS = [
  "gps_ping_interval_minutes",
  "off_site_distance_m",
  "invalid_gps_distance_m",
  "report_tabs",
  "staff_score_weights",
  "dashboard_layout",
] as const;

/**
 * The rules Tickd sets up for the customer from their trade and their own
 * data, moved off Settings (20261022230000_tickd_sets_up_the_rules).
 */
export const TICKD_RULES = [
  "short_visit_minutes",
  "report_short_day_hours",
  "report_long_day_hours",
  "report_day_normal_hours",
  "report_week_normal_hours",
  "report_sunday_is_overtime",
  "reorder_after_days",
  "range_lapse_days",
  "dashboard_cards",
  "alerts_digest_time",
  "alerts_patrol_gap_minutes",
  "document_style",
] as const;

export const INTERNAL_SETTINGS = [...ENGINE_SETTINGS, ...TICKD_RULES] as const;

/**
 * Settings the customer can still write, because the set-up wizard asks for
 * them (how they get paid) or because Notifications offers a simpler switch
 * over them (alerts), but whose full detail only the Control Centre shows.
 */
export const CONTROL_CENTRE_OWNER_SETTINGS = [
  "money_workflow",
  "money_quotes",
  "money_deposits",
  "money_invoice_from_jobs",
  "money_invoice_direct",
  "money_contracts",
  "money_invoice_orders",
  "alerts_on",
  "alerts_email",
] as const;

/**
 * How close to a site a check-in must be. The setting is still metres
 * (`checkin_radius_m`); a value that is not one of these (set before, or by
 * Tickd) is offered as itself and kept.
 */
export const CHECKIN_DISTANCES = [50, 100, 250, 500] as const;

/** The distances to offer: the four, and the company's own value when it is another. */
export function checkinChoices(current: number | null): number[] {
  const all = new Set<number>(CHECKIN_DISTANCES);
  if (current !== null && Number.isInteger(current) && current > 0) all.add(current);
  return [...all].sort((a, b) => a - b);
}

/**
 * Whether the Control Centre offers a word: not for something the company
 * does not have. Leads exist only with Distribution. Until the modules are
 * known, every word is offered.
 */
export function termShown(key: string, modules: ModuleSet | null): boolean {
  if (!modules) return true;
  if (key === "prospect") return moduleEnabled(modules, "distribution");
  return true;
}
