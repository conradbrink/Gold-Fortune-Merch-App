import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * The company's details that go onto its quotes and invoices — VAT, numbers,
 * bank details, prefixes, terms. They live on `organizations`, next to the
 * name and address, and are copied onto each invoice when it is issued.
 */

type Client = SupabaseClient<Database>;

export type DocumentSettings = Pick<
  Database["public"]["Tables"]["organizations"]["Row"],
  | "id"
  | "vat_rate"
  | "vat_number"
  | "tax_number"
  | "registration_number"
  | "bank_details"
  | "prices_include_vat"
  | "invoice_prefix"
  | "quote_prefix"
  | "quote_validity_days"
  | "invoice_terms_days"
  | "invoice_footer"
>;

const COLUMNS =
  "id, vat_rate, vat_number, tax_number, registration_number, bank_details, prices_include_vat, invoice_prefix, quote_prefix, quote_validity_days, invoice_terms_days, invoice_footer";

export async function fetchDocumentSettings(supabase: Client): Promise<DocumentSettings> {
  const { data, error } = await supabase.from("organizations").select(COLUMNS).limit(1).single();
  if (error) throw new Error(error.message);
  const d = data as DocumentSettings;
  return { ...d, vat_rate: Number(d.vat_rate) };
}

/** A prefix the database's numbering accepts: two to six capital letters. */
export function validPrefix(p: string): boolean {
  return /^[A-Z]{2,6}$/.test(p);
}

/** YYYY-MM-DD, `days` from today (the quote's default valid-until). */
export function daysFromToday(days: number, today = new Date()): string {
  const d = new Date(today);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
