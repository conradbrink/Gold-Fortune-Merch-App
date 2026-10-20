import { canAccessPath, type PermissionSet } from "@/lib/permissions";
import { canReachPath, type ModuleSet } from "@/lib/modules";
import { lower, type Terms } from "@/lib/terms";

/**
 * What the assistant may look up, and who may have it look.
 *
 * The assistant never writes a query. It can only call the lookups below, and
 * each one runs on the server with the asker's own session, so the database
 * decides what comes back exactly as it does for the page the lookup mirrors.
 * Nothing here can reach another company: the session belongs to one.
 *
 * Each lookup names the page it answers for, and a person is offered a lookup
 * only when they may open that page (`canAccessPath`) at a company that has
 * its module (`canReachPath`). One rule for the menu, the proxy and the
 * assistant, so the assistant cannot tell somebody what the app would not
 * show them. The database is still the boundary behind that.
 *
 * Plain data and plain functions: the top bar (browser) and the route
 * (server) both read it.
 */

export type ToolName =
  | "find_sites"
  | "site_visits"
  | "sites_not_visited"
  | "sites_due_for_order"
  | "sales"
  | "orders"
  | "stock"
  | "hours_worked"
  | "team_performance"
  | "money_owed"
  | "staff_sites"
  | "draft_visit_plan";

type JsonSchema = Record<string, unknown>;

export type ToolSpec = {
  name: ToolName;
  /** The page this lookup answers for. Access follows that page. */
  page: string;
  /** For the model: when to use it. In the company's words. */
  description: (t: Terms) => string;
  parameters: (t: Terms) => JsonSchema;
  /** Shown while it runs: "Looking up sales". */
  working: (t: Terms) => string;
  /**
   * Only for managers. Planning writes the schedule, and the schedule's tables
   * still let only `current_role() = 'manager'` write (see `use-is-manager.ts`);
   * offering it to anybody else would draft a plan they could never save.
   */
  managerOnly?: boolean;
  /**
   * When its rows are shown under the answer as a table. "asked": only when
   * the call sets `show_table`, which the model does when the person asked to
   * see a list. Most lookups are made to answer one fact, and a table of every
   * row behind it buries the answer. "always": the rows are the answer (a
   * drafted plan). Left out: it returns no table. `toolParameters` adds the
   * `show_table` parameter, so it is declared here once.
   */
  table?: "asked" | "always";
};

const DATE = "A date as YYYY-MM-DD, in the company's time zone.";

const dateRange = {
  from: { type: "string", description: `First day, inclusive. ${DATE}` },
  to: { type: "string", description: `Last day, inclusive. ${DATE}` },
};

