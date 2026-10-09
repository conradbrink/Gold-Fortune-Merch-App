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
import { moduleEnabled } from "@/lib/modules";
import { lower } from "@/lib/terms";
import { SCORE_PARTS, findPart, parseWeights, weightsSetting } from "@/lib/staff-score";

type DraftWeight = { code: string; weight: string };
type Draft = {
  tabs: ReportTab[];
  shortHours: string;
  longHours: string;
  dayNormal: string;
  weekNormal: string;
  sundayOvertime: boolean;
  weights: DraftWeight[];
};

const SETTING_KEYS = [
  "report_tabs",
  "report_short_day_hours",
  "report_long_day_hours",
  "report_day_normal_hours",
  "report_week_normal_hours",
  "report_sunday_is_overtime",
  "staff_score_weights",
];
const toDraftWeights = (setting: string) => parseWeights(setting).map((w) => ({ code: w.code, weight: String(w.weight) }));
const weightOk = (v: string) => /^\d{1,3}$/.test(v) && Number(v) <= 100;

const hoursOk = (v: string) => /^\d{1,2}$/.test(v) && Number(v) <= 24;
const weekHoursOk = (v: string) => /^\d{1,3}$/.test(v) && Number(v) <= 168;

/**
 * The Reports page's tabs and their order (`report_tabs`), the Hours
 * report's short and long day marks and its overtime rules, all seeded from
 * the trade at sign-up.
 */
