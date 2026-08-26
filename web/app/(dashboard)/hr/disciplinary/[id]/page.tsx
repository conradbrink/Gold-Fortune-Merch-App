"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Paperclip, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Detail, Field } from "@/components/hr/field";
import { WarningDialog } from "@/components/hr/warning-dialog";
import { createClient } from "@/lib/supabase/client";
import { useHrLoad } from "@/lib/hr/use-load";
import { usePermissions } from "@/lib/use-permissions";
import { can } from "@/lib/permissions";
import { formatDateOnly } from "@/lib/format-date";
import { toLocalDateInput } from "@/lib/date-range";
import { fetchOrgId } from "@/lib/hr/employees";
import { fetchHrReference, type HrReference } from "@/lib/hr/settings";
import {
  addResponse,
  deleteEvidence,
  fetchCase,
  fetchEvidence,
  fetchResponses,
  fetchWarnings,
  isActiveWarning,
  updateCase,
  uploadEvidence,
  uploadResponseDocument,
  type CaseResponseRow,
  type CaseRow,
  type EvidenceRow,
  type WarningRow,
} from "@/lib/hr/disciplinary";
import { signedDocumentUrl } from "@/lib/hr/documents";
import { lookupLabel, lookupsOfKind } from "@/lib/hr/types";

/**
 * One disciplinary case.
 *
 * 🔴 The outcome field is a list of codes HR configured and a free-text note.
 * It is empty until somebody chooses, there is no default, nothing pre-selects
 * a value from the severity, and closing a case does not fill it in. "Closed,
 * no action" and "closed, nobody recorded what happened" are different facts
 * and this page keeps them different.
 *
 * The employee can read this page — that is not a leak, it is the point of a
 * response section. What they cannot do is edit the case, which is why their
 * reply is a separate table rather than a field on it.
 */