/** Strict structured tools need every key listed as required, nullable instead of optional. */
function object(properties: Record<string, JsonSchema>): JsonSchema {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

const nullableString = (description: string): JsonSchema => ({
  type: ["string", "null"],
  description,
});

/** Added to every lookup whose rows can be shown (`table: "asked"`) by `toolParameters`. */
const SHOW_TABLE: JsonSchema = {
  type: "boolean",
  description:
    "True when the person asked for the list itself: which or who (more than one), a list, a table, " +
    "a report, a breakdown (per person, per month...), or a download. False when they asked for one " +
    "fact, a count or a total (how many, how much, one name), or you only need the rows to work out your answer.",
};

export const TOOLS: readonly ToolSpec[] = [
  {
    name: "find_sites",
    page: "/stores",
    description: (t) =>
      `Find ${lower(t.site.many)} by name or town. Returns each match's id, name, town, group, ` +
      `when it was last visited and by whom. Use it first whenever a question names a ` +
      `${lower(t.site.one)}, to get its id for the other lookups.`,
    parameters: (t) =>
      object({
        name: { type: "string", description: `Part of the ${lower(t.site.one)}'s name, or a town.` },
      }),
    working: (t) => `Finding the ${lower(t.site.one)}`,
  },
  {
    name: "site_visits",
    table: "asked",
    page: "/activities",
    description: (t) =>
      `${t.job.many} in a date range: when each ${lower(t.staff.one)} checked in and out, at which ` +
      `${lower(t.site.one)}, and for how long. Filter by one ${lower(t.site.one)} (id from find_sites) ` +
      `or one ${lower(t.staff.one)}.`,
    parameters: (t) =>
      object({
        ...dateRange,
        site_id: nullableString(`Only this ${lower(t.site.one)} (id from find_sites), or null for all.`),
        staff_name: nullableString(`Only this ${lower(t.staff.one)} (part of their name), or null for all.`),
      }),
    working: (t) => `Looking up ${lower(t.job.many)}`,
  },
  {
    name: "sites_not_visited",
    table: "asked",
    page: "/stores",
    description: (t) =>
      `Active ${lower(t.site.many)} nobody has been to in the last N days, or ever, with the ` +
      `date of the last ${lower(t.job.one)} there.`,
    parameters: () =>
      object({
        days: { type: "integer", description: "Not visited in at least this many days, 1 to 365." },
      }),
    working: (t) => `Checking which ${lower(t.site.many)} were missed`,
  },
  {
    name: "sites_due_for_order",
    table: "asked",
    page: "/stores/reorder",
    description: (t) =>
      `${t.site.many} due for an order: when each last ordered, how often it usually orders, ` +
      `and whether it is due now, due soon, has stopped ordering or has never ordered.`,
    parameters: () =>
      object({
        town: nullableString("Only this town, or null for all."),
      }),
    working: (t) => `Checking which ${lower(t.site.many)} are due for an order`,
  },
  {
    name: "sales",
    table: "asked",
    page: "/sales",
    description: (t) =>
      `Sales in a date range, counted on the day the order was delivered and valued on what ` +
      `arrived, excluding VAT. Group by ${lower(t.staff.one)}, ${lower(t.site.one)}, month or ` +
      `product, or get the total. Can filter to one ${lower(t.site.one)} or one ${lower(t.staff.one)}.`,
    parameters: (t) =>
      object({
        ...dateRange,
        group_by: {
          type: "string",
          enum: ["total", "staff", "site", "month", "product"],
          description: `How to break the figure down. "staff" is per ${lower(t.staff.one)}, "site" per ${lower(t.site.one)}.`,
        },
        site_id: nullableString(`Only this ${lower(t.site.one)} (id from find_sites), or null.`),
        staff_name: nullableString(`Only this ${lower(t.staff.one)} (part of their name), or null.`),
      }),
    working: () => "Adding up sales",
  },
  {
    name: "orders",
    table: "asked",
    page: "/orders",
    description: (t) =>
      `Orders and where they stand (new, confirmed, picking, packed, dispatched, delivered, ` +
      `cancelled), with value excluding VAT. Filter by status, one ${lower(t.site.one)}, or the ` +
      `day the order was taken.`,
    parameters: (t) =>
      object({
        status: {
          type: ["string", "null"],
          enum: ["new", "confirmed", "picking", "packed", "dispatched", "delivered", "cancelled", "open", null],
          description: '"open" means not yet delivered or cancelled. Null for any status.',
        },
        site_id: nullableString(`Only this ${lower(t.site.one)} (id from find_sites), or null.`),
        from: nullableString(`Taken on or after this day. ${DATE} Or null.`),
        to: nullableString(`Taken on or before this day. ${DATE} Or null.`),
      }),
    working: () => "Looking up orders",
  },
  {
    name: "stock",
    table: "asked",
    page: "/inventory",
    description: () =>
      "Stock in the warehouse per product: on hand, packed for orders (reserved), available, " +
      "damaged, and whether it is below its minimum.",
    parameters: () =>
      object({
        search: nullableString("Part of a product name, brand or code, or null for all products."),
        only_low: { type: "boolean", description: "Only products below their minimum or out of stock." },
      }),
    working: () => "Checking stock",
  },
  {
    name: "hours_worked",
    table: "asked",
    page: "/reports",
    description: (t) =>
      `Hours per ${lower(t.staff.one)} per day in a date range: first in, last out, hours worked, ` +
      `hours on site, ${lower(t.job.many)} done and km. Shows who is working right now for today.`,
    parameters: (t) =>
      object({
        ...dateRange,
        staff_name: nullableString(`Only this ${lower(t.staff.one)} (part of their name), or null.`),
      }),
    working: () => "Looking up hours",
  },
  {
    name: "team_performance",
    table: "asked",
    page: "/reports",
    description: (t) =>
      `Per ${lower(t.staff.one)} in a date range: ${lower(t.job.many)} planned and done, completion ` +
      `rate, average time on site, form compliance, GPS-verified rate and overall score.`,
    parameters: () => object({ ...dateRange }),
    working: (t) => `Looking up how the ${lower(t.staff.many)} did`,
  },
  {
    name: "staff_sites",
    table: "asked",
    page: "/schedule",
    managerOnly: true,
    description: (t) =>
      `The ${lower(t.site.many)} assigned to one ${lower(t.staff.one)}, by town: how many in each town and how ` +
      `often each wants a ${lower(t.job.one)}, plus what is already on their schedule for the month and the company's ` +
      `${lower(t.site.many)}-a-day and working days. Use it first when planning someone's ${lower(t.job.many)}.`,
    parameters: (t) =>
      object({
        staff_name: { type: "string", description: `The ${lower(t.staff.one)}'s name, or part of it.` },
        month: { type: "string", description: "The month to plan, as YYYY-MM." },
      }),
    working: (t) => `Looking up their ${lower(t.site.many)}`,
  },
  {
    name: "draft_visit_plan",
    table: "always",
    page: "/schedule",
    managerOnly: true,
    description: (t) =>
      `Drafts a month of ${lower(t.job.many)} for one ${lower(t.staff.one)} from their assigned ` +
      `${lower(t.site.many)}: the towns in order with how many days in each, days off, and ` +
      `${lower(t.site.many)} a day. It is only a draft: the person saves it with the button under it.`,
    parameters: (t) =>
      object({
        staff_id: { type: "string", description: `The ${lower(t.staff.one)}'s id, from staff_sites.` },
        month: { type: "string", description: "The month, as YYYY-MM." },
        towns: {
          type: "array",
          description: "The towns in the order to go to them, each with how many working days to spend there.",
          items: object({
            town: { type: "string", description: "The town, as staff_sites names it." },
            days: { type: "integer", description: "Working days in that town." },
          }),
        },
        days_off: {
          type: "array",
          description: "Days they won't work, as YYYY-MM-DD. Empty for none.",
          items: { type: "string" },
        },
        sites_per_day: {
          type: ["integer", "null"],
          description: `${t.site.many} a day, or null for the company's number.`,
        },
      }),
    working: () => "Drafting the plan",
  },
  {
    name: "money_owed",
    table: "asked",
    page: "/owed",
    description: (t) =>
      `Who owes the company money today, per ${lower(t.client.one)}: not yet due, 1 to 30, 31 to 60, ` +
      `61 to 90 and over 90 days overdue, total, and when they last paid.`,
    parameters: () => object({}),
    working: () => "Looking up money owed",
  },
];

export function toolSpec(name: string): ToolSpec | undefined {
  return TOOLS.find((t) => t.name === name);
}

/** What the model is offered for a lookup: its parameters, plus `show_table` when its rows can be shown. */
export function toolParameters(spec: ToolSpec, t: Terms): JsonSchema {
  const schema = spec.parameters(t);
  if (spec.table !== "asked") return schema;
  return object({ ...(schema.properties as Record<string, JsonSchema>), show_table: SHOW_TABLE });
}

/**
 * A lookup call's arguments as the model sent them. Null when they are not
 * JSON at all; anything that is JSON but not an object reads as no arguments.
 */
export function parseArgs(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw || "{}") as unknown;
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return null;
  }
}

