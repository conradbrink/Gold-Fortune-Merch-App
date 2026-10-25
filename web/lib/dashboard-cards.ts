import { moduleEnabled, type ModuleCode, type ModuleSet } from "@/lib/modules";
import { can, type PermissionCode, type PermissionSet } from "@/lib/permissions";
import { codesFromSetting } from "@/lib/kpis";
import { lower, possessive, withArticle, type Terms } from "@/lib/terms";

/**
 * The dashboard's cards as plain facts: what each is called, what it shows,
 * and who may have it.
 *
 * The cards themselves (what they fetch and draw) are in
 * `components/dashboard/widget-registry.tsx`, which only the browser can load.
 * These facts are kept apart so the server can read them too: the AI Manager
 * adds and removes cards for a person, and must offer exactly the cards the
 * Customise panel would. The registry spreads each card in by its id, so the
 * two cannot drift.
 */

export type DashboardCard = {
  /** Stored in `dashboard_layouts.widget_ids`. Never change one in place. */
  id: string;
  /**
   * In the company's words, so a function of them rather than a string: the
   * catalogue is shared by every company, the wording is not.
   */
  title: (t: Terms) => string;
  /** What this card tells you. Shown in the Customise panel. */
  description: (t: Terms) => string;
  /**
   * The module this card reports on, when it is not core. A company without
   * it does not see the card or get it offered in Customise — the numbers
   * would be zeros from a feature they do not have.
   */
  module?: ModuleCode;
  /**
   * The permission it needs, when not everyone with the dashboard may see what
   * it shows (money). The database leaves those figures out regardless.
   */
  permission?: PermissionCode;
};

/** In the order the Customise panel offers them. */
export const DASHBOARD_CARDS: readonly DashboardCard[] = [
  {
    id: "kpis",
    title: () => "Your numbers",
    description: (t) => `The numbers your trade runs on: ${lower(t.job.many)} done, proof, money. Choose them in Settings.`,
  },
  {
    id: "today",
    title: () => "Today",
    description: (t) => `Today's ${lower(t.job.many)}: who is on site, who has not started, how many are done.`,
  },
  {
    id: "money",
    title: () => "Money",
    description: (t) => `Finished ${lower(t.job.many)} not invoiced, what you are owed, what came in, contracts due.`,
    module: "invoicing",
    permission: "invoicing",
  },
  {
    id: "quotes",
    title: () => "Quotes",
    description: () => "Quotes waiting for an answer, how many you win, and won quotes not yet invoiced.",
    module: "invoicing",
    permission: "invoicing",
  },
  {
    id: "headline",
    title: () => "Headline numbers",
    description: (t) =>
      `Revenue, orders needing action, money owed, ${lower(t.site.one)} coverage and ${lower(t.site.many)} needing attention.`,
  },
  {
    id: "sales",
    title: () => "Sales",
    description: (t) =>
      `Sales by month with this month's pace, and each ${lower(t.staff.one)} against target.`,
    module: "distribution",
  },
  {
    id: "pipeline",
    title: () => "Orders pipeline",
    description: () =>
      "Orders by stage, missing proofs of delivery, quotes, recurring orders, low stock and money owed.",
    module: "distribution",
  },
  {
    id: "field_team",
    title: () => "Field team",
    description: (t) =>
      `Where each ${lower(t.staff.one)} last was, who has gone quiet, out-of-stock, planogram and far-from-${lower(t.site.one)} check-ins.`,
  },
  {
    id: "store_health",
    title: (t) => `${t.site.one} health`,
    description: (t) =>
      `${t.site.many} ordering, visited without ordering, and not visited — with the ones to go to first.`,
    module: "distribution",
  },
  {
    id: "store_reorder",
    title: (t) => `${t.site.many} due for an order`,
    description: (t) =>
      `${t.site.many} that have gone their usual time without an order, the ones that stopped ordering, and which to ask first.`,
    module: "distribution",
  },
  {
    id: "store_range",
    title: () => "Range",
    description: (t) =>
      `Which products each ${lower(t.site.one)} should have, what is missing, and how new products are doing. Tickd works it out from your orders.`,
    module: "distribution",
    // Management figures with money, like the page it opens (/stores/range).
    permission: "insights",
  },
  {
    id: "visits_completed",
    title: (t) => `${t.job.many} completed`,
    description: (t) =>
      `Completed ${lower(t.job.many)} in the period, against the period before it.`,
  },
  {
    id: "store_coverage",
    title: (t) => `${t.site.one} coverage`,
    description: (t) =>
      `Share of active ${lower(t.site.many)} visited at least once in the period.`,
  },
  {
    id: "oos_rate",
    module: "distribution",
    title: () => "Out of stock rate",
    description: () =>
      "Share of stock checks answered “no”. Reads the in_stock metric on your forms.",
  },
  {
    id: "planogram",
    module: "distribution",
    title: () => "Planogram compliance",
    description: () =>
      "Share of planogram checks answered “yes”. Reads the planogram_ok metric.",
  },
  {
    id: "live_reps",
    title: () => "Where the team is",
    description: (t) =>
      `Each ${possessive(lower(t.staff.one))} latest position on a map, with how long ago it arrived. Phones report at the interval set in company settings while the ${lower(t.workday.one)} is open.`,
  },
  {
    id: "working_day",
    title: () => "Working day",
    description: (t) =>
      `When each ${lower(t.staff.one)} starts, closes and how long they work — from the day's evidence, not from what anyone typed.`,
  },
  {
    id: "visits_trend",
    title: (t) => `${t.job.many} completed — trend`,
    description: (t) => `Completed ${lower(t.job.many)} per day across the period.`,
  },
  {
    id: "coverage_donut",
    title: (t) => `${t.site.one} coverage — chart`,
    description: () => "The same coverage figure as a proportion of the estate.",
  },
  {
    id: "forms_submitted",
    module: "checklists_forms",
    title: () => "Forms submitted",
    description: (t) =>
      `Submissions in the period, and what share of completed ${lower(t.job.many)} carried one.`,
  },
  {
    // From the plan, as the "Missed" number and the reports count it: planned
    // work on days gone by that nobody did. It used to count visit rows with
    // status 'missed', which nothing ever writes, so it always read 0.
    id: "missed_visits",
    title: (t) => `Missed ${lower(t.job.many)}`,
    description: (t) => `Planned ${lower(t.job.many)} on days gone by that nobody did.`,
  },
  {
    id: "active_reps",
    title: (t) => `Active ${lower(t.staff.many)}`,
    description: (t) =>
      `${t.staff.many} who recorded anything in the period, and the average ${lower(t.job.one)} length.`,
  },
  {
    id: "unscheduled_visits",
    title: (t) => `Unscheduled ${lower(t.job.many)}`,
    description: (t) => `Calls ${withArticle(t, "staff")} started outside the plan.`,
  },
  {
    id: "prospecting",
    module: "distribution",
    title: () => "Prospecting",
    description: () => "Sales calls, pipeline stages and follow-ups owed.",
  },
  {
    id: "territories",
    title: (t) => t.territory.many,
    description: (t) =>
      `The ${lower(t.territory.one)} structure, and ${lower(t.site.many)} that are not in one.`,
  },
  {
    id: "confirmed_positions",
    title: () => "Confirmed positions",
    description: (t) =>
      `How much of the estate stands on a position ${withArticle(t, "staff")} measured, rather than a geocoder's guess.`,
  },
];

