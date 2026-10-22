"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { createClient } from "@/lib/supabase/client";
import { usePermissions } from "@/lib/use-permissions";
import { can } from "@/lib/permissions";
import { refreshCompanyConfig, useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { useRegionLists } from "@/lib/region-lists";
import { BrandingSection } from "@/components/settings/branding-section";
import { SaveRow, SettingsPage, SettingsSection, SettingsSurface } from "@/components/settings/settings-section";

type Form = {
  name: string;
  legal_name: string;
  address: string;
  support_email: string;
  phone: string;
  website: string;
  timezone: string;
  country: string;
  currency: string;
};

const EMPTY: Form = {
  name: "",
  legal_name: "",
  address: "",
  support_email: "",
  phone: "",
  website: "",
  timezone: "",
  country: "",
  currency: "",
};

/**
 * Settings > Business: who the business is and how it looks.
 *
 * Only what an owner fills in themselves. The numbers on a tax invoice
 * (registration, TIN, VAT), the VAT rate, invoice numbering and the words
 * Tickd uses are set up by Tickd in the Control Centre; saving here sends
 * only these columns, so it never touches them.
 */
export default function BusinessSettingsPage() {
  const t = useTerms();
  const config = useCompanyConfig();
  const permissions = usePermissions();
  // The page is already behind `company_settings` (proxy.ts); this only
  // decides whether the fields can be changed, read-only until it is known.
  const canEdit = permissions !== null && can(permissions, "company_settings");
  const lists = useRegionLists();
  const orgId = config?.orgId ?? null;

  const [saved, setSaved] = useState<Form>(EMPTY);
  const [form, setForm] = useState<Form>(EMPTY);
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId || !config) return;
    let cancelled = false;
    void (async () => {
      const { data, error: e } = await createClient()
        .from("organizations")
        .select("name, legal_name, address, support_email, phone, website, timezone, logo_path")
        .eq("id", orgId)
        .single();
      if (cancelled) return;
      if (e) return setLoadError(`Your details could not be loaded (${e.message}).`);
      const next: Form = {
        name: data.name ?? "",
        legal_name: data.legal_name ?? "",
        address: data.address ?? "",
        support_email: data.support_email ?? "",
        phone: data.phone ?? "",
        website: data.website ?? "",
        timezone: data.timezone ?? "",
        country: config.settings.country_code ?? "",
        currency: config.settings.currency_code ?? "",
      };
      setSaved(next);
      setForm(next);
      setLogoPath(data.logo_path);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
    // Loaded once, when the company is known; a refresh after saving must not
    // overwrite what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const dirty = (Object.keys(form) as (keyof Form)[]).some((k) => form[k] !== saved[k]);

  function set(key: keyof Form, value: string) {
    setDone(false);
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    if (!orgId) return;
    setDone(false);
    setError(null);
    if (!form.name.trim()) return setError("Type your business name.");
    setBusy(true);
    const supabase = createClient();
    // The time zone is checked by the database (`organizations_validate_timezone`):
    // which day a visit belongs to depends on it, so a refusal is shown, never
    // swallowed. Left out when blank, since the database refuses an empty one.
    const { error: e } = await supabase
      .from("organizations")
      .update({
        name: form.name.trim(),
        legal_name: form.legal_name.trim() || null,
        address: form.address.trim() || null,
        support_email: form.support_email.trim() || null,
        phone: form.phone.trim() || null,
        website: form.website.trim() || null,
        ...(form.timezone.trim() ? { timezone: form.timezone.trim() } : {}),
      })
      .eq("id", orgId);
    if (e) {
      setBusy(false);
      return setError(`Not saved: ${e.message}`);
    }
    if (form.country !== saved.country || form.currency !== saved.currency) {
      const { error: r } = await supabase.from("company_settings").upsert(
        [
          { org_id: orgId, key: "country_code", value: form.country },
          { org_id: orgId, key: "currency_code", value: form.currency },
        ],
        { onConflict: "org_id,key" }
      );
      if (r) {
        setBusy(false);
        setSaved({ ...form, country: saved.country, currency: saved.currency });
        return setError(`Your details were saved, but not the country and currency: ${r.message}`);
      }
    }
    setBusy(false);
    setSaved(form);
    refreshCompanyConfig();
    setDone(true);
  }

  if (loadError) {
    return (
      <SettingsPage title="Business">
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{loadError}</p>
      </SettingsPage>
    );
  }

  if (!loaded || !orgId) {
    return (
      <SettingsPage title="Business">
        <div className="h-96 animate-pulse rounded-xl border border-border bg-muted/30" aria-label="Loading your business details" />
      </SettingsPage>
    );
  }

  // The browser's lists, with the saved value offered even when the browser
  // does not name it, so opening the page never changes it.
  const countries =
    !form.country || lists.countries.some((c) => c.code === form.country)
      ? lists.countries
      : [{ code: form.country, name: form.country }, ...lists.countries];
  const currencies =
    !form.currency || lists.currencies.some((c) => c.code === form.currency)
      ? lists.currencies
      : [{ code: form.currency, name: form.currency }, ...lists.currencies];
  const zones = !form.timezone || lists.zones.includes(form.timezone) ? lists.zones : [form.timezone, ...lists.zones];

  const field = (key: keyof Form, label: string, opts: { type?: string; wide?: boolean; hint?: string; autoComplete?: string } = {}) => (
    <div className={`space-y-1.5 ${opts.wide ? "sm:col-span-2" : ""}`}>
      <Label htmlFor={`business-${key}`}>{label}</Label>
      <Input
        id={`business-${key}`}
        type={opts.type ?? "text"}
        value={form[key]}
        disabled={!canEdit}
        autoComplete={opts.autoComplete}
        aria-describedby={opts.hint ? `business-${key}-hint` : undefined}
        onChange={(e) => set(key, e.target.value)}
      />
      {opts.hint && (
        <p id={`business-${key}-hint`} className="text-xs text-muted-foreground">
          {opts.hint}
        </p>
      )}
    </div>
  );

  return (
    <SettingsPage title="Business">
      <SettingsSurface>
        <SettingsSection id="details" title="Business details" description="On your quotes, invoices and emails.">
          <div className="grid gap-5 sm:grid-cols-2">
            {field("name", "Business name", { autoComplete: "organization" })}
            {field("legal_name", "Legal entity name")}
            {field("address", "Business address", { wide: true, autoComplete: "street-address" })}
            {field("support_email", `${t.client.one} email`, {
              type: "email",
              autoComplete: "email",
              hint: "Replies to the emails Tickd sends for you come here.",
            })}
            {field("phone", "Phone", { type: "tel", autoComplete: "tel" })}
            {field("website", "Website", { type: "url", autoComplete: "url" })}
          </div>
        </SettingsSection>
        <SettingsSection id="region" title="Region" description="Your money and your clock.">
          <div className="grid gap-5 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="business-country">Country</Label>
              <NativeSelect
                id="business-country"
                value={form.country}
                disabled={!canEdit}
                onChange={(e) => set("country", e.target.value)}
              >
                <option value="">Anywhere</option>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="business-currency">Currency</Label>
              <NativeSelect
                id="business-currency"
                value={form.currency}
                disabled={!canEdit}
                onChange={(e) => set("currency", e.target.value)}
              >
                {currencies.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="business-timezone">Time zone</Label>
              <NativeSelect
                id="business-timezone"
                value={form.timezone}
                disabled={!canEdit}
                onChange={(e) => set("timezone", e.target.value)}
              >
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z.replaceAll("_", " ")}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
        </SettingsSection>
        {canEdit && <SaveRow onSave={() => void save()} busy={busy} dirty={dirty} saved={done} error={error} />}
      </SettingsSurface>

      <h2 className="pt-3 text-base font-semibold text-foreground">Branding</h2>
      <BrandingSection orgId={orgId} logoPath={logoPath} canEdit={canEdit} />
    </SettingsPage>
  );
}
