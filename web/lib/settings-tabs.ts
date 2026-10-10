import { moduleEnabled, type ModuleSet } from "@/lib/modules";

/**
 * Company settings: owners configure their business, not the software.
 *
 * Six tabs, each a question an owner can answer without knowing how Tickd
 * works: who the company is, how the work runs, how it gets paid, what it
 * sends people, how it looks, and what it pays Tickd for. Settings that are
 * Tickd's own (GPS timing, distance thresholds, report formulas) are not
 * here at all: `setting_definitions.audience = 'internal'`, changed only by
 * the platform operator, and the database refuses a customer write to them
 * (20261010390000_internal_settings).
 *
 * HR settings and the warehouse setup keep their own pages, shown as tabs
 * beside these (`nav-items.ts`), because their permissions differ.
 */

export const SETTINGS_TABS = [
  { id: "company", label: "Company" },
  { id: "operations", label: "Operations" },
  { id: "billing", label: "Billing" },
  { id: "communications", label: "Communications" },
  { id: "branding", label: "Branding" },
  { id: "plan", label: "Plan" },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]["id"];

/**
 * The tabs before this redesign, and where each went, so a link or a
 * bookmark with `?tab=` still opens the right place. "team" duplicated People
 * & permissions and is now that page.
 */
const LEGACY_TABS: Record<string, SettingsTab | "people"> = {
  details: "company",
  team: "people",
  field: "operations",
  money: "billing",
  dashboard: "operations",
  emails: "communications",
  alerts: "communications",
  branding: "branding",
  plan: "plan",
};

/** Where `?tab=` should open: a tab, the People page, or the first tab. */
export function settingsTabFromQuery(raw: string | null | undefined): SettingsTab | "people" {
  const v = (raw ?? "").trim();
  if (SETTINGS_TABS.some((t) => t.id === v)) return v as SettingsTab;
  return LEGACY_TABS[v] ?? "company";
}

/** Whether the Communications tab shows the alerts card. */
export function showsAlerts(modules: ModuleSet): boolean {
  return moduleEnabled(modules, "owner_notifications");
}

/**
 * The settings Tickd keeps for itself. The database is the authority
 * (`setting_definitions.audience`); this copy is what the web knows without
 * asking, so tests can check that no customer screen writes one.
 */
export const INTERNAL_SETTINGS = [
  "gps_ping_interval_minutes",
  "off_site_distance_m",
  "invalid_gps_distance_m",
  "report_tabs",
  "staff_score_weights",
  "dashboard_layout",
] as const;

/**
 * How close to a site a check-in must be, in words an owner can choose
 * between. The setting is still metres; a value that is not one of these
 * (set before, or by Tickd) is shown as itself and kept.
 */
export const CHECKIN_DISTANCES: { metres: number; label: string }[] = [
  { metres: 50, label: "Very close (50 m): small places in busy areas" },
  { metres: 100, label: "Close (100 m): most places" },
  { metres: 150, label: "A little further (150 m): gates, receptions, parking" },
  { metres: 250, label: "Further (250 m): large premises" },
  { metres: 500, label: "Far (500 m): estates, farms and big grounds" },
];

/**
 * Whether Terminology offers a word: not for something the company does not
 * have. Leads exist only with Distribution. Until the modules are known,
 * every word is offered.
 */
export function termShown(key: string, modules: ModuleSet | null): boolean {
  if (!modules) return true;
  if (key === "prospect") return moduleEnabled(modules, "distribution");
  return true;
}
