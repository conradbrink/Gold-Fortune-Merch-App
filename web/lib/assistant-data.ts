import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { ExportColumn, ExportSheet } from "@/lib/export";
import type { ToolName } from "@/lib/assistant-tools";
import { companyMidnight } from "@/lib/company-time";
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
 * under the answer and downloadable, so the answer can be checked against the
 * rows it came from.
 */

type Client = SupabaseClient<Database>;

export type ToolEnv = {
  supabase: Client;
  terms: Terms;
  timeZone: string;
  /** YYYY-MM-DD, company time. */
  today: string;
};

export type ToolResult = { model: unknown; sheet?: ExportSheet };

/** Rows the assistant reads from one lookup. The table shows them all. */
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

function addDays(dayText: string, n: number): string {
  const d = new Date(`${dayText}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
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

function localTime(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  });
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
  return typeof value === "string" ? value.replace(/[%_,()*\\]/g, " ").trim().slice(0, 60) : "";
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

  // The last time somebody checked in at each, and who. One small query per
  // match keeps "last" exact however often a busy one is visited.
  const last = await Promise.all(
    found.map(async (s) => {
      const { data: v, error: e } = await env.supabase
        .from("visits")
        .select("checkin_at, rep:profiles!visits_rep_id_fkey(full_name)")
        .eq("store_id", s.id)
        .not("checkin_at", "is", null)
        .order("checkin_at", { ascending: false })
        .limit(1);
      fail(e);
      return one(v);
    })
  );

  return {
    model: {
      matches: found.map((s, i) => {
        const v = last[i];
        return {
          id: s.id,
          name: s.name,
          town: s.city,
          group: one(s.store_groups as { name: string } | { name: string }[] | null)?.name ?? null,
          active: s.active,
          last_visit_day: v?.checkin_at ? niceDay(localDay(v.checkin_at, env.timeZone)) : null,
          last_visit_time: v?.checkin_at ? localTime(v.checkin_at, env.timeZone) : null,
          last_visit_by: one(v?.rep as { full_name: string } | { full_name: string }[] | null)?.full_name ?? null,
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

  let q = env.supabase
    .from("visits")
    .select("checkin_at, checkout_at, duration_seconds, status, stores!visits_store_id_fkey(name), rep:profiles!visits_rep_id_fkey(full_name)")
    .gte("checkin_at", r.from.toISOString())
    .lt("checkin_at", r.to.toISOString())
    .order("checkin_at", { ascending: false })
    .limit(1000);
  if (siteId) q = q.eq("store_id", siteId);
  if (reps) q = q.in("rep_id", reps);
  const { data, error } = await q;
  fail(error);

  const rows = (data ?? []).map((v) => ({
    day: localDay(v.checkin_at, env.timeZone),
    in: localTime(v.checkin_at, env.timeZone),
    out: localTime(v.checkout_at, env.timeZone),
    minutes: v.duration_seconds == null ? null : Math.round(v.duration_seconds / 60),
    site: one(v.stores as { name: string } | { name: string }[] | null)?.name ?? "",
    staff: one(v.rep as { full_name: string } | { full_name: string }[] | null)?.full_name ?? "",
    status: v.status,
  }));

  const perStaff = new Map<string, number>();
  for (const row of rows) perStaff.set(row.staff, (perStaff.get(row.staff) ?? 0) + 1);

  return {
    model: {
      period: r.label,
      count: rows.length,
      capped_at_1000: rows.length === 1000,
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

  const [stores, last] = await Promise.all([
    env.supabase.from("stores").select("id, name, city, store_groups(name)").eq("active", true).order("name"),
    env.supabase.rpc("store_last_visit"),
  ]);
  fail(stores.error);
  fail(last.error);

  const lastBy = new Map((last.data ?? []).map((l) => [l.store_id, l.last_visit_at]));
  const rows = (stores.data ?? [])
    .map((s) => {
      const at = lastBy.get(s.id) ?? null;
      const lastDay = at ? localDay(at, env.timeZone) : null;
      return {
        site: s.name,
        town: s.city ?? "",
        group: one(s.store_groups as { name: string } | { name: string }[] | null)?.name ?? "",
        last: lastDay,
        days_since: lastDay ? Math.round((Date.parse(env.today) - Date.parse(lastDay)) / 86_400_000) : null,
      };
    })
    .filter((s) => s.last === null || s.last < cutoff)
    .sort((a, b) => (b.days_since ?? Infinity) - (a.days_since ?? Infinity));

  return {
    model: {
      not_visited_in_days: days,
      active_total: (stores.data ?? []).length,
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

  type Row = {
    id: string;
    delivered_at: string;
    stores: { name: string } | { name: string }[] | null;
    rep: { full_name: string } | { full_name: string }[] | null;
    order_lines:
      | {
          qty_delivered: number;
          qty_returned: number;
          unit_price: number | null;
          products: { name: string } | { name: string }[] | null;
        }[]
      | null;
  };

  // Counted and valued exactly as the Sales page does (`lib/sales.ts`): on the
  // day it was delivered, on what arrived less what came back, excluding VAT.
  const PAGE = 1000;
  const orders: Row[] = [];
  for (let start = 0; ; start += PAGE) {
    let q = env.supabase
      .from("orders")
      .select(
        `id, delivered_at, stores(name), rep:profiles!orders_rep_id_fkey(full_name),
         order_lines(qty_delivered, qty_returned, unit_price, products(name))`
      )
      .eq("status", "delivered")
      .gte("delivered_at", r.from.toISOString())
      .lt("delivered_at", r.to.toISOString())
      .order("delivered_at", { ascending: false })
      .order("id", { ascending: false })
      .range(start, start + PAGE - 1);
    if (siteId) q = q.eq("store_id", siteId);
    if (reps) q = q.in("rep_id", reps);
    const { data, error } = await q;
    fail(error);
    const page = (data ?? []) as unknown as Row[];
    orders.push(...page);
    if (page.length < PAGE) break;
  }

  type Group = { name: string; orders: Set<string>; units: number; net: number };
  const groups = new Map<string, Group>();
  const add = (key: string, orderId: string, units: number, net: number) => {
    const g = groups.get(key) ?? { name: key, orders: new Set<string>(), units: 0, net: 0 };
    g.orders.add(orderId);
    g.units += units;
    g.net += net;
    groups.set(key, g);
  };

  let units = 0;
  let net = 0;
  for (const o of orders) {
    const month = localDay(o.delivered_at, env.timeZone).slice(0, 7);
    for (const l of o.order_lines ?? []) {
      const qty = l.qty_delivered - l.qty_returned;
      if (qty <= 0) continue;
      const value = qty * (l.unit_price == null ? 0 : Number(l.unit_price));
      units += qty;
      net += value;
      const key =
        groupBy === "staff"
          ? (one(o.rep)?.full_name ?? `No ${lower(t.staff.one)}`)
          : groupBy === "site"
            ? (one(o.stores)?.name ?? "")
            : groupBy === "month"
              ? new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
              : groupBy === "product"
                ? (one(l.products)?.name ?? "")
                : "";
      if (groupBy !== "total") add(key, o.id, qty, value);
    }
  }

  const list = [...groups.values()]
    .map((g) => ({ name: g.name, orders: g.orders.size, units: g.units, sales_excl_vat: money(g.net) }))
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
      total: { orders: orders.length, units, sales_excl_vat: money(net) },
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
            [r.label, "Delivered orders, excluding VAT"],
            [
              { header: byLabel[groupBy], key: "name" },
              { header: "Orders", key: "orders", numeric: true },
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

  let q = env.supabase
    .from("orders")
    .select(
      "order_number, status, on_hold, created_at, delivered_at, stores(name), rep:profiles!orders_rep_id_fkey(full_name), order_lines(qty_ordered, unit_price)"
    )
    .order("created_at", { ascending: false })
    .limit(500);
  if (status === "open") q = q.in("status", OPEN_STATUSES);
  else if (status && STATUS_LABELS[status]) q = q.eq("status", status);
  if (siteId) q = q.eq("store_id", siteId);
  if (from) q = q.gte("created_at", companyMidnight(from, env.timeZone).toISOString());
  if (to) q = q.lt("created_at", companyMidnight(addDays(to, 1), env.timeZone).toISOString());
  const { data, error } = await q;
  fail(error);

  const rows = (data ?? []).map((o) => ({
    order: o.order_number,
    site: one(o.stores as { name: string } | { name: string }[] | null)?.name ?? "",
    staff: one(o.rep as { full_name: string } | { full_name: string }[] | null)?.full_name ?? "",
    status: (STATUS_LABELS[o.status] ?? o.status) + (o.on_hold ? " (on hold)" : ""),
    taken: localDay(o.created_at, env.timeZone),
    delivered: localDay(o.delivered_at, env.timeZone),
    value_excl_vat: money(
      (o.order_lines ?? []).reduce((n, l) => n + l.qty_ordered * Number(l.unit_price ?? 0), 0)
    ),
  }));

  const counts: Record<string, number> = {};
  for (const o of data ?? []) counts[o.status] = (counts[o.status] ?? 0) + 1;

  const context = [
    status ? `Status: ${status === "open" ? "not yet delivered" : (STATUS_LABELS[status] ?? status)}` : "Every status",
    ...(from || to ? [`Taken ${from ? niceDay(from) : "any time"} to ${to ? niceDay(to) : "today"}`] : []),
  ];

  return {
    model: {
      count: rows.length,
      capped_at_500: rows.length === 500,
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
      first_in: localTime(h.first_in, env.timeZone),
      last_out: h.open_now ? "Still working" : localTime(h.last_out, env.timeZone),
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
};

/**
 * Runs one lookup. Never throws: a failure becomes something the assistant can
 * tell the person, because a half-answered question is better than a crash.
 */
export async function runTool(name: ToolName, rawArgs: string, env: ToolEnv): Promise<ToolResult> {
  let args: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawArgs || "{}") as unknown;
    args = parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return { model: { error: "The lookup's arguments could not be read." } };
  }
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
