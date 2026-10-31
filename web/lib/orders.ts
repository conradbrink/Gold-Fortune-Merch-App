import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { lower, withArticle, type Terms } from "@/lib/terms";
import type { StorePriceList } from "@/lib/price-lists";
import { allByKey, byName, type KeyedQuery } from "@/lib/all-pages";

/**
 * Everything the order screens read and do.
 *
 * The transactional half of this module is thin on purpose: each function is a
 * single `rpc()` call. All the reservation arithmetic, the status graph and the
 * oversell guard live in the database, where they hold regardless of which
 * client is talking to it — the phone app will call exactly these RPCs when it
 * arrives. A function here that "helpfully" updated a status column directly
 * would be refused by the column grant, and rightly.
 */

type Client = SupabaseClient<Database>;

export type OrderRow = Database["public"]["Tables"]["orders"]["Row"];
export type OrderLineRow = Database["public"]["Tables"]["order_lines"]["Row"];
export type AvailabilityRow =
  Database["public"]["Functions"]["order_availability_check"]["Returns"][number];

/**
 * " (40 expired)" after a short line, when stock at the location has expired.
 * Expired batches are never reserved, so they are not counted as available;
 * this says why a full shelf reads short. Empty otherwise.
 */
export function expiredNote(row: Pick<AvailabilityRow, "qty_expired">): string {
  // Absent until the database returns the column (20261030175300).
  const n = row.qty_expired ?? 0;
  return n > 0 ? ` (${n} expired)` : "";
}

export type PickingRow =
  Database["public"]["Functions"]["order_picking_list"]["Returns"][number];

export type OrderDetail = {
  order: OrderRow;
  storeName: string | null;
  storeAddress: string | null;
  /** The store's group, for its price list. */
  storeGroupId: string | null;
  repName: string | null;
  /**
   * The warehouse the stock is reserved at, named.
   *
   * Read from the order's own join rather than looked up against the list of
   * locations the picker offers, because that list is active locations only —
   * an order fulfilled from a warehouse since retired still has to be able to
   * say where its stock came from.
   */
  fulfilLocationName: string | null;
  lines: (OrderLineRow & {
    product_name: string;
    brand: string | null;
    /** Units in the product's shrink as the catalogue has it now: what "per shrink" on the page counts in. */
    units_per_shrink: number | null;
  })[];
  events: {
    id: number;
    from_status: string | null;
    to_status: string;
    note: string | null;
    created_at: string;
    actor_name: string | null;
  }[];
  dispatches: {
    id: string;
    dispatch_number: string;
    status: string;
    tracking_reference: string | null;
    carrier_name: string | null;
    driver_name: string | null;
    vehicle_registration: string | null;
    dispatched_at: string;
    delivered_at: string | null;
    received_by_name: string | null;
    /** The receiver's signature on the phone (20261029181700), in fulfilment-docs. */
    received_signature_path: string | null;
    /** The rep whose job this delivery is, when one has been given it. */
    assigned_rep_id: string | null;
    assigned_rep_name: string | null;
  }[];
  documents: {
    id: string;
    doc_type: string;
    file_name: string | null;
    storage_path: string;
    signed_by_name: string | null;
    created_at: string;
  }[];
};

/** Shortfall handling when confirming. `reject` is the safe default. */
export type ShortfallAction = "reject" | "partial" | "backorder" | "hold";

/**
 * How an order reached the office. The stored values never change; only the
 * label for an order taken on a call names the company's own people and calls
 * ("Rep visit").
 */
export function receivedViaOptions(t: Terms) {
  return [
    { value: "whatsapp", label: "WhatsApp" },
    { value: "email", label: "Email" },
    { value: "phone", label: "Phone call" },
    { value: "in_person", label: "In person" },
    { value: "rep_visit", label: `${t.staff.one} ${lower(t.job.one)}` },
    { value: "other", label: "Other" },
  ] as const;
}

/**
 * How an order came in, in the words of the New order form: "WhatsApp",
 * "Phone call". The stored value itself for one the list does not know.
 */
export function receivedViaLabel(value: string, t: Terms): string {
  return receivedViaOptions(t).find((o) => o.value === value)?.label ?? value;
}

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

// ------------------------------------------------------------------ reads

/**
 * The search box's filter, for `.or()`: order number, invoice number, contact,
 * the customer's PO number, or a store whose name matches. Null when there is nothing left to search for.
 *
 * It has to run in the database, before any limit. Filtering the rows that came
 * back means an order older than the newest page can never be found by its own
 * order number, and the screen says "no orders" about an order that exists.
 *
 * `order_number`, `invoice_number` and `contact_name` are columns here, so they
 * go straight into the filter. The store name lives on an embedded table and
 * cannot, so the matching store ids are looked up first and folded in.
 */
async function orderSearchFilter(supabase: Client, term: string | undefined): Promise<string | null> {
  // PostgREST parses this filter as a comma-separated list with parenthesised
  // groups, so those characters have to go or the query is malformed. `%` and
  // `_` are ilike wildcards and would widen the match silently, and so is `*`,
  // which PostgREST reads as `%` in a like pattern.
  const safe = (term ?? "").trim().replace(/[%_*,()\\]/g, "");
  if (!safe) return null;
  const { data: storeHits, error: storeError } = await supabase
    .from("stores")
    .select("id")
    .ilike("name", `%${safe}%`)
    .limit(100);
  fail(storeError);

  const clauses = [
    `order_number.ilike.%${safe}%`,
    `invoice_number.ilike.%${safe}%`,
    `contact_name.ilike.%${safe}%`,
    `customer_po_number.ilike.%${safe}%`,
  ];
  const storeIds = (storeHits ?? []).map((s) => s.id);
  if (storeIds.length > 0) clauses.push(`store_id.in.(${storeIds.join(",")})`);
  return clauses.join(",");
}

