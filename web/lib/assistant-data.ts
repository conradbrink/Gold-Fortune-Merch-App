import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { ExportColumn, ExportSheet } from "@/lib/export";
import { parseArgs, type ToolName } from "@/lib/assistant-tools";
import type { PlanDraft } from "@/lib/assistant-stream";
import { fetchOrgSettings } from "@/lib/org-settings";
import { fetchRepStartAnchors } from "@/lib/route-order";
import {
  NO_TOWN,
  addDays,
  buildVisitPlan,
  isoWeekday,
  planMonth,
  townKey,
  townLabel,
  visitsWanted,
  wholeWeeks,
  workingDates,
  type PlanFrequency,
  type PlanSite,
} from "@/lib/visit-plan";
import { companyMidnight, companyTime } from "@/lib/company-time";
import { fetchStoreReorder, groupLabel, orderRhythm, reorderStatus, describeDue } from "@/lib/store-reorder";
import { fetchRepScorecard, formatDuration } from "@/lib/reports";
import { fetchStockOnHand, STATUS_LABELS } from "@/lib/warehouse";
import { fetchStaffHours } from "@/lib/staff-hours";
import { fetchAgeing } from "@/lib/owed";
import { lower, type Terms } from "@/lib/terms";

/**
 * The assistant's lookups, run on the server with the asker's session.
 *
 * Every read goes through the same client the pages use, signed in as the
 * person asking, so row-level security scopes it to their company and the
 * report functions apply their own permission checks. Nothing here uses the
 * service role, and nothing takes a company id from the model: there is no
 * argument that could point a lookup at somebody else's data.
 *
 * Each lookup returns two things. `model` is what the assistant reads: small,
 * already rounded, with dates in company time, so it has nothing to work out
 * and nothing to get wrong. `sheet` is the full list for the person, shown
 * under the answer and downloadable when they asked to see it
 * (`showsTable` in lib/assistant-tools.ts), so the answer can be checked
 * against the rows it came from.
 */

type Client = SupabaseClient<Database>;

export type ToolEnv = {
  supabase: Client;
  terms: Terms;
  timeZone: string;
  /** YYYY-MM-DD, company time. */
  today: string;
};

export type ToolResult = { model: unknown; sheet?: ExportSheet; plan?: PlanDraft };

/** Rows the assistant reads from one lookup. The table, when shown, has them all. */
const MODEL_ROWS = 40;

// ---------------------------------------------------------------- helpers

class LookupError extends Error {}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function day(value: unknown, label: string): string {
  if (typeof value !== "string" || !DAY.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new LookupError(`${label} must be a date written as YYYY-MM-DD.`);
  }
  return value;
}


/** Inclusive days in company time, as the instants the database compares. */
function range(args: Record<string, unknown>, env: ToolEnv): { from: Date; to: Date; label: string } {
  const from = day(args.from, "from");
  const to = day(args.to, "to");
  if (from > to) throw new LookupError("from is after to.");
  if (Date.parse(to) - Date.parse(from) > 731 * 86_400_000) {
    throw new LookupError("Ask about two years or less at a time.");
  }
  return {
    from: companyMidnight(from, env.timeZone),
    to: companyMidnight(addDays(to, 1), env.timeZone),
    label: from === to ? niceDay(from) : `${niceDay(from)} to ${niceDay(to)}`,
  };
}

function niceDay(dayText: string): string {
  return new Date(`${dayText}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function localDay(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(iso));
}

function money(n: number): number {
  return Math.round(n * 100) / 100;
}

function hours(seconds: number | null | undefined): number {
  return Math.round(((seconds ?? 0) / 3600) * 10) / 10;
}

function pct(rate: number | null | undefined): number | null {
  return rate === null || rate === undefined ? null : Math.round(Number(rate) * 100);
}

/** Text for an `ilike` filter: the characters PostgREST's `or()` grammar reads as syntax go. */
function searchText(value: unknown): string {
  return typeof value === "string" ? value.replace(/[%_,()*\\"]/g, " ").trim().slice(0, 60) : "";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function optionalId(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new LookupError(`${label} must be an id from find_sites.`);
  }
  return value;
}

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

/** People whose name contains the text, as the asker may see them. */
async function staffIds(env: ToolEnv, name: unknown): Promise<string[] | null> {
  const text = searchText(name);
  if (!text) return null;
  const { data, error } = await env.supabase
    .from("profiles")
    .select("id")
    .ilike("full_name", `%${text}%`)
    .limit(25);
  fail(error);
  const ids = (data ?? []).map((p) => p.id);
  if (ids.length === 0) {
    throw new LookupError(`Nobody's name matches "${text}". Check the spelling.`);
  }
  return ids;
}

/** Rows read for one lookup at most. Past this the lookup says so, rather than counting part. */
const MAX_ROWS = 5000;

/**
 * Every row of a query, a page at a time, up to `MAX_ROWS`.
 *
 * PostgREST answers at most a page (1000 rows here) whatever is asked, so a
 * single select silently counts only part of a big company. The query must be
 * ordered on something unique, or rows can repeat or go missing between pages.
 */
async function allRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<{ rows: T[]; capped: boolean }> {
  const PAGE = 1000;
  const rows: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    fail(error);
    const got = (data ?? []) as T[];
    rows.push(...got);
    if (got.length < PAGE) return { rows, capped: false };
  }
  return { rows, capped: true };
}

/** Every store's last check-in, paged: one row per visited store can pass 1000. */
async function lastVisits(env: ToolEnv): Promise<Map<string, string>> {
  const { rows } = await allRows<{ store_id: string; last_visit_at: string }>((a, b) =>
    env.supabase.rpc("store_last_visit").order("store_id").range(a, b)
  );
  return new Map(rows.map((l) => [l.store_id, l.last_visit_at]));
}