/** Whether this call's rows are shown as a table: see `ToolSpec.table`. Anything but a clear yes is a no. */
export function showsTable(spec: ToolSpec, args: Record<string, unknown> | null): boolean {
  if (spec.table === "always") return true;
  return spec.table === "asked" && args?.show_table === true;
}

/** Whether this person, at this company, may have the assistant run a lookup. */
export function toolAllowed(
  spec: ToolSpec,
  permissions: PermissionSet,
  modules: ModuleSet,
  isManager: boolean
): boolean {
  return (
    canAccessPath(permissions, spec.page) &&
    canReachPath(modules, spec.page) &&
    (!spec.managerOnly || isManager)
  );
}

/** The lookups this person may use. Empty means the assistant has nothing to offer them. */
export function toolsFor(permissions: PermissionSet, modules: ModuleSet, isManager: boolean): ToolSpec[] {
  return TOOLS.filter((spec) => toolAllowed(spec, permissions, modules, isManager));
}

/**
 * Questions to start from, matched to what this person can look up.
 *
 * The first answer is one tap away: somebody who opens the panel and does not
 * know what to ask still gets something useful.
 */
export function exampleQuestions(tools: readonly ToolSpec[], t: Terms): string[] {
  const has = (n: ToolName) => tools.some((s) => s.name === n);
  const out: string[] = [];
  if (has("draft_visit_plan")) out.push(`Help me plan a ${lower(t.staff.one)}'s ${lower(t.job.many)} for next month`);
  if (has("sales")) out.push(`What are sales this month per ${lower(t.staff.one)}?`);
  if (has("sites_due_for_order")) out.push(`Which ${lower(t.site.many)} are due for an order?`);
  if (has("sites_not_visited")) out.push(`Which ${lower(t.site.many)} haven't been visited in 30 days?`);
  if (has("hours_worked")) out.push("Who is working today, and since when?");
  if (has("orders")) out.push("Which orders are still waiting to be delivered?");
  if (has("stock")) out.push("Which products are low on stock?");
  if (has("money_owed")) out.push("Who owes us money, and how much is overdue?");
  if (has("team_performance")) out.push(`How did each ${lower(t.staff.one)} do last week?`);
  if (has("site_visits") && out.length < 4) out.push(`Who visited which ${lower(t.site.many)} yesterday?`);
  return out.slice(0, 4);
}