/** A finished order, as the archive lists it. */
export type ArchivedOrder = {
  id: string;
  orderNumber: string;
  invoiceNumber: string | null;
  status: "delivered" | "cancelled";
  podStatus: string;
  storeName: string | null;
  contactName: string | null;
  repName: string | null;
  createdAt: string;
  /** When it was delivered, or cancelled. Null only on an order older than the stamps. */
  closedAt: string | null;
  /** Who signed for it, from the consignment that arrived. */
  receivedBy: string | null;
  cancelReason: string | null;
  /** VAT included, at the rate frozen onto the order. */
  total: number;
};

/** How many the archive shows at a time. */
export const ARCHIVE_PAGE = 50;

/**
 * The archive: delivered (or cancelled) orders, the newest first.
 *
 * Newest by the day it was delivered or cancelled, then by the day it was
 * taken, so a batch recorded on one afternoon still reads newest order first.
 * One row more than a page is asked for, which is how `more` knows there is
 * another page without counting the whole table.
 */
export async function fetchArchivedOrders(
  supabase: Client,
  opts: { show: "delivered" | "cancelled"; search?: string; offset?: number }
): Promise<{ rows: ArchivedOrder[]; more: boolean }> {
  const offset = opts.offset ?? 0;
  let q = supabase
    .from("orders")
    .select(
      `id, order_number, invoice_number, status, pod_status, contact_name, created_at, delivered_at,
       cancelled_at, cancel_reason, vat_rate, stores(name), profiles!orders_rep_id_fkey(full_name),
       order_lines(qty_ordered, unit_price), dispatches(status, received_by_name, delivered_at)`
    )
    .eq("status", opts.show)
    .order(opts.show === "delivered" ? "delivered_at" : "cancelled_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .order("id")
    .range(offset, offset + ARCHIVE_PAGE);

  const filter = await orderSearchFilter(supabase, opts.search);
  if (filter) q = q.or(filter);

  const { data, error } = await q;
  fail(error);

  type Raw = {
    id: string;
    order_number: string;
    invoice_number: string | null;
    status: "delivered" | "cancelled";
    pod_status: string;
    contact_name: string | null;
    created_at: string;
    delivered_at: string | null;
    cancelled_at: string | null;
    cancel_reason: string | null;
    vat_rate: number | null;
    stores: { name: string } | { name: string }[] | null;
    profiles: { full_name: string | null } | { full_name: string | null }[] | null;
    order_lines: { qty_ordered: number; unit_price: number | null }[] | null;
    dispatches: { status: string; received_by_name: string | null; delivered_at: string | null }[] | null;
  };
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  const raw = (data ?? []) as unknown as Raw[];

  return {
    more: raw.length > ARCHIVE_PAGE,
    rows: raw.slice(0, ARCHIVE_PAGE).map((r) => {
      // The consignment that arrived. An order that went out, came back and
      // went out again has a returned dispatch as well, with nobody signing.
      const arrived = (r.dispatches ?? [])
        .filter((d) => d.status === "delivered")
        .sort((a, b) => (b.delivered_at ?? "").localeCompare(a.delivered_at ?? ""))[0];
      return {
        id: r.id,
        orderNumber: r.order_number,
        invoiceNumber: r.invoice_number,
        status: r.status,
        podStatus: r.pod_status,
        storeName: one(r.stores)?.name ?? null,
        contactName: r.contact_name,
        repName: one(r.profiles)?.full_name ?? null,
        createdAt: r.created_at,
        closedAt: r.status === "delivered" ? r.delivered_at : r.cancelled_at,
        receivedBy: arrived?.received_by_name ?? null,
        cancelReason: r.cancel_reason,
        total: orderTotals(
          (r.order_lines ?? []).map((l) => ({
            qty: l.qty_ordered,
            unitPrice: l.unit_price == null ? 0 : Number(l.unit_price),
          })),
          Number(r.vat_rate ?? 0)
        ).total,
      };
    }),
  };
}

/**
 * The archive in month blocks, in the order given: "October 2026" and its rows.
 * A row with no date (older than the stamps) goes under "Date not recorded".
 */
export function archiveMonths<T extends { closedAt: string | null }>(
  rows: T[],
  timeZone?: string
): { month: string; rows: T[] }[] {
  const out: { month: string; rows: T[] }[] = [];
  for (const r of rows) {
    // In the company's time zone, so a delivery just after midnight on the 1st
    // is that month's, wherever the page is opened.
    const month = r.closedAt
      ? new Date(r.closedAt).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone })
      : "Date not recorded";
    const last = out[out.length - 1];
    if (last && last.month === month) last.rows.push(r);
    else out.push({ month, rows: [r] });
  }
  return out;
}

type LineProduct = { name: string; brand: string | null; units_per_shrink: number | null };

