"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/warehouse/stat-tile";
import { ContractForm, contractProblem, type ContractDraft } from "@/components/money/contract-form";
import { blankLine, type EditableLine } from "@/components/money/line-editor";
import { fetchOrgId } from "@/lib/representatives";
import { fetchStoresForOrder } from "@/lib/orders";
import { fetchServiceItems, type ServiceItem } from "@/lib/service-items";
import { fetchDocumentSettings, type DocumentSettings } from "@/lib/document-settings";
import { createContract } from "@/lib/contracts";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A new contract: its site, how it is billed, and what it charges each period. */
export default function NewContractPage() {
  const supabase = createClient();
  const t = useTerms();
  const config = useCompanyConfig();
  const router = useRouter();
  const currency = config?.settings.currency_code ?? "";
  const [orgId, setOrgId] = useState<string | null>(null);
  const [doc, setDoc] = useState<DocumentSettings | null>(null);
  const [stores, setStores] = useState<{ id: string; name: string; city: string | null }[]>([]);
  const [items, setItems] = useState<ServiceItem[]>([]);
  const [draft, setDraft] = useState<ContractDraft>(() => ({
    storeId: "",
    name: "",
    period: "monthly",
    billing: "advance",
    invoiceDay: "1",
    startsOn: localToday(),
    endsOn: "",
    reference: "",
    notes: "",
    active: true,
  }));
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [org, d, s, si] = await Promise.all([
          fetchOrgId(supabase),
          fetchDocumentSettings(supabase),
          fetchStoresForOrder(supabase),
          fetchServiceItems(supabase, { activeOnly: true }),
        ]);
        if (cancelled) return;
        setOrgId(org);
        setDoc(d);
        setStores(s);
        setItems(si);
        setLines((prev) => (prev.length > 0 ? prev : [blankLine()]));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function save() {
    setError(null);
    if (!orgId) return;
    const problem = contractProblem(draft, lines, t);
    if (problem) return setError(problem);
    setSaving(true);
    try {
      const id = await createContract(
        supabase,
        orgId,
        {
          ...draft,
          invoiceDay: Number(draft.invoiceDay),
          endsOn: draft.endsOn || null,
          reference: draft.reference || null,
          notes: draft.notes || null,
        },
        lines.map((l) => ({
          serviceItemId: l.serviceItemId,
          description: l.description,
          unit: l.unit || null,
          qty: Number(l.qty),
          unitPrice: Number(l.price),
        }))
      );
      router.push(`/contracts/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/contracts" className="text-sm text-muted-foreground hover:text-foreground">
          ← Contracts
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground">New contract</h1>
      </div>
      <ErrorBanner message={error} />
      <ContractForm
        draft={draft}
        onChange={setDraft}
        lines={lines}
        onLinesChange={setLines}
        stores={stores}
        items={items}
        currency={currency}
        vatRate={Number(doc?.vat_rate ?? 0)}
        pricesIncludeVat={doc?.prices_include_vat ?? false}
        termsFixed={false}
        today={localToday()}
        disabled={loading || saving}
      />
      <div className="flex justify-end gap-2">
        <Button variant="outline" nativeButton={false} render={<Link href="/contracts" />}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving || loading}>
          {saving ? "Saving…" : "Save contract"}
        </Button>
      </div>
    </div>
  );
}
