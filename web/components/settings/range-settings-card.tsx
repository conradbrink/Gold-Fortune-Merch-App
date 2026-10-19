"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { refreshCompanyConfig, useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { moduleEnabled } from "@/lib/modules";
import { lower } from "@/lib/terms";
import { storeRangeHref } from "@/lib/dashboard-links";

/**
 * Range: the one number an owner may want to change. Tickd works out each
 * store's range from the orders (lib/store-range.ts); this says how recent an
 * order must be for a store to count as having the product. Only for a
 * company that takes orders.
 */
export function RangeSettingsCard({ orgId, canEdit }: { orgId: string; canEdit: boolean }) {
  const t = useTerms();
  const config = useCompanyConfig();
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!config || !moduleEnabled(config.modules, "distribution")) return null;
  const value = draft ?? String(config.settings.range_lapse_days);
  const site = lower(t.site.one);

  async function save() {
    const days = Number(value);
    if (!Number.isInteger(days) || days < 14 || days > 180) {
      return setError("Choose a whole number of days from 14 to 180.");
    }
    setBusy(true);
    setError(null);
    const { error: e } = await createClient()
      .from("company_settings")
      .upsert([{ org_id: orgId, key: "range_lapse_days", value: days }], { onConflict: "org_id,key" });
    setBusy(false);
    if (e) return setError(e.message);
    setDraft(null);
    refreshCompanyConfig();
    setSaved(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Range</CardTitle>
        <CardDescription>
          Tickd works out which products each {site} should have from your orders, and shows what is missing on{" "}
          <Link href={storeRangeHref()} className="text-primary hover:underline">
            Range
          </Link>
          . There is nothing to set up.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <section className="space-y-1.5">
          <label htmlFor="range-days" className="block text-sm font-medium text-foreground">
            A {site} has a product if it ordered it in the last (days)
          </label>
          <Input
            id="range-days"
            type="number"
            min={14}
            max={180}
            className="w-28"
            value={value}
            disabled={!canEdit}
            aria-describedby="range-days-help"
            onChange={(e) => {
              setSaved(false);
              setDraft(e.target.value);
            }}
          />
          <p id="range-days-help" className="text-xs text-muted-foreground">
            If your {lower(t.site.many)} order every two or three weeks, 60 days is about three missed orders. A product
            not ordered in that time shows as missing, or as stopped if they used to order it.
          </p>
        </section>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {canEdit && (
          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={busy || draft === null}>
              {busy ? "Saving…" : "Save"}
            </Button>
            {saved && <span className="text-sm text-muted-foreground">Saved.</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