export function ReportsSettingsCard({ orgId, canEdit }: { orgId: string; canEdit: boolean }) {
  const t = useTerms();
  const config = useCompanyConfig();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [adding, setAdding] = useState("");
  const [addingPart, setAddingPart] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!config) return null;
  const current: Draft = {
    tabs: companyReportTabs(config.modules, config.settings.report_tabs),
    shortHours: String(config.settings.report_short_day_hours),
    longHours: String(config.settings.report_long_day_hours),
    dayNormal: String(config.settings.report_day_normal_hours),
    weekNormal: String(config.settings.report_week_normal_hours),
    sundayOvertime: config.settings.report_sunday_is_overtime,
    weights: toDraftWeights(config.settings.staff_score_weights),
  };
  const d = draft ?? current;
  const labels = new Map(reportTabs(t).map((x) => [x.value, x.label]));
  const offered = availableReportTabs(config.modules).filter((tab) => !d.tabs.includes(tab));
  // Sales and retail audits are measured only where the company sells.
  const sells = moduleEnabled(config.modules, "distribution");
  const offeredParts = SCORE_PARTS.filter(
    (p) => !d.weights.some((w) => w.code === p.code) && (!p.reportOnly || sells)
  );
  const total = d.weights.reduce((a, w) => a + (weightOk(w.weight) ? Number(w.weight) : 0), 0);
  const setWeight = (code: string, weight: string) =>
    change({ weights: d.weights.map((w) => (w.code === code ? { ...w, weight } : w)) });
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
    if (!hoursOk(d.dayNormal)) return setError("A normal day is a whole number of hours from 0 to 24.");
    if (!weekHoursOk(d.weekNormal)) return setError("A normal week is a whole number of hours from 0 to 168.");
    if (d.weights.length === 0 || d.weights.some((w) => !weightOk(w.weight)) || total !== 100) {
      return setError(`The score's weights must be whole numbers adding up to 100 (now ${total}).`);
    }
    setBusy(true);
    setError(null);
    const { error: e } = await createClient()
      .from("company_settings")
      .upsert(
        [
          { org_id: orgId, key: "report_tabs", value: d.tabs.join(",") },
          { org_id: orgId, key: "report_short_day_hours", value: Number(d.shortHours) },
          { org_id: orgId, key: "report_long_day_hours", value: Number(d.longHours) },
          { org_id: orgId, key: "report_day_normal_hours", value: Number(d.dayNormal) },
          { org_id: orgId, key: "report_week_normal_hours", value: Number(d.weekNormal) },
          { org_id: orgId, key: "report_sunday_is_overtime", value: d.sundayOvertime },
          {
            org_id: orgId,
            key: "staff_score_weights",
            value: weightsSetting(d.weights.map((w) => ({ code: w.code, weight: Number(w.weight) }))),
          },
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
    try {
      await loadTradeDefaults();
    } catch (e) {
      setError(`Your trade's settings could not be read (${e instanceof Error ? e.message : String(e)}). Nothing was changed.`);
    } finally {
      setBusy(false);
    }
  }

  async function loadTradeDefaults() {
    const supabase = createClient();
    // Any failed lookup stops here: falling back to the defaults would save
    // distribution's tabs as a service trade's own.
    const { data: org, error: orgError } = await supabase.from("organizations").select("industries").eq("id", orgId).single();
    if (orgError) return setError(`Your trade could not be read (${orgError.message}). Nothing was changed.`);
    const trade = (org as { industries: string[] | null } | null)?.industries?.[0] ?? null;
    const [{ data: rows, error: rowsError }, { data: defs, error: defsError }] = await Promise.all([
      trade
        ? supabase
            .from("template_settings")
            .select("setting_key, value")
            .eq("template_code", trade)
            .in("setting_key", SETTING_KEYS)
        : Promise.resolve({ data: [] as { setting_key: string; value: unknown }[], error: null }),
      supabase
        .from("setting_definitions")
        .select("key, default_value")
        .in("key", SETTING_KEYS),
    ]);
    const failed = rowsError ?? defsError;
    if (failed) return setError(`Your trade's settings could not be read (${failed.message}). Nothing was changed.`);
    const value = (key: string) =>
      (rows as { setting_key: string; value: unknown }[] | null)?.find((r) => r.setting_key === key)?.value ??
      (defs as { key: string; default_value: unknown }[] | null)?.find((r) => r.key === key)?.default_value;
    const tabs = tabsFromSetting(String(value("report_tabs") ?? "")).filter((tab) =>
      availableReportTabs(config!.modules).includes(tab)
    );
    if (tabs.length === 0) return setError("Your trade has no standard tabs to go back to.");
    // A part picked before the reset may now be among the weights again.
    setAddingPart("");
    setAdding("");
    change({
      tabs,
      shortHours: String(Number(value("report_short_day_hours") ?? 0)),
      longHours: String(Number(value("report_long_day_hours") ?? 0)),
      dayNormal: String(Number(value("report_day_normal_hours") ?? 0)),
      weekNormal: String(Number(value("report_week_normal_hours") ?? 0)),
      sundayOvertime: value("report_sunday_is_overtime") === true,
      weights: toDraftWeights(String(value("staff_score_weights") ?? "")),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Reports</CardTitle>
        <CardDescription>
          The tabs on the Reports page, in this order, when the Hours report marks a day as short or long or counts
          overtime, and what the {lower(t.staff.one)} score is made of.
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
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 text-sm font-medium text-foreground">Overtime</legend>
          <div className="space-y-1.5">
            <Label htmlFor="report-day-normal">Normal day (hours)</Label>
            <Input
              id="report-day-normal"
              inputMode="numeric"
              value={d.dayNormal}
              disabled={!canEdit}
              aria-invalid={!hoursOk(d.dayNormal)}
              aria-describedby="report-overtime-hint"
              onChange={(e) => change({ dayNormal: e.target.value.trim() })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-week-normal">Normal week (hours)</Label>
            <Input
              id="report-week-normal"
              inputMode="numeric"
              value={d.weekNormal}
              disabled={!canEdit}
              aria-invalid={!weekHoursOk(d.weekNormal)}
              aria-describedby="report-overtime-hint"
              onChange={(e) => change({ weekNormal: e.target.value.trim() })}
            />
          </div>
          <p id="report-overtime-hint" className="text-xs text-pretty text-muted-foreground sm:col-span-2">
            Hours past a normal day, or past a normal week from Monday, count as overtime. 0 turns it off.
          </p>
          <label className="flex min-h-11 items-start gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              className="mt-0.5 size-4"
              checked={d.sundayOvertime}
              disabled={!canEdit}
              onChange={(e) => change({ sundayOvertime: e.target.checked })}
            />
            <span>
              <span className="font-medium">Sunday is all overtime</span>
              <span className="block text-xs text-muted-foreground">Every hour worked on a Sunday counts as overtime.</span>
            </span>
          </label>
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-foreground">{t.staff.one} score</legend>
          <p className="text-xs text-pretty text-muted-foreground">
            Your trade&apos;s parts and weights, from industry research. A part that is not measured yet sits out and its
            weight is shared across the rest until Tickd records what it needs.
          </p>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {d.weights.map((w) => {
              const part = findPart(w.code)!;
              const note = part.needs ?? part.standIn ?? null;
              return (
                <li key={w.code} className="flex min-h-11 items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">{part.label(t)}</span>
                    {note && (
                      <span className="block text-xs text-muted-foreground">
                        {part.needs ? `Not measured yet. ${part.needs}.` : `${note}.`}
                      </span>
                    )}
                  </span>
                  <Input
                    aria-label={`Weight of ${part.label(t)}`}
                    inputMode="numeric"
                    className="w-16 text-right tabular-nums"
                    value={w.weight}
                    disabled={!canEdit}
                    aria-invalid={!weightOk(w.weight)}
                    onChange={(e) => setWeight(w.code, e.target.value.trim())}
                  />
                  <span className="w-3 text-sm text-muted-foreground">%</span>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${part.label(t)}`}
                      disabled={d.weights.length === 1}
                      onClick={() => change({ weights: d.weights.filter((x) => x.code !== w.code) })}
                    >
                      <X className="size-4" aria-hidden />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {canEdit && offeredParts.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <NativeSelect aria-label="Add a part" value={addingPart} onChange={(e) => setAddingPart(e.target.value)} className="max-w-xs">
                  <option value="">Add a part…</option>
                  {offeredParts.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.label(t)}
                      {p.needs ? " (not measured yet)" : ""}
                    </option>
                  ))}
                </NativeSelect>
                <Button
                  variant="outline"
                  disabled={!offeredParts.some((p) => p.code === addingPart)}
                  onClick={() => {
                    if (!offeredParts.some((p) => p.code === addingPart)) return;
                    change({ weights: [...d.weights, { code: addingPart, weight: "0" }] });
                    setAddingPart("");
                  }}
                >
                  Add
                </Button>
              </div>
            ) : (
              <span />
            )}
            <span
              aria-live="polite"
              className={`text-sm tabular-nums ${total === 100 ? "text-muted-foreground" : "font-medium text-destructive"}`}
            >
              Adds up to {total} of 100
            </span>
          </div>
        </fieldset>
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
