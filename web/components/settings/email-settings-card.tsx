"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { refreshCompanyConfig, useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { lower } from "@/lib/terms";
import type { JobReportSend } from "@/lib/company-config";

type Row = {
  id: string;
  to_address: string;
  template: string;
  status: string;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
};

/** What each template is, in words. */
const TEMPLATE_LABEL: Record<string, string> = {
  test: "Test email",
  job_report: "Job report",
  job_reports_day: "Day's reports",
  alert: "Alert",
  alerts_digest: "Day's alerts",
};

const STATUS: Record<string, { label: string; tone: string }> = {
  queued: { label: "Waiting to send", tone: "text-muted-foreground" },
  sending: { label: "Sending", tone: "text-muted-foreground" },
  sent: { label: "Sent", tone: "text-emerald-700 dark:text-emerald-400" },
  failed: { label: "Not delivered", tone: "text-destructive" },
  suppressed: { label: "Not sent: this address is blocked or opted out", tone: "text-muted-foreground" },
  cancelled: { label: "Cancelled", tone: "text-muted-foreground" },
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/**
 * Emails Tickd sends for the company (Stage 8.1): who they come from, a test
 * to yourself, and the last 20 with what happened to each, so "the client
 * never got it" has an answer.
 */
export function EmailSettingsCard({ supportEmail, orgId, canEdit }: { supportEmail: string | null; orgId: string; canEdit: boolean }) {
  const t = useTerms();
  const config = useCompanyConfig();
  const [mode, setMode] = useState<JobReportSend | null>(null);
  const [at, setAt] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: e } = await createClient()
      .from("message_outbox")
      .select("id, to_address, template, status, last_error, created_at, sent_at")
      .order("created_at", { ascending: false })
      .limit(20);
    if (e) {
      setRows([]);
      return setError(`The list could not be loaded (${e.message}).`);
    }
    setError(null);
    setRows((data ?? []) as Row[]);
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  const currentMode = mode ?? config?.settings.job_report_send ?? "manual";
  const currentAt = at ?? config?.settings.job_report_send_time ?? "18:00";

  async function saveReports(nextMode: JobReportSend, nextAt: string) {
    setError(null);
    setSavedNote(null);
    if (!/^\d{2}:\d{2}$/.test(nextAt)) return setError("Choose a time, for example 18:00.");
    const { error: e } = await createClient()
      .from("company_settings")
      .upsert(
        [
          { org_id: orgId, key: "job_report_send", value: nextMode },
          { org_id: orgId, key: "job_report_send_time", value: nextAt },
        ],
        { onConflict: "org_id,key" }
      );
    if (e) return setError(`Not saved: ${e.message}`);
    refreshCompanyConfig();
    setSavedNote("Saved.");
  }

  async function sendTest() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const { error: e } = await createClient().rpc("send_test_email");
      if (e) return setError(e.message);
      await load();
      setNote("Queued.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Emails</CardTitle>
        <CardDescription className="text-pretty">
          Reports and alerts go out under your company&apos;s name from Tickd&apos;s address.{" "}
          {supportEmail
            ? `Replies go to ${supportEmail}.`
            : "Add your company email under Company Details so replies reach you."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-foreground">Job reports to your clients</legend>
          <p className="text-xs text-pretty text-muted-foreground">
            Each finished {lower(t.job.one)}&apos;s report, with the checklist and photos, goes to the contacts at the{" "}
            {lower(t.site.one)} who get reports. They can sign it off from the email.
          </p>
          {(
            [
              ["evening", "One email per site each evening"],
              ["immediate", `As each ${lower(t.job.one)} is finished`],
              ["manual", "Only when I send one"],
            ] as [JobReportSend, string][]
          ).map(([value, label]) => (
            <label key={value} className="flex min-h-11 items-center gap-3 text-sm text-foreground">
              <input
                type="radio"
                name="job-report-send"
                value={value}
                checked={currentMode === value}
                disabled={!canEdit}
                onChange={() => {
                  setMode(value);
                  void saveReports(value, currentAt);
                }}
                className="size-4 accent-primary"
              />
              {label}
              {value === "evening" && (
                <Input
                  type="time"
                  aria-label="Evening email time"
                  value={currentAt}
                  disabled={!canEdit || currentMode !== "evening"}
                  onChange={(e) => setAt(e.target.value)}
                  onBlur={() => void saveReports(currentMode, currentAt)}
                  className="h-9 w-28"
                />
              )}
            </label>
          ))}
          {savedNote && <p className="text-xs text-muted-foreground" aria-live="polite">{savedNote}</p>}
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={sendTest} disabled={busy}>
            {busy ? "Sending…" : "Send me a test email"}
          </Button>
          {note && <span className="text-sm text-muted-foreground" aria-live="polite">{note}</span>}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div>
          <h3 className="mb-2 text-sm font-medium text-foreground">Recent emails</h3>
          {rows === null ? (
            <div className="h-20 animate-pulse rounded-lg bg-muted/50" />
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing sent yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {rows.map((r) => {
                const s = STATUS[r.status] ?? { label: r.status, tone: "text-muted-foreground" };
                return (
                  <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate">
                      <span className="font-medium text-foreground">{TEMPLATE_LABEL[r.template] ?? r.template}</span>
                      <span className="text-muted-foreground"> to {r.to_address}</span>
                    </span>
                    <span className="flex items-baseline gap-2">
                      <span className={s.tone} title={r.last_error ?? undefined}>
                        {s.label}
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground">{when(r.sent_at ?? r.created_at)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
