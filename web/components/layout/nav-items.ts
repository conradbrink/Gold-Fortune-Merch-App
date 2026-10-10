import {
  LayoutDashboard,
  Target,
  Store,
  Building2,
  House,
  Briefcase,
  MapPin,
  Map as MapIcon,
  Calendar,
  ClipboardList,
  BadgePercent,
  Users,
  Package,
  FileText,
  FilePen,
  Folder,
  BarChart3,
  Warehouse,
  Boxes,
  ClipboardCheck,
  Contact,
  CalendarCheck,
  CalendarOff,
  FolderLock,
  Star,
  ShieldAlert,
  ShieldCheck,
  Settings,
  Navigation,
  Receipt,
  Repeat,
  Coins,
  HandCoins,
} from "lucide-react";
import {
  can,
  canAccessPath,
  matchesPrefix,
  type PermissionCode,
  type PermissionSet,
} from "@/lib/permissions";
import { canReachPath, moduleEnabled, type ModuleSet } from "@/lib/modules";
import { DEFAULT_TERMS, type Terms } from "@/lib/terms";
import type { CompanySettings } from "@/lib/company-config";
import { switchesOf, usesPriceList } from "@/lib/money-workflow";

/**
 * The sidebar: simple navigation, deep pages.
 *
 * The sidebar shows the areas of the business (customers, the work, the team,
 * money, reports, settings), not every feature. A page that belongs to an area
 * is a tab at the top of that area's page, so it is one click away without
 * being one more line in the menu. `docs/navigation.md` maps every route to
 * its place.
 *
 * One configuration serves every trade. Labels are the company's words, the
 * modules decide which items exist, and a company with the Distribution module
 * gets the sales layout (it has orders, stock and a warehouse to find); every
 * other company gets the service layout. No route moved: only where it is
 * offered.
 */

type Label = string | ((t: Terms) => string);

/** A page: a sidebar item, or a tab inside one. */
type PageDef = {
  href: string;
  label: Label;
  /**
   * The permission this page needs.
   *
   * Presentation, not enforcement: `canAccessPath` in `lib/permissions.ts`
   * decides what is actually served, and both are required here, so a gap in
   * either makes the page quietly disappear rather than become a dead end.
   * Omitted means everyone with access to the path.
   */
  permission?: PermissionCode;
  /**
   * Shown only when the company's settings say it uses this (the money
   * switches). Without settings (a caller that only asks which pages exist)
   * the page is offered.
   */
  when?: (settings: CompanySettings, modules: ModuleSet) => boolean;
};

type ItemDef = PageDef & {
  icon: typeof LayoutDashboard;
  /** An icon chosen by the company's words, in place of `icon`. */
  iconFor?: (t: Terms) => typeof LayoutDashboard;
  /**
   * The pages that live inside this item, shown as tabs at the top of each of
   * them. The first is normally the item's own page. A tab the person cannot
   * open is left out, and the row is not drawn for a single tab.
   */
  tabs?: PageDef[];
  /** Other paths that count as being here, with no tab of their own. */
  also?: string[];
};

type GroupDef = {
  /** Null for the Dashboard, which needs no heading. */
  label: string | null;
  items: ItemDef[];
};

/** A page as resolved for one person at one company. */
export type NavPage = { href: string; label: string };

export type NavItem = {
  /**
   * Which item this is: the href it is written with. Stable whoever is
   * looking, unlike `href`, which may point at a tab (see `resolveItem`).
   */
  id: string;
  /** Where clicking it goes: its own page, or the first tab this person may open. */
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  permission?: PermissionCode;
  /** The tabs this person may open, in order. Empty or one: no tab row. */
  tabs: NavPage[];
  /** Every path prefix that highlights this item. */
  matches: string[];
};

export type NavGroup = {
  /** Null renders the items with no heading. */
  label: string | null;
  items: NavItem[];
};

/* ----------------------------------------------------------------- pages */

