"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { refreshCompanyConfig, useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { lower } from "@/lib/terms";

type Draft = {
  shortHours: string;
  longHours: string;
  dayNormal: string;
  weekNormal: string;
  sundayOvertime: boolean;
};

const SETTING_KEYS = [
  "report_short_day_hours",
  "report_long_day_hours",
  "report_day_normal_hours",
  "report_week_normal_hours",
  "report_sunday_is_overtime",
];

const hoursOk = (v: string) => /^\d{1,2}$/.test(v) && Number(v) <= 24;
const weekHoursOk = (v: string) => /^\d{1,3}$/.test(v) && Number(v) <= 168;

/**
 * Working hours and overtime: when the Hours report marks a day as short or
 * long, and what counts as overtime. Business rules, seeded from the trade.
 *
 * The report tabs and the staff score's weights used to be edited here too.
 * They are formulas rather than business decisions and are now Tickd's
 * (`setting_definitions.audience = 'internal'`, changed on the platform
 * operator's company page); the database refuses them from this screen.
 */
export function WorkingHoursCard({ orgId, canEdit }: { orgId: string; canEdit: boolean }) {
  const t = useTerms();
  const config = useCompanyConfig();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!config) return null;
  const current: Draft = {
    shortHours: String(config.settings.report_short_day_hours),
    longHours: String(config.settings.report_long_day_hours),
    dayNormal: String(config.settings.report_day_normal_hours),
    weekNormal: String(config.settings.report_week_normal_hours),
    sundayOvertime: config.settings.report_sunday_is_overtime,
  };
  const d = draft ?? current;
  const change = (next: Partial<Draft>) => {
    setSaved(false);
    setDraft({ ...d, ...next });
  };

  async function save() {
    if (!hoursOk(d.shortHours) || !hoursOk(d.longHours)) return setError("Hours are a whole number from 0 to 24.");
    if (!hoursOk(d.dayNormal)) return setError("A normal day is a whole number of hours from 0 to 24.");
    if (!weekHoursOk(d.weekNormal)) return setError("A normal week is a whole number of hours from 0 to 168.");
    setBusy(true);
    setError(null);
    const { error: e } = await createClient()
      .from("company_settings")
      .upsert(
        [
          { org_id: orgId, key: "report_short_day_hours", value: Number(d.shortHours) },
          { org_id: orgId, key: "report_long_day_hours", value: Number(d.longHours) },
          { org_id: orgId, key: "report_day_normal_hours", value: Number(d.dayNormal) },
          { org_id: orgId, key: "report_week_normal_hours", value: Number(d.weekNormal) },
          { org_id: orgId, key: "report_sunday_is_overtime", value: d.sundayOvertime },
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
    // another trade's hours as this one's.
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
    change({
      shortHours: String(Number(value("report_short_day_hours") ?? 0)),
      longHours: String(Number(value("report_long_day_hours") ?? 0)),
      dayNormal: String(Number(value("report_day_normal_hours") ?? 0)),
      weekNormal: String(Number(value("report_week_normal_hours") ?? 0)),
      sundayOvertime: value("report_sunday_is_overtime") === true,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Working hours and overtime</CardTitle>
        <CardDescription>
          When a {lower(t.staff.one)}&apos;s day counts as short or long, and which hours count as overtime on the
          Hours report.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
