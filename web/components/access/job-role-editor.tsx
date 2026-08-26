"use client";

import { useState } from "react";
import { AlertTriangle, Info, Plus, Smartphone, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/hr/field";
import { createClient } from "@/lib/supabase/client";
import { ROLE_LABELS, type AppRole } from "@/lib/roles";
import {
  BASE_ROLE_NOTES,
  deleteJobRole,
  groupByArea,
  peopleOnRole,
  reapplyJobRole,
  saveJobRole,
  type AccessDirectory,
} from "@/lib/access";

type Draft = {
  id: string | null;
  name: string;
  description: string;
  baseRole: string;
  active: boolean;
  permissions: Set<string>;
  isSystem: boolean;
  code: string | null;
};

/**
 * Job roles: the templates behind the tick boxes.
 *
 * Three things this screen has to be honest about, all of which come from
 * decisions in the schema rather than from the UI:
 *
 *   * **Editing a role does not change the people on it.** Grants are copied
 *     onto a person when the role is applied, so an administrator's individual
 *     adjustments survive. "Apply to everyone" is the deliberate opposite, and
 *     it discards those adjustments — which is why it is a separate button with
 *     a confirmation rather than something that happens on save.
 *   * **The base role is not a permission**, but it decides whether the Android
 *     app lets somebody in and what they can read in the modules that are not
 *     on permissions yet. Choosing it blind would be a coin flip, so each option
 *     says what it means.
 *   * **A built-in role can be renamed but not deleted**, and keeps a hidden
 *     stable code — the trigger that gives a new account its permissions matches
 *     on that code, so a rename must not be able to orphan somebody.
 */
export function JobRoleEditor({
  directory,
  onChanged,
}: {
  directory: AccessDirectory;
  onChanged: () => Promise<void> | void;
}) {
  const supabase = createClient();
  const [selectedId, setSelectedId] = useState<string | null>(
    directory.jobRoles[0]?.id ?? null
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Load the selected role into the draft during render rather than in an
  // effect, so the form never shows the previous role for a frame.
  const [loadedFor, setLoadedFor] = useState<string | null | undefined>(undefined);
  if (loadedFor !== selectedId) {
    setLoadedFor(selectedId);
    const role = directory.jobRoles.find((r) => r.id === selectedId) ?? null;
    setDraft(
      role
        ? {
            id: role.id,
            name: role.name,
            description: role.description ?? "",
            baseRole: role.base_role,
            active: role.active,
            permissions: new Set(directory.jobRolePermissions.get(role.id) ?? []),
            isSystem: role.is_system,
            code: role.code,
          }
        : null
    );
    setError(null);
    setNote(null);
  }

  function startNew() {
    setSelectedId(null);
    setLoadedFor(null);
    setDraft({
      id: null,
      name: "",
      description: "",
      // Warehouse is the safe default: in the unconverted modules it can read
      // nothing, so a new role starts as exactly its tick boxes and no more.
      baseRole: "warehouse",
      active: true,
      permissions: new Set<string>(),
      isSystem: false,
      code: null,
    });
    setError(null);
    setNote(null);
  }

  async function run(fn: () => Promise<string | void>, message?: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const result = await fn();
      await onChanged();
      if (typeof result === "string") {
        setSelectedId(result);
        setLoadedFor(undefined);
      }
      if (message) setNote(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const people = draft?.id ? peopleOnRole(directory, draft.id) : 0;
  const areas = groupByArea(directory.permissions);

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <Card>
        <CardContent className="space-y-2 p-2">
          <ul className="space-y-0.5">
            {directory.jobRoles.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(r.id)}
                  className={
                    "w-full rounded-md px-3 py-2 text-left transition-colors " +
                    (r.id === selectedId ? "bg-muted" : "hover:bg-muted/50")
                  }
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    {r.name}
                    {r.base_role === "rep" && (
                      <Smartphone className="h-3 w-3 shrink-0" aria-label="Uses the Android app" />
                    )}
                    {!r.active && (
                      <Badge variant="outline" className="font-normal">
                        Disabled
                      </Badge>
                    )}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {peopleOnRole(directory, r.id)} people ·{" "}
                    {(directory.jobRolePermissions.get(r.id) ?? []).length} permissions
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={startNew}>
            <Plus className="h-4 w-4" /> New job role
          </Button>
        </CardContent>
      </Card>

      {draft && (
        <div className="space-y-4">
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}
          {note && (
            <div className="rounded-md border border-border bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
              {note}
            </div>
          )}

          <Card>
            <CardContent className="space-y-3 p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name">
                  <Input
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="Field Supervisor"
                  />
                </Field>
                <Field label="Base role" hint={BASE_ROLE_NOTES[draft.baseRole]}>
                  <NativeSelect
                    value={draft.baseRole}
                    onChange={(e) => setDraft({ ...draft, baseRole: e.target.value })}
                  >
                    {(Object.keys(ROLE_LABELS) as AppRole[]).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Description" className="sm:col-span-2">
                  <Textarea
                    rows={2}
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  />
                </Field>
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <Checkbox
                    checked={draft.active}
                    onCheckedChange={(c) => setDraft({ ...draft, active: Boolean(c) })}
                  />
                  Offered when assigning somebody a job role
                </label>
              </div>

              {draft.isSystem && (
                <p className="flex gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    A built-in role. Rename it, describe it and change its
                    permissions freely — it keeps a hidden identifier (
                    <code>{draft.code}</code>) so new accounts still find it. It
                    cannot be deleted; disable it instead.
                  </span>
                </p>
              )}

              {draft.id && people > 0 && (
                <p className="flex gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    Saving changes the template,{" "}
                    <span className="font-medium">not</span> the {people}{" "}
                    {people === 1 ? "person" : "people"} already on it — their
                    permissions were copied when the role was applied, so
                    anything you adjusted on one of them individually survives.
                    Use <span className="font-medium">Apply to everyone</span> to
                    overwrite them.
                  </span>
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy}
                  onClick={() =>
                    run(
                      () =>
                        saveJobRole(supabase, {
                          id: draft.id,
                          name: draft.name,
                          description: draft.description.trim() || null,
                          baseRole: draft.baseRole,
                          active: draft.active,
                          permissions: Array.from(draft.permissions),
                        }),
                      "Saved."
                    )
                  }
                >
                  {busy ? "Saving…" : draft.id ? "Save changes" : "Create job role"}
                </Button>
                {draft.id && people > 0 && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Give all ${people} ${
                            people === 1 ? "person" : "people"
                          } on this role exactly these permissions? Any individual changes you made to them are discarded.`
                        )
                      )
                        return;
                      const id = draft.id!;
                      void run(async () => {
                        const n = await reapplyJobRole(supabase, id);
                        setNote(`Applied to ${n} ${n === 1 ? "person" : "people"}.`);
                      });
                    }}
                  >
                    Apply to everyone ({people})
                  </Button>
                )}
                {draft.id && !draft.isSystem && (
                  <Button
                    variant="ghost"
                    className="gap-1.5 text-destructive"
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm(`Delete "${draft.name}"?`)) return;
                      const id = draft.id!;
                      void run(async () => {
                        await deleteJobRole(supabase, id);
                        setSelectedId(directory.jobRoles[0]?.id ?? null);
                        setLoadedFor(undefined);
                      }, "Deleted.");
                    }}
                  >
                    <Trash2 className="h-4 w-4" /> Delete
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {areas.map((area) => (
            <Card key={area.area}>
              <CardContent className="space-y-3 p-5">
                <h3 className="text-sm font-semibold">{area.area}</h3>
                <ul className="space-y-3">
                  {area.permissions.map((p) => (
                    <li key={p.code} className="flex gap-3">
                      <Checkbox
                        className="mt-0.5"
                        checked={draft.permissions.has(p.code)}
                        // `admin` is not a tick box anywhere: granting your own
                        // level of access is a Supabase-dashboard act, and the
                        // database refuses it on a template too.
                        disabled={p.code === "admin" || busy}
                        onCheckedChange={(checked) => {
                          const next = new Set(draft.permissions);
                          if (checked) next.add(p.code);
                          else next.delete(p.code);
                          setDraft({ ...draft, permissions: next });
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">
                          {p.label}
                          {!p.data_enforced && (
                            <Badge
                              variant="outline"
                              className="ml-2 font-normal"
                              title="Decides what appears in the menu. The data behind it still follows the base role until that module is converted."
                            >
                              Menu only
                            </Badge>
                          )}
                          {p.code === "admin" && (
                            <Badge variant="outline" className="ml-2 font-normal">
                              Not grantable here
                            </Badge>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">{p.description}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
