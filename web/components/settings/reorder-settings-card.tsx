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
import { storeReorderHref } from "@/lib/dashboard-links";

/**
 * When a store is due for an order: the one rule an owner sets. Each store's
 * own rhythm does the rest (lib/store-reorder.ts). Only for a company that
 * takes orders.
 */
export function ReorderSettingsCard({ orgId, canEdit }: { orgId: string; canEdit: boolean }) {
  const t = useTerms();
  const config = useCompanyConfig();
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!config || !moduleEnabled(config.modules, "distribution")) return null;
  const value = draft ?? String(config.settings.reorder_after_days);
  const site = lower(t.site.one);

  async function save() {
    const days = Number(value);
    if (!Number.isInteger(days) || days < 7 || days > 180) {
      return setError("Choose a whole number of days from 7 to 180.");
    }
    setBusy(true);
    setError(null);
    const { error: e } = await createClient()
      .from("company_settings")
      .upsert([{ org_id: orgId, key: "reorder_after_days", value: days }], { onConflict: "org_id,key" });
    setBusy(false);
    if (e) return setError(e.message);
    setDraft(null);
    refreshCompanyConfig();
    setSaved(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Orders</CardTitle>
        <CardDescription>
          When a {site} is due for an order, your team sees it on their phones at the {site}, and you see it on{" "}
          <Link href={storeReorderHref()} className="text-primary hover:underline">
            {t.site.many} due for an order
          </Link>
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <section className="space-y-1.5">
          <label htmlFor="reorder-days" className="block text-sm font-medium text-foreground">
            Ask for an order after (days)
          </label>
          <Input
            id="reorder-days"
            type="number"
            min={7}
            max={180}
            className="w-28"
            value={value}
            disabled={!canEdit}
            aria-describedby="reorder-days-help"
            onChange={(e) => {
              setSaved(false);
              setDraft(e.target.value);
            }}
          />
          <p id="reorder-days-help" className="text-xs text-muted-foreground">
            A {site} that hasn&apos;t ordered for this many days is due for an order. A {site} that usually orders
            sooner is due at its own usual time, worked out from its last year of orders.
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