export async function fetchOrderDetail(
  supabase: Client,
  orderId: string
): Promise<OrderDetail> {
  const [orderRes, linesRes, eventsRes, dispatchRes, docsRes] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "*, stores(name, address, store_group_id), profiles!orders_rep_id_fkey(full_name), stock_locations(name)"
      )
      .eq("id", orderId)
      .single(),
    supabase
      .from("order_lines")
      .select("*, products(name, brand, units_per_shrink)")
      .eq("order_id", orderId),
    supabase
      .from("order_status_events")
      .select("id, from_status, to_status, note, created_at, profiles(full_name)")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true }),
    supabase
      .from("dispatches")
      .select(
        "id, dispatch_number, status, tracking_reference, carrier_name, dispatched_at, delivered_at, received_by_name, received_signature_path, assigned_rep_id, assigned_rep:profiles!dispatches_assigned_rep_id_fkey(full_name), drivers(full_name), vehicles(registration)"
      )
      .eq("order_id", orderId)
      .order("dispatched_at", { ascending: false }),
    supabase
      .from("delivery_documents")
      .select("id, doc_type, file_name, storage_path, signed_by_name, created_at")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false }),
  ]);

  fail(orderRes.error);
  fail(linesRes.error);
  fail(eventsRes.error);
  fail(dispatchRes.error);
  fail(docsRes.error);

  const one = <T>(v: T | T[] | null): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : v;

  type StoreBits = { name: string; address: string | null; store_group_id: string | null };
  const orderRaw = orderRes.data as unknown as OrderRow & {
    stores: StoreBits | StoreBits[] | null;
    profiles: { full_name: string } | { full_name: string }[] | null;
    stock_locations: { name: string } | { name: string }[] | null;
  };
  const store = one(orderRaw.stores);
  const rep = one(orderRaw.profiles);

  return {
    order: orderRaw,
    storeName: store?.name ?? null,
    storeAddress: store?.address ?? null,
    storeGroupId: store?.store_group_id ?? null,
    repName: rep?.full_name ?? null,
    fulfilLocationName: one(orderRaw.stock_locations)?.name ?? null,
    lines: ((linesRes.data ?? []) as unknown as (OrderLineRow & {
      products: LineProduct | LineProduct[] | null;
    })[]).map((l) => {
      const p = one(l.products);
      return {
        ...l,
        product_name: p?.name ?? "Unknown product",
        brand: p?.brand ?? null,
        units_per_shrink: p?.units_per_shrink ?? null,
      };
    }),
    events: ((eventsRes.data ?? []) as unknown as {
      id: number;
      from_status: string | null;
      to_status: string;
      note: string | null;
      created_at: string;
      profiles: { full_name: string } | { full_name: string }[] | null;
    }[]).map((e) => ({
      id: e.id,
      from_status: e.from_status,
      to_status: e.to_status,
      note: e.note,
      created_at: e.created_at,
      actor_name: one(e.profiles)?.full_name ?? null,
    })),
    dispatches: ((dispatchRes.data ?? []) as unknown as {
      id: string;
      dispatch_number: string;
      status: string;
      tracking_reference: string | null;
      carrier_name: string | null;
      dispatched_at: string;
      delivered_at: string | null;
      received_by_name: string | null;
      received_signature_path: string | null;
      assigned_rep_id: string | null;
      assigned_rep:
        | { full_name: string | null }
        | { full_name: string | null }[]
        | null;
      drivers: { full_name: string } | { full_name: string }[] | null;
      vehicles: { registration: string } | { registration: string }[] | null;
    }[]).map((d) => ({
      id: d.id,
      dispatch_number: d.dispatch_number,
      status: d.status,
      tracking_reference: d.tracking_reference,
      carrier_name: d.carrier_name,
      driver_name: one(d.drivers)?.full_name ?? null,
      vehicle_registration: one(d.vehicles)?.registration ?? null,
      dispatched_at: d.dispatched_at,
      delivered_at: d.delivered_at,
      received_by_name: d.received_by_name,
      received_signature_path: d.received_signature_path,
      assigned_rep_id: d.assigned_rep_id,
      assigned_rep_name: one(d.assigned_rep)?.full_name ?? null,
    })),
    documents: (docsRes.data ?? []) as OrderDetail["documents"],
  };
}

export async function fetchAvailability(
  supabase: Client,
  orderId: string,
  locationId?: string | null
): Promise<AvailabilityRow[]> {
  const { data, error } = await supabase.rpc("order_availability_check", {
    p_order_id: orderId,
    p_location_id: locationId ?? undefined,
  });
  fail(error);
  return data ?? [];
}

export async function fetchPickingList(
  supabase: Client,
  orderId: string
): Promise<PickingRow[]> {
  const { data, error } = await supabase.rpc("order_picking_list", {
    p_order_id: orderId,
  });
  fail(error);
  return data ?? [];
}

export async function fetchOrderableProducts(supabase: Client) {
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, name, brand, sku_code, unit_barcode, shrink_barcode, units_per_shrink, shrink_price_excl_vat"
    )
    .eq("active", true)
    .eq("is_stock_tracked", true)
    .order("name");
  fail(error);
  return (data ?? []) as {
    id: string;
    name: string;
    brand: string | null;
    sku_code: string | null;
    unit_barcode: string | null;
    shrink_barcode: string | null;
    units_per_shrink: number | null;
    shrink_price_excl_vat: number | null;
  }[];
}

/**
 * Products matching what was typed into an order's product search.
 *
 * Name and brand match anywhere in the text; the codes match from the start,
 * because a clerk reading a SKU or scanning a barcode has the whole thing and
 * a code that merely contains "12" is noise. Codes are compared without
 * spaces, which is how they arrive from a WhatsApp message.
 */
export function matchProducts<
  P extends {
    name: string;
    brand: string | null;
    sku_code: string | null;
    unit_barcode: string | null;
    shrink_barcode: string | null;
  },
>(products: P[], query: string, limit = 8): P[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const code = q.replace(/\s+/g, "");
  return products
    .filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.brand ?? "").toLowerCase().includes(q) ||
        [p.sku_code, p.unit_barcode, p.shrink_barcode].some((c) =>
          (c ?? "").toLowerCase().replace(/\s+/g, "").startsWith(code)
        )
    )
    .slice(0, limit);
}

/**
 * What Enter adds from an order's product search: the top match, because a
 * barcode scanner sends Enter after the code. Null when the code is a barcode
 * several of the matches share (one product per quantity band, 31 Oct): the
 * top one would be a guess at the band, so the clerk picks it from the list.
 */
export function enterPick<P extends { unit_barcode: string | null; shrink_barcode: string | null }>(
  matches: P[],
  query: string
): P | null {
  const code = query.trim().toLowerCase().replace(/\s+/g, "");
  const exact = matches.filter((p) =>
    [p.unit_barcode, p.shrink_barcode].some((c) => (c ?? "").toLowerCase().replace(/\s+/g, "") === code)
  );
  return exact.length > 1 ? null : (matches[0] ?? null);
}

