"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { refreshCompanyConfig } from "@/lib/use-company-config";
import type { Json, Tables } from "@/lib/supabase/types";

type Definition = Tables<"setting_definitions">;

/**
 * The company's field settings: GPS interval, short visit, auto-end, check-in
 * distances, currency.
 *
 * Built from `setting_definitions`, not from a list in this file: the label,
 * the help text, the type and the allowed range all come from the database,
 * so a setting added by a migration appears here without a code change, and
 * the range shown is the one the database enforces (`company_settings_validate`
 * refuses anything else, with the message shown below the field).
 *
 * Saving needs `company_settings`, which RLS checks; the page is already
 * behind it. The phone picks the new values up on its next refresh.
 */
export function FieldSettingsCard({ orgId }: { orgId: string }) {
  const supabase = createClient();
  const [definitions, setDefinitions] = useState<Definition[] | null>(null);
  const [values, setValues] = useState<Record<string, Json>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [defs, mine] = await Promise.all([
        supabase.from("setting_definitions").select("*").order("sort_order"),
        supabase.from("company_settings").select("key, value").eq("org_id", orgId),
      ]);
      if (cancelled) return;
      if (defs.error || mine.error) {
        setLoadError((defs.error ?? mine.error)!.message);
        return;
      }
      const effective: Record<string, Json> = {};
      for (const d of defs.data) effective[d.key] = d.default_value;
      for (const row of mine.data) effective[row.key] = row.value;
      setDefinitions(defs.data);
      setValues(effective);
      setDraft(Object.fromEntries(Object.entries(effective).map(([k, v]) => [k, toText(v)])));
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, orgId]);

  async function handleSave() {
    if (!definitions) return;
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    const changed = definitions
      .filter((d) => draft[d.key] !== toText(values[d.key]))
      .map((d) => ({ org_id: orgId, key: d.key, value: fromText(d, draft[d.key]) }));
    if (changed.length === 0) {
      setSaving(false);
      setSaved(true);
      return;
    }
    // One row per setting; the database validates each and refuses the batch
    // with the first bad one's message.
    const { error } = await supabase
      .from("company_settings")
      .upsert(changed, { onConflict: "org_id,key" });
    setSaving(false);
    if (error) {
      setSaveError(error.message);
      return;
    }
    setValues((v) => ({ ...v, ...Object.fromEntries(changed.map((c) => [c.key, c.value])) }));
    refreshCompanyConfig();
    setSaved(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Field settings</CardTitle>
        <CardDescription>
          How the phone app tracks the working day, and how check-ins are judged.
          Changes reach phones the next time they refresh.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loadError && <p className="text-sm text-destructive">{loadError}</p>}
        {!definitions && !loadError && (
          <p className="text-sm text-muted-foreground">Loading settings…</p>
        )}
        {definitions && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {definitions.map((d) => (
              <SettingField
                key={d.key}
                definition={d}
                value={draft[d.key] ?? ""}
                onChange={(v) => {
                  setSaved(false);
                  setDraft((cur) => ({ ...cur, [d.key]: v }));
                }}
              />
            ))}
          </div>
        )}
        {saveError && <p className="text-sm text-destructive">{saveError}</p>}
        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={!definitions || saving}>
            {saving ? "Saving…" : "Save field settings"}
          </Button>
          {saved && <span className="text-sm text-muted-foreground">Saved.</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function SettingField({
  definition: d,
  value,
  onChange,
}: {
  definition: Definition;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = `setting-${d.key}`;
  if (d.value_type === "boolean") {
    return (
      <div className="space-y-1.5">
        <label htmlFor={id} className="flex items-center gap-2 text-sm font-medium">
          <input
            id={id}
            type="checkbox"
            checked={value === "true"}
            onChange={(e) => onChange(e.target.checked ? "true" : "false")}
            className="size-4"
          />
          {d.label}
        </label>
        <p className="text-xs text-muted-foreground">{d.description}</p>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{d.label}</Label>
      <Input
        id={id}
        type={d.value_type === "integer" ? "number" : d.value_type === "time" ? "time" : "text"}
        min={d.min_value ?? undefined}
        max={d.max_value ?? undefined}
        step={d.value_type === "integer" ? 1 : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        {d.description}
        {d.min_value !== null && d.max_value !== null
          ? ` Between ${d.min_value} and ${d.max_value}.`
          : ""}
      </p>
    </div>
  );
}

/** A stored value as the text an input holds. */
function toText(v: Json | undefined): string {
  if (v === undefined || v === null) return "";
  return typeof v === "string" ? v : String(v);
}

/**
 * Back to the JSON the database stores. A malformed number is sent as text so
 * the database's validation answers with the setting's own message rather than
 * this file guessing one.
 */
function fromText(d: Definition, text: string): Json {
  if (d.value_type === "boolean") return text === "true";
  if (d.value_type === "integer") {
    const n = Number(text);
    return text.trim() !== "" && Number.isFinite(n) ? n : text;
  }
  return text.trim();
}
