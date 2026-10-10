"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { refreshCompanyConfig, useCompanyConfig, useTerms } from "@/lib/use-company-config";
import {
  ALERT_RULES,
  ruleLabels,
  rulesFromSetting,
  rulesSetting,
  type AlertEmailMode,
  type AlertRule,
} from "@/lib/alerts";
import { moduleEnabled } from "@/lib/modules";
import { lower } from "@/lib/terms";

type Draft = {
  rules: AlertRule[];
  email: AlertEmailMode;
  at: string;
  gap: string;
};

const gapOk = (v: string) => /^\d{1,4}$/.test(v) && Number(v) >= 15 && Number(v) <= 1440;

/**
 * Alerts (Stage 8.4): which rules are on, how they are emailed to the people
 * who read reports, the end of the company's day, and the longest gap between
 * rounds. Seeded from the trade at sign-up; nothing here for a company
 * without the module.
 */
export function AlertsSettingsCard({ orgId, canEdit }: { orgId: string; canEdit: boolean }) {
  const t = useTerms();
  const config = useCompanyConfig();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!config || !moduleEnabled(config.modules, "owner_notifications")) return null;
  const s = config.settings;
  const current: Draft = {
    rules: rulesFromSetting(s.alerts_on),
    email: s.alerts_email,
    at: s.alerts_digest_time,
    gap: String(s.alerts_patrol_gap_minutes),
  };
  const d = draft ?? current;
  const labels = ruleLabels(t);
  const change = (next: Partial<Draft>) => {
    setSaved(false);
    setDraft({ ...d, ...next });
  };
  const toggle = (rule: AlertRule) =>
    change({
      rules: d.rules.includes(rule) ? d.rules.filter((r) => r !== rule) : [...d.rules, rule],
    });

  async function save() {
    if (!/^\d{2}:\d{2}$/.test(d.at)) return setError("Choose a time for the end of the day, for example 17:30.");
    if (!gapOk(d.gap)) return setError("The longest gap is a whole number of minutes from 15 to 1440.");
    setBusy(true);
    setError(null);
    const { error: e } = await createClient()
      .from("company_settings")
      .upsert(
        [
          { org_id: orgId, key: "alerts_on", value: rulesSetting(d.rules) },
          { org_id: orgId, key: "alerts_email", value: d.email },
          { org_id: orgId, key: "alerts_digest_time", value: d.at },
          {
            org_id: orgId,
            key: "alerts_patrol_gap_minutes",
            value: Number(d.gap),
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

  const emailChoices: [AlertEmailMode, string][] = [
    ["digest", "One email a day, at the end of the day"],
    ["instant", "An email for each alert, as it happens"],
    ["off", "No emails, only the alerts in Tickd"],
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Alerts</CardTitle>
        <CardDescription className="text-pretty">
          Tickd checks the field every five minutes and tells the people who read reports when something is off. They
          see them under the alert icon at the top of every page.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <fieldset className="space-y-1">
          <legend className="mb-1 text-sm font-medium text-foreground">Tell me when</legend>
          {ALERT_RULES.map((rule) => (
            <div key={rule}>
              <label className="flex min-h-11 items-start gap-3 py-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={d.rules.includes(rule)}
                  disabled={!canEdit}
                  onChange={() => toggle(rule)}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                />
                <span className="min-w-0">
                  <span className="block font-medium text-foreground">{labels[rule].label}</span>
                  <span className="block text-xs text-pretty text-muted-foreground">
                    {labels[rule].explain}
                    {rule === "short_job" && s.short_visit_minutes === 0 && d.rules.includes("short_job") && (
                      <> The shortest normal {lower(t.job.one)} on Operations is 0, so this never fires.</>
                    )}
                  </span>
                </span>
              </label>
              {rule === "patrol_gap" && d.rules.includes("patrol_gap") && (
                <div className="flex items-center gap-3 pb-1.5 pl-7">
                  <Label htmlFor="alerts-gap" className="text-sm font-normal text-muted-foreground">
                    Longest gap
                  </Label>
                  <Input
                    id="alerts-gap"
                    type="number"
                    inputMode="numeric"
                    min={15}
                    max={1440}
                    value={d.gap}
                    disabled={!canEdit}
                    onChange={(e) => change({ gap: e.target.value })}
                    className="h-9 w-24 tabular-nums"
                  />
                  <span className="text-sm text-muted-foreground">minutes</span>
                </div>
              )}
            </div>
          ))}
        </fieldset>

        <div className="space-y-1.5">
          <Label htmlFor="alerts-end-of-day">End of the day</Label>
          <Input
            id="alerts-end-of-day"
            type="time"
            value={d.at}
            disabled={!canEdit}
            onChange={(e) => change({ at: e.target.value })}
            className="h-9 w-32"
          />
          <p className="text-xs text-pretty text-muted-foreground">
            Planned {lower(t.job.many)} not done by this time count as not done, and the daily email goes out. Your
            company&apos;s clock.
          </p>
        </div>

        <fieldset className="space-y-1">
          <legend className="mb-1 text-sm font-medium text-foreground">Emails</legend>
          {emailChoices.map(([value, label]) => (
            <label key={value} className="flex min-h-11 items-center gap-3 text-sm text-foreground">
              <input
                type="radio"
                name="alerts-email"
                value={value}
                checked={d.email === value}
                disabled={!canEdit}
                onChange={() => change({ email: value })}
                className="size-4 accent-primary"
              />
              {label}
            </label>
          ))}
          <p className="text-xs text-pretty text-muted-foreground">
            They go to everyone who reads reports and has an email address, not to phone logins.
          </p>
        </fieldset>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void save()} disabled={busy || draft === null}>
              {busy ? "Saving…" : "Save alerts"}
            </Button>
            {saved && (
              <span className="text-sm text-muted-foreground" aria-live="polite">
                Saved.
              </span>
            )}
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