const DASHBOARD: ItemDef = {
  href: "/",
  label: "Dashboard",
  icon: LayoutDashboard,
  permission: "dashboard",
};

/**
 * The customer's icon follows the company's word for it: a shop front for
 * stores, a house for properties, a briefcase for clients, a pin for stops.
 */
function siteIcon(t: Terms): typeof LayoutDashboard {
  switch (t.site.one.toLowerCase()) {
    case "store":
    case "shop":
      return Store;
    case "property":
    case "home":
    case "house":
      return House;
    case "client":
    case "customer":
      return Briefcase;
    case "stop":
      return MapPin;
    default:
      return Building2;
  }
}

const SITES: ItemDef = {
  href: "/stores",
  label: (t) => t.site.many,
  icon: Building2,
  iconFor: siteIcon,
  permission: "sales_coverage",
  tabs: [
    { href: "/stores", label: (t) => t.site.many, permission: "sales_coverage" },
    // Locations that could not settle themselves. A button on the page used to
    // be the only way in.
    { href: "/stores/review", label: "Location exceptions", permission: "field_ops" },
  ],
};

const TERRITORIES: ItemDef = {
  href: "/territories",
  label: (t) => t.territory.many,
  icon: MapIcon,
  permission: "sales_coverage",
};

const LEADS: ItemDef = {
  href: "/leads",
  label: (t) => t.prospect.many,
  icon: Target,
  permission: "sales_coverage",
};

const SCHEDULE: ItemDef = {
  href: "/schedule",
  label: "Schedule",
  icon: Calendar,
  permission: "field_ops",
};

const JOBS: ItemDef = {
  // The list of the work itself, in the company's word ("Cleans", "Patrols",
  // "Visits"). It used to be reachable only from dashboard tiles, while the
  // menu offered the check-in feed as "Jobs & Activities"; the feed is now a
  // tab beside it.
  href: "/visits",
  label: (t) => t.job.many,
  icon: ClipboardList,
  permission: "field_ops",
  tabs: [
    { href: "/visits", label: (t) => t.job.many, permission: "field_ops" },
    { href: "/activities", label: "Activity", permission: "field_ops" },
    { href: "/visits/off-site", label: "Off-site check-ins", permission: "field_ops" },
  ],
};

const TRACKING: ItemDef = {
  // Gated by `insights`, not `field_ops`: `location_pings` and `visits` are
  // readable by the manager role only, so anyone else would be shown an empty
  // map that looks like nobody is working.
  href: "/tracking",
  label: "Tracking",
  icon: Navigation,
  permission: "insights",
  tabs: [
    { href: "/tracking", label: "Live map", permission: "insights" },
    // Where the vehicles went and how far: the same question as the map, a
    // day later.
    { href: "/logbook", label: "Vehicle logbook", permission: "insights" },
  ],
};

const PROMOTIONS: ItemDef = {
  href: "/promotions",
  label: "Promotions",
  icon: BadgePercent,
  permission: "field_ops",
};

const STAFF: ItemDef = {
  href: "/representatives",
  label: (t) => t.staff.many,
  icon: Users,
  permission: "team",
};

const ORDERS: ItemDef = {
  href: "/orders",
  label: "Orders",
  icon: ClipboardCheck,
  permission: "warehouse",
};

const QUOTES: ItemDef = {
  href: "/quotes",
  label: "Quotes",
  icon: FilePen,
  permission: "invoicing",
};

const PRODUCTS: ItemDef = {
  // Keeps `resources`, not `warehouse`: moving an item between groups changes
  // where it appears, not who may open it.
  href: "/products",
  label: "Products",
  icon: Package,
  permission: "resources",
};

const INVENTORY: ItemDef = {
  href: "/inventory",
  label: "Inventory",
  icon: Boxes,
  permission: "warehouse",
};

const WAREHOUSE: ItemDef = {
  // The dispatch and delivery board: what is waiting, moving and outstanding.
  href: "/warehouse",
  label: "Warehouse",
  icon: Warehouse,
  permission: "warehouse",
};

