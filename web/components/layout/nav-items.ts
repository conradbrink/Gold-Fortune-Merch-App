import {
  LayoutDashboard,
  Target,
  Store,
  Map as MapIcon,
  Calendar,
  ClipboardList,
  BadgePercent,
  Users,
  Package,
  FileText,
  Folder,
  BarChart3,
  Gauge,
  TrendingUp,
  Warehouse,
  Boxes,
  ClipboardCheck,
  Settings2,
  PieChart,
  Contact,
  CalendarCheck,
  CalendarOff,
  FolderLock,
  Star,
  ShieldAlert,
  SlidersHorizontal,
  UserRound,
  UserCheck,
  ShieldCheck,
  Building2,
  Navigation,
  Receipt,
  Repeat,
  Flag,
  Coins,
  HandCoins,
  Tags,
} from "lucide-react";
import {
  can,
  canAccessPath,
  type PermissionCode,
  type PermissionSet,
} from "@/lib/permissions";
import { canReachPath, type ModuleSet } from "@/lib/modules";
import { DEFAULT_TERMS, type Terms } from "@/lib/terms";

export type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /**
   * The permission this destination needs.
   *
   * Presentation, not enforcement: `canAccessPath` in `lib/permissions.ts`
   * decides what is actually served, and `visibleNavGroups` requires both — so
   * forgetting one here makes an item quietly disappear rather than become a
   * dead end. Omitted means everyone, which is true of exactly one item.
   */
  permission?: PermissionCode;
};

/**
 * An item as written below: a label that names one of the company's things
 * (stores, visits, reps) is a function of its words, so a cleaning company's
 * menu says "Sites" where Gold Fortune's says "Stores". `visibleNavGroups`
 * resolves it; everything after that sees a plain string.
 */
type NavItemDef = Omit<NavItem, "label"> & {
  label: string | ((t: Terms) => string);
};

type NavGroupDef = {
  label: string | null;
  items: NavItemDef[];
};

/**
 * The sidebar, grouped by what a person came to do.
 *
 * A flat list of eleven destinations made the reader scan the whole thing every
 * time; the groups are the questions the app answers — who are we selling to,
 * what is happening in the field, who does it, what they need, and what came of
 * it.
 *
 * Dashboard sits outside the groups on purpose. It is the landing page and the
 * only item that is not part of a workflow, and putting it under a heading of
 * its own ("Overview") would give a one-item group a label that says less than
 * the item does.
 */
export type NavGroup = {
  /** Null renders the items with no heading — used for Dashboard and My HR. */
  label: string | null;
  items: NavItem[];
};