function sheet(
  title: string,
  filename: string,
  context: string[],
  columns: ExportColumn[],
  rows: ExportSheet["rows"]
): ExportSheet | undefined {
  return rows.length === 0 ? undefined : { title, filename: `assistant-${filename}`, context, columns, rows };
}

// ---------------------------------------------------------------- lookups

async function findSites(args: Record<string, unknown>, env: ToolEnv): Promise<ToolResult> {
  const text = searchText(args.name);
  if (!text) throw new LookupError("Give part of a name or a town.");
  const { data, error } = await env.supabase
    .from("stores")
    .select("id, name, city, active, store_groups(name)")
    .or(`name.ilike.%${text}%,city.ilike.%${text}%`)
    .order("active", { ascending: false })
    .order("name")
    .limit(11);
  fail(error);
  const found = (data ?? []).slice(0, 10);

  // The last check-in at each match and who made it. Usually one query: the
  // newest check-ins across the matches. A match a busier one crowded out of
  // that page gets its own small query, so "last" is exact either way.
  type Last = { store_id: string; checkin_at: string | null; rep: { full_name: string } | { full_name: string }[] | null };
  const last = new Map<string, Last>();
  const ids = found.map((s) => s.id);
  if (ids.length) {
    const { data: v, error: e } = await env.supabase
      .from("visits")
      .select("store_id, checkin_at, rep:profiles!visits_rep_id_fkey(full_name)")
      .in("store_id", ids)
      .not("checkin_at", "is", null)
      .order("checkin_at", { ascending: false })
      .limit(200);
    fail(e);
    for (const row of (v ?? []) as Last[]) if (!last.has(row.store_id)) last.set(row.store_id, row);
    if ((v ?? []).length === 200) {
      await Promise.all(
        ids
          .filter((id) => !last.has(id))
          .map(async (id) => {
            const { data: latest, error: e1 } = await env.supabase
              .from("visits")
              .select("store_id, checkin_at, rep:profiles!visits_rep_id_fkey(full_name)")
              .eq("store_id", id)
              .not("checkin_at", "is", null)
              .order("checkin_at", { ascending: false })
              .limit(1);
            fail(e1);
            const row = ((latest ?? []) as Last[])[0];
            if (row) last.set(id, row);
          })
      );
    }
  }

  return {
    model: {
      matches: found.map((s) => {
        const v = last.get(s.id);
        const at = v?.checkin_at ?? null;
        return {
          id: s.id,
          name: s.name,
          town: s.city,
          group: one(s.store_groups as { name: string } | { name: string }[] | null)?.name ?? null,
          active: s.active,
          last_visit_day: at ? niceDay(localDay(at, env.timeZone)) : null,
          last_visit_time: at ? companyTime(at, env.timeZone) : null,
          last_visit_by: one(v?.rep)?.full_name ?? null,
        };
      }),
      more_matches: (data ?? []).length > 10,
    },
  };
}

async function siteVisits(args: Record<string, unknown>, env: ToolEnv): Promise<ToolResult> {
  const t = env.terms;
  const r = range(args, env);
  const siteId = optionalId(args.site_id, "site_id");
  const reps = await staffIds(env, args.staff_name);

  type VisitRow = {
    checkin_at: string | null;
    checkout_at: string | null;
    duration_seconds: number | null;
    status: string;
    stores: { name: string } | { name: string }[] | null;
    rep: { full_name: string } | { full_name: string }[] | null;
  };
  const { rows: data, capped } = await allRows<VisitRow>((a, b) => {
    let q = env.supabase
      .from("visits")
      .select("id, checkin_at, checkout_at, duration_seconds, status, stores!visits_store_id_fkey(name), rep:profiles!visits_rep_id_fkey(full_name)")
      .gte("checkin_at", r.from.toISOString())
      .lt("checkin_at", r.to.toISOString())
      .order("checkin_at", { ascending: false })
      .order("id", { ascending: false })
      .range(a, b);
    if (siteId) q = q.eq("store_id", siteId);
    if (reps) q = q.in("rep_id", reps);
    return q;
  });

  const rows = data.map((v) => ({
    day: localDay(v.checkin_at, env.timeZone),
    in: companyTime(v.checkin_at, env.timeZone),
    out: companyTime(v.checkout_at, env.timeZone),
    minutes: v.duration_seconds == null ? null : Math.round(v.duration_seconds / 60),
    site: one(v.stores)?.name ?? "",
    staff: one(v.rep)?.full_name ?? "",
    status: v.status,
  }));

  const perStaff = new Map<string, number>();
  for (const row of rows) perStaff.set(row.staff, (perStaff.get(row.staff) ?? 0) + 1);

  return {
    model: {
      period: r.label,
      count: rows.length,
      ...(capped ? { only_first_rows: MAX_ROWS, note: "There were more; narrow the dates for exact counts." } : {}),
      per_staff: [...perStaff.entries()].map(([staff, count]) => ({ staff, count })),
      latest: rows.slice(0, MODEL_ROWS),
    },
    sheet: sheet(
      t.job.many,
      "visits",
      [r.label],
      [
        { header: "Day", key: "day" },
        { header: "Checked in", key: "in" },
        { header: "Checked out", key: "out" },
        { header: "Minutes", key: "minutes", numeric: true },
        { header: t.site.one, key: "site" },
        { header: t.staff.one, key: "staff" },
        { header: "Status", key: "status" },
      ],
      rows
    ),
  };
}