const RECURRING_ORDERS: ItemDef = {
  href: "/recurring-orders",
  label: "Recurring orders",
  icon: Repeat,
  permission: "warehouse",
};

const INVOICES: ItemDef = {
  href: "/invoices",
  label: "Invoices",
  icon: Receipt,
  permission: "invoicing",
  tabs: [
    { href: "/invoices", label: "Invoices", permission: "invoicing" },
    {
      href: "/contracts",
      label: "Contracts",
      permission: "invoicing",
      when: (s) => s.money_contracts,
    },
    { href: "/statements", label: "Statements", permission: "invoicing" },
    {
      href: "/price-list",
      label: "Price list",
      permission: "invoicing",
      when: (s, m) => usesPriceList(switchesOf(s), m),
    },
  ],
};

const OWED: ItemDef = {
  href: "/owed",
  label: "Who owes you",
  icon: HandCoins,
  permission: "invoicing",
};

const COMMISSIONS: ItemDef = {
  // Pay information about colleagues: manager-only, as it was under Insights.
  href: "/commissions",
  label: "Commissions",
  icon: Coins,
  permission: "insights",
};

const REPORTS: ItemDef = {
  href: "/reports",
  label: "Reports",
  icon: BarChart3,
  permission: "insights",
  // Each report page is a tab here rather than a line in the menu. The
  // reports inside the Reports page follow the company's trade
  // (`lib/report-catalogue.ts`). One person's full report
  // (`/reports/rep-performance`) opens from their name on Team or the
  // Performance summary, and counts as Reports.
  tabs: [
    { href: "/reports", label: "Reports", permission: "insights" },
    { href: "/sales", label: "Sales", permission: "insights" },
    { href: "/targets", label: "Targets", permission: "insights" },
    { href: "/warehouse/insights", label: "Warehouse insights", permission: "insights" },
  ],
};

/**
 * The HR module. The HR overview is a tab on Employees rather than a second
 * dashboard in the menu: the Dashboard stays the one place to start.
 */
const HR_ITEMS: ItemDef[] = [
  {
    href: "/hr/employees",
    label: "Employees",
    icon: Contact,
    permission: "hr",
    tabs: [
      { href: "/hr/employees", label: "Employees", permission: "hr" },
      { href: "/hr", label: "Overview", permission: "hr" },
    ],
  },
  { href: "/hr/attendance", label: "Attendance", icon: CalendarCheck, permission: "hr" },
  { href: "/hr/leave", label: "Leave", icon: CalendarOff, permission: "hr" },
  { href: "/hr/performance", label: "Performance", icon: Star, permission: "hr" },
  { href: "/hr/documents", label: "Documents", icon: FolderLock, permission: "hr" },
  { href: "/hr/disciplinary", label: "Disciplinary", icon: ShieldAlert, permission: "hr" },
];

const PEOPLE_AND_PERMISSIONS: ItemDef = {
  href: "/settings/users",
  label: "People & permissions",
  icon: ShieldCheck,
  permission: "admin",
};

const COMPANY_SETTINGS: ItemDef = {
  href: "/settings/company",
  label: "Company settings",
  icon: Settings,
  permission: "company_settings",
  // Every kind of setting in one place. Each tab keeps its own permission: an
  // HR manager reaches HR settings here, and a warehouse clerk the warehouse
  // setup (suppliers, drivers, vehicles), exactly as before; the item opens
  // whichever of them they may see first.
  tabs: [
    { href: "/settings/company", label: "Company", permission: "company_settings" },
    { href: "/hr/settings", label: "HR", permission: "hr_settings" },
    { href: "/warehouse/settings", label: "Warehouse", permission: "warehouse" },
  ],
  also: ["/plans"],
};

const FORMS: ItemDef = { href: "/forms", label: "Forms", icon: FileText, permission: "resources" };
const FILES: ItemDef = { href: "/files", label: "Files", icon: Folder, permission: "resources" };

/* --------------------------------------------------------------- layouts */

