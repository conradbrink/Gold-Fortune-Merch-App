import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { CreditNote, Customer, Invoice, Payment } from "@/lib/accounting/documents";
import type { Connection, FinishInput, LinkKind, QueueRow, SyncDb } from "@/lib/accounting/sync";

/** The sync's reads and writes, with the service-role client. */
export function supabaseSyncDb(admin: SupabaseClient<Database>): SyncDb {
  const must = <T>(label: string, res: { data: T; error: { message: string } | null }): T => {
    if (res.error) throw new Error(`${label}: ${res.error.message}`);
    return res.data;
  };

  return {
    async claim() {
      const rows = must("claim", await admin.rpc("accounting_claim", {}));
      return (rows ?? []) as QueueRow[];
    },

    async requeueStale(olderThanMs) {
      // A run that died mid-send leaves rows "sending". Each kind can safely be
      // tried again (an invoice or credit note is looked for in Sage first, a
      // payment's receipt is linked the moment Sage returns it), so they go
      // back to the queue keeping their attempt.
      must(
        "requeue",
        await admin
          .from("accounting_queue")
          .update({ status: "queued", send_after: new Date().toISOString() })
          .eq("status", "sending")
          .lt("updated_at", new Date(Date.now() - olderThanMs).toISOString()),
      );
    },

    async connection(org) {
      const data = must(
        "connection",
        await admin
          .from("accounting_connections")
          .select("org_id, company_id, bank_account_id")
          .eq("org_id", org)
          .maybeSingle(),
      );
      return (data as Connection | null) ?? null;
    },

    async sealedSignIn(org) {
      const data = must(
        "secret",
        await admin.from("accounting_secrets").select("sealed").eq("org_id", org).maybeSingle(),
      );
      return data?.sealed ?? null;
    },

    async link(org, companyId, kind: LinkKind, localId) {
      const data = must(
        "link",
        await admin
          .from("accounting_links")
          .select("remote_id")
          .eq("org_id", org)
          .eq("provider", "sage_za")
          .eq("company_id", companyId)
          .eq("kind", kind)
          .eq("local_id", localId)
          .maybeSingle(),
      );
      return data?.remote_id ?? null;
    },

    async setLink(org, companyId, kind, localId, remoteId) {
      must(
        "set link",
        await admin
          .from("accounting_links")
          .upsert(
            { org_id: org, provider: "sage_za", company_id: companyId, kind, local_id: localId, remote_id: remoteId },
            { onConflict: "org_id,provider,company_id,kind,local_id" },
          ),
      );
    },

    async invoice(id) {
      const inv = must(
        "invoice",
        await admin
          .from("tax_invoices")
          .select(
            "id, invoice_number, status, store_id, customer_name, customer_address, customer_email, issue_date, due_date, " +
              "vat_rate, prices_include_vat, subtotal, total, reference, customer_po_number, " +
              "tax_invoice_lines(id, position, product_id, description, qty, unit_price, line_total, unit)",
          )
          .eq("id", id)
          .maybeSingle(),
      ) as (Omit<Invoice, "lines"> & { tax_invoice_lines: Invoice["lines"] }) | null;
      if (!inv) return null;
      const { tax_invoice_lines, ...head } = inv;
      return { ...head, lines: tax_invoice_lines ?? [] };
    },

    async creditNote(id) {
      const cn = must(
        "credit note",
        await admin
          .from("credit_notes")
          .select("id, credit_number, invoice_id, reason, issue_date, subtotal, total, credit_note_lines(invoice_line_id, qty, unit_price, line_total)")
          .eq("id", id)
          .maybeSingle(),
      ) as (Omit<CreditNote, "lines"> & { credit_note_lines: CreditNote["lines"] }) | null;
      if (!cn) return null;
      const { credit_note_lines, ...head } = cn;
      return { ...head, lines: credit_note_lines ?? [] };
    },

    async payment(id) {
      const data = must(
        "payment",
        await admin
          .from("invoice_payments")
          .select("id, invoice_id, amount, paid_on, method, reference")
          .eq("id", id)
          .maybeSingle(),
      );
      return (data as Payment | null) ?? null;
    },

    async customer(storeId) {
      const store = must(
        "store",
        await admin.from("stores").select("name, address, city, zip").eq("id", storeId).maybeSingle(),
      );
      if (!store) return null;
      const contacts = must(
        "contacts",
        await admin
          .from("site_contacts")
          .select("name, email, phone, receives_accounts")
          .eq("store_id", storeId)
          .order("receives_accounts", { ascending: false })
          .order("created_at")
          .limit(1),
      );
      const contact = contacts?.[0];
      const customer: Customer = {
        name: store.name,
        address: store.address,
        city: store.city,
        zip: store.zip,
        contact_name: contact?.name ?? null,
        email: contact?.email ?? null,
        phone: contact?.phone ?? null,
      };
      return customer;
    },

    async products(ids) {
      if (ids.length === 0) return new Map();
      const rows = must("products", await admin.from("products").select("id, sku_code, name").in("id", ids));
      return new Map((rows ?? []).map((p) => [p.id, { code: p.sku_code?.trim() || null, name: p.name }]));
    },

    async invoiceQueueStatus(org, invoiceId) {
      const data = must(
        "invoice status",
        await admin
          .from("accounting_queue")
          .select("status")
          .eq("org_id", org)
          .eq("kind", "invoice")
          .eq("local_id", invoiceId)
          .maybeSingle(),
      );
      return data?.status ?? null;
    },

    async finish(row: QueueRow, r: FinishInput) {
      must(
        "finish",
        await admin.rpc("accounting_finish", {
          p_id: row.id,
          p_ok: "ok" in r,
          p_remote_id: "ok" in r ? r.remoteId : null,
          p_error: "fail" in r ? r.fail : "wait" in r ? r.wait : "skip" in r ? r.skip : null,
          p_permanent: "fail" in r ? r.permanent : false,
          p_calls: r.calls,
          p_wait: "wait" in r,
          p_skip: "skip" in r,
        }),
      );
    },

    async pause(org, until, message) {
      must(
        "pause",
        await admin
          .from("accounting_connections")
          .update({ paused_until: until === "infinity" ? "infinity" : until.toISOString(), last_error: message })
          .eq("org_id", org),
      );
    },
  };
}