async function sitesNotVisited(args: Record<string, unknown>, env: ToolEnv): Promise<ToolResult> {
  const t = env.terms;
  const days = Math.min(365, Math.max(1, Math.round(Number(args.days) || 30)));
  const cutoff = addDays(env.today, -days);

  type StoreRow = { id: string; name: string; city: string | null; store_groups: { name: string } | { name: string }[] | null };
  const [stores, last] = await Promise.all([
    allRows<StoreRow>((a, b) =>
      env.supabase
        .from("stores")
        .select("id, name, city, store_groups(name)")
        .eq("active", true)
        .order("name")
        .order("id")
        .range(a, b)
    ),
    lastVisits(env),
  ]);

  const lastBy = last;
  const rows = stores.rows
    .map((s) => {
      const at = lastBy.get(s.id) ?? null;
      const lastDay = at ? localDay(at, env.timeZone) : null;
      return {
        site: s.name,
        town: s.city ?? "",
        group: one(s.store_groups)?.name ?? "",
        last: lastDay,
        days_since: lastDay ? Math.round((Date.parse(env.today) - Date.parse(lastDay)) / 86_400_000) : null,
      };
    })
    // "Not in at least N days": a visit exactly N days ago counts as missed.
    .filter((s) => s.last === null || s.last <= cutoff)
    .sort((a, b) => (b.days_since ?? Infinity) - (a.days_since ?? Infinity));

  return {
    model: {
      not_visited_in_days: days,
      active_total: stores.rows.length,
      count: rows.length,
      never_visited: rows.filter((r) => r.last === null).length,
      longest_first: rows.slice(0, MODEL_ROWS),
    },
    sheet: sheet(
      `${t.site.many} not visited in ${days} days`,
      "not-visited",
      [`As at ${niceDay(env.today)}`],
      [
        { header: t.site.one, key: "site" },
        { header: "Town", key: "town" },
        { header: t.site_group.one, key: "group" },
        { header: `Last ${lower(t.job.one)}`, key: "last" },
        { header: "Days since", key: "days_since", numeric: true },
      ],
      rows
    ),
  };
}

async function sitesDueForOrder(args: Record<string, unknown>, env: ToolEnv): Promise<ToolResult> {
  const t = env.terms;
  const town = searchText(args.town).toLowerCase();
  const all = await fetchStoreReorder(env.supabase as unknown as SupabaseClient);
  const rows = all
    .filter((r) => !town || (r.city ?? "").toLowerCase().includes(town))
    .map((r) => {
      const s = reorderStatus(r, env.today);
      return {
        site: r.store_name,
        town: r.city ?? "",
        state: s.state,
        where: groupLabel(s.state),
        due: describeDue(s),
        last_order: r.last_order_on,
        last_order_ref: r.last_order_ref,
        usually: r.usual_days === null ? "" : orderRhythm(r.usual_days),
        days_until_due: s.daysUntilDue,
      };
    });

  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.state] = (counts[r.state] ?? 0) + 1;
  const order = { due: 0, soon: 1, stopped: 2, never: 3, not_due: 4 } as const;
  const act = rows
    .filter((r) => r.state === "due" || r.state === "soon" || r.state === "stopped")
    .sort((a, b) => order[a.state] - order[b.state] || (a.days_until_due ?? 0) - (b.days_until_due ?? 0));

  return {
    model: {
      as_at: niceDay(env.today),
      town: town || null,
      counts,
      due_soon_or_stopped: act.slice(0, MODEL_ROWS).map((r) => ({ ...r, state: undefined })),
    },
    sheet: sheet(
      `${t.site.many} due for an order`,
      "due-for-order",
      [`As at ${niceDay(env.today)}`, ...(town ? [`Town: ${args.town}`] : [])],
      [
        { header: t.site.one, key: "site" },
        { header: "Town", key: "town" },
        { header: "Where it stands", key: "where" },
        { header: "Due", key: "due" },
        { header: "Last order", key: "last_order" },
        { header: "Usually orders", key: "usually" },
      ],
      act
    ),
  };
}

async function sales(args: Record<string, unknown>, env: ToolEnv): Promise<ToolResult> {
  const t = env.terms;
  const r = range(args, env);
  const siteId = optionalId(args.site_id, "site_id");
  const reps = await staffIds(env, args.staff_name);
  const groupBy = ["total", "staff", "site", "month", "product"].includes(String(args.group_by))
    ? String(args.group_by)
    : "total";

  type Row = Database["public"]["Functions"]["sales_lines"]["Returns"][number];

  // Counted exactly as the Sales page counts (`sales_documents`, which adds up
  // these same lines): invoices on the day they were issued, less credit notes
  // on theirs, excluding VAT. Paged by line so nothing repeats or drops out.
  const PAGE = 1000;
  const lines: Row[] = [];
  for (let start = 0; ; start += PAGE) {
    let q = env.supabase
      .rpc("sales_lines", { p_from: r.from.toISOString(), p_to: r.to.toISOString() })
      .order("line_id", { ascending: true })
      .range(start, start + PAGE - 1);
    if (siteId) q = q.eq("store_id", siteId);
    if (reps) q = q.in("rep_id", reps);
    const { data, error } = await q;
    fail(error);
    const page = (data ?? []) as Row[];
    lines.push(...page);
    if (page.length < PAGE) break;
  }

  // Keyed by id, not name: two branches called "Choppies" are two rows. A
  // credit note changes the money and units, not the number of invoices.
  type Group = { name: string; town: string | null; invoices: Set<string>; units: number; net: number };
  const groups = new Map<string, Group>();
  const add = (key: string, name: string, town: string | null, l: Row) => {
    const g = groups.get(key) ?? { name, town, invoices: new Set<string>(), units: 0, net: 0 };
    if (l.doc_kind !== "credit_note") g.invoices.add(l.doc_id);
    g.units += Number(l.units);
    g.net += Number(l.net);
    groups.set(key, g);
  };

  let units = 0;
  let net = 0;
  const invoices = new Set<string>();
  for (const l of lines) {
    units += Number(l.units);
    net += Number(l.net);
    if (l.doc_kind !== "credit_note") invoices.add(l.doc_id);
    if (groupBy === "staff") {
      add(l.rep_id ?? "", l.rep_name ?? `No ${lower(t.staff.one)}`, null, l);
    } else if (groupBy === "site") {
      add(l.store_id ?? "", l.store_name ?? "", l.store_city ?? null, l);
    } else if (groupBy === "month") {
      const month = l.issued_on.slice(0, 7);
      const label = new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
      add(month, label, null, l);
    } else if (groupBy === "product") {
      // QuickBooks history often names a product without linking it, and a
      // rebate or rounding row has neither: those read as typed, or "Other".
      const key = l.product_id ? `p:${l.product_id}` : l.product_name ? `d:${l.product_name}` : "other";
      add(key, l.product_name ?? "Other (no product)", null, l);
    }
  }

  // Two rows that would read the same say which town they are.
  const seen = new Map<string, number>();
  for (const g of groups.values()) seen.set(g.name, (seen.get(g.name) ?? 0) + 1);
  const list = [...groups.values()]
    .map((g) => ({
      name: (seen.get(g.name) ?? 0) > 1 && g.town ? `${g.name} (${g.town})` : g.name,
      invoices: g.invoices.size,
      units: g.units,
      sales_excl_vat: money(g.net),
    }))
    .sort((a, b) =>
      groupBy === "month" ? 0 : b.sales_excl_vat - a.sales_excl_vat
    );
  if (groupBy === "month") list.reverse();

  const byLabel: Record<string, string> = {
    staff: t.staff.one,
    site: t.site.one,
    month: "Month",
    product: "Product",
  };

  return {
    model: {
      period: r.label,
      total: { invoices: invoices.size, units, sales_excl_vat: money(net) },
      group_by: groupBy,
      groups: list.slice(0, MODEL_ROWS),
      groups_total: list.length,
    },
    sheet:
      groupBy === "total"
        ? undefined
        : sheet(
            `Sales per ${lower(byLabel[groupBy])}`,
            `sales-${groupBy}`,
            [r.label, "Invoices less credit notes, excluding VAT"],
            [
              { header: byLabel[groupBy], key: "name" },
              { header: "Invoices", key: "invoices", numeric: true },
              { header: "Units", key: "units", numeric: true },
              { header: "Sales excl. VAT", key: "sales_excl_vat", numeric: true },
            ],
            list
          ),
  };
}