export default function CasePage() {
  const supabase = createClient();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const permissions = usePermissions();
  const isHr = permissions !== null && can(permissions, "hr");

  const [row, setRow] = useState<CaseRow | null>(null);
  const [evidence, setEvidence] = useState<EvidenceRow[]>([]);
  const [responses, setResponses] = useState<CaseResponseRow[]>([]);
  const [warnings, setWarnings] = useState<WarningRow[]>([]);
  const [reference, setReference] = useState<HrReference | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [status, setStatus] = useState("");
  const [outcome, setOutcome] = useState("");
  const [outcomeNote, setOutcomeNote] = useState("");
  const [responseText, setResponseText] = useState("");
  const [responseDate, setResponseDate] = useState(toLocalDateInput(new Date()));
  const [responseFile, setResponseFile] = useState<File | null>(null);
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidenceKind, setEvidenceKind] = useState("document");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [issuingWarning, setIssuingWarning] = useState(false);

  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: auth } = await supabase.auth.getUser();
      setUserId(auth.user?.id ?? null);
      const [c, ev, rs, ref, org] = await Promise.all([
        fetchCase(supabase, id),
        fetchEvidence(supabase, id),
        fetchResponses(supabase, id),
        fetchHrReference(supabase),
        fetchOrgId(supabase),
      ]);
      setRow(c);
      setEvidence(ev);
      setResponses(rs);
      setReference(ref);
      setOrgId(org);
      if (c) {
        setStatus(c.status);
        setOutcome(c.outcome ?? "");
        setOutcomeNote(c.outcome_note ?? "");
        setWarnings(await fetchWarnings(supabase, { caseId: c.id }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useHrLoad(load);

  async function saveWorkflow() {
    if (!row) return;
    setBusy(true);
    setError(null);
    try {
      await updateCase(supabase, row.id, {
        status,
        // An empty select means "not recorded", which is a real state and must
        // stay null rather than becoming the empty string.
        outcome: outcome || null,
        outcome_note: outcomeNote.trim() || null,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitResponse() {
    if (!row || !orgId) return;
    if (!responseText.trim()) {
      setError("Write the response before recording it.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const path = responseFile
        ? await uploadResponseDocument(supabase, orgId, row.employee_id, responseFile)
        : null;
      await addResponse(supabase, orgId, row.id, userId, {
        response: responseText.trim(),
        response_date: responseDate,
        document_path: path,
      });
      setResponseText("");
      setResponseFile(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function attachEvidence() {
    if (!row || !orgId || !evidenceFile) return;
    setBusy(true);
    setError(null);
    try {
      await uploadEvidence(supabase, orgId, row.employee_id, row.id, userId, {
        kind: evidenceKind,
        name: evidenceFile.name,
        note: evidenceNote.trim() || null,
        file: evidenceFile,
      });
      setEvidenceFile(null);
      setEvidenceNote("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function open(path: string) {
    try {
      const url = await signedDocumentUrl(supabase, path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (loading) {
    return <div className="h-64 animate-pulse rounded-lg bg-muted/50" />;
  }

  // A failure and an absence are different answers, and the "not found" text
  // below is a claim — that the record does not exist or is not yours. Saying
  // that when the load simply errored would be telling somebody they have no
  // access when what happened was a dropped connection.
  // Guarded on the record being absent as well: `error` is also set by actions
  // on a page that loaded fine — a signed URL that failed, an asset that would
  // not return — and those belong in the banner at the top, not in place of
  // everything.
  if (error && !row) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <p className="font-medium">Could not load this case</p>
          <p className="mt-1">{error}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={load}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!row) {
    return (
      <div className="space-y-4">
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/hr/disciplinary" />}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Disciplinary
        </Button>
        <p className="rounded-md border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          That case could not be found, or you do not have access to it.
        </p>
      </div>
    );
  }

  const lookups = reference?.lookups ?? [];
  const employeeName = row.employee?.full_name ?? "employee";

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 h-7 text-muted-foreground" nativeButton={false}
          render={<Link href="/hr/disciplinary" />}
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Disciplinary
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {row.case_number}
          </h1>
          <Badge variant={row.closed_at ? "outline" : "secondary"} className="font-normal">
            {lookupLabel(lookups, "case_status", row.status)}
          </Badge>
          <Badge variant="outline" className="font-normal">
            {lookupLabel(lookups, "severity", row.severity)}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          <Link href={`/hr/employees/${row.employee_id}`} className="hover:underline">
            {employeeName}
          </Link>{" "}
          · {lookupLabel(lookups, "incident_type", row.incident_type)} · opened{" "}
          {formatDateOnly(row.opened_on)}
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardContent className="space-y-4 p-5">
          <h2 className="text-sm font-semibold">The incident</h2>
          <dl className="grid gap-3 sm:grid-cols-3">
            <Detail label="Incident date">{formatDateOnly(row.incident_date)}</Detail>
            <Detail label="Reported by">{row.reporter?.full_name ?? "—"}</Detail>
            <Detail label="Handled by">{row.handler?.full_name ?? "—"}</Detail>
          </dl>
          <p className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm">
            {row.description}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-5">
          <h2 className="text-sm font-semibold">Workflow and outcome</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Status">
              <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)}>
                {lookupsOfKind(lookups, "case_status").map((s) => (
                  <option key={s.id} value={s.code}>
                    {s.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field
              label="Outcome"
              hint="Recorded once decided. Nothing here is suggested by the system."
            >
              <NativeSelect
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
              >
                <option value="">Not recorded</option>
                {lookupsOfKind(lookups, "outcome").map((o) => (
                  <option key={o.id} value={o.code}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Outcome note" className="sm:col-span-2">
              <Textarea
                rows={3}
                value={outcomeNote}
                onChange={(e) => setOutcomeNote(e.target.value)}
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={saveWorkflow} disabled={busy}>
              Save
            </Button>
            <Button
              variant="outline"
              onClick={() => setIssuingWarning(true)}
              disabled={busy}
            >
              Issue a warning
            </Button>
            {row.outcome_recorded_at && (
              <span className="text-xs text-muted-foreground">
                Outcome recorded {formatDateOnly(row.outcome_recorded_at.slice(0, 10))}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-5">
          <h2 className="text-sm font-semibold">Evidence</h2>
          {evidence.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing attached.</p>
          ) : (
            <ul className="space-y-2">
              {evidence.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-sm"
                >
                  <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="font-medium">{e.name}</span>
                  <Badge variant="outline" className="font-normal">
                    {e.kind}
                  </Badge>
                  {e.note && (
                    <span className="text-xs text-muted-foreground">{e.note}</span>
                  )}
                  <span className="ml-auto flex gap-1.5">
                    {e.storage_path && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => open(e.storage_path!)}
                      >
                        Open
                      </Button>
                    )}
                    {isHr && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          if (!window.confirm(`Remove "${e.name}" from this case?`))
                            return;
                          try {
                            await deleteEvidence(supabase, e);
                            await load();
                          } catch (err) {
                            setError(err instanceof Error ? err.message : String(err));
                          }
                        }}
                      >
                        Remove
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-3">
            <Field label="Kind">
              <NativeSelect
                value={evidenceKind}
                onChange={(e) => setEvidenceKind(e.target.value)}
              >
                <option value="document">Document</option>
                <option value="photo">Photo</option>
                <option value="screenshot">Screenshot</option>
                <option value="attendance">Attendance record</option>
                <option value="gps">GPS record</option>
                <option value="store_visit">Store visit</option>
                <option value="other">Other</option>
              </NativeSelect>
            </Field>
            <Field label="File">
              <Input
                type="file"
                onChange={(e) => setEvidenceFile(e.target.files?.[0] ?? null)}
              />
            </Field>
            <Field label="Note">
              <Input
                value={evidenceNote}
                onChange={(e) => setEvidenceNote(e.target.value)}
              />
            </Field>
            <div className="sm:col-span-3">
              <Button
                size="sm"
                variant="outline"
                onClick={attachEvidence}
                disabled={busy || !evidenceFile}
              >
                <Plus className="mr-1.5 h-4 w-4" /> Attach
              </Button>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Attendance and GPS evidence already exists in the system — see the
                employee&rsquo;s{" "}
                <Link
                  href={`/hr/employees/${row.employee_id}`}
                  className="underline"
                >
                  Attendance tab
                </Link>
                , which shows start and end positions with map links. Attach a
                file here only when the record needs to be preserved as it was.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-5">
          <h2 className="text-sm font-semibold">Employee response</h2>
          {responses.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing recorded yet. Setting the status to a step that asks for a
              response notifies the employee.
            </p>
          ) : (
            <ul className="space-y-3">
              {responses.map((r) => (
                <li key={r.id} className="rounded-md border border-border p-3">
                  <p className="whitespace-pre-wrap text-sm">{r.response}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {r.author?.full_name ?? "—"} · {formatDateOnly(r.response_date)}
                    {r.document_path && (
                      <>
                        {" · "}
                        <button
                          type="button"
                          className="underline"
                          onClick={() => open(r.document_path!)}
                        >
                          attachment
                        </button>
                      </>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}

          <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
            <Field label="Response" className="sm:col-span-2">
              <Textarea
                rows={4}
                value={responseText}
                onChange={(e) => setResponseText(e.target.value)}
                placeholder="In the employee's own words, or as recorded from a meeting."
              />
            </Field>
            <Field label="Date">
              <Input
                type="date"
                value={responseDate}
                onChange={(e) => setResponseDate(e.target.value)}
              />
            </Field>
            <Field label="Supporting document">
              <Input
                type="file"
                onChange={(e) => setResponseFile(e.target.files?.[0] ?? null)}
              />
            </Field>
            <div className="sm:col-span-2">
              <Button size="sm" onClick={submitResponse} disabled={busy}>
                Record response
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {warnings.length > 0 && (
        <Card>
          <CardContent className="space-y-3 p-5">
            <h2 className="text-sm font-semibold">Warnings from this case</h2>
            <ul className="space-y-2">
              {warnings.map((w) => (
                <li key={w.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">
                    {lookupLabel(lookups, "warning_type", w.warning_type)}
                  </span>
                  <span className="text-muted-foreground">
                    {formatDateOnly(w.issued_on)}
                  </span>
                  <Badge
                    variant={isActiveWarning(w) ? "default" : "outline"}
                    className="font-normal"
                  >
                    {isActiveWarning(w) ? "Active" : "Lapsed"}
                  </Badge>
                  {!w.acknowledged_at && (
                    <span className="text-xs text-muted-foreground">
                      not acknowledged
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <WarningDialog
        open={issuingWarning}
        onOpenChange={setIssuingWarning}
        orgId={orgId}
        employeeId={row.employee_id}
        employeeName={employeeName}
        caseId={row.id}
        lookups={lookups}
        onSaved={load}
      />
    </div>
  );
}
