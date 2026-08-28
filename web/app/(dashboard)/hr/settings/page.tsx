"use client";

import { useCallback, useState } from "react";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Field } from "@/components/hr/field";
import { createClient } from "@/lib/supabase/client";
import { useHrLoad } from "@/lib/hr/use-load";
import { usePermissions } from "@/lib/use-permissions";
import { can } from "@/lib/permissions";
import { fetchOrgId } from "@/lib/hr/employees";
import {
  codeFromLabel,
  fetchHrReference,
  LOOKUP_KINDS,
  saveDepartment,
  saveLeaveType,
  saveLookup,
  saveReviewCategory,
  saveReviewTemplate,
  saveSettings,
  setDepartmentTemplate,
  WEEKDAYS,
  type HrReference,
  type SettingsInput,
} from "@/lib/hr/settings";
import { activeTemplates, categoriesOfTemplate } from "@/lib/hr/performance";
import { REVIEW_PERIOD_LABELS } from "@/lib/hr/types";

/**
 * HR settings.
 *
 * Everything on this page is a policy decision, and every one of them is a row
 * rather than a constant in the code. That is section 12's instruction taken
 * literally: no Botswana employment rule is hard-coded anywhere in this module,
 * because policy and law change and a check constraint changes only by
 * migration.
 *
 * The three that reach furthest:
 *
 *   * **Working hours and the late threshold** are read every time attendance
 *     is displayed. Nothing stores a "late" flag, so raising the threshold
 *     re-reads history correctly instead of leaving last month's verdicts
 *     frozen at last month's rule.
 *   * **The rating scale and minimum acceptable score** decide what "below
 *     expectations" means on the performance dashboard.
 *   * **The case statuses** carry flags that the dashboards count on — which
 *     status is terminal, which is waiting on the employee, which on a hearing.
 *     Renaming a status is safe; the code behind it is what everything is filed
 *     under.
 */