export const navGroups: NavGroupDef[] = [
  {
    label: null,
    items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard" }],
  },
  {
    // Directly under Dashboard, because it answers the same question at the
    // same altitude: the dashboard is today, this is the trend behind it. It
    // used to sit last, below Resources, which put the reporting a manager
    // opens daily underneath the files they open monthly.
    //
    // Manager-only throughout, by the `roles` default. Every item here is
    // management information about a colleague — revenue by rep, fulfilment
    // time by clerk — and `canAccessPath` refuses all three for the other
    // roles, so the menu hiding them is the second guard rather than the only
    // one.
    label: "Insights",
    items: [
      { href: "/sales", label: "Sales", icon: TrendingUp, permission: "insights" },
      { href: "/reports", label: "Reports", icon: BarChart3, permission: "insights" },
      // Directly under Reports, because it is one: the same visits, orders and
      // audits, cut to one rep and one period and laid out for printing rather
      // than for browsing. `canAccessPath` resolves `/reports/rep-performance`
      // through the `/reports` prefix, so it needs no entry of its own there.
      {
        href: "/reports/rep-performance",
        label: (t) => `${t.staff.one} performance`,
        icon: UserCheck,
        permission: "insights",
      },
      // Moved out of Warehouse & Fulfilment. It reads as warehouse work
      // because of its URL, but it ranks staff by fulfilment time and
      // accuracy — which is the same kind of thing as Sales, and not the
      // day-to-day "what is going out today?" the rest of that group answers.
      // Its own icon rather than Reports' bar chart: the two sat adjacent with
      // the same glyph, which read as one entry duplicated. A gauge also says
      // what it is — fulfilment speed and accuracy, not another report.
      { href: "/warehouse/insights", label: "Warehouse insights", icon: Gauge, permission: "insights" },
      // Targets and commissions are pay and performance information about
      // colleagues, so they sit with the rest of the manager-only reporting.
      // A rep's own figures reach them through RLS, not through these pages.
      { href: "/targets", label: "Targets", icon: Flag, permission: "insights" },
      { href: "/commissions", label: "Commissions", icon: Coins, permission: "insights" },
    ],
  },
  {
    label: "Sales & Coverage",
    items: [
      { href: "/leads", label: (t) => t.prospect.many, icon: Target, permission: "sales_coverage" },
      { href: "/stores", label: (t) => t.site.many, icon: Store, permission: "sales_coverage" },
      { href: "/territories", label: (t) => t.territory.many, icon: MapIcon, permission: "sales_coverage" },
    ],
  },
  {
    label: "Field Operations",
    items: [
      { href: "/schedule", label: "Schedule", icon: Calendar, permission: "field_ops" },
      // Gated by `insights`, not `field_ops`: `location_pings` and `visits`
      // are readable by the manager role only, so anyone else would be shown
      // an empty map that looks like nobody is working.
      { href: "/tracking", label: "Tracking", icon: Navigation, permission: "insights" },
      {
        // One destination, two names in the old menu. The feed is where a
        // manager starts, and the per-visit drill-down hangs off it.
        href: "/activities",
        label: (t) => `${t.job.many} & Activities`,
        icon: ClipboardList,
        permission: "field_ops",
      },
      { href: "/promotions", label: "Promotions", icon: BadgePercent, permission: "field_ops" },
    ],
  },
  {
    // Quotes, invoices and who owes you, for every trade (Stage 7). Above the
    // warehouse: getting paid is a daily question for every company, and a
    // trade without a warehouse sees this group and not that one.
    label: "Money",
    items: [
      { href: "/quotes", label: "Quotes", icon: FileText, permission: "invoicing" },
      { href: "/invoices", label: "Invoices", icon: Receipt, permission: "invoicing" },
      { href: "/owed", label: "Who owes you", icon: HandCoins, permission: "invoicing" },
      { href: "/price-list", label: "Price list", icon: Tags, permission: "invoicing" },
    ],
  },
  {
    // The warehouse clerk's whole job, and the only group they see in full.
    // It sits above Team because for a manager it is a daily operational
    // question ("what is going out today?") rather than a reference one.
    label: "Warehouse & Fulfilment",
    items: [
      {
        href: "/warehouse",
        label: "Warehouse",
        icon: Warehouse,
        permission: "warehouse",
      },
      {
        href: "/orders",
        label: "Orders",
        icon: ClipboardCheck,
        permission: "warehouse",
      },
      // Beside Orders: a recurring order places orders. Same people, same
      // permission. Invoices and quotes moved to Money (Stage 7).
      { href: "/recurring-orders", label: "Recurring orders", icon: Repeat, permission: "warehouse" },
      {
        href: "/inventory",
        label: "Inventory",
        icon: Boxes,
        permission: "warehouse",
      },
      // Moved out of Resources, and it belongs here: Inventory is how much of
      // a line is in the building, Products is what the line *is* — price,
      // pack size, code — and the two are read together and edited together.
      //
      // ⚠️ It keeps `resources`, not `warehouse`. Moving an item between
      // groups is a change to where it appears, not to who may open it: the
      // group heading grants nothing, `visibleNavGroups` filters per item, and
      // `canAccessPath` still refuses `/products` to anyone without
      // `resources`. A clerk who could not open Products yesterday still
      // cannot see it here today.
      {
        href: "/products",
        label: "Products",
        icon: Package,
        permission: "resources",
      },
      // Reachable by clerks on purpose: adding the driver who started this
      // morning should not wait for a manager, and RLS already permits it. The
      // manager-only tabs inside are gated by the page and by RLS.
      {
        href: "/warehouse/settings",
        label: "Warehouse setup",
        icon: Settings2,
        permission: "warehouse",
      },
    ],
  },
  {
    // "Sales Team", not "Team". The old heading sat a few inches above a Human
    // Resources group containing "Employees" and gave no signal about which of
    // the two answered which question — they are the same five people described
    // two different ways.
    //
    // The names now carry that: Employees is the employment record — department,
    // manager, contract, status. This is field coverage — who covers which store,
    // and when they were last out. Neither set of columns appears on the other
    // page, which is why folding one into the other would lose something rather
    // than tidy something.
    label: "Sales Team",
    items: [
      // The company's word for its people. Gold Fortune's is "Reps", which
      // replaced the longer "Representatives" here on purpose (Stage 3).
      { href: "/representatives", label: (t) => t.staff.many, icon: Users, permission: "team" },
    ],
  },
  {
    // The whole HR module, and the only group an `hr_manager` account sees.
    //
    // Eight destinations under one heading rather than a collapsing sub-menu:
    // the sidebar has no nesting today, and adding a second interaction model
    // for one group would make HR the odd section rather than a section. The
    // group heading does the work the parent item would have done.
    label: "Human Resources",
    items: [
      { href: "/hr", label: "HR dashboard", icon: PieChart, permission: "hr" },
      { href: "/hr/employees", label: "Employees", icon: Contact, permission: "hr" },
      { href: "/hr/attendance", label: "Attendance", icon: CalendarCheck, permission: "hr" },
      { href: "/hr/leave", label: "Leave", icon: CalendarOff, permission: "hr" },
      { href: "/hr/documents", label: "Documents", icon: FolderLock, permission: "hr" },
      { href: "/hr/performance", label: "Performance", icon: Star, permission: "hr" },
      { href: "/hr/disciplinary", label: "Disciplinary", icon: ShieldAlert, permission: "hr" },
      { href: "/hr/settings", label: "HR settings", icon: SlidersHorizontal, permission: "hr_settings" },
    ],
  },
  {
    // Everybody, including a rep who otherwise never sees this shell. Its own
    // group rather than an entry under Human Resources, because for three of
    // the four roles it is the only HR destination there is, and a lone item
    // under a heading called "Human Resources" would read as a module they had
    // been given and could not open.
    //
    // Directly under Human Resources and above Administration: for anyone who
    // holds `hr` it now sits with the module it belongs to, and for everyone
    // else it is the last thing before the administrator-only section rather
    // than something below it.
    label: null,
    items: [
      {
        href: "/hr/me",
        label: "My HR",
        icon: UserRound,
        // The one destination with no permission: a person's own record.
      },
    ],
  },
  {
    // Reachable only by an administrator, and deliberately in the sidebar
    // rather than behind the top-bar gear: who can see what is a thing people
    // go looking for, and a settings icon is where features go to be lost.
    label: "Administration",
    items: [
      {
        href: "/settings/users",
        label: "Users & permissions",
        icon: ShieldCheck,
        permission: "admin",
      },
      {
        href: "/settings/company",
        label: "Company profile",
        icon: Building2,
        permission: "company_settings",
      },
    ],
  },
  {
    // Products used to head this group; it now sits with Inventory under
    // Warehouse & Fulfilment. What is left is the two reference destinations —
    // the forms reps fill in and the files they are given.
    label: "Resources",
    items: [
      { href: "/forms", label: "Forms", icon: FileText, permission: "resources" },
      { href: "/files", label: "Files", icon: Folder, permission: "resources" },
    ],
  },
];

