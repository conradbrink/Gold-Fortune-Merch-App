"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { refreshCompanyConfig, useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { moduleEnabled } from "@/lib/modules";
import { KPIS, codesFromSetting, findKpi } from "@/lib/kpis";

/**
 * Which numbers "Your numbers" shows, in order: the company setting
 * `dashboard_cards`, seeded from the trade at sign-up. Each person's card
 * layout stays their own (Customise on the dashboard).
 */
export function DashboardSettingsCard({ orgId, canEdit }: { orgId: string; canEdit: boolean }) {
  const t = useTerms();
  const config = useCompanyConfig();
  const [draft, setDraft] = useState<string[] | null>(null);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const known = (c: string) => !!findKpi(c);
  const current = codesFromSetting(config?.settings.dashboard_cards ?? "", known);
  const list = draft ?? current;
  const change = (next: string[]) => {
    setSaved(false);
    setDraft(next);
  };
  // Money only where the company invoices; checklists only where it has forms.
  const offered = KPIS.filter(
    (k) =>
      !list.includes(k.code) &&
      (!k.money || (config && moduleEnabled(config.modules, "invoicing"))) &&
      (k.code !== "forms_done" || (config && moduleEnabled(config.modules, "checklists_forms")))
  );

  function move(i: number, by: -1 | 1) {
    const next = [...list];
    const [c] = next.splice(i, 1);
    next.splice(i + by, 0, c);
    change(next);
  }

  async function save(codes: string[]) {
    setBusy(true);
    setError(null);
    const { error: e } = await createClient()
      .from("company_settings")
      .upsert([{ org_id: orgId, key: "dashboard_cards", value: codes.join(",") }], { onConflict: "org_id,key" });
    setBusy(false);
    if (e) return setError(`Not saved: ${e.message}`);
    refreshCompanyConfig();
    setDraft(null);
    setSaved(true);
  }

  async function resetToTrade() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data: org } = await supabase.from("organizations").select("industries").eq("id", orgId).single();
    const trade = (org as { industries: string[] | null } | null)?.industries?.[0] ?? null;
    const { data: row } = trade
      ? await supabase
          .from("template_settings")
          .select("value")
          .eq("template_code", trade)
          .eq("setting_key", "dashboard_cards")
          .maybeSingle()
      : { data: null };
    setBusy(false);
    const codes = codesFromSetting((row as { value: unknown } | null)?.value ?? "", known);
    if (codes.length === 0) return setError("Your trade has no standard numbers to go back to.");
    change(codes);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Dashboard numbers</CardTitle>
        <CardDescription>
          The numbers at the top of everyone&apos;s dashboard, in this order. Six to eight read best. Each person can
          still arrange their own cards with Customise.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="divide-y divide-border rounded-lg border border-border">
          {list.map((code, i) => {
            const k = findKpi(code)!;
            return (
              <li key={code} className="flex min-h-11 items-center gap-2 px-3 py-2">
                <span className="w-5 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">{k.label(t)}</span>
                  <span className="block text-xs text-muted-foreground">{k.hint(t)}</span>
                </span>
                {canEdit && (
                  <span className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="icon-sm" aria-label={`Move ${k.label(t)} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp className="size-4" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move ${k.label(t)} down`}
                      disabled={i === list.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown className="size-4" aria-hidden />
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Remove ${k.label(t)}`} onClick={() => change(list.filter((c) => c !== code))}>
                      <X className="size-4" aria-hidden />
                    </Button>
                  </span>
                )}
              </li>
            );
          })}
          {list.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">No numbers chosen.</li>}
        </ol>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect aria-label="Add a number" value={adding} onChange={(e) => setAdding(e.target.value)} className="max-w-xs">
              <option value="">Add a number…</option>
              {offered.map((k) => (
                <option key={k.code} value={k.code}>
                  {k.label(t)}
                </option>
              ))}
            </NativeSelect>
            <Button
              variant="outline"
              disabled={!adding}
              onClick={() => {
                change([...list, adding]);
                setAdding("");
              }}
            >
              Add
            </Button>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {canEdit && (
          <div className="flex flex-wrap items-center justify-end gap-3">
            {saved && <span className="text-sm text-muted-foreground">Saved.</span>}
            <Button variant="ghost" onClick={resetToTrade} disabled={busy}>
              Reset to my trade&apos;s
            </Button>
            <Button onClick={() => save(list)} disabled={busy || draft === null}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
