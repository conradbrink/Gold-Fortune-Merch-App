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
import { updateDocument, uploadDocument, type DocumentRow } from "@/lib/hr/documents";
import { lookupsOfKind, type Lookup } from "@/lib/hr/types";

/**
 * File a document against an employee, or correct one already filed.
 *
 * Editing deliberately cannot replace the bytes. A contract whose PDF can be
 * swapped after the fact is not evidence of a contract; if the wrong file went
 * up, delete the row and upload the right one, and both actions are in the
 * audit trail.
 *
 * The expiry date is the reason most of this exists. It is optional, and blank
 * means "does not expire" rather than "unknown" — a signed contract copy or a
 * qualification certificate genuinely has no end date, and treating the gap as
 * a problem would fill the dashboard with warnings about paperwork that is
 * fine.
 */
export function DocumentDialog({
  open,
  onOpenChange,
  orgId,
  userId,
  employeeId,
  employeeName,
  lookups,
  existing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string | null;
  userId: string | null;
  employeeId: string | null;
  employeeName: string;
  lookups: Lookup[];
  /** Null uploads a new document; a row edits its metadata. */
  existing: DocumentRow | null;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const categories = lookupsOfKind(lookups, "document_category");

  const [name, setName] = useState("");
  const [category, setCategory] = useState("other");
  const [issued, setIssued] = useState("");
  const [expiry, setExpiry] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset when the dialog opens, during render rather than in an effect.
  // This is React's documented "adjusting state when a prop changes" pattern:
  // an effect would paint the previous contents for one frame first, and would
  // trip react-hooks/set-state-in-effect for a real reason rather than a
  // spurious one.
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const openKey = open ? existing?.id ?? "new" : null;
  if (openKey !== openedFor) {
    setOpenedFor(openKey);
    if (open) {
      setName(existing?.name ?? "");
      setCategory(existing?.category ?? categories[0]?.code ?? "other");
      setIssued(existing?.issued_on ?? "");
      setExpiry(existing?.expiry_date ?? "");
      setNotes(existing?.notes ?? "");
      setFile(null);
      setError(null);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (existing) {
        await updateDocument(supabase, existing.id, {
          name: name.trim() || existing.name,
          category,
          issued_on: issued || null,
          expiry_date: expiry || null,
          notes: notes.trim() || null,
        });
      } else {
        if (!orgId) throw new Error("Your organisation could not be resolved.");
        if (!employeeId) throw new Error("Choose an employee first.");
        if (!file) throw new Error("Choose a file to upload.");
        await uploadDocument(supabase, orgId, userId, {
          employeeId,
          // Falling back to the file name keeps the field optional without
          // producing a row called "".
          name: name.trim() || file.name,
          category,
          issued_on: issued || null,
          expiry_date: expiry || null,
          notes: notes.trim() || null,
          file,
        });
      }
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
          <DialogTitle>
            {existing ? "Edit document" : `Upload a document — ${employeeName}`}
          </DialogTitle>
          <DialogDescription>
            {existing
              ? "The file itself cannot be replaced. Delete and re-upload if it is wrong."
              : "Up to 25 MB. Only HR and this employee's management chain can read it."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          {!existing && (
            <Field label="File" className="sm:col-span-2">
              <Input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </Field>
          )}
          <Field label="Name" className="sm:col-span-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={file?.name ?? "Employment contract 2026"}
            />
          </Field>
          <Field label="Category">
            <NativeSelect
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.code}>
                  {c.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Issued on">
            <Input
              type="date"
              value={issued}
              onChange={(e) => setIssued(e.target.value)}
            />
          </Field>
          <Field
            label="Expires on"
            className="sm:col-span-2"
            hint="Leave blank for a document that does not expire."
          >
            <Input
              type="date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
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
            {busy ? "Saving…" : existing ? "Save changes" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
