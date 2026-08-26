"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/hr/field";
import { createClient } from "@/lib/supabase/client";
import { issueWarning, uploadResponseDocument } from "@/lib/hr/disciplinary";
import { lookupsOfKind, type Lookup } from "@/lib/hr/types";
import { toLocalDateInput } from "@/lib/date-range";

/**
 * Record a warning.
 *
 * With or without a case behind it: a verbal warning given on the spot is a
 * real warning, and requiring a case first would push people into opening cases
 * they do not mean or into not recording the warning at all.
 *
 * The expiry date is offered and left blank. Whether a warning lapses, and
 * after how long, is a policy question this system has no view on — the brief
 * is explicit that no employment-law rule may be hard-coded, and a default of
 * "six months" would be exactly that, wearing the costume of a convenience.
 */
export function WarningDialog({
  open,
  onOpenChange,
  orgId,
  employeeId,
  employeeName,
  caseId,
  lookups,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string | null;
  employeeId: string;
  employeeName: string;
  caseId?: string | null;
  lookups: Lookup[];
  onSaved: () => void;
}) {
  const supabase = createClient();
  const today = toLocalDateInput(new Date());
  const types = lookupsOfKind(lookups, "warning_type");

  const [type, setType] = useState("");
  const [issuedOn, setIssuedOn] = useState(today);
  const [reason, setReason] = useState("");
  const [expires, setExpires] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset when the dialog opens, during render rather than in an effect.
  // This is React's documented "adjusting state when a prop changes" pattern:
  // an effect would paint the previous contents for one frame first, and would
  // trip react-hooks/set-state-in-effect for a real reason rather than a
  // spurious one.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setType(types[0]?.code ?? "");
      setIssuedOn(today);
      setReason("");
      setExpires("");
      setFile(null);
      setError(null);
    }
  }

  async function save() {
    if (!orgId) {
      setError("Your organisation could not be resolved.");
      return;
    }
    if (!type) {
      setError("Choose a warning type.");
      return;
    }
    if (!reason.trim()) {
      setError("Give the reason. This is what the employee is told.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const path = file
        ? await uploadResponseDocument(supabase, orgId, employeeId, file)
        : null;
      await issueWarning(supabase, orgId, {
        employee_id: employeeId,
        case_id: caseId ?? null,
        warning_type: type,
        issued_on: issuedOn,
        reason: reason.trim(),
        expires_on: expires || null,
        document_path: path,
      });
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Issue a warning — {employeeName}</DialogTitle>
          <DialogDescription>
            The employee is notified and can acknowledge it from their own HR
            page.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Warning type">
            <NativeSelect value={type} onChange={(e) => setType(e.target.value)}>
              {types.map((t) => (
                <option key={t.id} value={t.code}>
                  {t.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Issued on">
            <Input
              type="date"
              value={issuedOn}
              onChange={(e) => setIssuedOn(e.target.value)}
            />
          </Field>
          <Field
            label="Valid until"
            hint="Leave blank if it does not lapse. This system takes no view on how long a warning should stand."
            className="sm:col-span-2"
          >
            <Input
              type="date"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
            />
          </Field>
          <Field label="Reason" className="sm:col-span-2">
            <Textarea
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <Field label="Attach the letter" className="sm:col-span-2">
            <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
        </div>

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Issue warning"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
