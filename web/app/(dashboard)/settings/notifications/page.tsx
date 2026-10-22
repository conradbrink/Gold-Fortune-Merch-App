"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { createClient } from "@/lib/supabase/client";
import { usePermissions } from "@/lib/use-permissions";
import { can } from "@/lib/permissions";
import { refreshCompanyConfig, useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { lower } from "@/lib/terms";
import { showsAlerts } from "@/lib/settings-tabs";
import { alertSwitches, applyAlertSwitches, rulesFromSetting, rulesSetting, type AlertSwitches } from "@/lib/alerts";
import type { JobReportSend } from "@/lib/company-config";
import { SaveRow, SettingsPage, SettingsSection, SettingsSurface } from "@/components/settings/settings-section";

type Draft = { send: JobReportSend; at: string; alerts: AlertSwitches };

/**
 * Settings > Notifications: when finished visit reports go out, which alerts
 * the owner wants, and a test email to see one arrive.
 *
 * The settings are the ones the database reads (`job_report_send`,
 * `job_report_send_time`, `alerts_on`, `alerts_email`); the switches map onto
 * them in `lib/alerts.ts`. The end of the alerts day, the longest gap between
 * rounds and the exact alert rules are Tickd's, in the Control Centre.
 */
export default function NotificationSettingsPage() {
  const t = useTerms();
  const config = useCompanyConfig();
  const permissions = usePermissions();
  const canEdit = permissions !== null && can(permissions, "company_settings");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A fresh configuration (after a save, or a change made elsewhere) is the
  // truth again: what was being edited is dropped rather than written back
  // over it.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(null);
  }, [config]);

  if (!config) {
    return (
      <SettingsPage title="Notifications">
        <div className="h-80 animate-pulse rounded-xl border border-border bg-muted/30" aria-label="Loading your settings" />
      </SettingsPage>
    );
  }

  const s = config.settings;
  const hasAlerts = showsAlerts(config.modules);
  const savedRules = rulesFromSetting(s.alerts_on);
  const current: Draft = {
    send: s.job_report_send,
    at: s.job_report_send_time,
    alerts: alertSwitches(savedRules, s.alerts_email),
  };
  const d = draft ?? current;
  const dirty =
    d.send !== current.send ||
    (d.send === "evening" && d.at !== current.at) ||
    d.alerts.missed !== current.alerts.missed ||
    d.alerts.important !== current.alerts.important ||
    d.alerts.summary !== current.alerts.summary;

  function change(next: Partial<Draft>) {
    setDone(false);
    setDraft({ ...d, ...next });
  }
  const flip = (key: keyof AlertSwitches) => (on: boolean) => change({ alerts: { ...d.alerts, [key]: on } });

  async function save() {
    if (!config) return;
    setDone(false);
    setError(null);
    if (d.send === "evening" && !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(d.at)) {
      return setError("Choose a time, such as 18:00, for the daily reports.");
    }
    const orgId = config.orgId;
    const rows: { org_id: string; key: string; value: string }[] = [
      { org_id: orgId, key: "job_report_send", value: d.send },
      { org_id: orgId, key: "job_report_send_time", value: d.at },
    ];
    if (hasAlerts) {
      const next = applyAlertSwitches({ rules: savedRules, email: s.alerts_email }, d.alerts);
      rows.push(
        { org_id: orgId, key: "alerts_on", value: rulesSetting(next.rules) },
        { org_id: orgId, key: "alerts_email", value: next.email }
      );
    }
    setBusy(true);
    const { error: e } = await createClient().from("company_settings").upsert(rows, { onConflict: "org_id,key" });
    setBusy(false);
    if (e) return setError(`Not saved: ${e.message}`);
    // The saved values come back with the company's configuration; until they
    // do, what was chosen stays on screen.
    refreshCompanyConfig();
    setDone(true);
  }

  const job = lower(t.job.one);
  const reportChoices: [JobReportSend, string][] = [
    ["immediate", `After every ${job}`],
    ["evening", "Once per day"],
    ["manual", "Only when I send one"],
  ];

  return (
    <SettingsPage title="Notifications">
      <SettingsSurface>
        <SettingsSection
          id="reports"
          title={`${t.job.one} reports`}
          description={`How should finished ${job} reports be sent to your ${lower(t.client.many)}?`}
        >
          <fieldset className="space-y-1">
            <legend className="sr-only">{t.job.one} reports</legend>
            {reportChoices.map(([value, label]) => (
              <div key={value} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2">
                <label className="flex items-center gap-3 text-sm text-foreground">
                  <input
                    type="radio"
                    name="job-report-send"
                    value={value}
                    checked={d.send === value}
                    disabled={!canEdit}
                    onChange={() => change({ send: value })}
                    className="size-4 accent-primary"
                  />
                  {label}
                </label>
                {value === "evening" && d.send === "evening" && (
                  <Input
                    type="time"
                    aria-label="Time to send the day's reports"
                    value={d.at}
                    disabled={!canEdit}
                    onChange={(e) => change({ at: e.target.value })}
                    className="h-9 w-28"
                  />
                )}
              </div>
            ))}
          </fieldset>
        </SettingsSection>

        {hasAlerts && (
          <SettingsSection id="alerts" title="Alerts" description="What Tickd tells you about.">
            <div className="divide-y divide-border">
              <SwitchRow
                label={`Missed ${job} alerts`}
                hint={`A planned ${job} not done by the end of the day.`}
                checked={d.alerts.missed}
                disabled={!canEdit}
                onChange={flip("missed")}
              />
              <SwitchRow
                label="Daily summary"
                hint={
                  s.alerts_email === "instant" && !d.alerts.summary
                    ? "Your alerts are emailed as they happen."
                    : "One email at the end of the day."
                }
                checked={d.alerts.summary}
                disabled={!canEdit}
                onChange={flip("summary")}
              />
              <SwitchRow
                label="Important alerts"
                hint={`Someone checks in away from the ${lower(t.site.one)} or leaves very quickly.`}
                checked={d.alerts.important}
                disabled={!canEdit}
                onChange={flip("important")}
              />
            </div>
          </SettingsSection>
        )}

        {canEdit && <SaveRow onSave={() => void save()} busy={busy} dirty={dirty} saved={done} error={error} />}
      </SettingsSurface>

      <TestEmail orgId={config.orgId} />
    </SettingsPage>
  );
}

function SwitchRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="flex min-h-14 items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block text-xs text-pretty text-muted-foreground">{hint}</span>
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={label} />
    </label>
  );
}

/**
 * A test email to the person signed in, so they can see what the emails
 * look like and that they arrive. Where replies go is the customer email on
 * Business.
 */
function TestEmail({ orgId }: { orgId: string }) {
  const t = useTerms();
  // Where replies go: without a customer email they reach nobody, so say so.
  const [replyTo, setReplyTo] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void createClient()
      .from("organizations")
      .select("support_email")
      .eq("id", orgId)
      .single()
      .then(({ data }) => {
        if (live) setReplyTo(data?.support_email?.trim() || null);
      });
    return () => {
      live = false;
    };
  }, [orgId]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const { error: e } = await createClient().rpc("send_test_email");
      if (e) setError(e.message);
      else setNote("On its way to your inbox.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsSurface>
      <SettingsSection id="test-email" title="Test email" description="See what your emails look like.">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={() => void send()} disabled={busy}>
            {busy ? "Sending…" : "Send me a test email"}
          </Button>
          <p aria-live="polite" className={`text-sm ${error ? "text-destructive" : "text-muted-foreground"}`}>
            {error ?? note ?? ""}
          </p>
        </div>
        <p className={`text-xs ${replyTo === null ? "text-destructive" : "text-muted-foreground"}`}>
          {replyTo === null ? `You have no ${lower(t.client.one)} email yet, so replies reach nobody. Add one on` : `Replies go to the ${lower(t.client.one)} email on`}{" "}
          <Link href="/settings/business" className="underline underline-offset-2 hover:text-foreground">
            Business
          </Link>
          .
        </p>
      </SettingsSection>
    </SettingsSurface>
  );
}