const OPEN_STATUSES = ["new", "confirmed", "picking", "packed", "dispatched"];

async function ordersLookup(args: Record<string, unknown>, env: ToolEnv): Promise<ToolResult> {
  const t = env.terms;
  const siteId = optionalId(args.site_id, "site_id");
  const status = typeof args.status === "string" ? args.status : null;
  const from = args.from ? day(args.from, "from") : null;
  const to = args.to ? day(args.to, "to") : null;

  type OrderRow = {
    order_number: string;
    status: string;
    on_hold: boolean;
    created_at: string;
    delivered_at: string | null;
    stores: { name: string } | { name: string }[] | null;
    rep: { full_name: string } | { full_name: string }[] | null;
    order_lines: { qty_ordered: number; unit_price: number | null }[] | null;
  };
  const { rows: data, capped } = await allRows<OrderRow>((a, b) => {
    let q = env.supabase
      .from("orders")
      .select(
        "id, order_number, status, on_hold, created_at, delivered_at, stores(name), rep:profiles!orders_rep_id_fkey(full_name), order_lines(qty_ordered, unit_price)"
      )
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(a, b);
    if (status === "open") q = q.in("status", OPEN_STATUSES);
    else if (status && STATUS_LABELS[status]) q = q.eq("status", status);
    if (siteId) q = q.eq("store_id", siteId);
    if (from) q = q.gte("created_at", companyMidnight(from, env.timeZone).toISOString());
    if (to) q = q.lt("created_at", companyMidnight(addDays(to, 1), env.timeZone).toISOString());
    return q;
  });

  const rows = data.map((o) => ({
    order: o.order_number,
    site: one(o.stores)?.name ?? "",
    staff: one(o.rep)?.full_name ?? "",
    status: (STATUS_LABELS[o.status] ?? o.status) + (o.on_hold ? " (on hold)" : ""),
    taken: localDay(o.created_at, env.timeZone),
    delivered: localDay(o.delivered_at, env.timeZone),
    value_excl_vat: money(
      (o.order_lines ?? []).reduce((n, l) => n + l.qty_ordered * Number(l.unit_price ?? 0), 0)
    ),
  }));

  const counts: Record<string, number> = {};
  for (const o of data) counts[o.status] = (counts[o.status] ?? 0) + 1;

  const context = [
    status ? `Status: ${status === "open" ? "not yet delivered" : (STATUS_LABELS[status] ?? status)}` : "Every status",
    ...(from || to ? [`Taken ${from ? niceDay(from) : "any time"} to ${to ? niceDay(to) : "today"}`] : []),
  ];

  return {
    model: {
      count: rows.length,
      ...(capped ? { only_first_rows: MAX_ROWS, note: "There were more; narrow the dates or status for exact counts." } : {}),
      per_status: counts,
      value_excl_vat_total: money(rows.reduce((n, r) => n + r.value_excl_vat, 0)),
      value_note: "Value is what was ordered, before anything was short-picked or returned.",
      newest: rows.slice(0, MODEL_ROWS),
    },
    sheet: sheet(
      "Orders",
      "orders",
      context,
      [
        { header: "Order", key: "order" },
        { header: t.site.one, key: "site" },
        { header: t.staff.one, key: "staff" },
        { header: "Status", key: "status" },
        { header: "Taken", key: "taken" },
        { header: "Delivered", key: "delivered" },
        { header: "Value excl. VAT", key: "value_excl_vat", numeric: true },
      ],
      rows
    ),
  };
}

