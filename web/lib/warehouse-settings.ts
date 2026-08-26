import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * The reference data the warehouse runs on: who we buy from, who drives, what
 * they drive, where stock lives, and when to reorder.
 *
 * The write permissions here are not uniform, and the UI mirrors what RLS
 * already enforces rather than inventing its own rule:
 *
 *   suppliers, drivers, vehicles   warehouse and manager
 *   stock locations                manager only
 *   reorder levels                 manager only
 *
 * A clerk needs to add the driver who started this morning without waiting for
 * anybody. Deciding that a second warehouse exists, or what the reorder point
 * for a line should be, is a different kind of decision.
 */

type Client = SupabaseClient<Database>;

export type Supplier = {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  account_ref: string | null;
  active: boolean;
};

export type Driver = {
  id: string;
  full_name: string;
  phone: string | null;
  licence_number: string | null;
  licence_expires_on: string | null;
  active: boolean;
};

export type Vehicle = {
  id: string;
  registration: string;
  description: string | null;
  make_model: string | null;
  active: boolean;
};

export type LocationRow = {
  id: string;
  name: string;
  code: string | null;
  type: string;
  address: string | null;
  is_default: boolean;
  active: boolean;
};

export type ReorderRow = {
  product_id: string;
  product_name: string;
  brand: string | null;
  min_stock_level: number | null;
  reorder_point: number | null;
  reorder_qty: number | null;
  is_batch_tracked: boolean;
};

export type StaffMember = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
};

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

/**
 * Everyone with a warehouse login.
 *
 * `rep_directory()` deliberately filters to reps, so warehouse staff have no
 * RPC of their own — a plain select is enough, since `profiles_select` is
 * org-wide and this page is manager-only.
 */
export async function fetchWarehouseStaff(supabase: Client): Promise<StaffMember[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone, is_active, created_at")
    .eq("role", "warehouse")
    .order("full_name");
  fail(error);
  return (data ?? []) as StaffMember[];
}

/**
 * Creates a warehouse login with a starting password.
 *
 * Goes through the route handler rather than the browser client, because
 * creating an auth user needs the service-role key and that must never reach a
 * bundle. The route refuses any role a manager does not outrank — `manager`
 * itself is excluded — so this cannot be turned into a way to mint one.
 */
export async function inviteWarehouseUser(input: {
  email: string;
  fullName: string;
  password: string;
}): Promise<void> {
  const res = await fetch("/api/reps/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: input.email,
      full_name: input.fullName,
      password: input.password,
      role: "warehouse",
    }),
  });
  // The route always answers with JSON, including on failure — but a proxy or a
  // crash could still return HTML, and `res.json()` would then throw a parse
  // error that says nothing useful.
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (payload as { error?: string } | null)?.error ??
        `Could not create the account (${res.status}).`
    );
  }
}