/**
 * Creates a store from the order-capture screen.
 *
 * Deliberately minimal — name and where it is. Everything else on a store
 * (groups, territory, geocoding) is management data that the full Stores
 * screen owns; an order should not be blocked on any of it.
 *
 * Whether the caller *may* do this is RLS's decision, not this function's:
 * `stores_insert` names the roles. The screen shows the refusal as-is.
 */
export async function createStoreInline(
  supabase: Client,
  input: { orgId: string; name: string; city?: string | null; address?: string | null }
) {
  const { data, error } = await supabase
    .from("stores")
    .insert({
      org_id: input.orgId,
      name: input.name.trim(),
      city: input.city?.trim() || null,
      address: input.address?.trim() || null,
    })
    .select("id, name, city")
    .single();
  fail(error);
  return data as { id: string; name: string; city: string | null };
}

/**
 * The sales reps an order can be attributed to.
 *
 * Only `role = 'rep'` and only active ones: a warehouse clerk is not whose
 * account the shop is, and a rep who has left should not appear on new orders
 * while still appearing on the old ones they took.
 */
/**
 * The per-unit trade price implied by a product's shrink price.
 *
 * The catalogue quotes per shrink; a line is priced per base unit — the same
 * unit `qty_ordered` counts in. Dividing here is what stops a ten-unit line
 * being charged at ten times the pack price.
 *
 * Null when the pack size is unknown, so the clerk is asked rather than handed
 * a figure derived from a missing factor.
 *
 * Lives here rather than on the capture screen because two screens now need
 * it: capture, and the order detail where the warehouse prices a rep's order.
 *
 * Given the store's price list, the list's case price is used where it has
 * one (20261015210000).
 */
export function unitPriceFor(
  p: {
    id?: string;
    units_per_shrink: number | null;
    shrink_price_excl_vat: number | null;
  },
  /** The store's price list: its price for the product wins over the
      product's own, as `store_unit_price` decides in the database. */
  list?: StorePriceList | null
): string | null {
  const shrink = shrinkPriceFor(p, list);
  if (shrink == null) return null;
  const units = p.units_per_shrink;
  if (units == null || !Number.isInteger(units) || units <= 0) return null;
  // In whole cents, half away from zero, as `round(price / units, 2)` in the
  // database: a rep's line priced there and a clerk's prefilled here agree.
  return perUnitOfShrink(Number(shrink), units);
}

/**
 * A shrink's price as the price of one unit in it, to the cent: whole cents,
 * half away from zero, as `round(price / units, 2)` in the database.
 */
export function perUnitOfShrink(shrinkPrice: number, units: number): string {
  const cents = Math.round(shrinkPrice * 100);
  return (Math.floor((cents * 2 + units) / (units * 2)) / 100).toFixed(2);
}

/** The units in a product's shrink when it can be priced per shrink (more than one); otherwise null. */
export function shrinkUnits(unitsPerShrink: number | null | undefined): number | null {
  return unitsPerShrink != null && Number.isInteger(unitsPerShrink) && unitsPerShrink > 1
    ? unitsPerShrink
    : null;
}

/**
 * An order line's quantity and price as the order page shows them: per unit
 * as saved, or per shrink of `units` (`units` null means per unit).
 *
 * An order is kept in units, so per shrink is a way of reading and typing the
 * line, not of saving it: `lineFromShown` turns what was typed back.
 */
export function shownLine(
  line: { qty_ordered: number; unit_price: number | null },
  units: number | null
): { qty: string; price: string } {
  const price = line.unit_price == null ? "" : String(line.unit_price);
  if (!units) return { qty: String(line.qty_ordered), price };
  return {
    // Up to three places: 5 units of a shrink of 12 read 0.417, not 0.41666…
    qty: String(Math.round((line.qty_ordered / units) * 1000) / 1000),
    price: line.unit_price == null ? "" : (Math.round(Number(line.unit_price) * units * 100) / 100).toFixed(2),
  };
}

/**
 * Moves a typed quantity or price from per unit to per shrink, or back, so a
 * box keeps meaning the same order when the switch changes. Something that is
 * not a number is left as typed, for the save to refuse.
 */
export function switchedShown(
  raw: string,
  kind: "qty" | "price",
  toShrink: boolean,
  units: number
): string {
  const n = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(n)) return raw;
  if (kind === "price") {
    return toShrink ? (Math.round(n * units * 100) / 100).toFixed(2) : perUnitOfShrink(n, units);
  }
  if (toShrink) return String(Math.round((n / units) * 1000) / 1000);
  // Back to units: a whole number the shrinks were rounded from comes back whole.
  return String(unitsFromShown(raw, units) ?? Math.round(n * units * 1000) / 1000);
}

/**
 * What a typed quantity saves as, in units: null when it is not a whole
 * number of units, one or more (2.5 shrinks of 10 is 25 units; 0.25 is not).
 *
 * Shrinks are shown to three places, so 5 units of a shrink of 12 read 0.417;
 * anything within that rounding of a whole number of units is that number.
 */
export function unitsFromShown(raw: string, units: number | null): number | null {
  const n = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(n)) return null;
  const total = units ? n * units : n;
  const whole = Math.round(total);
  const slack = units ? units * 0.0005 + 1e-9 : 1e-6;
  return Math.abs(total - whole) <= slack && whole >= 1 ? whole : null;
}

/** What a typed price saves as, per unit: a price per shrink is divided by its units, to the cent. */
export function unitPriceFromShown(raw: string, units: number | null): number | null {
  const n = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(n) || n < 0) return null;
  return units ? Number(perUnitOfShrink(n, units)) : n;
}

/**
 * A product's shrink price excluding VAT: the store's price list's, or the
 * product's own. What a quote line priced per shrink starts at. Null when
 * neither has one.
 */
