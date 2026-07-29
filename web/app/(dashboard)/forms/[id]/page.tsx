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

type FormTemplate = Tables<"form_templates">;
type FormField = Tables<"form_fields">;

const fieldTypeLabels: Record<string, string> = {
  text: "Text",
  number: "Number",
  photo: "Photo",
  multiple_choice: "Multiple choice",
  boolean: "Yes / No",
  date: "Date",
};

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
  const [newField, setNewField] = useState({
    label: "",
    field_type: "text",
    required: false,
    options: "",
  });

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
    const options =
      newField.field_type === "multiple_choice" && newField.options
        ? newField.options.split(",").map((o) => o.trim()).filter(Boolean)
        : null;

    await supabase.from("form_fields").insert({
      form_template_id: params.id,
      label: newField.label,
      field_type: newField.field_type,
      required: newField.required,
      options,
      sort_order: fields.length,
    });

    setSaving(false);
    setDialogOpen(false);
    setNewField({ label: "", field_type: "text", required: false, options: "" });
    load();
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
                  onChange={(e) => setNewField({ ...newField, field_type: e.target.value })}
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
