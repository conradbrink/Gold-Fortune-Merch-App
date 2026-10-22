"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { refreshCompanyConfig, useBranding } from "@/lib/use-company-config";
import { DEFAULT_ACCENT, DEFAULT_PRIMARY, brandCssVariables } from "@/lib/branding";
import { normalizeHex } from "@/lib/branding-settings";
import { LogoUpload } from "@/components/settings/logo-card";
import { SaveRow, SettingsSection, SettingsSurface } from "@/components/settings/settings-section";

const PRIMARY_KEY = "brand_primary_color";
const ACCENT_KEY = "brand_accent_color";

/** A saved colour as the field shows it; anything malformed shows the default. */
function stored(value: unknown, fallback: string): string {
  return typeof value === "string" ? (normalizeHex(value) ?? fallback) : fallback;
}

/**
 * Branding on Business: the logo (saved as soon as it is chosen) and the two
 * colours (`brand_primary_color`, `brand_accent_color`), with a small sample
 * built from the same `brandCssVariables` the app's style sheet is, so it
 * shows what the app will look like rather than an approximation.
 *
 * `company_settings` has no delete policy, so "Use Tickd's colours" puts the
 * defaults in the fields and Save stores them like any other choice.
 */
export function BrandingSection({
  orgId,
  logoPath,
  canEdit,
}: {
  orgId: string;
  logoPath: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState({ primary: DEFAULT_PRIMARY, accent: DEFAULT_ACCENT });
  const [primaryText, setPrimaryText] = useState(DEFAULT_PRIMARY);
  const [accentText, setAccentText] = useState(DEFAULT_ACCENT);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error: e } = await createClient()
        .from("company_settings")
        .select("key, value")
        .eq("org_id", orgId)
        .in("key", [PRIMARY_KEY, ACCENT_KEY]);
      if (cancelled) return;
      if (e) return setError(`Your colours could not be loaded (${e.message}).`);
      const byKey = new Map(data.map((r) => [r.key, r.value]));
      const current = {
        primary: stored(byKey.get(PRIMARY_KEY), DEFAULT_PRIMARY),
        accent: stored(byKey.get(ACCENT_KEY), DEFAULT_ACCENT),
      };
      setSaved(current);
      setPrimaryText(current.primary);
      setAccentText(current.accent);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const primary = normalizeHex(primaryText);
  const accent = normalizeHex(accentText);
  const dirty = loaded && (primary !== saved.primary || accent !== saved.accent);

  async function save() {
    setDone(false);
    setError(null);
    if (!primary || !accent) return setError("Each colour is a hex value, such as #0F3D3E.");
    setBusy(true);
    const { error: e } = await createClient()
      .from("company_settings")
      .upsert(
        [
          { org_id: orgId, key: PRIMARY_KEY, value: primary },
          { org_id: orgId, key: ACCENT_KEY, value: accent },
        ],
        { onConflict: "org_id,key" }
      );
    setBusy(false);
    if (e) return setError(`Not saved: ${e.message}`);
    setSaved({ primary, accent });
    setPrimaryText(primary);
    setAccentText(accent);
    // The colours are a style sheet the server layout renders, so the layout
    // has to run again for the rest of the app to change.
    refreshCompanyConfig();
    router.refresh();
    setDone(true);
  }

  function edit(set: (v: string) => void, value: string) {
    setDone(false);
    set(value);
  }

  return (
    <SettingsSurface>
      <SettingsSection id="logo" title="Logo" description="On your invoices and in the menu. PNG, JPEG or WebP, up to 1 MB.">
        <LogoUpload orgId={orgId} initialLogoPath={logoPath} canEdit={canEdit} />
      </SettingsSection>
      <SettingsSection id="colours" title="Colours" description="Used across Tickd and on your documents.">
        {!loaded && !error && <div className="h-24 animate-pulse rounded-lg bg-muted/50" aria-label="Loading colours" />}
        {loaded && (
          <>
            <div className="grid gap-5 sm:grid-cols-2">
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
            <BrandPreview primary={primary ?? DEFAULT_PRIMARY} accent={accent ?? DEFAULT_ACCENT} />
            {canEdit && (primary !== DEFAULT_PRIMARY || accent !== DEFAULT_ACCENT) && (
              <Button
                variant="link"
                className="h-auto px-0 text-muted-foreground"
                onClick={() => {
                  edit(setPrimaryText, DEFAULT_PRIMARY);
                  setAccentText(DEFAULT_ACCENT);
                }}
              >
                Use Tickd&apos;s colours
              </Button>
            )}
          </>
        )}
      </SettingsSection>
      {canEdit && <SaveRow onSave={() => void save()} busy={busy} dirty={dirty} saved={done} error={error} label="Save colours" />}
      {!canEdit && error && <p className="px-5 py-3 text-sm text-destructive sm:px-6">{error}</p>}
    </SettingsSurface>
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
          aria-describedby={valid ? undefined : `${id}-error`}
          onChange={(e) => onChange(e.target.value)}
          className="max-w-32 font-mono uppercase"
        />
      </div>
      {!valid && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          A hex colour, such as #0F3D3E.
        </p>
      )}
    </div>
  );
}

/**
 * One line of the app in the chosen colours: the company's badge, the current
 * page's marker, a button and a badge. The same custom properties the layout
 * sets, applied to this strip only.
 */
function BrandPreview({ primary, accent }: { primary: string; accent: string }) {
  const name = useBranding()?.name || "Your business";
  const style = brandCssVariables({ primary, accent }) as CSSProperties;
  return (
    <div
      style={style}
      aria-hidden
      className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 text-foreground"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">
          {name.trim().charAt(0).toUpperCase()}
        </span>
        <span className="max-w-40 truncate text-xs font-semibold">{name}</span>
      </span>
      <span className="relative rounded-md bg-muted px-2 py-1 text-xs font-semibold before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-gold">
        Dashboard
      </span>
      <span className="ml-auto flex items-center gap-2">
        <span className="rounded-full bg-gold px-2 py-0.5 text-[11px] font-medium text-gold-foreground">New</span>
        <span className="inline-flex h-7 items-center rounded-lg bg-primary px-2.5 text-xs font-medium text-primary-foreground">
          Save
        </span>
      </span>
    </div>
  );
}