/** Suspends or restores a warehouse login. Bans the auth user too, not just RLS. */
export async function setStaffActive(id: string, active: boolean): Promise<void> {
  const res = await fetch(`/api/reps/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_active: active }),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (payload as { error?: string } | null)?.error ??
        `Could not update the account (${res.status}).`
    );
  }
}

export async function fetchSuppliersAll(supabase: Client): Promise<Supplier[]> {
  const { data, error } = await supabase
    .from("suppliers")
    .select("id, name, contact_name, phone, email, account_ref, active")
    .order("name");
  fail(error);
  return (data ?? []) as Supplier[];
}

export async function fetchDriversAll(supabase: Client): Promise<Driver[]> {
  const { data, error } = await supabase
    .from("drivers")
    .select("id, full_name, phone, licence_number, licence_expires_on, active")
    .order("full_name");
  fail(error);
  return (data ?? []) as Driver[];
}

export async function fetchVehiclesAll(supabase: Client): Promise<Vehicle[]> {
  const { data, error } = await supabase
    .from("vehicles")
    .select("id, registration, description, make_model, active")
    .order("registration");
  fail(error);
  return (data ?? []) as Vehicle[];
}

export async function fetchLocationsAll(supabase: Client): Promise<LocationRow[]> {
  const { data, error } = await supabase
    .from("stock_locations")
    .select("id, name, code, type, address, is_default, active")
    .order("is_default", { ascending: false })
    .order("name");
  fail(error);
  return (data ?? []) as LocationRow[];
}

/**
 * Products with their reorder settings.
 *
 * Only the product-level defaults are edited here. The per-location override
 * exists in the schema and is deliberately not surfaced yet: with one warehouse
 * it would be a second number that always has to match the first, and two
 * places to set the same thing is how they end up disagreeing.
 */
export async function fetchReorderLevels(supabase: Client): Promise<ReorderRow[]> {
  const { data, error } = await supabase
    .from("products")
    .select("id, name, brand, min_stock_level, reorder_point, reorder_qty, is_batch_tracked")
    .eq("active", true)
    .eq("is_stock_tracked", true)
    .order("name");
  fail(error);
  return ((data ?? []) as unknown as {
    id: string;
    name: string;
    brand: string | null;
    min_stock_level: number | null;
    reorder_point: number | null;
    reorder_qty: number | null;
    is_batch_tracked: boolean;
  }[]).map((p) => ({
    product_id: p.id,
    product_name: p.name,
    brand: p.brand,
    min_stock_level: p.min_stock_level,
    reorder_point: p.reorder_point,
    reorder_qty: p.reorder_qty,
    is_batch_tracked: p.is_batch_tracked,
  }));
}

/**
 * Asks for the affected row back.
 *
 * PostgREST reports an UPDATE that matched nothing as a success, so without the
 * `select` a write refused by RLS would show as saved. The same trap
 * `lib/representatives.ts` documents.
 */
type Editable = "suppliers" | "drivers" | "vehicles" | "stock_locations" | "products";

async function updateOne<T extends Editable>(
  supabase: Client,
  table: T,
  id: string,
  patch: Database["public"]["Tables"][T]["Update"]
) {
  // The signature is where the typing has to be right, and it is: `patch` is
  // checked against the Update type of whichever table T is, at every call
  // site. Inside, `table` is still a type parameter, so the client resolves
  // `.update()`, `.eq("id", …)` and `.select("id")` against the union of every
  // table in the schema and nothing satisfies all of them at once — including
  // the column name "id", which not every table has. Dropping the schema
  // generic for these four chained calls is narrower than sprinkling `as never`
  // through each of them, and the boundary above is unaffected.
  const untyped = supabase as unknown as SupabaseClient;
  const { data, error } = await untyped
    .from(table)
    .update(patch as Record<string, unknown>)
    .eq("id", id)
    .select("id");
  fail(error);
  if (!data || data.length === 0) {
    throw new Error(
      "That change was not saved — you may not have permission to make it."
    );
  }
}

export async function saveSupplier(
  supabase: Client,
  orgId: string,
  input: Partial<Supplier> & { name: string; id?: string }
) {
  const patch = {
    name: input.name.trim(),
    contact_name: input.contact_name?.trim() || null,
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
    account_ref: input.account_ref?.trim() || null,
  };
  if (input.id) return updateOne(supabase, "suppliers", input.id, patch);
  const { error } = await supabase.from("suppliers").insert({ org_id: orgId, ...patch });
  fail(error);
}

export async function saveDriver(
  supabase: Client,
  orgId: string,
  input: Partial<Driver> & { full_name: string; id?: string }
) {
  const patch = {
    full_name: input.full_name.trim(),
    phone: input.phone?.trim() || null,
    licence_number: input.licence_number?.trim() || null,
    licence_expires_on: input.licence_expires_on || null,
  };
  if (input.id) return updateOne(supabase, "drivers", input.id, patch);
  const { error } = await supabase.from("drivers").insert({ org_id: orgId, ...patch });
  fail(error);
}

export async function saveVehicle(
  supabase: Client,
  orgId: string,
  input: Partial<Vehicle> & { registration: string; id?: string }
) {
  const patch = {
    registration: input.registration.trim(),
    description: input.description?.trim() || null,
    make_model: input.make_model?.trim() || null,
  };
  if (input.id) return updateOne(supabase, "vehicles", input.id, patch);
  const { error } = await supabase.from("vehicles").insert({ org_id: orgId, ...patch });
  fail(error);
}

export async function saveLocation(
  supabase: Client,
  orgId: string,
  input: { id?: string; name: string; code: string | null; address: string | null }
) {
  const patch = {
    name: input.name.trim(),
    code: input.code?.trim() || null,
    address: input.address?.trim() || null,
  };
  if (input.id) return updateOne(supabase, "stock_locations", input.id, patch);
  // Only warehouses are created here. A vehicle location is created by the
  // first dispatch that uses the van, and a rep location by the transfer that
  // gives them stock — both need an id this form has no business asking for.
  const { error } = await supabase
    .from("stock_locations")
    .insert({ org_id: orgId, type: "warehouse", ...patch });
  fail(error);
}

/** Retire rather than delete: history keeps pointing at these rows. */
export async function setActive(
  supabase: Client,
  table: "suppliers" | "drivers" | "vehicles" | "stock_locations",
  id: string,
  active: boolean
) {
  return updateOne(supabase, table, id, { active });
}

export async function saveReorderLevels(
  supabase: Client,
  productId: string,
  levels: {
    min_stock_level: number | null;
    reorder_point: number | null;
    reorder_qty: number | null;
  }
) {
  // The database refuses a reorder point below the minimum. Saying so here
  // means one sentence instead of a constraint name.
  if (
    levels.min_stock_level != null &&
    levels.reorder_point != null &&
    levels.reorder_point < levels.min_stock_level
  ) {
    throw new Error(
      "The reorder point has to be at or above the minimum — the point is to reorder before the floor is breached."
    );
  }
  // `min={0}` on a number input blocks the spinner and native validation, not
  // a typed or pasted value. A negative minimum or reorder quantity is not
  // stock data that means anything, and nothing downstream would question it.
  for (const [name, value] of Object.entries(levels)) {
    if (value != null && value < 0) {
      throw new Error(`${name.replace(/_/g, " ")} cannot be negative.`);
    }
    if (value != null && !Number.isInteger(value)) {
      throw new Error(`${name.replace(/_/g, " ")} has to be a whole number of units.`);
    }
  }

  return updateOne(supabase, "products", productId, levels);
}