export default function HrSettingsPage() {
  const supabase = createClient();
  const permissions = usePermissions();
  // Changing HR settings is a narrower grant than running HR — the database
  // draws the same line, in `hr_can_configure()`. Creating people and granting
  // permissions is not here at all: that moved to Settings → Users, which does
  // it for every job role rather than only for HR.
  const isHr = permissions !== null && can(permissions, "hr_settings");

  const [reference, setReference] = useState<HrReference | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  // Which scorecard's categories the Performance tab is showing. Held as "" and
  // resolved against the loaded list below rather than seeded in an effect once
  // the reference data arrives — an effect that sets state from state is the
  // pattern `use-load.ts` exists to keep out of this module.
  const [templateId, setTemplateId] = useState("");
  const [newTemplate, setNewTemplate] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const [ref, org] = await Promise.all([
        fetchHrReference(supabase),
        fetchOrgId(supabase),
      ]);
      setReference(ref);
      setOrgId(org);
      const s = ref.settings;
      setSettings({
        work_start_time: (s?.work_start_time ?? "08:00").slice(0, 5),
        work_end_time: (s?.work_end_time ?? "17:00").slice(0, 5),
        late_threshold_minutes: s?.late_threshold_minutes ?? 15,
        short_day_hours: Number(s?.short_day_hours ?? 4),
        workweek: (s?.workweek ?? [1, 2, 3, 4, 5]) as number[],
        review_frequency: s?.review_frequency ?? "quarterly",
        rating_scale_max: s?.rating_scale_max ?? 5,
        min_acceptable_score: Number(s?.min_acceptable_score ?? 3),
        leave_year_start_month: s?.leave_year_start_month ?? 1,
        expiry_warning_days: s?.expiry_warning_days ?? 30,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useHrLoad(load);

  async function persist(fn: () => Promise<void>, message: string) {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      await fn();
      setSaved(message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!settings || !reference) {
    // An error has to win over the skeleton here. `load()` sets `error` and
    // leaves `settings` null, so checking the skeleton first would spin for
    // ever on a failure and say nothing about why.
    return error ? (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          HR settings
        </h1>
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <p className="font-medium">Could not load HR settings</p>
          <p className="mt-1">{error}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={load}>
            Retry
          </Button>
        </div>
      </div>
    ) : (
      <div className="h-64 animate-pulse rounded-lg bg-muted/50" />
    );
  }

  // The scorecard on screen: whatever HR picked, else the first one there is.
  // Falls back rather than persisting a choice, so deleting or retiring the
  // selected scorecard cannot leave the tab pointing at nothing.
  const selectedTemplate =
    reference.reviewTemplates.find((t) => t.id === templateId)?.id ??
    reference.reviewTemplates[0]?.id ??
    "";
  const current =
    reference.reviewTemplates.find((t) => t.id === selectedTemplate) ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          HR settings
        </h1>
        <p className="text-sm text-muted-foreground">
          No employment rule is compiled into this system. Everything here is
          yours to change.
        </p>
      </div>

      {!isHr && (
        <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          You can see these settings but not change them.
        </div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {saved && (
        <div className="rounded-md border border-border bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
          {saved}
        </div>
      )}

      <Tabs defaultValue="hours">
        <TabsList className="flex-wrap">
          <TabsTrigger value="hours">Working hours</TabsTrigger>
          <TabsTrigger value="leave">Leave types</TabsTrigger>
          <TabsTrigger value="departments">Departments</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="disciplinary">Disciplinary</TabsTrigger>
        </TabsList>

        {/* ---------------------------------------------------------- hours */}
        <TabsContent value="hours" className="mt-4">
          <Card>
            <CardContent className="space-y-4 p-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Standard start time">
                  <Input
                    type="time"
                    value={settings.work_start_time}
                    disabled={!isHr}
                    onChange={(e) =>
                      setSettings({ ...settings, work_start_time: e.target.value })
                    }
                  />
                </Field>
                <Field label="Standard end time">
                  <Input
                    type="time"
                    value={settings.work_end_time}
                    disabled={!isHr}
                    onChange={(e) =>
                      setSettings({ ...settings, work_end_time: e.target.value })
                    }
                  />
                </Field>
                <Field
                  label="Late after (minutes)"
                  hint="Attendance is recalculated from this every time it is read."
                >
                  <Input
                    type="number"
                    min={0}
                    max={240}
                    value={settings.late_threshold_minutes}
                    disabled={!isHr}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        late_threshold_minutes: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field
                  label="Very short day under (hours)"
                  hint="Flags a day that was started and ended unusually quickly."
                >
                  <Input
                    type="number"
                    step="0.5"
                    min={0}
                    value={settings.short_day_hours}
                    disabled={!isHr}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        short_day_hours: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field
                  label="Leave year starts in month"
                  hint="1 = January. Entitlement runs on this cycle."
                >
                  <Input
                    type="number"
                    min={1}
                    max={12}
                    value={settings.leave_year_start_month}
                    disabled={!isHr}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        leave_year_start_month: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field
                  label="Warn before expiry (days)"
                  hint="Applies to documents and contracts."
                >
                  <Input
                    type="number"
                    min={1}
                    value={settings.expiry_warning_days}
                    disabled={!isHr}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        expiry_warning_days: Number(e.target.value),
                      })
                    }
                  />
                </Field>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Working week</Label>
                <div className="flex flex-wrap gap-3">
                  {WEEKDAYS.map((d) => (
                    <label key={d.value} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={settings.workweek.includes(d.value)}
                        disabled={!isHr}
                        onCheckedChange={(checked) =>
                          setSettings({
                            ...settings,
                            workweek: checked
                              ? [...settings.workweek, d.value].sort((a, b) => a - b)
                              : settings.workweek.filter((v) => v !== d.value),
                          })
                        }
                      />
                      {d.label}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  A day outside the working week is never counted absent.
                </p>
              </div>

              {isHr && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    persist(async () => {
                      if (!orgId) throw new Error("No organisation.");
                      await saveSettings(supabase, orgId, settings);
                    }, "Working hours saved.")
                  }
                >
                  Save
                </Button>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------------------------------------------------- leave */}
        <TabsContent value="leave" className="mt-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Default entitlements start at zero deliberately. Botswana&rsquo;s
            statutory minimums are not built in, because they change and because
            they differ by contract type — set the number your policy uses.
          </p>
          <EditableList
            rows={reference.leaveTypes.map((t) => ({
              id: t.id,
              label: t.name,
              code: t.code,
              active: t.active,
              extra: `${t.default_entitlement_days} days${t.is_paid ? "" : " · unpaid"}${
                t.requires_document ? " · needs a document" : ""
              }`,
            }))}
            editable={isHr}
            addLabel="Add a leave type"
            onToggle={(row, active) =>
              persist(async () => {
                if (!orgId) throw new Error("No organisation.");
                const t = reference.leaveTypes.find((x) => x.id === row.id)!;
                await saveLeaveType(supabase, orgId, {
                  id: t.id,
                  name: t.name,
                  code: t.code,
                  is_paid: t.is_paid,
                  default_entitlement_days: Number(t.default_entitlement_days),
                  requires_document: t.requires_document,
                  deducts_from_balance: t.deducts_from_balance,
                  active,
                  sort_order: t.sort_order,
                });
              }, active ? "Enabled." : "Disabled.")
            }
            onAdd={(label) =>
              persist(async () => {
                if (!orgId) throw new Error("No organisation.");
                await saveLeaveType(supabase, orgId, {
                  name: label,
                  code: codeFromLabel(label),
                  is_paid: true,
                  default_entitlement_days: 0,
                  requires_document: false,
                  deducts_from_balance: true,
                  active: true,
                  sort_order: (reference.leaveTypes.at(-1)?.sort_order ?? 0) + 10,
                });
              }, "Leave type added.")
            }
          >
            {isHr && (
              <LeaveTypeEditor
                reference={reference}
                busy={busy}
                onSave={(input) =>
                  persist(async () => {
                    if (!orgId) throw new Error("No organisation.");
                    await saveLeaveType(supabase, orgId, input);
                  }, "Leave type saved.")
                }
              />
            )}
          </EditableList>
        </TabsContent>

        {/* ---------------------------------------------------- departments */}
        <TabsContent value="departments" className="mt-4">
          <EditableList
            rows={reference.departments.map((d) => ({
              id: d.id,
              label: d.name,
              code: d.code ?? "",
              active: d.active,
              extra: "",
            }))}
            editable={isHr}
            addLabel="Add a department"
            onToggle={(row, active) =>
              persist(async () => {
                if (!orgId) throw new Error("No organisation.");
                const d = reference.departments.find((x) => x.id === row.id)!;
                await saveDepartment(supabase, orgId, {
                  id: d.id,
                  name: d.name,
                  code: d.code,
                  active,
                  sort_order: d.sort_order,
                });
              }, active ? "Enabled." : "Disabled.")
            }
            onAdd={(label) =>
              persist(async () => {
                if (!orgId) throw new Error("No organisation.");
                await saveDepartment(supabase, orgId, {
                  name: label,
                  code: codeFromLabel(label).toUpperCase().slice(0, 8),
                  active: true,
                  sort_order: (reference.departments.at(-1)?.sort_order ?? 0) + 10,
                });
              }, "Department added.")
            }
          />
        </TabsContent>

        {/* ---------------------------------------------------- performance */}
        <TabsContent value="performance" className="mt-4 space-y-4">
          <Card>
            <CardContent className="space-y-4 p-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Review frequency">
                  <NativeSelect
                    value={settings.review_frequency}
                    disabled={!isHr}
                    onChange={(e) =>
                      setSettings({ ...settings, review_frequency: e.target.value })
                    }
                  >
                    {Object.entries(REVIEW_PERIOD_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field
                  label="Rating scale"
                  hint="1 to this number. Existing reviews keep the scale they were rated on."
                >
                  <Input
                    type="number"
                    min={3}
                    max={10}
                    value={settings.rating_scale_max}
                    disabled={!isHr}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        rating_scale_max: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field
                  label="Minimum acceptable score"
                  hint="Below this counts as below expectations."
                >
                  <Input
                    type="number"
                    step="0.1"
                    min={1}
                    value={settings.min_acceptable_score}
                    disabled={!isHr}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        min_acceptable_score: Number(e.target.value),
                      })
                    }
                  />
                </Field>
              </div>
              {isHr && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    persist(async () => {
                      if (!orgId) throw new Error("No organisation.");
                      await saveSettings(supabase, orgId, settings);
                    }, "Performance settings saved.")
                  }
                >
                  Save
                </Button>
              )}
            </CardContent>
          </Card>

          <ScorecardAssignment
            reference={reference}
            editable={isHr}
            busy={busy}
            onAssign={(departmentId, templateId) =>
              persist(
                () => setDepartmentTemplate(supabase, departmentId, templateId),
                "Scorecard assigned."
              )
            }
          />

          <Card>
            <CardContent className="space-y-3 p-5">
              <div>
                <h2 className="text-sm font-semibold">Scorecards</h2>
                <p className="text-xs text-muted-foreground">
                  A scorecard is the set of things one kind of job is rated on.
                  Pick one to edit its categories.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <NativeSelect
                  className="w-[16rem]"
                  value={selectedTemplate}
                  onChange={(e) => setTemplateId(e.target.value)}
                >
                  {reference.reviewTemplates.length === 0 && (
                    <option value="">No scorecards yet</option>
                  )}
                  {reference.reviewTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.active ? "" : " (retired)"}
                    </option>
                  ))}
                </NativeSelect>
                {isHr && (
                  <>
                    <Input
                      className="max-w-xs"
                      placeholder="Add a scorecard"
                      value={newTemplate}
                      onChange={(e) => setNewTemplate(e.target.value)}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !newTemplate.trim()}
                      onClick={() =>
                        persist(async () => {
                          if (!orgId) throw new Error("No organisation.");
                          await saveReviewTemplate(supabase, orgId, {
                            name: newTemplate.trim(),
                            description: null,
                            active: true,
                            sort_order:
                              (reference.reviewTemplates.at(-1)?.sort_order ?? 0) + 10,
                          });
                          setNewTemplate("");
                        }, "Scorecard added.")
                      }
                    >
                      <Plus className="mr-1.5 h-4 w-4" /> Add
                    </Button>
                  </>
                )}
              </div>
              {current && (
                <div className="flex flex-wrap items-center gap-3">
                  {current.description && (
                    <p className="text-xs text-muted-foreground">
                      {current.description}
                    </p>
                  )}
                  {isHr && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox
                        checked={current.active}
                        onCheckedChange={(checked) =>
                          persist(async () => {
                            if (!orgId) throw new Error("No organisation.");
                            await saveReviewTemplate(supabase, orgId, {
                              id: current.id,
                              name: current.name,
                              description: current.description,
                              active: Boolean(checked),
                              sort_order: current.sort_order,
                            });
                          }, checked ? "Scorecard enabled." : "Scorecard retired.")
                        }
                      />
                      In use
                    </label>
                  )}
                </div>
              )}
              {!current?.active && current && (
                <p className="text-xs text-muted-foreground">
                  Retired. Reviews already written against it keep their
                  categories and scores; no new review can be started on it.
                </p>
              )}
            </CardContent>
          </Card>

          <EditableList
            rows={categoriesOfTemplate(reference.reviewCategories, selectedTemplate).map(
              (c) => ({
                id: c.id,
                label: c.name,
                code: "",
                active: c.active,
                extra:
                  Number(c.weight) === 1 ? "" : `weighted ×${Number(c.weight)}`,
              })
            )}
            editable={isHr && Boolean(selectedTemplate)}
            addLabel="Add a category"
            onToggle={(row, active) =>
              persist(async () => {
                if (!orgId) throw new Error("No organisation.");
                const c = reference.reviewCategories.find((x) => x.id === row.id)!;
                await saveReviewCategory(supabase, orgId, {
                  id: c.id,
                  template_id: c.template_id,
                  name: c.name,
                  description: c.description,
                  weight: Number(c.weight),
                  active,
                  sort_order: c.sort_order,
                });
              }, active ? "Enabled." : "Disabled.")
            }
            onAdd={(label) =>
              persist(async () => {
                if (!orgId) throw new Error("No organisation.");
                if (!selectedTemplate) throw new Error("Add a scorecard first.");
                const existing = categoriesOfTemplate(
                  reference.reviewCategories,
                  selectedTemplate
                );
                await saveReviewCategory(supabase, orgId, {
                  template_id: selectedTemplate,
                  name: label,
                  description: null,
                  weight: 1,
                  active: true,
                  sort_order: (existing.at(-1)?.sort_order ?? 0) + 10,
                });
              }, "Category added.")
            }
          />
        </TabsContent>

        {/* ---------------------------------------------------- disciplinary */}
        <TabsContent value="disciplinary" className="mt-4 space-y-4">
          {LOOKUP_KINDS.map((k) => (
            <div key={k.kind} className="space-y-2">
              <div>
                <h2 className="text-sm font-semibold">{k.label}</h2>
                <p className="text-xs text-muted-foreground">{k.help}</p>
              </div>
              <EditableList
                rows={reference.lookups
                  .filter((l) => l.kind === k.kind)
                  .map((l) => ({
                    id: l.id,
                    label: l.label,
                    code: l.code,
                    active: l.active,
                    extra: describeMeta(l.meta),
                  }))}
                editable={isHr}
                addLabel={`Add to ${k.label.toLowerCase()}`}
                onToggle={(row, active) =>
                  persist(async () => {
                    if (!orgId) throw new Error("No organisation.");
                    const l = reference.lookups.find((x) => x.id === row.id)!;
                    await saveLookup(supabase, orgId, {
                      id: l.id,
                      kind: l.kind,
                      code: l.code,
                      label: l.label,
                      sort_order: l.sort_order,
                      active,
                    });
                  }, active ? "Enabled." : "Disabled.")
                }
                onAdd={(label) =>
                  persist(async () => {
                    if (!orgId) throw new Error("No organisation.");
                    const siblings = reference.lookups.filter((l) => l.kind === k.kind);
                    await saveLookup(supabase, orgId, {
                      kind: k.kind,
                      code: codeFromLabel(label),
                      label,
                      sort_order: (siblings.at(-1)?.sort_order ?? 0) + 10,
                      active: true,
                    });
                  }, "Added.")
                }
              />
            </div>
          ))}
        </TabsContent>

      </Tabs>
    </div>
  );
}