const BY_ID = new Map(DASHBOARD_CARDS.map((c) => [c.id, c]));

export function findCard(id: string): DashboardCard | undefined {
  return BY_ID.get(id);
}

/** Every card id the running code knows. */
export const CARD_IDS: readonly string[] = DASHBOARD_CARDS.map((c) => c.id);

/** Whether a card belongs on this person's dashboard. Without the permissions yet, permission-bound cards wait. */
export function cardAvailable(
  card: Pick<DashboardCard, "module" | "permission">,
  modules: ModuleSet,
  permissions: PermissionSet | null = null
): boolean {
  if (card.module !== undefined && !moduleEnabled(modules, card.module)) return false;
  if (card.permission !== undefined) return permissions !== null && can(permissions, card.permission);
  return true;
}

/**
 * The layout somebody sees before they have customised anything.
 *
 * Written out, no longer derived from the registry: since the October 2026
 * redesign the default is the five summary cards plus the team map, and the
 * fourteen earlier field cards stay in the catalogue for Customise rather than
 * all appearing at once, which was most of the old clutter. A new widget meant
 * for everyone must therefore be added here as well as to `DASHBOARD_CARDS`
 * and the registry's `WIDGETS`.
 *
 * Nobody had a saved layout when this changed (checked: `dashboard_layouts`
 * was empty), so every dashboard picked the new default up at once.
 */
export const DEFAULT_LAYOUT: string[] = [
  "headline",
  "sales",
  "pipeline",
  "field_team",
  "store_health",
  "store_reorder",
  "store_range",
  "live_reps",
];

/**
 * The cards a new user starts with: the company's setting (its trade's, at
 * sign-up), or the default above when the setting names nothing we know.
 */
export function companyDefaultLayout(settingValue: string | null | undefined): string[] {
  const ids = codesFromSetting(settingValue ?? "", (id) => BY_ID.has(id));
  return ids.length > 0 ? ids : DEFAULT_LAYOUT;
}