const PEOPLE: GroupDef = { label: "People", items: HR_ITEMS };
const ADMIN: GroupDef = { label: "Admin", items: [PEOPLE_AND_PERMISSIONS, COMPANY_SETTINGS] };
const RESOURCES: GroupDef = { label: "Resources", items: [FORMS, FILES] };
// "Reports" over a single "Reports" says nothing the item does not, so the
// item stands alone, like the Dashboard.
const REPORTS_GROUP: GroupDef = { label: null, items: [REPORTS] };

/**
 * Cleaning, garden, plumbing, installation, maintenance, security, pest
 * control, pool, delivery and general: who the customers are, today's work,
 * the team, the money, how it went, and the company.
 */
const SERVICE_LAYOUT: GroupDef[] = [
  { label: null, items: [DASHBOARD] },
  { label: "Customers", items: [SITES, TERRITORIES] },
  { label: "Operations", items: [SCHEDULE, JOBS, TRACKING] },
  { label: "Team", items: [STAFF] },
  { label: "Finance", items: [QUOTES, INVOICES, OWED] },
  REPORTS_GROUP,
  PEOPLE,
  ADMIN,
  RESOURCES,
];

/**
 * Distribution and FMCG: the same areas, plus the stock and the orders that a
 * company selling its own products has to find.
 */
const DISTRIBUTION_LAYOUT: GroupDef[] = [
  { label: null, items: [DASHBOARD] },
  { label: "Sales", items: [SITES, LEADS, ORDERS, QUOTES, PROMOTIONS] },
  { label: "Field team", items: [SCHEDULE, JOBS, TRACKING, STAFF, TERRITORIES] },
  { label: "Inventory", items: [PRODUCTS, INVENTORY, WAREHOUSE, RECURRING_ORDERS] },
  { label: "Finance", items: [INVOICES, OWED, COMMISSIONS] },
  REPORTS_GROUP,
  PEOPLE,
  ADMIN,
  RESOURCES,
];

export function layoutFor(modules: ModuleSet): GroupDef[] {
  return moduleEnabled(modules, "distribution") ? DISTRIBUTION_LAYOUT : SERVICE_LAYOUT;
}

/** Every item in either layout, once: for checks that ask what exists. */
export const allItemDefs: readonly ItemDef[] = [
  ...new Set([...SERVICE_LAYOUT, ...DISTRIBUTION_LAYOUT].flatMap((g) => g.items)),
];

/* ------------------------------------------------------------- resolving */

function text(label: Label, terms: Terms): string {
  return typeof label === "function" ? label(terms) : label;
}

function offered(
  page: PageDef,
  permissions: PermissionSet,
  modules: ModuleSet,
  settings: CompanySettings | undefined
): boolean {
  return (
    (page.permission === undefined || can(permissions, page.permission)) &&
    canAccessPath(permissions, page.href) &&
    canReachPath(modules, page.href) &&
    (page.when === undefined || settings === undefined || page.when(settings, modules))
  );
}

/**
 * The item as this person sees it, or null when there is nothing in it they
 * may open. When its own page is closed to them but a tab is open, the item
 * leads to that tab: an HR manager's "Company settings" opens HR settings.
 */
function resolveItem(
  item: ItemDef,
  permissions: PermissionSet,
  modules: ModuleSet,
  terms: Terms,
  settings: CompanySettings | undefined
): NavItem | null {
  const tabs = (item.tabs ?? [])
    .filter((tab) => offered(tab, permissions, modules, settings))
    .map((tab) => ({ href: tab.href, label: text(tab.label, terms) }));
  const ownPage = offered(item, permissions, modules, settings);
  const href = ownPage ? item.href : tabs[0]?.href;
  if (href === undefined) return null;
  return {
    id: item.href,
    href,
    label: text(item.label, terms),
    icon: item.iconFor ? item.iconFor(terms) : item.icon,
    permission: item.permission,
    tabs,
    matches: [...new Set([item.href, ...tabs.map((t) => t.href), ...(item.also ?? [])])],
  };
}

