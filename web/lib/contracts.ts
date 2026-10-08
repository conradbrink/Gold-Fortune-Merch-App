import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { lineTotal } from "@/lib/money-docs";

/**
 * Contracts: a fixed fee per site, invoiced by the database on the contract's
 * day each month or quarter (`contract_invoices_run`, daily). The office
 * writes the terms and lines; when to bill from, the next invoice date and the
 * run's notes are the database's (`service_contracts_stamp`).
 */

type Client = SupabaseClient<Database>;

export type Contract = Database["public"]["Tables"]["service_contracts"]["Row"];
export type ContractLine = Database["public"]["Tables"]["service_contract_lines"]["Row"];

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export type ContractListRow = Contract & { store_name: string; monthly_value: number; lines: number };

/** Every contract, with its site and what it charges per period (before VAT basis). */
export async function fetchContracts(supabase: Client): Promise<ContractListRow[]> {
  const { data, error } = await supabase
    .from("service_contracts")
    .select("*, stores(name), service_contract_lines(qty, unit_price)")
    .order("active", { ascending: false })
    .order("name");
  fail(error);
  type Raw = Contract & { stores: { name: string } | null; service_contract_lines: { qty: number; unit_price: number }[] };
  return ((data ?? []) as unknown as Raw[]).map(({ stores, service_contract_lines, ...c }) => ({
    ...c,
    store_name: stores?.name ?? "—",
    monthly_value: service_contract_lines.reduce((n, l) => n + lineTotal(Number(l.qty), Number(l.unit_price)), 0),
    lines: service_contract_lines.length,
  }));
}

export type ContractPeriodInvoice = {
  period_start: string;
  period_end: string;
  active: boolean;
  invoice_id: string;
  invoice_number: string;
  status: string;
  total: number;
  issue_date: string;
};

export type ContractDetail = {
  contract: Contract;
  storeName: string;
  lines: ContractLine[];
  invoices: ContractPeriodInvoice[];
};

export async function fetchContract(supabase: Client, id: string): Promise<ContractDetail> {
  const [c, l, inv] = await Promise.all([
    supabase.from("service_contracts").select("*, stores(name)").eq("id", id).single(),
    supabase.from("service_contract_lines").select("*").eq("contract_id", id).order("position", { nullsFirst: false }),
    supabase
      .from("service_contract_invoices")
      .select("period_start, period_end, active, invoice_id, tax_invoices(invoice_number, status, total, issue_date)")
      .eq("contract_id", id)
      .order("period_start", { ascending: false }),
  ]);
  fail(c.error);
  fail(l.error);
  fail(inv.error);
  const raw = c.data as unknown as Contract & { stores: { name: string } | null };
  const { stores, ...contract } = raw;
  type RawInv = Omit<ContractPeriodInvoice, "invoice_number" | "status" | "total" | "issue_date"> & {
    tax_invoices: { invoice_number: string; status: string; total: number; issue_date: string } | null;
  };
  return {
    contract,
    storeName: stores?.name ?? "—",
    lines: ((l.data ?? []) as ContractLine[]).map((x) => ({
      ...x,
      qty: Number(x.qty),
      unit_price: Number(x.unit_price),
    })),
    invoices: ((inv.data ?? []) as unknown as RawInv[]).map(({ tax_invoices, ...i }) => ({
      ...i,
      invoice_number: tax_invoices?.invoice_number ?? "—",
      status: tax_invoices?.status ?? "",
      total: Number(tax_invoices?.total ?? 0),
      issue_date: tax_invoices?.issue_date ?? "",
    })),
  };
}

export type ContractInput = {
  storeId: string;
  name: string;
  period: "monthly" | "quarterly";
  billing: "advance" | "arrears";
  invoiceDay: number;
  startsOn: string;
  endsOn: string | null;
  reference: string | null;
  notes: string | null;
  active: boolean;
};

export type ContractLineInput = {
  serviceItemId: string | null;
  description: string;
  unit: string | null;
  qty: number;
  unitPrice: number;
};

const terms = (i: ContractInput) => ({
  store_id: i.storeId,
  name: i.name.trim(),
  period: i.period,
  billing: i.billing,
  invoice_day: i.invoiceDay,
  starts_on: i.startsOn,
  ends_on: i.endsOn || null,
  reference: i.reference?.trim() || null,
  notes: i.notes?.trim() || null,
  active: i.active,
});

/**
 * Writes the contract's lines: the old ones out, these in. Lines only shape
 * future invoices; issued ones keep what they were issued with.
 */
async function writeLines(supabase: Client, orgId: string, contractId: string, lines: ContractLineInput[]) {
  const del = await supabase.from("service_contract_lines").delete().eq("contract_id", contractId);
  fail(del.error);
  if (lines.length === 0) return;
  const { error } = await supabase.from("service_contract_lines").insert(
    lines.map((l, i) => ({
      contract_id: contractId,
      org_id: orgId,
      position: i + 1,
      service_item_id: l.serviceItemId,
      description: l.description.trim(),
      unit: l.unit?.trim() || null,
      qty: l.qty,
      unit_price: l.unitPrice,
    }))
  );
  fail(error);
}

export async function createContract(
  supabase: Client,
  orgId: string,
  input: ContractInput,
  lines: ContractLineInput[]
): Promise<string> {
  if (lines.length === 0) throw new Error("A contract needs at least one line to invoice.");
  const { data, error } = await supabase
    .from("service_contracts")
    .insert({ org_id: orgId, ...terms(input) })
    .select("id")
    .single();
  fail(error);
  const id = (data as { id: string }).id;
  try {
    await writeLines(supabase, orgId, id, lines);
  } catch (e) {
    // A contract without lines would fail every run: take it back out.
    await supabase.from("service_contracts").delete().eq("id", id);
    throw e;
  }
  return id;
}

export async function updateContract(
  supabase: Client,
  orgId: string,
  id: string,
  input: ContractInput,
  lines: ContractLineInput[]
) {
  if (lines.length === 0) throw new Error("A contract needs at least one line to invoice.");
  const { error } = await supabase.from("service_contracts").update(terms(input)).eq("id", id);
  fail(error);
  await writeLines(supabase, orgId, id, lines);
}

export async function deleteContract(supabase: Client, id: string) {
  const { error } = await supabase.from("service_contracts").delete().eq("id", id);
  fail(error);
}

/** Invoices whatever is due now (one contract, or all). Returns how many were issued. */
export async function runContractsNow(supabase: Client, contractId?: string): Promise<number> {
  const { data, error } = await supabase.rpc("contract_invoices_run_now", { p_contract: contractId ?? null });
  fail(error);
  return Number(data ?? 0);
}

/** A period whose invoice was voided, invoiced again now. Returns the new invoice's id. */
export async function reinvoicePeriod(supabase: Client, contractId: string, periodStart: string): Promise<string> {
  const { data, error } = await supabase.rpc("contract_reinvoice_period", {
    p_contract: contractId,
    p_period_start: periodStart,
  });
  fail(error);
  return data as string;
}