async function stock(args: Record<string, unknown>, env: ToolEnv): Promise<ToolResult> {
  const search = searchText(args.search);
  const lines = await fetchStockOnHand(env.supabase, {
    search: search || undefined,
    onlyBelowMin: args.only_low === true,
  });
  const rows = lines.map((l) => ({
    product: l.product_name,
    brand: l.brand,
    code: l.sku_code,
    location: l.location_name,
    on_hand: Number(l.qty_on_hand),
    packed_for_orders: Number(l.qty_reserved),
    available: Number(l.qty_available),
    damaged: Number(l.qty_damaged),
    minimum: Number(l.min_stock_level),
    below_minimum: l.is_out_of_stock ? "Out of stock" : l.is_below_min ? "Below minimum" : "",
  }));
  return {
    model: {
      search: search || null,
      only_low: args.only_low === true,
      count: rows.length,
      out_of_stock: lines.filter((l) => l.is_out_of_stock).length,
      below_minimum: lines.filter((l) => l.is_below_min).length,
      lines: rows.slice(0, MODEL_ROWS),
    },
    sheet: sheet(
      "Stock on hand",
      "stock",
      [`As at ${niceDay(env.today)}`, ...(search ? [`Matching "${search}"`] : [])],
      [
        { header: "Product", key: "product" },
        { header: "Brand", key: "brand" },
        { header: "Code", key: "code" },
        { header: "Location", key: "location" },
        { header: "On hand", key: "on_hand", numeric: true },
        { header: "Packed for orders", key: "packed_for_orders", numeric: true },
        { header: "Available", key: "available", numeric: true },
        { header: "Damaged", key: "damaged", numeric: true },
        { header: "Minimum", key: "minimum", numeric: true },
        { header: "Low", key: "below_minimum" },
      ],
      rows
    ),
  };
}

async function hoursWorked(args: Record<string, unknown>, env: ToolEnv): Promise<ToolResult> {
  const t = env.terms;
  const r = range(args, env);
  const name = searchText(args.staff_name).toLowerCase();
  const all = await fetchStaffHours(env.supabase, { from: r.from, to: r.to });
  const rows = all
    .filter((h) => !name || (h.staff_name ?? "").toLowerCase().includes(name))
    .map((h) => ({
      day: h.day,
      staff: h.staff_name ?? "",
      first_in: companyTime(h.first_in, env.timeZone),
      last_out: h.open_now ? "Still working" : companyTime(h.last_out, env.timeZone),
      hours: hours(h.workday_seconds),
      hours_on_site: hours(h.onsite_seconds),
      jobs: h.jobs,
      km: h.km == null ? null : Math.round(Number(h.km)),
    }));
  if (name && rows.length === 0 && all.length > 0) {
    throw new LookupError(`Nobody's name matches "${args.staff_name}" in that period.`);
  }

  const totals = new Map<string, { staff: string; days: number; hours: number; jobs: number }>();
  for (const row of rows) {
    const tot = totals.get(row.staff) ?? { staff: row.staff, days: 0, hours: 0, jobs: 0 };
    tot.days += 1;
    tot.hours = Math.round((tot.hours + row.hours) * 10) / 10;
    tot.jobs += row.jobs;
    totals.set(row.staff, tot);
  }

  return {
    model: {
      period: r.label,
      per_staff: [...totals.values()].sort((a, b) => b.hours - a.hours),
      working_now: rows.filter((x) => x.last_out === "Still working").map((x) => ({ staff: x.staff, since: x.first_in })),
      days: rows.slice(0, MODEL_ROWS),
    },
    sheet: sheet(
      "Hours worked",
      "hours",
      [r.label],
      [
        { header: "Day", key: "day" },
        { header: t.staff.one, key: "staff" },
        { header: "First in", key: "first_in" },
        { header: "Last out", key: "last_out" },
        { header: "Hours", key: "hours", numeric: true },
        { header: "Hours on site", key: "hours_on_site", numeric: true },
        { header: t.job.many, key: "jobs", numeric: true },
        { header: "Km", key: "km", numeric: true },
      ],
      rows
    ),
  };
}

async function teamPerformance(args: Record<string, unknown>, env: ToolEnv): Promise<ToolResult> {
  const t = env.terms;
  const r = range(args, env);
  const scores = await fetchRepScorecard(env.supabase, { from: r.from, to: r.to });
  const rows = scores.map((s) => ({
    staff: s.rep_name ?? "",
    planned: s.visits_total,
    done: s.visits_completed,
    completion_pct: pct(s.completion_rate),
    avg_time_on_site: formatDuration(s.avg_duration_seconds),
    forms_pct: pct(s.form_compliance_rate),
    gps_verified_pct: pct(s.verified_rate),
    score: s.score == null ? null : Math.round(Number(s.score)),
  }));
  return {
    model: { period: r.label, per_staff: rows },
    sheet: sheet(
      `How the ${lower(t.staff.many)} did`,
      "performance",
      [r.label],
      [
        { header: t.staff.one, key: "staff" },
        { header: "Planned", key: "planned", numeric: true },
        { header: "Done", key: "done", numeric: true },
        { header: "Completion %", key: "completion_pct", numeric: true },
        { header: "Average time on site", key: "avg_time_on_site" },
        { header: "Forms %", key: "forms_pct", numeric: true },
        { header: "GPS verified %", key: "gps_verified_pct", numeric: true },
        { header: "Score", key: "score", numeric: true },
      ],
      rows
    ),
  };
}

