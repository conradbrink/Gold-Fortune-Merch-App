"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StepCard } from "@/components/setup/step-card";
import { createClient } from "@/lib/supabase/client";
import { useCompanyConfig } from "@/lib/use-company-config";
import { moduleEnabled } from "@/lib/modules";
import { validPrice } from "@/lib/money-docs";
import {
  createServiceItem,
  fetchServiceItems,
  updateServiceItem,
  type ServiceItem,
} from "@/lib/service-items";
import type { StepProps } from "./types";

type NewRow = { key: number; name: string; unit: string; price: string };

/**
 * Prices for the price list the trade came with: one box per item, its unit
 * beside it, any left empty for later. A company that sells products adds
 * them on the Products page, where a spreadsheet can be imported.
 */
export function PricesStep(props: StepProps) {
  const config = useCompanyConfig();
  if (config && moduleEnabled(config.modules, "distribution")) return <ProductsNote {...props} />;
  return <PriceList {...props} />;
}

function ProductsNote({ setup, text, icon, onBack, onNext }: StepProps) {
  return (
    <StepCard icon={icon} title={text.title} subtitle={text.subtitle} time={text.time} onBack={onBack} onContinue={onNext}>
      <div className="space-y-3 text-sm">
        <p>
          {setup.counts.products === 0
            ? "You have no products yet."
            : `You have ${setup.counts.products} product${setup.counts.products === 1 ? "" : "s"}.`}{" "}
          Add them one at a time or import a spreadsheet on the Products page. It opens in a new tab, so this stays
          where it is.
        </p>
        <Button variant="outline" nativeButton={false} render={<Link href="/products" target="_blank" rel="noopener" />}>
          <ExternalLink className="mr-1.5 size-4" aria-hidden /> Open Products
        </Button>
      </div>
    </StepCard>
  );
}

function PriceList({ org, text, icon, onBack, onNext, reload }: StepProps) {
  const config = useCompanyConfig();
  const currency = config?.settings.currency_code ?? "";
  const [items, setItems] = useState<ServiceItem[]>([]);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<NewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchServiceItems(createClient(), { activeOnly: true });
        if (cancelled) return;
        setItems(list);
        setPrices(Object.fromEntries(list.map((i) => [i.id, i.unit_price === null ? "" : String(i.unit_price)])));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setError(null);
    const changed = items.filter((i) => (prices[i.id] ?? "") !== (i.unit_price === null ? "" : String(i.unit_price)));
    for (const i of changed) {
      const p = prices[i.id].trim();
      if (p !== "" && !validPrice(p)) return setError(`The price for ${i.name} is not a price, like 450 or 450.50.`);
    }
    const added = rows.filter((r) => r.name.trim());
    for (const r of added) {
      if (!r.unit.trim()) return setError(`Give ${r.name.trim()} a unit, like hour or each.`);
      if (r.price.trim() !== "" && !validPrice(r.price.trim())) {
        return setError(`The price for ${r.name.trim()} is not a price, like 450 or 450.50.`);
      }
    }
    setBusy(true);
    const supabase = createClient();
    try {
      for (const i of changed) {
        const p = prices[i.id].trim();
        await updateServiceItem(supabase, i.id, {
          name: i.name,
          description: i.description,
          unit: i.unit ?? "",
          unitPrice: p === "" ? null : Number(p),
          active: i.active,
        });
      }
      let order = items.reduce((m, i) => Math.max(m, i.sort_order ?? 0), 0);
      for (const r of added) {
        order += 10;
        await createServiceItem(
          supabase,
          org.id,
          { name: r.name, description: null, unit: r.unit, unitPrice: r.price.trim() === "" ? null : Number(r.price), active: true },
          order
        );
      }
      await reload();
      setBusy(false);
      onNext();
    } catch (e) {
      setBusy(false);
      setError(`Some prices were not saved: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <StepCard
      icon={icon}
      title={text.title}
      subtitle={text.subtitle}
      time={text.time}
      onBack={onBack}
      onContinue={save}
      busy={busy || loading}
      error={error}
    >
      <div className="space-y-3">
        {loading && <p className="text-sm text-muted-foreground">Loading your price list…</p>}
        {!loading && items.length === 0 && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">Your price list is empty. Add what you sell below.</p>
        )}
        <ul className="divide-y divide-border">
          {items.map((i) => (
            <li key={i.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2 sm:grid-cols-[minmax(0,1fr)_6rem_9rem]">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">{i.name}</span>
                <span className="text-xs text-muted-foreground sm:hidden">per {i.unit}</span>
              </span>
              <span className="hidden text-sm text-muted-foreground sm:block">per {i.unit}</span>
              <Input
                aria-label={`Price for ${i.name}, ${currency}`}
                inputMode="decimal"
                placeholder={currency}
                value={prices[i.id] ?? ""}
                onChange={(e) => setPrices((p) => ({ ...p, [i.id]: e.target.value }))}
                className="w-32 sm:w-full"
              />
            </li>
          ))}
          {rows.map((r) => (
            <li key={r.key} className="grid grid-cols-1 gap-2 py-2 sm:grid-cols-[minmax(0,1fr)_6rem_9rem_auto] sm:items-center">
              <Input
                aria-label="What you sell"
                placeholder="What you sell"
                value={r.name}
                onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, name: e.target.value } : x)))}
              />
              <Input
                aria-label="Unit"
                placeholder="hour"
                value={r.unit}
                onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, unit: e.target.value } : x)))}
              />
              <Input
                aria-label={`Price, ${currency}`}
                inputMode="decimal"
                placeholder="Price"
                value={r.price}
                onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, price: e.target.value } : x)))}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Remove this line"
                onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
        <Button
          variant="outline"
          onClick={() => setRows((rs) => [...rs, { key: Date.now(), name: "", unit: "", price: "" }])}
        >
          <Plus className="mr-1.5 size-4" aria-hidden /> Add your own
        </Button>
        <p className="text-xs text-muted-foreground">
          {Number(org.vat_rate) > 0 && `Prices are ${org.prices_include_vat ? "with" : "before"} VAT, as you chose on the last step. `}
          Change any of this later on the Price list page.
        </p>
      </div>
    </StepCard>
  );
}
