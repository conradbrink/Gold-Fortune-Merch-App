"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Plus,
  Trash2,
  GripVertical,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/lib/supabase/types";
import {
  fieldTypeLabels,
  findMetric,
  metricMismatch,
  metricsForFieldType,
} from "@/lib/metrics";

type FormTemplate = Tables<"form_templates">;
type FormField = Tables<"form_fields">;

/** The options a multiple-choice question offers, from the comma-separated input. */
function parseOptions(raw: string): string[] {
  return raw.split(",").map((o) => o.trim()).filter(Boolean);
}

function fieldOptions(field: FormField): string[] {
  return Array.isArray(field.options) ? (field.options as string[]) : [];
}

export default function FormDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();

  const [template, setTemplate] = useState<FormTemplate | null>(null);
  const [fields, setFields] = useState<FormField[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [newField, setNewField] = useState({
    label: "",
    field_type: "text",
    required: false,
    options: "",
    metric_key: "",
  });

  const emptyField = {
    label: "",
    field_type: "text",
    required: false,
    options: "",
    metric_key: "",
  };

  async function load() {
    setLoading(true);
    const { data: templateRow } = await supabase
      .from("form_templates")
      .select("*")
      .eq("id", params.id)
      .single();
    setTemplate(templateRow);

    const { data: fieldRows } = await supabase
      .from("form_fields")
      .select("*")
      .eq("form_template_id", params.id)
      .order("sort_order");
    setFields(fieldRows ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function handleAddField() {
    setSaving(true);
    setAddError(null);
    const parsed = parseOptions(newField.options);
    const options =
      newField.field_type === "multiple_choice" && parsed.length ? parsed : null;

    // Select the inserted row back: a write PostgREST filters away answers
    // with success and no rows, so nothing else would tell us it was refused.
    const { data, error: insertError } = await supabase
      .from("form_fields")
      .insert({
        form_template_id: params.id,
        label: newField.label,
        field_type: newField.field_type,
        required: newField.required,
        options,
        metric_key: newField.metric_key || null,
        sort_order: fields.length,
      })
      .select("id")
      .maybeSingle();

    setSaving(false);
    if (insertError || !data) {
      setAddError(insertError?.message ?? "The field could not be added.");
      return;
    }

    setDialogOpen(false);
    setNewField(emptyField);
    load();
  }

  /**
   * Changing the type can strand the metric — `in_stock` is only ever read
   * from `value_boolean`, so a question that stops being Yes/No stops feeding
   * it. Drop the link rather than keep one that silently measures nothing.
   */
  function handleNewFieldType(fieldType: string) {
    const stillValid = metricsForFieldType(fieldType).some(
      (m) => m.key === newField.metric_key
    );
    setNewField({
      ...newField,
      field_type: fieldType,
      metric_key: stillValid ? newField.metric_key : "",
    });
  }

  async function handleMetricChange(field: FormField, metricKey: string) {
    setRowError(null);
    const next = metricKey || null;
    // Apply locally first so the select does not snap back while the round
    // trip is in flight, then reconcile from what the database accepted.
    setFields((prev) =>
      prev.map((f) => (f.id === field.id ? { ...f, metric_key: next } : f))
    );

    const { data, error: updateError } = await supabase
      .from("form_fields")
      .update({ metric_key: next })
      .eq("id", field.id)
      .select("id, metric_key")
      .maybeSingle();

    if (updateError || !data) {
      setRowError(
        updateError?.message ??
          "That change was not saved — you may not have permission to edit this form."
      );
      load();
      return;
    }

    setFields((prev) =>
      prev.map((f) =>
        f.id === field.id ? { ...f, metric_key: data.metric_key } : f
      )
    );
  }

  async function handleDeleteField(id: string) {
    await supabase.from("form_fields").delete().eq("id", id);
    load();
  }

  async function persistOrder(ordered: FormField[]) {
    setFields(ordered);
    await Promise.all(
      ordered.map((f, i) =>
        supabase.from("form_fields").update({ sort_order: i }).eq("id", f.id)
      )
    );
  }

  function moveField(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    [next[index], next[target]] = [next[target], next[index]];
    persistOrder(next);
  }

  function handleDrop(targetIndex: number) {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null);
      return;
    }
    const next = [...fields];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(targetIndex, 0, moved);
    setDragIndex(null);
    persistOrder(next);
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card py-16 text-center text-sm text-muted-foreground">
        Loading form…
      </div>
    );
  }

  if (!template) {
    return (
      <div className="rounded-lg border border-border bg-card py-16 text-center text-sm text-muted-foreground">
        Form not found.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => router.push("/forms")}>
        <ArrowLeft className="h-4 w-4" />
        Back to Forms
      </Button>

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{template.name}</h1>
        {template.description && (
          <p className="text-sm text-muted-foreground">{template.description}</p>
        )}
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Fields</h2>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger
            render={
              <Button size="sm" className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="h-4 w-4" />
                Add field
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add field</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="field-label">Label</Label>
                <Input
                  id="field-label"
                  value={newField.label}
                  onChange={(e) => setNewField({ ...newField, label: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="field-type">Type</Label>
                <NativeSelect
                  id="field-type"
                  value={newField.field_type}
                  onChange={(e) => handleNewFieldType(e.target.value)}
                >
                  {Object.entries(fieldTypeLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              {newField.field_type === "multiple_choice" && (
                <div className="space-y-1.5">
                  <Label htmlFor="field-options">Options (comma-separated)</Label>
                  <Input
                    id="field-options"
                    placeholder="Yes, No, N/A"
                    value={newField.options}
                    onChange={(e) => setNewField({ ...newField, options: e.target.value })}
                  />
                </div>
              )}
              <MetricPicker
                id="field-metric"
                fieldType={newField.field_type}
                value={newField.metric_key}
                options={parseOptions(newField.options)}
                usedBy={fields}
                onChange={(metricKey) =>
                  setNewField({ ...newField, metric_key: metricKey })
                }
              />
              <div className="flex items-center gap-2">
                <Checkbox
                  id="field-required"
                  checked={newField.required}
                  onCheckedChange={(checked) =>
                    setNewField({ ...newField, required: checked === true })
                  }
                />
                <Label htmlFor="field-required" className="font-normal">
                  Required
                </Label>
              </div>
            </div>
            <DialogFooter>
              {addError && (
                <p className="mr-auto text-xs text-destructive">{addError}</p>
              )}
              <Button
                onClick={handleAddField}
                disabled={saving || !newField.label}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? "Adding…" : "Add field"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {rowError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {rowError}
        </div>
      )}

      <div className="space-y-2">
        {fields.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No fields yet. Add your first field above.
            </CardContent>
          </Card>
        )}
        {fields.map((field, index) => (
          <Card
            key={field.id}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(index)}
            onDragEnd={() => setDragIndex(null)}
            className={dragIndex === index ? "opacity-50" : undefined}
          >
            <CardContent className="flex items-center justify-between gap-2 py-3">
              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                <GripVertical className="hidden h-4 w-4 shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing sm:block" />
                <div className="flex shrink-0 flex-col">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground"
                    disabled={index === 0}
                    onClick={() => moveField(index, -1)}
                    aria-label="Move field up"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground"
                    disabled={index === fields.length - 1}
                    onClick={() => moveField(index, 1)}
                    aria-label="Move field down"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <span className="w-5 shrink-0 text-sm font-medium text-muted-foreground">
                  {index + 1}.
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">
                    {field.label}
                    {field.required && <span className="ml-1 text-destructive">*</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {fieldTypeLabels[field.field_type] ?? field.field_type}
                    {field.field_type === "multiple_choice" &&
                      Array.isArray(field.options) &&
                      ` — ${(field.options as string[]).join(", ")}`}
                  </div>
                  <div
                    className="mt-2 max-w-sm"
                    // Excluded from the drag so the select opens on click
                    // instead of the card picking the gesture up.
                    draggable={false}
                    onDragStart={(e) => e.stopPropagation()}
                  >
                    <MetricPicker
                      id={`field-metric-${field.id}`}
                      fieldType={field.field_type}
                      value={field.metric_key ?? ""}
                      options={fieldOptions(field)}
                      usedBy={fields}
                      currentFieldId={field.id}
                      onChange={(metricKey) => handleMetricChange(field, metricKey)}
                    />
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => handleDeleteField(field.id)}
                aria-label="Delete field"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

/**
 * Picks what a question measures.
 *
 * Deliberately a closed list. `metric_key` is free text in the column and the
 * database only checks it against ten allowed values, so free text in the UI
 * would let a manager type `stock` and watch the dashboard ignore it forever.
 *
 * The list is narrowed to the metrics this field type can actually reach — see
 * `metricsForFieldType` — so a Yes/No question is never offered a metric read
 * from a number.
 */
function MetricPicker({
  id,
  fieldType,
  value,
  options,
  usedBy,
  currentFieldId,
  onChange,
}: {
  id: string;
  fieldType: string;
  value: string;
  options: string[];
  /** Every field on the template, to warn when a metric is shared. */
  usedBy: FormField[];
  currentFieldId?: string;
  onChange: (metricKey: string) => void;
}) {
  const available = metricsForFieldType(fieldType);
  const selected = findMetric(value);
  const mismatch = metricMismatch(value, fieldType, options);

  // A metric belongs to exactly one question per form — `form_fields_template_
  // metric_idx` is a unique index on (form_template_id, metric_key). Offering a
  // key another question already holds would produce a save that can only fail
  // on a duplicate-key error, so the option is shown disabled and says who has
  // it. Disabled rather than absent: "why can I not pick this?" needs an answer.
  const heldBy = new Map<string, string>();
  for (const f of usedBy) {
    if (f.metric_key && f.id !== currentFieldId) heldBy.set(f.metric_key, f.label);
  }

  if (available.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {selected
          ? `Measures ${selected.label} — but a ${fieldTypeLabels[fieldType] ?? fieldType} answer cannot reach it.`
          : "No analytics read this kind of answer."}
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        Measures
      </Label>
      <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Nothing — not on the dashboard</option>
        {available.map((metric) => {
          const taken = heldBy.get(metric.key);
          return (
            <option key={metric.key} value={metric.key} disabled={taken !== undefined}>
              {metric.label}
              {metric.feeds.length === 0 ? " (not charted yet)" : ""}
              {taken ? ` — already measured by “${taken}”` : ""}
            </option>
          );
        })}
      </NativeSelect>

      {mismatch && <p className="text-xs text-destructive">{mismatch}</p>}

      {selected && !mismatch && (
        <p className="text-xs text-muted-foreground">
          {selected.feeds.length > 0
            ? `Feeds ${selected.feeds.join(", ")}.`
            : "Stored, but no dashboard card reads this metric yet."}
          {selected.invertedNote ? ` ${selected.invertedNote}` : ""}
        </p>
      )}

      {!selected && (
        <p className="text-xs text-muted-foreground">
          A question that measures nothing is still asked and still stored — it
          just never appears on the dashboard.
        </p>
      )}
    </div>
  );
}