async function moneyOwed(_args: Record<string, unknown>, env: ToolEnv): Promise<ToolResult> {
  const t = env.terms;
  const ageing = await fetchAgeing(env.supabase, env.today);
  const rows = ageing
    .map((a) => ({
      client: a.client_name,
      not_due: money(a.not_due),
      days_1_30: money(a.days_1_30),
      days_31_60: money(a.days_31_60),
      days_61_90: money(a.days_61_90),
      over_90: money(a.days_over_90),
      total: money(a.total),
      invoices: a.invoices,
      last_paid: a.last_paid_on ?? "",
    }))
    .sort((a, b) => b.total - a.total);
  const sum = (k: keyof (typeof rows)[number]) => money(rows.reduce((n, r) => n + Number(r[k] || 0), 0));
  return {
    model: {
      as_at: niceDay(env.today),
      totals: {
        owed: sum("total"),
        not_due: sum("not_due"),
        overdue: money(sum("days_1_30") + sum("days_31_60") + sum("days_61_90") + sum("over_90")),
        over_90: sum("over_90"),
      },
      count: rows.length,
      largest_first: rows.slice(0, MODEL_ROWS),
    },
    sheet: sheet(
      "Money owed",
      "owed",
      [`As at ${niceDay(env.today)}`],
      [
        { header: t.client.one, key: "client" },
        { header: "Not due", key: "not_due", numeric: true },
        { header: "1 to 30 days", key: "days_1_30", numeric: true },
        { header: "31 to 60 days", key: "days_31_60", numeric: true },
        { header: "61 to 90 days", key: "days_61_90", numeric: true },
        { header: "Over 90 days", key: "over_90", numeric: true },
        { header: "Total", key: "total", numeric: true },
        { header: "Invoices", key: "invoices", numeric: true },
        { header: "Last paid", key: "last_paid" },
      ],
      rows
    ),
  };
}

// ---------------------------------------------------------------- planning

/** The month to plan, or a message the assistant can pass on. */
function planMonthFor(value: unknown, env: ToolEnv) {
  try {
    return planMonth(value, env.today);
  } catch (reason) {
    throw new LookupError(reason instanceof Error ? reason.message : String(reason));
  }
}

type Person = { id: string; full_name: string | null };

/**
 * The person's assigned, active sites, as the planner wants them.
 *
 * A site where somebody else is the primary person is theirs to visit, not
 * this person's: planning it for both would send two people every week.
 * `withCycleDays` counts sites with a call-cycle day set, which "Generate
 * schedule" would add on top of a plan.
 */
async function assignedSites(
  env: ToolEnv,
  staffId: string
): Promise<{ sites: PlanSite[]; othersPrimary: number; withCycleDays: number }> {
  type Store = {
    name: string;
    city: string | null;
    active: boolean;
    visit_frequency: string;
    lat: number | null;
    lng: number | null;
    geocode_source: string | null;
    location_confirmed_at: string | null;
  };
  type Row = { store_id: string; is_primary: boolean; day_of_week: number | null; stores: Store | Store[] | null };
  const { rows } = await allRows<Row>((a, b) =>
    env.supabase
      .from("store_assignments")
      .select(
        "id, store_id, is_primary, day_of_week, stores(name, city, active, visit_frequency, lat, lng, geocode_source, location_confirmed_at)"
      )
      .eq("rep_id", staffId)
      .order("id")
      .range(a, b)
  );
  const active = rows.filter((r) => one(r.stores)?.active);

  // Primaries held by somebody else, among this person's non-primary sites.
  const notMine = active.filter((r) => !r.is_primary).map((r) => r.store_id);
  const othersPrimary = new Set<string>();
  for (let i = 0; i < notMine.length; i += 100) {
    const { data, error } = await env.supabase
      .from("store_assignments")
      .select("store_id")
      .in("store_id", notMine.slice(i, i + 100))
      .eq("is_primary", true)
      .neq("rep_id", staffId);
    fail(error);
    for (const r of data ?? []) othersPrimary.add(r.store_id);
  }

  const mine = active.filter((r) => !othersPrimary.has(r.store_id));
  return {
    othersPrimary: othersPrimary.size,
    withCycleDays: mine.filter((r) => r.day_of_week !== null).length,
    sites: mine.map((r) => {
      const store = one(r.stores)!;
      return {
        id: r.store_id,
        name: store.name,
        town: store.city,
        frequency: (["weekly", "biweekly", "monthly"].includes(store.visit_frequency)
          ? store.visit_frequency
          : "weekly") as PlanFrequency,
        lat: store.lat,
        lng: store.lng,
        trusted: vouched(store),
      };
    }),
  };
}

/**
 * A location a person set or confirmed: a rep on site, a manager by hand, or
 * one confirmed on the Stores page. The same test the store review uses.
 */
function vouched(store: { geocode_source: string | null; location_confirmed_at: string | null }): boolean {
  return store.geocode_source === "rep" || store.geocode_source === "manual" || store.location_confirmed_at !== null;
}

/**
 * Every located, active store of the company, to judge where each town really
 * is: one person's few stores in a town are not enough to tell a wrong pin.
 */
async function companyLocatedSites(env: ToolEnv): Promise<PlanSite[]> {
  type Row = {
    id: string;
    name: string;
    city: string | null;
    lat: number;
    lng: number;
    geocode_source: string | null;
    location_confirmed_at: string | null;
  };
  const { rows } = await allRows<Row>((a, b) =>
    env.supabase
      .from("stores")
      .select("id, name, city, lat, lng, geocode_source, location_confirmed_at")
      .eq("active", true)
      .not("lat", "is", null)
      .not("lng", "is", null)
      .order("id")
      .range(a, b)
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    town: r.city,
    frequency: "weekly" as const,
    lat: r.lat,
    lng: r.lng,
    trusted: vouched(r),
  }));
}

/**
 * What is already on the person's schedule, over the whole weeks the two days
 * fall in: the planner judges a week whole, so a visit on Mon 30 Nov counts
 * for the week December's plan starts in.
 */
async function plannedVisits(env: ToolEnv, staffId: string, fromDay: string, toDay: string) {
  const { from, to } = wholeWeeks(fromDay, toDay);
  type Row = {
    id: string;
    store_id: string;
    scheduled_date: string;
    source: string;
    sequence_order: number | null;
    stores: { lat: number | null; lng: number | null } | { lat: number | null; lng: number | null }[] | null;
  };
  const { rows } = await allRows<Row>((a, b) =>
    env.supabase
      .from("routes")
      .select("id, store_id, scheduled_date, source, sequence_order, stores!routes_store_id_fkey(lat, lng)")
      .eq("rep_id", staffId)
      .gte("scheduled_date", from)
      .lte("scheduled_date", to)
      .order("id")
      .range(a, b)
  );
  return rows;
}

