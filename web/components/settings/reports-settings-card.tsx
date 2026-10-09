"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { refreshCompanyConfig, useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { availableReportTabs, companyReportTabs, reportTabs, tabsFromSetting, type ReportTab } from "@/lib/report-tabs";

type Draft = { tabs: ReportTab[]; shortHours: string; longHours: string };

const hoursOk = (v: string) => /^\d{1,2}$/.test(v) && Number(v) <= 24;

/**
 * The Reports page's tabs and their order (`report_tabs`), and the Hours
 * report's short and long day marks, all seeded from the trade at sign-up.
 */
export function ReportsSettingsCard({ orgId, canEdit }: { orgId: string; canEdit: boolean }) {
  const t = useTerms();
  const config = useCompanyConfig();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!config) return null;
  const current: Draft = {
    tabs: companyReportTabs(config.modules, config.settings.report_tabs),
    shortHours: String(config.settings.report_short_day_hours),
    longHours: String(config.settings.report_long_day_hours),
  };
  const d = draft ?? current;
  const labels = new Map(reportTabs(t).map((x) => [x.value, x.label]));
  const offered = availableReportTabs(config.modules).filter((tab) => !d.tabs.includes(tab));
  const change = (next: Partial<Draft>) => {
    setSaved(false);
    setDraft({ ...d, ...next });
  };

  function move(i: number, by: -1 | 1) {
    const next = [...d.tabs];
    const [tab] = next.splice(i, 1);
    next.splice(i + by, 0, tab);
    change({ tabs: next });
  }

  async function save() {
    if (d.tabs.length === 0) return setError("Keep at least one tab.");
    if (!hoursOk(d.shortHours) || !hoursOk(d.longHours)) return setError("Hours are a whole number from 0 to 24.");
    setBusy(true);
    setError(null);
    const { error: e } = await createClient()
      .from("company_settings")
      .upsert(
        [
          { org_id: orgId, key: "report_tabs", value: d.tabs.join(",") },
          { org_id: orgId, key: "report_short_day_hours", value: Number(d.shortHours) },
          { org_id: orgId, key: "report_long_day_hours", value: Number(d.longHours) },
        ],
        { onConflict: "org_id,key" }
      );
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
    // Any failed lookup stops here: falling back to the defaults would save
    // distribution's tabs as a service trade's own.
    const { data: org, error: orgError } = await supabase.from("organizations").select("industries").eq("id", orgId).single();
    if (orgError) {
      setBusy(false);
      return setError(`Your trade could not be read (${orgError.message}). Nothing was changed.`);
    }
    const trade = (org as { industries: string[] | null } | null)?.industries?.[0] ?? null;
    const [{ data: rows, error: rowsError }, { data: defs, error: defsError }] = await Promise.all([
      trade
        ? supabase
            .from("template_settings")
            .select("setting_key, value")
            .eq("template_code", trade)
            .in("setting_key", ["report_tabs", "report_short_day_hours", "report_long_day_hours"])
        : Promise.resolve({ data: [] as { setting_key: string; value: unknown }[], error: null }),
      supabase
        .from("setting_definitions")
        .select("key, default_value")
        .in("key", ["report_tabs", "report_short_day_hours", "report_long_day_hours"]),
    ]);
    setBusy(false);
    const failed = rowsError ?? defsError;
    if (failed) return setError(`Your trade's settings could not be read (${failed.message}). Nothing was changed.`);
    const value = (key: string) =>
      (rows as { setting_key: string; value: unknown }[] | null)?.find((r) => r.setting_key === key)?.value ??
      (defs as { key: string; default_value: unknown }[] | null)?.find((r) => r.key === key)?.default_value;
    const tabs = tabsFromSetting(String(value("report_tabs") ?? "")).filter((tab) =>
      availableReportTabs(config!.modules).includes(tab)
    );
    if (tabs.length === 0) return setError("Your trade has no standard tabs to go back to.");
    change({
      tabs,
      shortHours: String(Number(value("report_short_day_hours") ?? 0)),
      longHours: String(Number(value("report_long_day_hours") ?? 0)),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Reports</CardTitle>
        <CardDescription>
          The tabs on the Reports page, in this order, and when the Hours report marks a day as short or long.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="divide-y divide-border rounded-lg border border-border">
          {d.tabs.map((tab, i) => (
            <li key={tab} className="flex min-h-11 items-center gap-2 px-3 py-2">
              <span className="w-5 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
              <span className="min-w-0 flex-1 text-sm font-medium text-foreground">{labels.get(tab)}</span>
              {canEdit && (
                <span className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="icon-sm" aria-label={`Move ${labels.get(tab)} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp className="size-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${labels.get(tab)} down`}
                    disabled={i === d.tabs.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown className="size-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${labels.get(tab)}`}
                    disabled={d.tabs.length === 1}
                    onClick={() => change({ tabs: d.tabs.filter((x) => x !== tab) })}
                  >
                    <X className="size-4" aria-hidden />
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ol>
        {canEdit && offered.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect aria-label="Add a tab" value={adding} onChange={(e) => setAdding(e.target.value)} className="max-w-xs">
              <option value="">Add a tab…</option>
              {offered.map((tab) => (
                <option key={tab} value={tab}>
                  {labels.get(tab)}
                </option>
              ))}
            </NativeSelect>
            <Button
              variant="outline"
              disabled={!adding}
              onClick={() => {
                change({ tabs: [...d.tabs, adding as ReportTab] });
                setAdding("");
              }}
            >
              Add
            </Button>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="report-short-day">Short day under (hours)</Label>
            <Input
              id="report-short-day"
              inputMode="numeric"
              value={d.shortHours}
              disabled={!canEdit}
              aria-describedby="report-day-hint"
              onChange={(e) => change({ shortHours: e.target.value.trim() })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-long-day">Long day over (hours)</Label>
            <Input
              id="report-long-day"
              inputMode="numeric"
              value={d.longHours}
              disabled={!canEdit}
              aria-describedby="report-day-hint"
              onChange={(e) => change({ longHours: e.target.value.trim() })}
            />
          </div>
          <p id="report-day-hint" className="text-xs text-muted-foreground sm:col-span-2">
            0 turns a mark off. Only finished workdays are marked.
          </p>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {canEdit && (
          <div className="flex flex-wrap items-center justify-end gap-3">
            {saved && <span className="text-sm text-muted-foreground">Saved.</span>}
            <Button variant="ghost" onClick={resetToTrade} disabled={busy}>
              Reset to my trade&apos;s
            </Button>
            <Button onClick={save} disabled={busy || draft === null}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
