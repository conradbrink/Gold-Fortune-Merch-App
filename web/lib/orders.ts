import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

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
export type PickingRow =
  Database["public"]["Functions"]["order_picking_list"]["Returns"][number];

export type OrderListRow = OrderRow & {
  store_name: string | null;
  line_count: number;
  units: number;
  /** What the order is worth to the business, VAT included. */
  total_incl_vat: number;
};

export type OrderDetail = {
  order: OrderRow;
  storeName: string | null;
  storeAddress: string | null;
  repName: string | null;
  lines: (OrderLineRow & { product_name: string; brand: string | null })[];
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

export const RECEIVED_VIA = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "in_person", label: "In person" },
  { value: "rep_visit", label: "Rep visit" },
  { value: "other", label: "Other" },
] as const;

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

// ------------------------------------------------------------------ reads

export async function fetchOrders(
  supabase: Client,
  opts: { status?: string; search?: string } = {}
): Promise<OrderListRow[]> {
  let q = supabase
    .from("orders")
    .select("*, stores(name), order_lines(qty_ordered, unit_price)")
    .order("created_at", { ascending: false })
    .limit(200);

  if (opts.status && opts.status !== "all") q = q.eq("status", opts.status);

  // The search has to happen in the database, before the limit. Filtering the
  // 200 rows that came back means an order older than the newest 200 can never
  // be found by its own order number — the screen says "no orders" about an
  // order that exists, which is worse than saying nothing.
  //
  // `order_number` and `contact_name` are columns here, so they go straight
  // into an `.or()`. The store name lives on an embedded table and cannot, so
  // the matching store ids are looked up first and folded into the same filter
  // rather than dropped from the search.
  const term = opts.search?.trim();
  if (term) {
    // PostgREST parses this filter as a comma-separated list with parenthesised
    // groups, so those characters have to go or the query is malformed. `%` and
    // `_` are ilike wildcards and would widen the match silently.
    const safe = term.replace(/[%_,()\\]/g, "");
    if (safe) {
      const { data: storeHits, error: storeError } = await supabase
        .from("stores")
        .select("id")
        .ilike("name", `%${safe}%`)
        .limit(100);
      fail(storeError);

      const clauses = [
        `order_number.ilike.%${safe}%`,
        `contact_name.ilike.%${safe}%`,
      ];
      const storeIds = (storeHits ?? []).map((s) => s.id);
      if (storeIds.length > 0) clauses.push(`store_id.in.(${storeIds.join(",")})`);
      q = q.or(clauses.join(","));
    }
  }

  const { data, error } = await q;
  fail(error);

  const rows = (data ?? []) as unknown as (OrderRow & {
    stores: { name: string } | { name: string }[] | null;
    order_lines: { qty_ordered: number; unit_price: number | null }[] | null;
  })[];

  return rows.map((r) => {
    // PostgREST returns an embedded to-one as an object or an array depending
    // on how it resolves the relationship; normalise rather than guess.
    const store = Array.isArray(r.stores) ? r.stores[0] : r.stores;
    const lines = r.order_lines ?? [];
    return {
      ...r,
      store_name: store?.name ?? null,
      line_count: lines.length,
      units: lines.reduce((n, l) => n + l.qty_ordered, 0),
      // At the rate frozen onto this order, not the organisation's current one.
      total_incl_vat: orderTotals(
        lines.map((l) => ({
          qty: l.qty_ordered,
          unitPrice: l.unit_price == null ? 0 : Number(l.unit_price),
        })),
        Number(r.vat_rate ?? 0)
      ).total,
    } as OrderListRow;
  });
}

export async function fetchOrderDetail(
  supabase: Client,
  orderId: string
): Promise<OrderDetail> {
  const [orderRes, linesRes, eventsRes, dispatchRes, docsRes] = await Promise.all([
    supabase
      .from("orders")
      .select("*, stores(name, address), profiles!orders_rep_id_fkey(full_name)")
      .eq("id", orderId)
      .single(),
    supabase
      .from("order_lines")
      .select("*, products(name, brand)")
      .eq("order_id", orderId),
    supabase
      .from("order_status_events")
      .select("id, from_status, to_status, note, created_at, profiles(full_name)")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true }),
    supabase
      .from("dispatches")
      .select(
        "id, dispatch_number, status, tracking_reference, carrier_name, dispatched_at, delivered_at, received_by_name, drivers(full_name), vehicles(registration)"
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

  const orderRaw = orderRes.data as unknown as OrderRow & {
    stores: { name: string; address: string | null } | { name: string; address: string | null }[] | null;
    profiles: { full_name: string } | { full_name: string }[] | null;
  };
  const store = one(orderRaw.stores);
  const rep = one(orderRaw.profiles);

  return {
    order: orderRaw,
    storeName: store?.name ?? null,
    storeAddress: store?.address ?? null,
    repName: rep?.full_name ?? null,
    lines: ((linesRes.data ?? []) as unknown as (OrderLineRow & {
      products: { name: string; brand: string | null } | { name: string; brand: string | null }[] | null;
    })[]).map((l) => {
      const p = one(l.products);
      return { ...l, product_name: p?.name ?? "Unknown product", brand: p?.brand ?? null };
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
    .select("id, name, brand, sku_code, units_per_shrink, shrink_price_excl_vat")
    .eq("active", true)
    .eq("is_stock_tracked", true)
    .order("name");
  fail(error);
  return (data ?? []) as {
    id: string;
    name: string;
    brand: string | null;
    sku_code: string | null;
    units_per_shrink: number | null;
    shrink_price_excl_vat: number | null;
  }[];
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
 */
export function unitPriceFor(p: {
  units_per_shrink: number | null;
  shrink_price_excl_vat: number | null;
}): string | null {
  if (p.shrink_price_excl_vat == null) return null;
  if (p.units_per_shrink == null || p.units_per_shrink <= 0) return null;
  return (p.shrink_price_excl_vat / p.units_per_shrink).toFixed(2);
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

export async function fetchStoresForOrder(supabase: Client) {
  const { data, error } = await supabase
    .from("stores")
    .select("id, name, address, city")
    .eq("active", true)
    .order("name")
    .limit(1000);
  fail(error);
  return (data ?? []) as {
    id: string;
    name: string;
    address: string | null;
    city: string | null;
  }[];
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
    /** Whose account this is. Null is legitimate — plenty of orders arrive
        from a shop with no rep attached to them. */
    repId?: string | null;
    /** The accounting system's invoice number, when it already exists. */
    invoiceNumber?: string | null;
    lines: { productId: string; qty: number; unitPrice: number | null }[];
  }
): Promise<string> {
  if (input.lines.length === 0) {
    throw new Error("Add at least one product before saving the order.");
  }

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
      rep_id: input.repId || null,
      invoice_number: input.invoiceNumber || null,
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

export const dispatchOrder = (
  supabase: Client,
  orderId: string,
  carrier: {
    driverId?: string | null;
    vehicleId?: string | null;
    carrierName?: string | null;
    trackingReference?: string | null;
    expectedDeliveryOn?: string | null;
  }
) =>
  callRpc(supabase, "order_dispatch", {
    p_order_id: orderId,
    p_driver_id: carrier.driverId || undefined,
    p_vehicle_id: carrier.vehicleId || undefined,
    p_carrier_name: carrier.carrierName || undefined,
    p_tracking_reference: carrier.trackingReference || undefined,
    p_expected_delivery_on: carrier.expectedDeliveryOn || undefined,
  });

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
