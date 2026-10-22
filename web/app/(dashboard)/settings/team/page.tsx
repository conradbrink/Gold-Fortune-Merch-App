"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { createClient } from "@/lib/supabase/client";
import { usePermissions } from "@/lib/use-permissions";
import { can } from "@/lib/permissions";
import { refreshCompanyConfig, useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { count, lower, withArticle } from "@/lib/terms";
import { WEEKDAYS } from "@/lib/schedule";
import { checkinChoices } from "@/lib/settings-tabs";
import { DEFAULT_ORG_SETTINGS } from "@/lib/org-settings";
import {
  ChoiceButtons,
  SaveRow,
  SettingsPage,
  SettingsSection,
  SettingsSurface,
} from "@/components/settings/settings-section";

type Draft = {
  workingDays: number[];
  storesPerDay: string;
  checkinMetres: number;
  autoEnd: boolean;
  autoEndTime: string;
};

const sameDraft = (a: Draft, b: Draft) =>
  a.workingDays.join(",") === b.workingDays.join(",") &&
  a.storesPerDay === b.storesPerDay &&
  a.checkinMetres === b.checkinMetres &&
  a.autoEnd === b.autoEnd &&
  a.autoEndTime === b.autoEndTime;

/**
 * Settings > Team & Work: the few rules of the working week an owner decides.
 *
 * Working days and stores per day are the schedule's capacity (columns on
 * `organizations`); the check-in distance and the automatic end of the day
 * are company settings. How hours, overtime, short visits, orders and ranges
 * are worked out is set up by Tickd in the Control Centre, from the trade and
 * the company's own data.
 */
export default function TeamSettingsPage() {
  const t = useTerms();
  const config = useCompanyConfig();
  const permissions = usePermissions();
  const canEdit = permissions !== null && can(permissions, "company_settings");
  const orgId = config?.orgId ?? null;

  const [saved, setSaved] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId || !config) return;
    let cancelled = false;
    void (async () => {
      // Read with its error: a failed read must never show (and then save)
      // the defaults over the company's own week.
      const { data, error: e } = await createClient()
        .from("organizations")
        .select("stores_per_day, working_days")
        .eq("id", orgId)
        .single();
      if (cancelled) return;
      if (e) return setLoadError(`Your settings could not be loaded (${e.message}).`);
      const s = config.settings;
      const next: Draft = {
        workingDays: [...(data.working_days?.length ? data.working_days : DEFAULT_ORG_SETTINGS.workingDays)].sort((a, b) => a - b),
        storesPerDay: String(data.stores_per_day ?? DEFAULT_ORG_SETTINGS.storesPerDay),
        checkinMetres: s.checkin_radius_m,
        autoEnd: s.auto_end_enabled,
        autoEndTime: s.auto_end_time,
      };
      setSaved(next);
      setDraft(next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  function change(next: Partial<Draft>) {
    setDone(false);
    setDraft((d) => (d ? { ...d, ...next } : d));
  }

  function toggleDay(day: number) {
    if (!draft) return;
    const has = draft.workingDays.includes(day);
    // Never no working days: nothing could be scheduled, and the database
    // refuses it anyway.
    if (has && draft.workingDays.length === 1) return;
    change({
      workingDays: has ? draft.workingDays.filter((d) => d !== day) : [...draft.workingDays, day].sort((a, b) => a - b),
    });
  }

  async function save() {
    if (!orgId || !draft || !saved) return;
    setDone(false);
    setError(null);
    const stores = Number(draft.storesPerDay);
    if (!Number.isInteger(stores) || stores < 1 || stores > 50) {
      return setError(`${t.site.many} per day is a whole number from 1 to 50.`);
    }
    const timeOk = /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(draft.autoEndTime);
    if (draft.autoEnd && !timeOk) {
      return setError("Choose a time, such as 19:30, to end the workday.");
    }
    // With automatic ending off the time is not used; a cleared one keeps the
    // saved time rather than sending a value the database refuses.
    const endTime = timeOk ? draft.autoEndTime : saved.autoEndTime;
    setBusy(true);
    const supabase = createClient();
    const week = draft.workingDays.join(",") !== saved.workingDays.join(",") || draft.storesPerDay !== saved.storesPerDay;
    if (week) {
      const { error: e } = await supabase
        .from("organizations")
        .update({ stores_per_day: stores, working_days: draft.workingDays })
        .eq("id", orgId);
      if (e) {
        setBusy(false);
        return setError(`Not saved: ${e.message}`);
      }
    }
    const rules =
      draft.checkinMetres !== saved.checkinMetres || draft.autoEnd !== saved.autoEnd || draft.autoEndTime !== saved.autoEndTime;
    if (rules) {
      const { error: e } = await supabase.from("company_settings").upsert(
        [
          { org_id: orgId, key: "checkin_radius_m", value: draft.checkinMetres },
          { org_id: orgId, key: "auto_end_enabled", value: draft.autoEnd },
          { org_id: orgId, key: "auto_end_time", value: endTime },
        ],
        { onConflict: "org_id,key" }
      );
      if (e) {
        setBusy(false);
        // The week above may already be saved: keep it as saved, so only the
        // part that failed still shows as changed.
        if (week) setSaved({ ...saved, workingDays: draft.workingDays, storesPerDay: draft.storesPerDay });
        return setError(`${week ? "Your working week was saved, but not the rest" : "Not saved"}: ${e.message}`);
      }
      refreshCompanyConfig();
    }
    setBusy(false);
    setSaved({ ...draft, autoEndTime: endTime });
    setDraft({ ...draft, autoEndTime: endTime });
    setDone(true);
  }

  if (loadError) {
    return (
      <SettingsPage title="Team & Work">
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{loadError}</p>
      </SettingsPage>
    );
  }

  if (!draft || !saved) {
    return (
      <SettingsPage title="Team & Work">
        <div className="h-96 animate-pulse rounded-xl border border-border bg-muted/30" aria-label="Loading your settings" />
      </SettingsPage>
    );
  }

  const site = lower(t.site.one);
  const sites = lower(t.site.many);
  const staff = lower(t.staff.one);
  const stores = Number(draft.storesPerDay);
  const perWeek = Number.isInteger(stores) && stores > 0 ? draft.workingDays.length * stores : null;

  return (
    <SettingsPage title="Team & Work">
      <SettingsSurface>
        <SettingsSection id="days" title="Working days" description="Which days does your team normally work?">
          <ChoiceButtons
            label="Working days"
            multiple
            disabled={!canEdit}
            value={draft.workingDays}
            onChange={toggleDay}
            options={WEEKDAYS.map((w) => ({ value: w.value, label: w.short, title: w.long }))}
          />
        </SettingsSection>

        <SettingsSection
          id="capacity"
          title={`${t.site.many} per day`}
          description={`How many ${sites} can one ${staff} realistically visit in a day?`}
        >
          <div className="space-y-1.5">
            <Label htmlFor="stores-per-day" className="sr-only">
              {t.site.many} per day
            </Label>
            <Input
              id="stores-per-day"
              type="number"
              inputMode="numeric"
              min={1}
              max={50}
              className="w-24 tabular-nums"
              value={draft.storesPerDay}
              disabled={!canEdit}
              aria-describedby="stores-per-day-hint"
              onChange={(e) => change({ storesPerDay: e.target.value })}
            />
            <p id="stores-per-day-hint" className="text-xs text-muted-foreground tabular-nums">
              {perWeek !== null ? `That is ${count(t, "job", perWeek)} a week for each ${staff}.` : " "}
            </p>
          </div>
        </SettingsSection>

        <SettingsSection
          id="checkin"
          title="Check-in radius"
          description={`How close must ${withArticle(t, "staff")} be to the ${site} to check in?`}
        >
          <ChoiceButtons
            label="Check-in radius"
            disabled={!canEdit}
            value={draft.checkinMetres}
            onChange={(m) => change({ checkinMetres: m })}
            options={checkinChoices(saved.checkinMetres).map((m) => ({ value: m, label: `${m} m` }))}
          />
        </SettingsSection>

        <SettingsSection id="auto-end" title="Automatic workday ending" description="Finish a workday nobody ended.">
          <label className="flex min-h-11 items-center justify-between gap-4">
            <span className="text-sm font-medium text-foreground">{draft.autoEnd ? "On" : "Off"}</span>
            <Switch
              checked={draft.autoEnd}
              disabled={!canEdit}
              aria-label="Automatic workday ending"
              onCheckedChange={(on) => change({ autoEnd: on })}
            />
          </label>
          {draft.autoEnd && (
            <div className="flex items-center gap-3">
              <Label htmlFor="auto-end-time" className="font-normal text-muted-foreground">
                End workday at
              </Label>
              <Input
                id="auto-end-time"
                type="time"
                className="w-32"
                value={draft.autoEndTime}
                disabled={!canEdit}
                onChange={(e) => change({ autoEndTime: e.target.value })}
              />
            </div>
          )}
        </SettingsSection>

        {canEdit && (
          <SaveRow onSave={() => void save()} busy={busy} dirty={!sameDraft(draft, saved)} saved={done} error={error} />
        )}
      </SettingsSurface>
    </SettingsPage>
  );
}
