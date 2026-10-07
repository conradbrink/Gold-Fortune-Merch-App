"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Building2, LayoutDashboard } from "lucide-react";
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
import { refreshCompanyConfig, useBranding, useTerms } from "@/lib/use-company-config";
import { DEFAULT_ACCENT, DEFAULT_PRIMARY, brandCssVariables } from "@/lib/branding";
import { normalizeHex } from "@/lib/branding-settings";

const PRIMARY_KEY = "brand_primary_color";
const ACCENT_KEY = "brand_accent_color";

/** A saved colour as the input shows it; anything malformed shows the default. */
function stored(value: unknown, fallback: string): string {
  return typeof value === "string" ? (normalizeHex(value) ?? fallback) : fallback;
}

/**
 * The company's two colours (`brand_primary_color`, `brand_accent_color` in
 * `company_settings`), with a live preview built from the same
 * `brandCssVariables` the dashboard layout turns into its style sheet, so the
 * sample shows what the app will look like rather than an approximation.
 *
 * `company_settings` has no delete policy, so "Reset to default colours" puts
 * the defaults in the fields and Save stores them like any other choice.
 */
export function BrandColoursCard({ orgId, canEdit }: { orgId: string; canEdit: boolean }) {
  const supabase = createClient();
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [primaryText, setPrimaryText] = useState(DEFAULT_PRIMARY);
  const [accentText, setAccentText] = useState(DEFAULT_ACCENT);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("company_settings")
        .select("key, value")
        .eq("org_id", orgId)
        .in("key", [PRIMARY_KEY, ACCENT_KEY]);
      if (cancelled) return;
      if (error) {
        setLoadError(error.message);
        return;
      }
      const byKey = new Map(data.map((r) => [r.key, r.value]));
      setPrimaryText(stored(byKey.get(PRIMARY_KEY), DEFAULT_PRIMARY));
      setAccentText(stored(byKey.get(ACCENT_KEY), DEFAULT_ACCENT));
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, orgId]);

  const primary = normalizeHex(primaryText);
  const accent = normalizeHex(accentText);

  async function handleSave() {
    setSaved(false);
    setSaveError(null);
    if (!primary || !accent) {
      setSaveError("Each colour must be a hex value such as #1E293B.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("company_settings").upsert(
      [
        { org_id: orgId, key: PRIMARY_KEY, value: primary },
        { org_id: orgId, key: ACCENT_KEY, value: accent },
      ],
      { onConflict: "org_id,key" }
    );
    setSaving(false);
    if (error) {
      setSaveError(error.message);
      return;
    }
    setPrimaryText(primary);
    setAccentText(accent);
    // The colours are a style sheet the server layout renders, so the layout
    // has to run again for the rest of the app to change.
    refreshCompanyConfig();
    router.refresh();
    setSaved(true);
  }

  function edit(set: (v: string) => void, value: string) {
    setSaved(false);
    set(value);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Colours</CardTitle>
        <CardDescription>
          The main colour is used for buttons, headings and the company badge; the accent
          marks the current page, badges and charts. The dark theme keeps its own colours
          so text stays readable.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loadError && <p className="text-sm text-destructive">{loadError}</p>}
        {!loaded && !loadError && (
          <p className="text-sm text-muted-foreground">Loading colours…</p>
        )}
        {loaded && (
          <>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <ColourField
                id="brand-primary"
                label="Main colour"
                text={primaryText}
                disabled={!canEdit}
                onChange={(v) => edit(setPrimaryText, v)}
              />
              <ColourField
                id="brand-accent"
                label="Accent colour"
                text={accentText}
                disabled={!canEdit}
                onChange={(v) => edit(setAccentText, v)}
              />
            </div>
            <BrandPreview
              primary={primary ?? DEFAULT_PRIMARY}
              accent={accent ?? DEFAULT_ACCENT}
            />
          </>
        )}
        {saveError && <p className="text-sm text-destructive">{saveError}</p>}
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleSave} disabled={!loaded || saving}>
              {saving ? "Saving…" : "Save colours"}
            </Button>
            <Button
              variant="outline"
              disabled={!loaded || saving}
              onClick={() => {
                edit(setPrimaryText, DEFAULT_PRIMARY);
                setAccentText(DEFAULT_ACCENT);
              }}
            >
              Reset to default colours
            </Button>
            {saved && <span className="text-sm text-muted-foreground">Saved.</span>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Changing the colours needs the company settings permission.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ColourField({
  id,
  label,
  text,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  text: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const valid = normalizeHex(text);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        {/* The native picker only takes lower-case #rrggbb; while the text is
            half-typed it keeps showing the last whole colour. */}
        <input
          type="color"
          aria-label={`${label} picker`}
          value={(valid ?? "#000000").toLowerCase()}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-8 w-10 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <Input
          id={id}
          value={text}
          disabled={disabled}
          maxLength={7}
          spellCheck={false}
          aria-invalid={valid ? undefined : true}
          onChange={(e) => onChange(e.target.value)}
          className="max-w-32 font-mono uppercase"
        />
      </div>
      {!valid && (
        <p className="text-xs text-destructive">A hex colour, such as #1E293B.</p>
      )}
    </div>
  );
}

/**
 * A small sample of the app in the chosen colours: the same custom properties
 * the layout sets, applied to this box only.
 */
function BrandPreview({ primary, accent }: { primary: string; accent: string }) {
  const t = useTerms();
  const name = useBranding()?.name || "Company";
  const style = brandCssVariables({ primary, accent }) as CSSProperties;
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">Preview</p>
      <div
        style={style}
        className="flex overflow-hidden rounded-lg border border-border bg-background text-foreground"
        aria-hidden
      >
        <div className="w-40 shrink-0 space-y-1 border-r border-sidebar-border bg-sidebar p-2">
          <div className="mb-2 flex items-center gap-2 px-1">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Building2 className="h-3.5 w-3.5" />
            </div>
            <span className="truncate text-xs font-bold text-sidebar-foreground">{name}</span>
          </div>
          <div className="relative flex items-center gap-2 rounded-md bg-muted px-2 py-1 text-xs font-semibold before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-gold">
            <LayoutDashboard className="h-3.5 w-3.5" />
            Dashboard
          </div>
          <div className="rounded-md bg-sidebar-accent px-2 py-1 text-xs font-medium text-sidebar-accent-foreground">
            {t.site.many}
          </div>
          <div className="px-2 py-1 text-xs font-medium text-sidebar-foreground/70">
            {t.job.many}
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-3 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-primary">{t.site.many}</span>
            <span className="rounded-full bg-gold px-2 py-0.5 text-[11px] font-medium text-gold-foreground">
              New
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex h-7 items-center rounded-lg bg-primary px-2.5 text-xs font-medium text-primary-foreground">
              Save
            </span>
            <span className="inline-flex h-7 items-center rounded-lg bg-accent px-2.5 text-xs font-medium text-accent-foreground">
              Selected
            </span>
          </div>
          <div className="flex h-8 items-end gap-1">
            {[40, 70, 55, 90, 65].map((h, i) => (
              <div
                key={i}
                className={i % 2 === 0 ? "w-3 rounded-sm bg-chart-1" : "w-3 rounded-sm bg-chart-2"}
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