/** Flat list, for anything that only needs the destinations. */
export const navItems: NavItemDef[] = navGroups.flatMap((g) => g.items);

/**
 * The one destination that counts as "where you are", or null.
 *
 * Longest match wins, and that is the whole point: `/warehouse/insights` starts
 * with `/warehouse`, so a plain `startsWith` per item lights up two entries at
 * once. That was survivable while both sat in the same group and merely looked
 * untidy; with Insights lifted to the top it would highlight in two separate
 * groups and claim you are in two places.
 *
 * `/` is matched exactly, or it prefixes every path in the app.
 */
export function activeHref(pathname: string): string | null {
  let best: string | null = null;
  for (const item of navItems) {
    const hit =
      item.href === "/"
        ? pathname === "/"
        : pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (hit && (best === null || item.href.length > best.length)) best = item.href;
  }
  return best;
}

/**
 * The groups this role should be shown, with empty groups dropped.
 *
 * The `permission` field says what we *intend* to offer; `canAccessPath` says
 * what the proxy will actually serve. Requiring both means the two can never
 * drift into offering a link that bounces: get the path map wrong and the item
 * quietly disappears from the menu rather than becoming a dead end.
 */
export function visibleNavGroups(
  permissions: PermissionSet,
  // The company's modules. A destination whose module is off is not offered,
  // whatever the person's permissions: the proxy would only explain that it is
  // not part of the plan. Which module an item belongs to comes from its path
  // (`moduleForPath`), the same map the proxy uses, so the two cannot drift.
  modules: ModuleSet,
  // The company's words for the labels. Defaulted so a caller that only asks
  // which destinations are offered need not care what they are called.
  terms: Terms = DEFAULT_TERMS
): NavGroup[] {
  return navGroups
    .map((group) => ({
      label: group.label,
      items: group.items
        .filter(
          (item) =>
            (item.permission === undefined || can(permissions, item.permission)) &&
            canAccessPath(permissions, item.href) &&
            canReachPath(modules, item.href)
        )
        .map((item) => ({
          ...item,
          label: typeof item.label === "function" ? item.label(terms) : item.label,
        })),
    }))
    .filter((group) => group.items.length > 0);
}