export function shrinkPriceFor(
  p: { id?: string; shrink_price_excl_vat: number | null },
  list?: StorePriceList | null
): string | null {
  const listed = p.id != null ? list?.prices[p.id] : undefined;
  const shrink = listed ?? p.shrink_price_excl_vat;
  return shrink == null ? null : Number(shrink).toFixed(2);
}

/**
 * Sets the price on one order line.
 *
 * `order_lines` grants `update (qty_ordered, unit_price)` to `authenticated`
 * and its policy only admits a line whose order is still `new`, so the window
 * for this closes the moment the warehouse confirms — which is the right
 * moment, because confirming is the promise.
 */
export async function setLinePrice(
  supabase: Client,
  lineId: string,
  unitPrice: number | null
) {
  const { error } = await supabase
    .from("order_lines")
    .update({ unit_price: unitPrice })
    .eq("id", lineId);
  fail(error);
}

/**
 * Corrections to an order the warehouse has not confirmed yet.
 *
 * Everything below is bounded by `status = 'new'`, and that boundary is the
 * database's rather than this screen's: `order_lines_insert`, `_update` and
 * `_delete` each require the order to still be `new`, and the column grants
 * limit an update to `qty_ordered` and `unit_price`. So a stale tab cannot
 * rewrite an order that has since been confirmed — the write is refused rather
 * than racing.
 *
 * The cut-off is `confirmed` and not something later because confirming is what
 * reserves stock. After it, a quantity is not a number on a form; it is a
 * promise to a shop and a hold on the shelf, and changing it means unwinding
 * the reservation through the ledger. A wrong order past that point is
 * cancelled or credited, which leaves a record of what happened.
 */
export async function setLineQty(
  supabase: Client,
  lineId: string,
  qty: number
) {
  if (!Number.isInteger(qty) || qty < 1) {
    throw new Error("A quantity has to be a whole number, one or more.");
  }
  const { error } = await supabase
    .from("order_lines")
    .update({ qty_ordered: qty })
    .eq("id", lineId);
  fail(error);
}

export async function removeOrderLine(supabase: Client, lineId: string) {
  const { error } = await supabase.from("order_lines").delete().eq("id", lineId);
  fail(error);
}

/**
 * Adds a product to an order that is still open.
 *
 * `order_lines` is unique on (order_id, product_id), so a product already on
 * the order is refused here with something a person can act on, rather than
 * left to surface as a constraint violation naming an index.
 */
export async function addOrderLine(
  supabase: Client,
  input: {
    orgId: string;
    orderId: string;
    productId: string;
    qty: number;
    unitPrice: number | null;
  }
) {
  if (!Number.isInteger(input.qty) || input.qty < 1) {
    throw new Error("A quantity has to be a whole number, one or more.");
  }

  const { data: existing, error: existingError } = await supabase
    .from("order_lines")
    .select("id")
    .eq("order_id", input.orderId)
    .eq("product_id", input.productId)
    .maybeSingle();
  fail(existingError);
  if (existing) {
    throw new Error(
      "That product is already on this order. Change its quantity instead."
    );
  }

  const { error } = await supabase.from("order_lines").insert({
    org_id: input.orgId,
    order_id: input.orderId,
    product_id: input.productId,
    qty_ordered: input.qty,
    unit_price: input.unitPrice,
    client_generated_id: crypto.randomUUID(),
  });
  fail(error);
}

/**
 * The details around the order: who to ring, when the shop wants it, and why.
 *
 * Not the store. Moving an order to a different shop is not a correction, it is
 * a different order — and `orders.store_id` is what every downstream document
 * points at. Cancel and re-capture says what happened; a silent reassignment
 * does not.
 */
/**
 * Today through 365 days ahead, as local dates.
 *
 * The same window the rep app's date picker allows (`firstDate` today,
 * `lastDate` +365). A shop cannot ask for goods last Tuesday, and a date two
 * years out is a typo — usually the year. Kept in step with the phone on
 * purpose: the same order can be corrected from either, and a rule that holds
 * on one and not the other is a rule nobody can rely on.
 */
