import { canAccessPath, type PermissionSet } from "@/lib/permissions";
import { canReachPath, type ModuleSet } from "@/lib/modules";
import { lower, type Terms } from "@/lib/terms";
import { ACTIONS, type ActionName } from "@/lib/assistant-actions";
import { HELP_TOPICS } from "@/lib/assistant-help";
import { DATE, nullableString, object, type JsonSchema } from "@/lib/assistant-schema";

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

export type LookupName =
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
  | "draft_visit_plan"
  | "find_products"
  | "promotions"
  | "forms"
  | "dashboard_cards"
  | "ai_changes"
  | "how_to";

export type ToolName = LookupName | ActionName;

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
   * Does something in the app rather than look something up
   * (`lib/assistant-actions.ts`): drafts a card the person confirms.
   */
  action?: true;
  /**
   * Offered to anybody Ask has anything else for, whatever page they may
   * open: it checks each answer's own page itself (`how_to`).
   */
  everyone?: true;
  /**
   * Only for managers. Planning writes the schedule, and the schedule's tables
   * still let only `current_role() = 'manager'` write (see `use-is-manager.ts`);
   * offering it to anybody else would draft a plan they could never save.
   */
  managerOnly?: boolean;
};

const dateRange = {
  from: { type: "string", description: `First day, inclusive. ${DATE}` },
  to: { type: "string", description: `Last day, inclusive. ${DATE}` },
};

const LOOKUPS: readonly ToolSpec[] = [
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
    page: "/sales",
    description: (t) =>
      `Sales in a date range: invoices on the day they were issued, less credit notes, excluding ` +
      `VAT. Group by ${lower(t.staff.one)}, ${lower(t.site.one)}, month or ` +
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
    page: "/reports",
    description: (t) =>
      `Per ${lower(t.staff.one)} in a date range: ${lower(t.job.many)} planned and done, completion ` +
      `rate, average time on site, form compliance, GPS-verified rate and overall score.`,
    parameters: () => object({ ...dateRange }),
    working: (t) => `Looking up how the ${lower(t.staff.many)} did`,
  },
  {
    name: "staff_sites",
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
    page: "/owed",
    description: (t) =>
      `Who owes the company money today, per ${lower(t.client.one)}: not yet due, 1 to 30, 31 to 60, ` +
      `61 to 90 and over 90 days overdue, total, and when they last paid.`,
    parameters: () => object({}),
    working: () => "Looking up money owed",
  },
  {
    name: "find_products",
    // For promotions, the one place an action needs products by id.
    page: "/promotions",
    description: () =>
      "Find products by part of the name, brand or code. Returns each match's id, name, brand, code and " +
      "whether it is active. Use it to get product ids for a promotion.",
    parameters: () =>
      object({
        search: { type: "string", description: "Part of a product's name, brand or code." },
      }),
    working: () => "Finding the products",
  },
  {
    name: "promotions",
    page: "/promotions",
    description: (t) =>
      `The company's promotions: id, name, dates, on or off, how many products and ${lower(t.site.many)} ` +
      `each covers, and how many were checked and are running it. With a promotion_id, the products and ` +
      `${lower(t.site.many)} it covers.`,
    parameters: () =>
      object({
        promotion_id: nullableString("One promotion's id for its products and sites, or null for the list."),
      }),
    working: () => "Looking up promotions",
  },
  {
    name: "forms",
    page: "/forms",
    description: (t) =>
      `The company's forms that ${lower(t.staff.many)} fill in: id, name, compulsory or not, archived or not, ` +
      `how many questions. With a form_id, its questions in order with their ids.`,
    parameters: () =>
      object({
        form_id: nullableString("One form's id for its questions, or null for the list."),
      }),
    working: () => "Looking up forms",
  },
  {
    name: "dashboard_cards",
    page: "/",
    description: () =>
      "This person's own dashboard: the cards on it in order, and the cards they could add, each with its id " +
      "and what it shows. Use it before changing their dashboard.",
    parameters: () => object({}),
    working: () => "Looking at your dashboard",
  },
  {
    name: "ai_changes",
    page: "/",
    managerOnly: true,
    description: () =>
      "What people at the company had the AI Manager change in a date range: who, what, when, and whether it " +
      "went through.",
    parameters: () => object({ ...dateRange }),
    working: () => "Looking up the AI Manager's changes",
  },
  {
    name: "how_to",
    page: "/",
    everyone: true,
    // The topics' ids say what each is for, so they are listed once, in the
    // enum, rather than again in the description on every round.
    description: () =>
      "The steps to do something in Tickd by hand, and the page to do it on. Use it when the person asks how " +
      "to do something, or asks you to do something you have no action for. If no topic fits, say you have no " +
      "steps for that.",
    parameters: () =>
      object({
        topic: { type: "string", enum: HELP_TOPICS.map((h) => h.id), description: "The task's id, like create-form." },
      }),
    working: () => "Finding the steps",
  },
];

export const TOOLS: readonly ToolSpec[] = [...LOOKUPS, ...ACTIONS];

export function toolSpec(name: string): ToolSpec | undefined {
  return TOOLS.find((t) => t.name === name);
}

/** Whether this person, at this company, may have the assistant run a lookup or an action. */
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

/**
 * The lookups and actions this person may use. Empty means the assistant has
 * nothing to offer them: the steps for somebody else's pages are not enough
 * to put the button on their screen.
 */
export function toolsFor(permissions: PermissionSet, modules: ModuleSet, isManager: boolean): ToolSpec[] {
  const own = TOOLS.filter((spec) => !spec.everyone && toolAllowed(spec, permissions, modules, isManager));
  return own.length === 0 ? [] : [...own, ...TOOLS.filter((spec) => spec.everyone)];
}

/**
 * Questions to start from, matched to what this person can look up.
 *
 * The first answer is one tap away: somebody who opens the panel and does not
 * know what to ask still gets something useful. One of them is something it
 * can do, so the person learns it does more than answer.
 */
export function exampleQuestions(tools: readonly ToolSpec[], t: Terms): string[] {
  const has = (n: ToolName) => tools.some((s) => s.name === n);
  const out: string[] = [];
  if (has("draft_visit_plan")) out.push(`Help me plan a ${lower(t.staff.one)}'s ${lower(t.job.many)} for next month`);
  if (has("create_promotion")) out.push("Set up a new promotion");
  else if (has("create_form")) out.push(`Make a new form for the ${lower(t.staff.many)}`);
  else if (has("change_dashboard")) out.push("Add a card to my dashboard");
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