/** The `{"terminal": true}` style flags, rendered as words. */
function describeMeta(meta: unknown): string {
  const m = (meta ?? {}) as Record<string, unknown>;
  const bits: string[] = [];
  if (m.terminal) bits.push("closes the case");
  if (m.awaiting_employee) bits.push("waits on the employee");
  if (m.awaiting_hearing) bits.push("waits on a hearing");
  if (typeof m.rank === "number") bits.push(`rank ${m.rank}`);
  return bits.join(" · ");
}

type ListRow = {
  id: string;
  label: string;
  code: string;
  active: boolean;
  extra: string;
};

/**
 * A configurable list: enable, disable, add.
 *
 * There is no delete. Every one of these lists is referenced by a stored code —
 * a case's incident type, a document's category, a request's leave type — and
 * deleting the row would leave records filed under a label nobody can read.
 * Disabling takes it out of every dropdown while the history keeps its name.
 */
function EditableList({
  rows,
  editable,
  addLabel,
  onToggle,
  onAdd,
  children,
}: {
  rows: ListRow[];
  editable: boolean;
  addLabel: string;
  onToggle: (row: ListRow, active: boolean) => void;
  onAdd: (label: string) => void;
  children?: React.ReactNode;
}) {
  const [draft, setDraft] = useState("");
  return (
    <Card>
      <CardContent className="space-y-3 px-0 pb-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden sm:table-cell">Code</TableHead>
              <TableHead className="hidden md:table-cell" />
              <TableHead className="text-right">In use</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                  Nothing configured.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id} className={r.active ? undefined : "opacity-60"}>
                  <TableCell className="font-medium">{r.label}</TableCell>
                  <TableCell className="hidden sm:table-cell font-mono text-xs text-muted-foreground">
                    {r.code}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                    {r.extra}
                  </TableCell>
                  <TableCell className="text-right">
                    {editable ? (
                      <Checkbox
                        checked={r.active}
                        onCheckedChange={(checked) => onToggle(r, Boolean(checked))}
                      />
                    ) : (
                      <Badge variant="outline" className="font-normal">
                        {r.active ? "Yes" : "No"}
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {editable && (
          <div className="flex flex-wrap gap-2 px-4">
            <Input
              className="max-w-xs"
              placeholder={addLabel}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!draft.trim()}
              onClick={() => {
                onAdd(draft.trim());
                setDraft("");
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" /> Add
            </Button>
          </div>
        )}
        {children}
      </CardContent>
    </Card>
  );
}

/**
 * Which scorecard each department's people are reviewed on.
 *
 * This table is the whole answer to "why is the warehouse clerk being asked
 * about shelf facings": the review form follows the employee's department, and
 * before this existed there was only one set of categories for the entire
 * company.
 *
 * A department left unassigned is shown as a problem rather than defaulted.
 * Falling back to some organisation-wide scorecard would let a review be
 * written against criteria nobody chose for that job — which is the failure
 * being fixed, restated one level up.
 *
 * Retired scorecards are offered only where one is already assigned, so an
 * existing assignment stays visible and correctable instead of silently
 * reading as "None".
 */
function ScorecardAssignment({
  reference,
  editable,
  busy,
  onAssign,
}: {
  reference: HrReference;
  editable: boolean;
  busy: boolean;
  onAssign: (departmentId: string, templateId: string | null) => void;
}) {
  const choices = activeTemplates(reference.reviewTemplates);
  const departments = reference.departments.filter((d) => d.active);
  const unassigned = departments.filter((d) => !d.review_template_id).length;

  return (
    <Card>
      <CardContent className="space-y-3 px-0 pb-4">
        <div className="space-y-1 px-5 pt-1">
          <h2 className="text-sm font-semibold">Who is reviewed on what</h2>
          <p className="text-xs text-muted-foreground">
            Each department&rsquo;s people are reviewed on its scorecard. One
            person can be moved to a different one on their employee record.
          </p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Department</TableHead>
              <TableHead>Scorecard</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {departments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2} className="py-6 text-center text-sm text-muted-foreground">
                  No departments configured.
                </TableCell>
              </TableRow>
            ) : (
              departments.map((d) => {
                const assigned = reference.reviewTemplates.find(
                  (t) => t.id === d.review_template_id
                );
                return (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell>
                      {editable ? (
                        <NativeSelect
                          className="w-[16rem]"
                          disabled={busy}
                          value={d.review_template_id ?? ""}
                          onChange={(e) =>
                            onAssign(d.id, e.target.value || null)
                          }
                        >
                          <option value="">None — reviews cannot be started</option>
                          {choices.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                          {assigned && !assigned.active && (
                            <option value={assigned.id}>
                              {assigned.name} (retired)
                            </option>
                          )}
                        </NativeSelect>
                      ) : assigned ? (
                        <span className="text-sm text-muted-foreground">
                          {assigned.name}
                        </span>
                      ) : (
                        <span className="text-sm text-destructive">None</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        {unassigned > 0 && (
          <p className="px-5 text-xs text-destructive">
            {unassigned === 1
              ? "One department has no scorecard. Nobody in it can be reviewed until it does."
              : `${unassigned} departments have no scorecard. Nobody in them can be reviewed until they do.`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Entitlement and the two flags that change how a leave type behaves. */
function LeaveTypeEditor({
  reference,
  busy,
  onSave,
}: {
  reference: HrReference;
  busy: boolean;
  onSave: (input: {
    id: string;
    name: string;
    code: string;
    is_paid: boolean;
    default_entitlement_days: number;
    requires_document: boolean;
    deducts_from_balance: boolean;
    active: boolean;
    sort_order: number;
  }) => void;
}) {
  const [id, setId] = useState(reference.leaveTypes[0]?.id ?? "");
  const type = reference.leaveTypes.find((t) => t.id === id) ?? null;
  const [days, setDays] = useState("");
  const [paid, setPaid] = useState(true);
  const [needsDoc, setNeedsDoc] = useState(false);
  const [deducts, setDeducts] = useState(true);

  // Load the chosen type's values during render, not in an effect: the fields
  // would otherwise show the previous type for a frame after the dropdown
  // changes, which on a settings page reads as the edit having gone in.
  const [loadedId, setLoadedId] = useState<string | null>(null);
  if (type && type.id !== loadedId) {
    setLoadedId(type.id);
    setDays(String(type.default_entitlement_days));
    setPaid(type.is_paid);
    setNeedsDoc(type.requires_document);
    setDeducts(type.deducts_from_balance);
  }

  if (!type) return null;

  return (
    <div className="space-y-3 border-t border-border px-4 pt-4">
      <p className="text-xs font-medium text-foreground">Configure a leave type</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Leave type">
          <NativeSelect value={id} onChange={(e) => setId(e.target.value)}>
            {reference.leaveTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Default entitlement (days)">
          <Input
            type="number"
            step="0.5"
            min={0}
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </Field>
        <div className="flex items-end gap-4 sm:col-span-2">
          <label className="flex items-center gap-2 pb-1.5 text-sm">
            <Checkbox
              checked={paid}
              onCheckedChange={(c) => setPaid(Boolean(c))}
            />
            Paid
          </label>
          <label className="flex items-center gap-2 pb-1.5 text-sm">
            <Checkbox
              checked={needsDoc}
              onCheckedChange={(c) => setNeedsDoc(Boolean(c))}
            />
            Needs a document
          </label>
          {/* The entitlement above is meaningless for a type that does not
              deduct — study leave, unpaid leave taken outside the allowance —
              and the balance screen already reads this column. It was being
              persisted unchanged from a field nothing could edit. */}
          <label className="flex items-center gap-2 pb-1.5 text-sm">
            <Checkbox
              checked={deducts}
              onCheckedChange={(c) => setDeducts(Boolean(c))}
            />
            Comes off the balance
          </label>
          <Button
            size="sm"
            variant="outline"
            className="mb-0.5"
            disabled={busy}
            onClick={() =>
              onSave({
                id: type.id,
                name: type.name,
                code: type.code,
                is_paid: paid,
                default_entitlement_days: Number(days),
                requires_document: needsDoc,
                deducts_from_balance: deducts,
                active: type.active,
                sort_order: type.sort_order,
              })
            }
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
