import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * The company's price list: the services it quotes and invoices (call-out,
 * labour per hour, a standard clean…). Seeded from its trade without prices;
 * a null price is "not set yet". Lines copy the name, unit and price when they
 * are written, so changing the list never changes a quote or an invoice.
 */

type Client = SupabaseClient<Database>;

export type ServiceItem = Database["public"]["Tables"]["service_items"]["Row"];

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function fetchServiceItems(supabase: Client, opts: { activeOnly?: boolean } = {}) {
  let q = supabase.from("service_items").select("*").order("sort_order").order("name");
  if (opts.activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  fail(error);
  return ((data ?? []) as ServiceItem[]).map((i) => ({
    ...i,
    unit_price: i.unit_price === null ? null : Number(i.unit_price),
  }));
}

export type ServiceItemInput = {
  name: string;
  description: string | null;
  unit: string;
  unitPrice: number | null;
  active: boolean;
};

export async function createServiceItem(supabase: Client, orgId: string, input: ServiceItemInput, sortOrder: number) {
  const { error } = await supabase.from("service_items").insert({
    org_id: orgId,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    unit: input.unit.trim(),
    unit_price: input.unitPrice,
    active: input.active,
    sort_order: sortOrder,
  });
  fail(error);
}

export async function updateServiceItem(supabase: Client, id: string, input: ServiceItemInput) {
  const { error } = await supabase
    .from("service_items")
    .update({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      unit: input.unit.trim(),
      unit_price: input.unitPrice,
      active: input.active,
    })
    .eq("id", id);
  fail(error);
}

export async function deleteServiceItem(supabase: Client, id: string) {
  const { error } = await supabase.from("service_items").delete().eq("id", id);
  fail(error);
}