/**
 * The groups this person should be shown, with empty groups dropped.
 *
 * The `permission` field says what we intend to offer; `canAccessPath` says
 * what the proxy will actually serve. Requiring both means the two can never
 * drift into offering a link that bounces.
 */
export function visibleNavGroups(
  permissions: PermissionSet,
  // The company's modules. A page whose module is off is not offered, whatever
  // the person's permissions. Which module a page belongs to comes from its
  // path (`moduleForPath`), the same map the proxy uses.
  modules: ModuleSet,
  // The company's words for the labels. Defaulted so a caller that only asks
  // which pages are offered need not care what they are called.
  terms: Terms = DEFAULT_TERMS,
  settings?: CompanySettings
): NavGroup[] {
  return layoutFor(modules)
    .map((group) => ({
      label: group.label,
      items: group.items
        .map((item) => resolveItem(item, permissions, modules, terms, settings))
        .filter((item): item is NavItem => item !== null),
    }))
    .filter((group) => group.items.length > 0);
}

/** Every page the menu leads to, items and tabs alike. */
export function reachablePages(groups: NavGroup[]): NavPage[] {
  const seen = new Map<string, NavPage>();
  for (const item of groups.flatMap((g) => g.items)) {
    seen.set(item.href, { href: item.href, label: item.label });
    for (const tab of item.tabs) if (!seen.has(tab.href)) seen.set(tab.href, tab);
  }
  return [...seen.values()];
}

/** Pages reached from the profile menu rather than the sidebar. */
const OUTSIDE_THE_MENU = ["/hr/me"];

/**
 * The item that counts as "where you are", or null.
 *
 * Longest match wins, and that is the whole point: `/warehouse/insights` is a
 * Reports tab and `/warehouse/settings` a Company settings tab, while
 * `/warehouse` is the Warehouse item; a plain `startsWith` would light up two
 * items at once. `/` is matched exactly, or it prefixes every path in the app.
 */
export function activeItem(groups: NavGroup[], pathname: string): NavItem | null {
  // My HR is in the profile menu, so no sidebar item is "here", though its
  // path sits under the HR overview's.
  if (OUTSIDE_THE_MENU.some((p) => matchesPrefix(pathname, p))) return null;
  let best: { item: NavItem; length: number } | null = null;
  for (const item of groups.flatMap((g) => g.items)) {
    for (const prefix of item.matches) {
      const hit = prefix === "/" ? pathname === "/" : matchesPrefix(pathname, prefix);
      if (hit && (best === null || prefix.length > best.length)) best = { item, length: prefix.length };
    }
  }
  return best?.item ?? null;
}

/**
 * The tab row for this page: the active item's tabs, when there are at least
 * two and this page is one of them. A detail page (one invoice, one employee)
 * has its own way back and no row.
 */
export function tabsFor(groups: NavGroup[], pathname: string): { tabs: NavPage[]; current: string } | null {
  const item = activeItem(groups, pathname);
  if (!item || item.tabs.length < 2) return null;
  const current = item.tabs.find((t) => t.href === pathname);
  return current ? { tabs: item.tabs, current: current.href } : null;
}

/**
 * The destinations the phone's bottom bar offers, in order of use: the day's
 * work first, then the customers and the team. Somebody who has none of those
 * (an HR manager, a warehouse clerk) gets the first places in their own menu
 * instead. Four at most; "More" opens the full menu.
 */
const MOBILE_PRIORITY = ["/", "/visits", "/schedule", "/stores", "/representatives", "/reports"];

export function mobilePrimary(groups: NavGroup[]): NavItem[] {
  const items = groups.flatMap((g) => g.items);
  const chosen = MOBILE_PRIORITY.map((id) => items.find((i) => i.id === id)).filter(
    (i): i is NavItem => i !== undefined
  );
  for (const item of items) {
    if (chosen.length >= 4) break;
    if (!chosen.includes(item)) chosen.push(item);
  }
  return chosen.slice(0, 4);
}