const FREQUENCY_WORDS: Record<PlanFrequency, string> = {
  weekly: "Every week",
  biweekly: "Every second week",
  monthly: "Once a month",
};

async function staffSites(args: Record<string, unknown>, env: ToolEnv): Promise<ToolResult> {
  const t = env.terms;
  const name = searchText(args.staff_name);
  if (!name) throw new LookupError("Give the person's name.");
  const m = planMonthFor(args.month, env);

  const { data: people, error } = await env.supabase
    .from("profiles")
    .select("id, full_name")
    .eq("is_active", true)
    .ilike("full_name", `%${name}%`)
    .order("full_name")
    .limit(10);
  fail(error);
  let found = (people ?? []) as Person[];
  if (found.length === 0) throw new LookupError(`Nobody's name matches "${name}". Check the spelling.`);
  // A name typed in full is that person, however many others contain it.
  const exact = found.filter((p) => (p.full_name ?? "").trim().toLowerCase() === name.toLowerCase());
  if (exact.length === 1) found = exact;
  if (found.length > 1) {
    return { model: { several_match: found.map((p) => ({ id: p.id, name: p.full_name })), note: "Ask which one." } };
  }
  const person = found[0];

  const [{ sites, othersPrimary, withCycleDays }, settings, allPlanned] = await Promise.all([
    assignedSites(env, person.id),
    fetchOrgSettings(env.supabase),
    plannedVisits(env, person.id, m.from, m.to),
  ]);
  const planned = allPlanned.filter((p) => p.scheduled_date >= m.from && p.scheduled_date <= m.to);
  const dates = workingDates(m.from, m.to, settings.workingDays, []);
  // Weeks with working days in them: a weekly site wants one visit in each.
  const weeks = new Set(dates.map((d) => addDays(d, 1 - isoWeekday(d)))).size;

  const towns = new Map<string, { town: string; sites: number; weekly: number; biweekly: number; monthly: number; visits: number }>();
  for (const s of sites) {
    const key = townKey(s.town);
    const row = towns.get(key) ?? { town: townLabel(s.town), sites: 0, weekly: 0, biweekly: 0, monthly: 0, visits: 0 };
    row.sites++;
    row[s.frequency]++;
    row.visits += visitsWanted(s.frequency, weeks);
    towns.set(key, row);
  }
  const byTown = [...towns.values()]
    .sort((a, b) => b.sites - a.sites)
    .map((r) => ({
      town: r.town,
      sites: r.sites,
      weekly: r.weekly,
      every_second_week: r.biweekly,
      monthly: r.monthly,
      visits_if_there_every_week: r.visits,
      days_needed_if_there_every_week: Math.ceil(r.visits / settings.storesPerDay),
    }));

  return {
    model: {
      staff: { id: person.id, name: person.full_name },
      month: m.label,
      plannable: { from: niceDay(m.from), to: niceDay(m.to), working_days: dates.length, weeks },
      sites_per_day: settings.storesPerDay,
      working_weekdays: settings.workingDays,
      assigned_sites: sites.length,
      towns: byTown,
      already_planned: {
        visits: planned.length,
        days: new Set(planned.map((p) => p.scheduled_date)).size,
        from_call_cycle: planned.filter((p) => p.source === "cycle").length,
        one_off: planned.filter((p) => p.source !== "cycle").length,
      },
      town_without_name: NO_TOWN,
      left_to_their_primary: othersPrimary,
      call_cycle: {
        sites_with_cycle_days: withCycleDays,
        note:
          withCycleDays > 0
            ? `They have a ${lower(t.schedule_cycle.one)}. If someone later presses Generate schedule, its ${lower(t.job.many)} are added on top of this plan.`
            : `No ${lower(t.schedule_cycle.one)} set.`,
      },
    },
    sheet: sheet(
      `${person.full_name ?? t.staff.one}'s ${lower(t.site.many)}`,
      "assigned",
      [`${sites.length} assigned`],
      [
        { header: "Town", key: "town" },
        { header: t.site.one, key: "site" },
        { header: "How often", key: "how_often" },
      ],
      sites
        .map((s) => ({ town: townLabel(s.town), site: s.name, how_often: FREQUENCY_WORDS[s.frequency] }))
        .sort((a, b) => a.town.localeCompare(b.town) || a.site.localeCompare(b.site))
    ),
  };
}

