"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, FileText, Trash2, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { NativeSelect } from "@/components/ui/native-select";
import { Checkbox } from "@/components/ui/checkbox";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/lib/supabase/types";
import { FORM_PRESETS, findPreset } from "@/lib/form-presets";

type FormTemplate = Tables<"form_templates"> & { submissions: number };

export default function FormsPage() {
  const supabase = createClient();
  const [forms, setForms] = useState<FormTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  /** "" for a blank form, otherwise a key from FORM_PRESETS. */
  const [presetKey, setPresetKey] = useState("");
  /** Compulsory forms block the rep's check-out. Off unless chosen. */
  const [required, setRequired] = useState(false);
  /** The form the manager has asked to remove, pending confirmation. */
  const [pending, setPending] = useState<FormTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadForms() {
    setLoading(true);
    const { data: templateRows } = await supabase
      .from("form_templates")
      .select("*")
      .order("updated_at", { ascending: false });

    const { data: submissionRows } = await supabase
      .from("form_submissions")
      .select("form_template_id");

    const counts: Record<string, number> = {};
    for (const s of submissionRows ?? []) {
      counts[s.form_template_id] = (counts[s.form_template_id] ?? 0) + 1;
    }

    setForms(
      (templateRows ?? []).map((t) => ({ ...t, submissions: counts[t.id] ?? 0 }))
    );
    setLoading(false);
  }

  useEffect(() => {
    // Behind an async boundary so the loader's own `setLoading(true)`
    // is not a synchronous setState in the effect body. Same call, same
    // tick — `loadForms` still starts before this returns.
    void (async () => {
      await loadForms();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Creates the template, and its questions too when a preset was chosen.
   *
   * Two writes rather than one, because `form_fields` needs the template's id.
   * If the fields fail the template survives with none — recoverable in the
   * builder, and better than a rollback that loses the manager's typing. The
   * error says which half happened.
   */
  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { data: profileRow } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", userData.user!.id)
        .single();

      const preset = presetKey ? findPreset(presetKey) : undefined;
      const { data: created, error: insertError } = await supabase
        .from("form_templates")
        .insert({
          org_id: profileRow!.org_id,
          name,
          description: description || null,
          required,
          created_by: userData.user!.id,
        })
        .select("id")
        .single();
      if (insertError) throw new Error(insertError.message);

      if (preset && created) {
        const { error: fieldsError } = await supabase.from("form_fields").insert(
          preset.fields.map((f, i) => ({
            form_template_id: created.id,
            label: f.label,
            field_type: f.field_type,
            required: f.required,
            options: f.options ?? null,
            // Never a metric. See the note in lib/form-presets.ts: a
            // competitor's price is not our price accuracy.
            metric_key: f.metric_key ?? null,
            sort_order: i,
          }))
        );
        if (fieldsError) {
          throw new Error(
            `The form was created but its questions were not: ${fieldsError.message}`
          );
        }
      }

      setDialogOpen(false);
      setName("");
      setDescription("");
      setPresetKey("");
      setRequired(false);
      await loadForms();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  /** Fills the name and description in from a preset, leaving both editable. */
  function handlePresetChange(key: string) {
    setPresetKey(key);
    const preset = key ? findPreset(key) : undefined;
    if (!preset) return;
    setName(preset.name);
    setDescription(preset.description);
    setRequired(preset.required);
  }

  /**
   * Removes a template outright. Only offered when nothing has been submitted
   * against it: `form_fields` cascades, but `form_submissions.form_template_id`
   * is ON DELETE NO ACTION, so Postgres refuses to delete a form a rep has
   * filled in — and rightly, since the submissions would lose the questions
   * they answered. Archiving is the answer for those.
   */
  async function handleDelete(form: FormTemplate) {
    setBusy(true);
    setError(null);
    try {
      const { data, error: deleteError } = await supabase
        .from("form_templates")
        .delete()
        .eq("id", form.id)
        .select("id");
      if (deleteError) throw new Error(deleteError.message);
      // A delete blocked by RLS removes nothing and still reports success.
      if (!data || data.length === 0) {
        throw new Error("Nothing was deleted — you may not have permission.");
      }
      setPending(null);
      await loadForms();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** Hides a form from the reps without touching what was already answered. */
  async function handleSetActive(form: FormTemplate, active: boolean) {
    setBusy(true);
    setError(null);
    try {
      const { data, error: updateError } = await supabase
        .from("form_templates")
        .update({ active })
        .eq("id", form.id)
        .select("id");
      if (updateError) throw new Error(updateError.message);
      if (!data || data.length === 0) {
        throw new Error("Nothing changed — you may not have permission.");
      }
      setPending(null);
      await loadForms();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Forms
          </h1>
          <p className="text-sm text-muted-foreground">
            Build and manage the forms your reps fill out in the field.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger
            render={
              <Button className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="h-4 w-4" />
                New form
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New form</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="form-preset">Start from</Label>
                <NativeSelect
                  id="form-preset"
                  value={presetKey}
                  onChange={(e) => handlePresetChange(e.target.value)}
                >
                  <option value="">A blank form</option>
                  {FORM_PRESETS.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.name}
                    </option>
                  ))}
                </NativeSelect>
                {/* The blueprint is a starting point: the questions it creates
                    are ordinary fields, editable and deletable afterwards. */}
                {presetKey && (
                  <p className="text-xs text-muted-foreground">
                    {findPreset(presetKey)?.blurb} Every question can be edited
                    or removed afterwards.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="form-name">Name</Label>
                <Input id="form-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="form-description">Description</Label>
                <Input
                  id="form-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="flex items-start gap-2">
                <Checkbox
                  id="form-required"
                  checked={required}
                  onCheckedChange={(checked) => setRequired(checked === true)}
                />
                <div className="space-y-0.5">
                  <Label htmlFor="form-required" className="font-normal">
                    Compulsory
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Reps cannot check out of a store until this form is
                    submitted for that visit. Leave it off for occasional
                    surveys.
                  </p>
                </div>
              </div>
            </div>
            <DialogFooter>
              {error && (
                <p className="mr-auto text-xs text-destructive">{error}</p>
              )}
              <Button
                onClick={handleCreate}
                disabled={saving || !name}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? "Creating…" : "Create form"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Form</TableHead>
              <TableHead>Submissions</TableHead>
              <TableHead>Last updated</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                  Loading forms…
                </TableCell>
              </TableRow>
            ) : forms.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                  No forms yet. Create your first one above.
                </TableCell>
              </TableRow>
            ) : (
              forms.map((form) => (
                <TableRow key={form.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-accent-foreground">
                        <FileText className="h-4 w-4" />
                      </div>
                      <Link
                        href={`/forms/${form.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {form.name}
                      </Link>
                      {!form.active && (
                        <Badge variant="outline" className="font-normal">
                          Archived
                        </Badge>
                      )}
                      {/* Said on the list, not only in the builder: whether a
                          form holds a rep at the door is the fact a manager
                          scanning this page most needs. */}
                      <Badge
                        variant="outline"
                        className="font-normal text-muted-foreground"
                      >
                        {form.required ? "Compulsory" : "Optional"}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{form.submissions}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(form.updated_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    {/* `nativeButton={false}` because the render target is an
                        anchor. Without it Base UI logged an accessibility
                        error on every load of this page. */}
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        nativeButton={false}
                        render={<Link href={`/forms/${form.id}`}>Edit</Link>}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${form.name}`}
                        title="Remove"
                        onClick={() => {
                          setError(null);
                          setPending(form);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Delete when nothing has been answered, archive when something has.
          The database enforces the same rule — this explains it before the
          click rather than surfacing a foreign-key error afterwards. */}
      <Dialog
        open={pending !== null}
        onOpenChange={(o) => {
          // Ignored while the mutation is out. Disabling the Cancel button shut
          // one door and left Escape and the backdrop open — both land here, and
          // clearing `pending` throws away the state a later failure needs to be
          // reported on. Guard the state change, not the control.
          if (busy) return;
          if (!o) {
            setPending(null);
            setError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            {/* `pending` goes null the moment the dialog starts closing, while
                the content is still mounted for the animation — long enough to
                render "Delete undefined?" on the way out. */}
            <DialogTitle>
              {pending
                ? pending.submissions > 0
                  ? `Archive ${pending.name}?`
                  : `Delete ${pending.name}?`
                : "Remove form?"}
            </DialogTitle>
          </DialogHeader>

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          {pending && pending.submissions > 0 ? (
            <div className="space-y-2 text-sm">
              <p className="flex items-start gap-1.5 text-foreground">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <span>
                  {pending.submissions} submission
                  {pending.submissions === 1 ? " has" : "s have"} been recorded
                  against this form, so it cannot be deleted — those answers
                  would lose the questions they belong to.
                </span>
              </p>
              <p className="text-muted-foreground">
                Archiving takes it off the reps&rsquo; phones and leaves the
                history intact. You can restore it later.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nothing has been submitted against this form, so it can be removed
              outright. Its fields go with it. This cannot be undone.
            </p>
          )}

          <DialogFooter>
            {pending && pending.submissions > 0 ? (
              <Button
                disabled={busy}
                onClick={() => pending && handleSetActive(pending, !pending.active)}
              >
                {busy
                  ? "Working…"
                  : pending.active
                    ? "Archive form"
                    : "Restore form"}
              </Button>
            ) : (
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => pending && handleDelete(pending)}
              >
                {busy ? "Deleting…" : "Delete permanently"}
              </Button>
            )}
            {/* Disabled while the mutation is out: closing mid-request nulls
                `pending`, and a failure afterwards would set `error` on a dialog
                that is no longer open — so the manager would never learn the
                removal did not happen. */}
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setPending(null)}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