export function requiredByRange(today = new Date()) {
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-` +
    `${String(d.getDate()).padStart(2, "0")}`;
  const first = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const last = new Date(first);
  last.setDate(last.getDate() + 365);
  return { min: iso(first), max: iso(last) };
}

/**
 * What is wrong with a customer's purchase order as typed, or null. The same
 * rules as the database's checks on `orders`, said in words before the save.
 */
export function customerPoProblem(po: {
  number: string | null;
  date: string | null;
  expiresOn: string | null;
}): string | null {
  if (po.number && po.number.length > 60) return "A PO number can be at most 60 characters.";
  if (po.date && po.expiresOn && po.expiresOn < po.date) return "A PO cannot expire before its own date.";
  return null;
}

export async function updateOrderDetails(
  supabase: Client,
  orderId: string,
  fields: {
    contact_name: string | null;
    contact_phone: string | null;
    required_by: string | null;
    notes: string | null;
    customer_po_number: string | null;
    customer_po_date: string | null;
    customer_po_expires_on: string | null;
  }
) {
  const poProblem = customerPoProblem({
    number: fields.customer_po_number,
    date: fields.customer_po_date,
    expiresOn: fields.customer_po_expires_on,
  });
  if (poProblem) throw new Error(`${poProblem} Nothing was saved.`);
  if (fields.required_by) {
    const { min, max } = requiredByRange();
    // String comparison is exact for `YYYY-MM-DD` and sidesteps parsing a bare
    // date as UTC midnight, which shifts the day either side of the boundary.
    if (fields.required_by < min || fields.required_by > max) {
      throw new Error(
        `A wanted-by date has to be between ${min} and ${max}. Nothing was saved.`
      );
    }
  }

  const { error } = await supabase
    .from("orders")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", orderId);
  fail(error);
}

export async function fetchRepsForOrder(supabase: Client) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("role", "rep")
    .eq("is_active", true)
    .order("full_name")
    .limit(500);
  fail(error);
  return (data ?? []) as { id: string; full_name: string }[];
}

/**
 * The organisation's VAT percentage, e.g. 14 for 14%.
 *
 * Read for display only. What an order is actually taxed at is the copy frozen
 * onto the order when it was captured, not this.
 */
export async function fetchVatRate(supabase: Client): Promise<number> {
  const { data, error } = await supabase
    .from("organizations")
    .select("vat_rate")
    .limit(1)
    .single();
  fail(error);
  return Number((data as { vat_rate: number } | null)?.vat_rate ?? 0);
}

/**
 * A line's price after its discount, rounded to the cent.
 *
 * The same arithmetic as `order_lines_apply_discount` in the database, which
 * is what actually stores the figure — this only previews it, and the two have
 * to agree to the cent or the total on screen is not the total saved.
 */
export function netPrice(listPrice: number, discountPct: number) {
  // In whole cents and hundredths of a percent, so the rounding is exact the
  // way Postgres's numeric round() is. Float arithmetic put 1.005 at
  // 100.4999… cents and rounded it the other way from the database.
  const cents = Math.round(listPrice * 100);
  const keep = 10000 - Math.round(discountPct * 100);
  const num = cents * keep;
  const rounded = num >= 0 ? Math.floor((num + 5000) / 10000) : -Math.floor((-num + 5000) / 10000);
  return rounded / 100;
}

/** A line's discount is a percentage or an amount off the whole line. */
export type DiscountKind = "pct" | "amount";

/**
 * A line's price each after its discount, rounded to the cent.
 *
 * An amount comes off the whole line and is spread over the quantity, the way
 * `order_lines_apply_discount` and the quote line's `unit_price` do it:
 * `round(list_price - discount_amount / qty, 2)`. P50 off 3 at P20 is P3.33
 * each, so the line comes to 1 cent more off than typed.
 */
export function netUnitPrice(
  listPrice: number,
  qty: number,
  discount: number,
  kind: DiscountKind
) {
  if (kind === "pct") return netPrice(listPrice, discount);
  if (!(qty > 0)) return listPrice;
  // In whole cents, rounded half away from zero as Postgres does. Dividing
  // floats first put P1.14 less P0.29 over 2 at 0.99499… and lost a cent.
  const cents = Math.round(listPrice * 100);
  const off = Math.round(discount * 100);
  const num = cents * qty - off;
  const half = Math.floor((Math.abs(num) * 2 + qty) / (qty * 2));
  return (num < 0 ? -half : half) / 100;
}

/**
 * What is wrong with a line's discount, as a sentence for the screen, or null.
 *
 * The database refuses the same things; this says so before the round trip.
 * A line with no price yet (a recurring order's catalogue price on the day)
 * is only checked for the discount itself.
 */
export function discountProblem(line: {
  qty: number;
  price: number | null;
  discount: number;
  kind: DiscountKind;
}): string | null {
  const { qty, price, discount, kind } = line;
  if (kind === "pct") {
    return discount < 0 || discount > 100 ? "A discount is a percentage between 0 and 100." : null;
  }
  if (discount < 0) return "A discount can't be a negative amount.";
  if (Math.abs(Math.round(discount * 100) - discount * 100) > 1e-6) {
    return "A discount amount is to the cent.";
  }
  if (price != null && qty > 0 && Math.round(discount * 100) > Math.round(price * 100) * qty) {
    return "A discount can't be more than the line is worth (the quantity times the price).";
  }
  return null;
}

/**
 * Subtotal, VAT and total from VAT-exclusive line prices.
 *
 * One place, because three screens show these numbers and three
 * implementations would eventually disagree by a cent.
 */
export function orderTotals(
  lines: { qty: number; unitPrice: number | null }[],
  vatRate: number
) {
  const subtotal = lines.reduce((n, l) => n + l.qty * (l.unitPrice ?? 0), 0);
  // Rounded once, at the end, rather than per line: rounding each line and
  // adding them up drifts from the invoice by a cent or two on a long order.
  const vat = Math.round(subtotal * (vatRate / 100) * 100) / 100;
  return { subtotal, vat, total: subtotal + vat };
}

type StoreForOrder = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  store_group_id: string | null;
};

/** Every active customer, paged: a response stops at 1,000 rows. */
export async function fetchStoresForOrder(supabase: Client): Promise<StoreForOrder[]> {
  const rows = await allByKey<StoreForOrder>(
    () =>
      supabase
        .from("stores")
        .select("id, name, address, city, store_group_id")
        .eq("active", true) as unknown as KeyedQuery<StoreForOrder>
  );
  return rows.sort(byName);
}

export async function fetchCarriers(supabase: Client) {
  const [d, v] = await Promise.all([
    supabase.from("drivers").select("id, full_name").eq("active", true).order("full_name"),
    supabase.from("vehicles").select("id, registration").eq("active", true).order("registration"),
  ]);
  fail(d.error);
  fail(v.error);
  return {
    drivers: (d.data ?? []) as { id: string; full_name: string }[],
    vehicles: (v.data ?? []) as { id: string; registration: string }[],
  };
}

// ------------------------------------------------------------------ writes

/**
 * Creates a manually-keyed order with its lines.
 *
 * The order number is drawn from the same gapless counter every other document
 * uses, and `client_generated_id` is minted here so this row is idempotent the
 * same way a phone-captured one will be.
 *
 * There is no transaction across these inserts — PostgREST cannot give us one —
 * so a failure after the header lands leaves an empty draft order. That is
 * recoverable (it is `new`, so it can be edited or cancelled) and visible,
 * which is better than the alternative of building the lines client-side into
 * one RPC and losing the per-line error messages.
 */
export async function createManualOrder(
  supabase: Client,
  input: {
    orgId: string;
    storeId: string;
    receivedVia: string;
    contactName?: string;
    contactPhone?: string;
    requiredBy?: string | null;
    notes?: string;
    /** Null means deliver to the store's own address. */
    deliveryAddress?: string | null;
    /** Whose account this is. Null is legitimate — plenty of orders arrive
        from a shop with no rep attached to them. */
    repId?: string | null;
    /** The accounting system's invoice number, when it already exists. */
    invoiceNumber?: string | null;
    /** The customer's own purchase order: its number, date and last valid day. */
    customerPoNumber?: string | null;
    customerPoDate?: string | null;
    customerPoExpiresOn?: string | null;
    /** `unitPrice` is before the discount; the database derives the net.
        `discountAmount` is off the whole line, in place of a percentage. */
    lines: {
      productId: string;
      qty: number;
      unitPrice: number | null;
      discountPct?: number;
      discountAmount?: number;
    }[];
  }
): Promise<string> {
  if (input.lines.length === 0) {
    throw new Error("Add at least one product before saving the order.");
  }
  const poProblem = customerPoProblem({
    number: input.customerPoNumber?.trim() || null,
    date: input.customerPoDate || null,
    expiresOn: input.customerPoExpiresOn || null,
  });
  if (poProblem) throw new Error(poProblem);

  const { data: number, error: numberError } = await supabase.rpc(
    "next_document_number",
    { p_org_id: input.orgId, p_doc_type: "order", p_prefix: "SO" }
  );
  fail(numberError);

  const { data: created, error: orderError } = await supabase
    .from("orders")
    .insert({
      org_id: input.orgId,
      order_number: number as string,
      store_id: input.storeId,
      source: "warehouse_manual",
      received_via: input.receivedVia,
      contact_name: input.contactName || null,
      contact_phone: input.contactPhone || null,
      required_by: input.requiredBy || null,
      notes: input.notes || null,
      delivery_address: input.deliveryAddress || null,
      rep_id: input.repId || null,
      invoice_number: input.invoiceNumber || null,
      customer_po_number: input.customerPoNumber?.trim() || null,
      customer_po_date: input.customerPoDate || null,
      customer_po_expires_on: input.customerPoExpiresOn || null,
      client_generated_id: crypto.randomUUID(),
    })
    .select("id")
    .single();
  fail(orderError);

  const orderId = (created as { id: string }).id;

  const { error: linesError } = await supabase.from("order_lines").insert(
    input.lines.map((l) => ({
      org_id: input.orgId,
      order_id: orderId,
      product_id: l.productId,
      qty_ordered: l.qty,
      unit_price: l.unitPrice,
      discount_pct: l.discountAmount ? 0 : l.discountPct ?? 0,
      discount_amount: l.discountAmount ?? 0,
      client_generated_id: crypto.randomUUID(),
    }))
  );
  fail(linesError);

  return orderId;
}

type Jsonish = Record<string, unknown>;

async function callRpc<K extends keyof Database["public"]["Functions"]>(
  supabase: Client,
  fn: K,
  args: Database["public"]["Functions"][K]["Args"]
): Promise<Jsonish> {
  const { data, error } = await supabase.rpc(fn, args);
  fail(error);
  return (data ?? {}) as Jsonish;
}

export const confirmOrder = (
  supabase: Client,
  orderId: string,
  action: ShortfallAction,
  locationId?: string | null
) =>
  callRpc(supabase, "order_confirm", {
    p_order_id: orderId,
    p_shortfall_action: action,
    p_location_id: locationId ?? undefined,
  });

export const startPicking = (supabase: Client, orderId: string) =>
  callRpc(supabase, "order_start_picking", { p_order_id: orderId });

export const recordPick = (
  supabase: Client,
  orderId: string,
  lines: { allocation_id: string; qty_picked: number; actual_batch_id?: string | null }[]
) =>
  callRpc(supabase, "order_record_pick", {
    p_order_id: orderId,
    p_lines: lines as unknown as Database["public"]["Functions"]["order_record_pick"]["Args"]["p_lines"],
  });

export const markPacked = (supabase: Client, orderId: string, acceptShort = false) =>
  callRpc(supabase, "order_mark_packed", {
    p_order_id: orderId,
    p_accept_short: acceptShort,
  });

/**
 * The order went out, but it was not given to anybody.
 *
 * Its own type because the caller has to treat it differently from a refusal:
 * a refused dispatch leaves the screen as it was and the dialog is the right
 * place to stay, while this one means the order **has** changed and the page
 * is now showing a state that no longer exists — including hiding the very
 * control the message tells you to use.
 */
export class PartialDispatchError extends Error {
  /** Always true. Present so the check reads as a fact, not a type cast. */
  readonly orderWasDispatched = true;
  /**
   * Why the hand-over failed, without the order page's "on the delivery below":
   * a screen with no delivery card says where to go in its own words.
   */
  readonly reason: string;
  constructor(message: string, reason?: string) {
    super(message);
    this.name = "PartialDispatchError";
    this.reason = reason ?? message;
  }
}

/**
 * Send the order out, and say whose job it is.
 *
 * `assignedRepId` is the reason this is a function and not a one-liner. The
 * driver takes the stock; the *rep* is the one who sees the delivery on their
 * phone, and until somebody is named nobody does. Those were two separate
 * actions on two different parts of the screen — dispatching asked for a
 * driver, and the rep was a select further down the dispatch card that you had
 * to know to go back for. On the live data that produced 62 dispatches with a
 * driver and **zero** with a rep, in 119 dispatches over six weeks: the
 * warehouse was never asked the question at the moment it had the answer.
 *
 * Two calls rather than one, deliberately. Giving `order_dispatch` a rep
 * parameter would make it atomic, but adding a parameter to an existing
 * function is an overload rather than a replacement — every current caller
 * would start failing with "could not choose the best candidate function"
 * until the old signature was dropped. `order_dispatch` already returns the
 * `dispatch_id`, so the second call is exact rather than a guess.
 *
 * The failure between them is the case worth spelling out: if the assignment
 * is refused the order **is** dispatched, and the caller must be told that in
 * those words, or the obvious reaction is to press Dispatch again and put a
 * second dispatch on the same order.
 */
export async function dispatchOrder(
  supabase: Client,
  orderId: string,
  carrier: {
    driverId?: string | null;
    vehicleId?: string | null;
    carrierName?: string | null;
    trackingReference?: string | null;
    expectedDeliveryOn?: string | null;
    assignedRepId?: string | null;
  },
  t: Terms
): Promise<Jsonish> {
  const result = await callRpc(supabase, "order_dispatch", {
    p_order_id: orderId,
    p_driver_id: carrier.driverId || undefined,
    p_vehicle_id: carrier.vehicleId || undefined,
    p_carrier_name: carrier.carrierName || undefined,
    p_tracking_reference: carrier.trackingReference || undefined,
    p_expected_delivery_on: carrier.expectedDeliveryOn || undefined,
  });

  if (!carrier.assignedRepId) return result;

  const dispatchId = result.dispatch_id;
  if (typeof dispatchId !== "string") {
    throw new PartialDispatchError(
      `The order was dispatched, but it could not be given to ${withArticle(t, "staff")} or driver — the ` +
        `dispatch id came back missing. Set "Handled by" on the delivery below.`,
      "the dispatch id came back missing."
    );
  }

  try {
    await assignDispatchRep(supabase, dispatchId, carrier.assignedRepId);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new PartialDispatchError(
      `The order was dispatched, but it could not be given to ${withArticle(t, "staff")} or driver: ${reason} ` +
        `Set "Handled by" on the delivery below — do not dispatch again.`,
      reason
    );
  }
  return result;
}

export const markDelivered = (
  supabase: Client,
  dispatchId: string,
  receivedByName: string
) =>
  callRpc(supabase, "order_mark_delivered", {
    p_dispatch_id: dispatchId,
    p_received_by_name: receivedByName,
  });

export const returnUndelivered = (
  supabase: Client,
  dispatchId: string,
  reason: string,
  cancel: boolean
) =>
  callRpc(supabase, "order_return_undelivered", {
    p_dispatch_id: dispatchId,
    p_reason: reason,
    p_cancel: cancel,
  });

export const cancelOrder = (supabase: Client, orderId: string, reason: string) =>
  callRpc(supabase, "order_cancel", { p_order_id: orderId, p_reason: reason });

/**
 * For a company without the warehouse module: confirms a new order and issues
 * its invoice at the quantities ordered, touching no stock
 * (`order_invoice_without_stock`). Refused when the warehouse module is on.
 */
export const invoiceWithoutStock = (supabase: Client, orderId: string) =>
  callRpc(supabase, "order_invoice_without_stock", { p_order_id: orderId });

/** The same company's cancel: a new order only (`order_cancel_without_stock`). */
export const cancelWithoutStock = (supabase: Client, orderId: string, reason: string) =>
  callRpc(supabase, "order_cancel_without_stock", { p_order_id: orderId, p_reason: reason });

export const holdOrder = (supabase: Client, orderId: string, reason: string) =>
  callRpc(supabase, "order_hold", { p_order_id: orderId, p_reason: reason });

export const releaseHold = (supabase: Client, orderId: string) =>
  callRpc(supabase, "order_release_hold", { p_order_id: orderId });

/**
 * Uploads a delivery document and registers it.
 *
 * The bytes go up first — the browser talks to storage directly rather than
 * routing a file through the database — and the object stays unreadable until
 * `delivery_document_register` files the row the storage policy joins to. If
 * the register call fails, the object is removed again rather than left
 * orphaned in the bucket.
 */
export async function uploadDeliveryDocument(
  supabase: Client,
  input: {
    orgId: string;
    orderId: string;
    dispatchId?: string | null;
    docType: "delivery_note" | "pod" | "delivery_photo" | "other";
    file: File;
    signedByName?: string;
  }
): Promise<void> {
  // Whatever follows the last dot is not a file extension, it is caller input,
  // and it is interpolated into the storage key below. A name carrying a `/`
  // would put the object outside the `{org_id}/{order_id}` prefix the storage
  // policy joins on — which is the prefix that makes another org's PODs
  // unreachable. A browser file input will not produce one, but `File` is
  // constructible and this function is exported.
  const rawExt = input.file.name.split(".").pop()?.toLowerCase() ?? "";
  const ext = /^[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : "bin";
  const path = `${input.orgId}/${input.orderId}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("fulfilment-docs")
    .upload(path, input.file, { contentType: input.file.type, upsert: false });
  if (uploadError) throw new Error(uploadError.message);

  try {
    await callRpc(supabase, "delivery_document_register", {
      p_order_id: input.orderId,
      p_doc_type: input.docType,
      p_storage_path: path,
      p_dispatch_id: input.dispatchId || undefined,
      p_file_name: input.file.name,
      p_mime_type: input.file.type || undefined,
      p_size_bytes: input.file.size,
      p_signed_by_name: input.signedByName || undefined,
    });
  } catch (e) {
    // Take the bytes back out. An unregistered object is unreadable, but it is
    // still occupying the bucket and nothing would ever point at it.
    await supabase.storage.from("fulfilment-docs").remove([path]);
    throw e;
  }
}

export async function signedDocumentUrl(
  supabase: Client,
  storagePath: string
): Promise<string> {
  const { data, error } = await supabase.storage
    .from("fulfilment-docs")
    .createSignedUrl(storagePath, 60);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

/**
 * Give a delivery to a rep, or take it back with null.
 *
 * Through an RPC rather than an update, because the rule is not "may write
 * dispatches" — it is "may hand this job to somebody who can actually be shown
 * it", and only a `rep` base role opens the Android app.
 */
export const assignDispatchRep = (
  supabase: Client,
  dispatchId: string,
  repId: string | null
) =>
  callRpc(supabase, "assign_dispatch_rep", {
    p_dispatch: dispatchId,
    p_rep: repId,
  });