async function draftVisitPlan(args: Record<string, unknown>, env: ToolEnv): Promise<ToolResult> {
  const t = env.terms;
  const staffId = optionalId(args.staff_id, "staff_id");
  if (!staffId) throw new LookupError("staff_id is needed, from staff_sites.");
  const m = planMonthFor(args.month, env);

  const towns = (Array.isArray(args.towns) ? args.towns : [])
    .slice(0, 30)
    .map((x) => x as { town?: unknown; days?: unknown })
    .filter((x) => typeof x.town === "string" && Number.isFinite(Number(x.days)))
    .map((x) => ({ town: String(x.town).slice(0, 60), days: Math.min(31, Math.max(0, Math.round(Number(x.days)))) }));
  if (towns.length === 0) throw new LookupError("Say which towns to go to and how many days in each.");
  const daysOff = (Array.isArray(args.days_off) ? args.days_off : []).filter(
    (d): d is string => typeof d === "string" && DAY.test(d)
  );

  const { data: person, error } = await env.supabase
    .from("profiles")
    .select("id, full_name")
    .eq("id", staffId)
    .eq("is_active", true)
    .maybeSingle();
  fail(error);
  if (!person) throw new LookupError(`That ${lower(t.staff.one)} wasn't found, or is no longer active.`);

  const [{ sites }, settings, planned, reference, anchors] = await Promise.all([
    assignedSites(env, staffId),
    fetchOrgSettings(env.supabase),
    plannedVisits(env, staffId, m.from, m.to),
    companyLocatedSites(env),
    // Where they usually start the day; without it, a day starts at one end.
    fetchRepStartAnchors(env.supabase as unknown as SupabaseClient, staffId).catch(() => new Map()),
  ]);
  const plannedInMonth = planned.filter((p) => p.scheduled_date >= m.from && p.scheduled_date <= m.to).length;
  if (sites.length === 0) throw new LookupError(`They have no ${lower(t.site.many)} assigned, so there is nothing to plan.`);
  const perDay =
    typeof args.sites_per_day === "number" && args.sites_per_day >= 1
      ? Math.min(50, Math.round(args.sites_per_day))
      : settings.storesPerDay;

  const plan = buildVisitPlan({
    sites,
    towns,
    workingDays: settings.workingDays,
    sitesPerDay: perDay,
    from: m.from,
    to: m.to,
    daysOff,
    existing: planned.map((p) => {
      const at = one(p.stores);
      return { siteId: p.store_id, date: p.scheduled_date, lat: at?.lat ?? null, lng: at?.lng ?? null, sequence: p.sequence_order };
    }),
    reference,
    start: anchors.get(staffId) ?? null,
  });

  const nameOf = new Map(sites.map((s) => [s.id, s]));
  const rows = plan.days.flatMap((d) =>
    d.siteIds.map((id) => ({
      day: niceDay(d.date),
      town: d.town,
      site: nameOf.get(id)?.name ?? "",
      how_often: FREQUENCY_WORDS[nameOf.get(id)?.frequency ?? "weekly"],
    }))
  );
  const staffName = person.full_name ?? t.staff.one;
  const draft: PlanDraft = {
    staffId,
    staffName,
    month: m.month,
    monthLabel: m.label,
    days: plan.days.filter((d) => d.siteIds.length > 0).map((d) => ({ date: d.date, siteIds: d.siteIds })),
    visits: rows.length,
  };

  return {
    model: {
      staff: staffName,
      month: m.label,
      sites_per_day: perDay,
      new_visits: rows.length,
      days: plan.days.map((d) => ({
        day: niceDay(d.date),
        town: d.town,
        new_visits: d.siteIds.length,
        already_planned: d.alreadyPlanned,
      })),
      did_not_fit: plan.didNotFit.slice(0, MODEL_ROWS),
      left_for_the_other_month: plan.leftForOtherMonth,
      left_for_the_other_month_means:
        `${t.job.many} in a week the month shares with the next or last month that didn't fit on this month's days of it. Not missed.`,
      towns_given_no_days: plan.townsLeftOut,
      towns_with_no_assigned_sites: plan.unknownTowns,
      towns_short_of_days: plan.short,
      spare_working_days: plan.spareDays.map(niceDay),
      // Days are grouped by where sites are; these could not be. The counts
      // are the whole story; the names are the first few.
      sites_with_no_map_location_count: plan.noLocation.length,
      sites_with_no_map_location: plan.noLocation.slice(0, MODEL_ROWS).map((x) => `${x.name} (${x.town})`),
      map_location_far_from_its_town_count: plan.farFromTown.length,
      map_location_far_from_its_town: plan.farFromTown
        .slice(0, MODEL_ROWS)
        .map((x) => `${x.name} (${x.town}, ${x.km} km away)`),
      // Towns whose days fall in fewer of the month's whole weeks than it has:
      // their weekly sites are visited only in those weeks.
      towns_in_fewer_weeks: plan.fewerWeeks,
      already_planned_before: plannedInMonth,
      saved: false,
      note: "A draft. It is saved only when the person presses Add to schedule under it.",
    },
    sheet: sheet(
      `${t.job.many} for ${staffName}, ${m.label}`,
      "visit-plan",
      [`${rows.length} new ${lower(rows.length === 1 ? t.job.one : t.job.many)}`, `Up to ${perDay} a day`],
      [
        { header: "Day", key: "day" },
        { header: "Town", key: "town" },
        { header: t.site.one, key: "site" },
        { header: "How often", key: "how_often" },
      ],
      rows
    ),
    plan: rows.length > 0 ? draft : undefined,
  };
}

const RUN: Record<ToolName, (args: Record<string, unknown>, env: ToolEnv) => Promise<ToolResult>> = {
  find_sites: findSites,
  site_visits: siteVisits,
  sites_not_visited: sitesNotVisited,
  sites_due_for_order: sitesDueForOrder,
  sales,
  orders: ordersLookup,
  stock,
  hours_worked: hoursWorked,
  team_performance: teamPerformance,
  money_owed: moneyOwed,
  staff_sites: staffSites,
  draft_visit_plan: draftVisitPlan,
};

/**
 * Runs one lookup. Never throws: a failure becomes something the assistant can
 * tell the person, because a half-answered question is better than a crash.
 */
export async function runTool(name: ToolName, rawArgs: string, env: ToolEnv): Promise<ToolResult> {
  const args = parseArgs(rawArgs);
  if (!args) return { model: { error: "The lookup's arguments could not be read." } };
  try {
    return await RUN[name](args, env);
  } catch (reason) {
    if (reason instanceof LookupError) return { model: { error: reason.message } };
    const message = reason instanceof Error ? reason.message : String(reason);
    // 42501 from require_permission and RLS refusals: say so plainly.
    if (/permission|not allowed|42501/i.test(message)) {
      return { model: { error: "This person's access in Tickd doesn't include this." } };
    }
    console.error(`assistant: ${name} failed`, message);
    return { model: { error: "That lookup failed. Try again in a moment." } };
  }
}
