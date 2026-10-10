"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { createClient } from "@/lib/supabase/client";
import {
  DEFAULT_ORG_SETTINGS,
  fetchOrgSettings,
  updateOrgSettings,
  type OrgSettings,
} from "@/lib/org-settings";
import { FREQUENCIES, WEEKDAYS } from "@/lib/schedule";
import type { Tables } from "@/lib/supabase/types";
import { WorkdaySettingsCard } from "@/components/settings/workday-settings-card";
import { WorkingHoursCard } from "@/components/settings/working-hours-card";
import { MoneySettingsCard } from "@/components/settings/money-settings-card";
import { DocumentStyleCard } from "@/components/settings/document-style-card";
import { DashboardSettingsCard } from "@/components/settings/dashboard-settings-card";
import { EmailSettingsCard } from "@/components/settings/email-settings-card";
import { AlertsSettingsCard } from "@/components/settings/alerts-settings-card";
import { ModulesCard } from "@/components/settings/modules-card";
import { TerminologyCard } from "@/components/settings/terminology-card";
import { LogoCard } from "@/components/settings/logo-card";
import { BrandColoursCard } from "@/components/settings/brand-colours-card";
import { usePermissions } from "@/lib/use-permissions";
import { can } from "@/lib/permissions";
import { refreshCompanyConfig, useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { count, lower, withArticle } from "@/lib/terms";
import { useRegionLists } from "@/lib/region-lists";
import { SETTINGS_TABS, settingsTabFromQuery, showsAlerts, type SettingsTab } from "@/lib/settings-tabs";

type Organization = Tables<"organizations">;

/**
 * Company settings: how the business runs, in six tabs (`lib/settings-tabs.ts`).
 *
 * Owners configure their business here, not the software: Tickd's own
 * settings (GPS timing, distance thresholds, report formulas) are changed by
 * the platform operator and refused by the database from here. People are on
 * People & permissions; HR and warehouse settings are tabs beside this page.
 */
export default function CompanySettingsPage() {
  const supabase = createClient();
  const router = useRouter();
  const t = useTerms();
  // The page is already behind `company_settings` (proxy.ts); this only
  // decides whether the cards offer their controls, and stays read-only until
  // the answer is known.
  const permissions = usePermissions();
  const canEditCompany = permissions !== null && can(permissions, "company_settings");
  const config = useCompanyConfig();
  const hasAlerts = config !== null && showsAlerts(config.modules);
  const lists = useRegionLists();

  const [tab, setTab] = useState<SettingsTab>("company");
  const [org, setOrg] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    legal_name: "",
    industry: "",
    website: "",
    address: "",
    support_email: "",
    phone: "",
    timezone: "",
    tax_number: "",
    vat_number: "",
    registration_number: "",
  });
  /** Country and currency are company settings rather than columns; null until changed. */
  const [region, setRegion] = useState<{ country: string; currency: string } | null>(null);
  const country = region?.country ?? config?.settings.country_code ?? "";
  const currency = region?.currency ?? config?.settings.currency_code ?? "";

  /** Planning. Saved with its own button: it changes what the whole schedule is measured against. */
  const [capacity, setCapacity] = useState<OrgSettings>(DEFAULT_ORG_SETTINGS);
  const [savingCapacity, setSavingCapacity] = useState(false);
  const [savedCapacity, setSavedCapacity] = useState(false);
  const [capacityError, setCapacityError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    const { data: profileRow } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", userData.user!.id)
      .single();
    const { data: orgRow } = await supabase
      .from("organizations")
      .select("*")
      .eq("id", profileRow!.org_id)
      .single();
    setOrg(orgRow);
    if (orgRow) {
      setForm({
        name: orgRow.name ?? "",
        legal_name: orgRow.legal_name ?? "",
        industry: orgRow.industry ?? "",
        website: orgRow.website ?? "",
        address: orgRow.address ?? "",
        support_email: orgRow.support_email ?? "",
        phone: orgRow.phone ?? "",
        timezone: orgRow.timezone ?? "",
        tax_number: orgRow.tax_number ?? "",
        vat_number: orgRow.vat_number ?? "",
        registration_number: orgRow.registration_number ?? "",
      });
    }
    setCapacity(await fetchOrgSettings(supabase));
    setLoading(false);
  }

  useEffect(() => {
    // The tab named in the address, read after mount (the page is prerendered,
    // and reading the URL during render would differ between server and
    // browser). Old names still work: `?tab=money` opens Billing, and the old
    // Team members tab is People & permissions.
    const asked = settingsTabFromQuery(new URLSearchParams(window.location.search).get("tab"));
    if (asked === "people") {
      router.replace("/settings/users");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTab(asked);
    void (async () => {
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function chooseTab(next: SettingsTab) {
    setTab(next);
    // Kept in the address so a reload, a shared link or Back opens the same tab.
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  }

  async function handleSave() {
    if (!org) return;
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    // The timezone is not free text to the database: a value that is not an
    // IANA zone is refused (`organizations_validate_timezone`), and which day
    // a visit belongs to depends on it. So the error is shown, never swallowed.
    const { error } = await supabase
      .from("organizations")
      .update({
        name: form.name,
        legal_name: form.legal_name || null,
        industry: form.industry || null,
        website: form.website || null,
        address: form.address || null,
        support_email: form.support_email || null,
        // Left out when blank: the database refuses an empty zone, and a
        // company with none set must still be able to save its other fields.
        ...(form.timezone.trim() ? { timezone: form.timezone.trim() } : {}),
        tax_number: form.tax_number.trim() || null,
        vat_number: form.vat_number.trim() || null,
        registration_number: form.registration_number.trim() || null,
        phone: form.phone.trim() || null,
      })
      .eq("id", org.id);
    if (error) {
      setSaving(false);
      setSaveError(error.message);
      return;
    }
    if (region) {
      const { error: e } = await supabase.from("company_settings").upsert(
        [
          { org_id: org.id, key: "country_code", value: region.country },
          { org_id: org.id, key: "currency_code", value: region.currency },
        ],
        { onConflict: "org_id,key" }
      );
      if (e) {
        setSaving(false);
        setSaveError(`Your details were saved, but the country and currency were not: ${e.message}`);
        return;
      }
      setRegion(null);
      refreshCompanyConfig();
    }
    setSaving(false);
    // The Communications tab says where replies go: the saved address, not the typing.
    setOrg({ ...org, support_email: form.support_email || null });
    setSaved(true);
  }

  async function handleSaveCapacity() {
    if (!org) return;
    setSavingCapacity(true);
    setSavedCapacity(false);
    setCapacityError(null);
    try {
      await updateOrgSettings(supabase, org.id, capacity);
      setSavedCapacity(true);
    } catch (e) {
      setCapacityError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingCapacity(false);
    }
  }

  function toggleWorkingDay(day: number) {
    setSavedCapacity(false);
    setCapacity((prev) => {
      const has = prev.workingDays.includes(day);
      // Never zero working days: nothing could be scheduled, and the check
      // constraint would refuse the save anyway.
      if (has && prev.workingDays.length === 1) return prev;
      return {
        ...prev,
        workingDays: has
          ? prev.workingDays.filter((d) => d !== day)
          : [...prev.workingDays, day].sort((a, b) => a - b),
      };
    });
  }

  function field(key: keyof typeof form, label: string, opts: { wide?: boolean; type?: string; hint?: string } = {}) {
    const id = `company-${key}`;
    return (
      <div className={`space-y-1.5 ${opts.wide ? "sm:col-span-2" : ""}`}>
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          type={opts.type ?? "text"}
          value={form[key]}
          disabled={!canEditCompany}
          aria-describedby={opts.hint ? `${id}-hint` : undefined}
          onChange={(e) => {
            setSaved(false);
            setForm({ ...form, [key]: e.target.value });
          }}
        />
        {opts.hint && (
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {opts.hint}
          </p>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card py-16 text-center text-sm text-muted-foreground">
        Loading company settings…
      </div>
    );
  }

  // Lists from the browser; the saved value is offered even if the browser
  // does not name it, so opening the page never changes it.
  const countries = lists.countries.some((c) => c.code === country) || !country
    ? lists.countries
    : [{ code: country, name: country }, ...lists.countries];
  const currencies = lists.currencies.some((c) => c.code === currency) || !currency
    ? lists.currencies
    : [{ code: currency, name: currency }, ...lists.currencies];
  const zones = lists.zones.includes(form.timezone) || !form.timezone ? lists.zones : [form.timezone, ...lists.zones];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Company settings</h1>
        <p className="text-sm text-muted-foreground">How your business runs: your details, your rules, how you get paid and how you look.</p>
      </div>

      <Tabs value={tab} onValueChange={(v) => chooseTab(v as SettingsTab)}>
        {/* Scrolls on its own on a phone rather than pushing the page sideways. */}
        <TabsList className="max-w-full justify-start overflow-x-auto px-1 [&::-webkit-scrollbar]:hidden [&>*]:shrink-0 [&>*]:px-2.5">
          {SETTINGS_TABS.map((x) => (
            <TabsTrigger key={x.id} value={x.id}>
              {x.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ------------------------------------------------------- Company */}
        <TabsContent value="company" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Company details</CardTitle>
              <CardDescription>Who you are. Your name, address, numbers and contact details go on every quote, invoice and email.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                {field("name", "Company name")}
                {field("legal_name", "Legal entity name")}
                {field("industry", "Industry")}
                {field("website", "Website")}
                {field("address", "Business address", { wide: true })}
                {field("support_email", `Email for ${lower(t.client.many)}`, {
                  type: "email",
                  hint: "Replies to the emails Tickd sends for you go here.",
                })}
                {field("phone", "Phone")}
              </div>

              <fieldset className="grid grid-cols-1 gap-5 sm:grid-cols-3">
                <legend className="mb-3 text-sm font-medium text-foreground">Where you work</legend>
                <div className="space-y-1.5">
                  <Label htmlFor="company-country">Country</Label>
                  <NativeSelect
                    id="company-country"
                    value={country}
                    disabled={!canEditCompany}
                    onChange={(e) => {
                      setSaved(false);
                      setRegion({ country: e.target.value, currency });
                    }}
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
                  <Label htmlFor="company-currency">Currency</Label>
                  <NativeSelect
                    id="company-currency"
                    value={currency}
                    disabled={!canEditCompany}
                    onChange={(e) => {
                      setSaved(false);
                      setRegion({ country, currency: e.target.value });
                    }}
                  >
                    {currencies.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name} ({c.code})
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="company-timezone">Time zone</Label>
                  <NativeSelect
                    id="company-timezone"
                    value={form.timezone}
                    disabled={!canEditCompany}
                    onChange={(e) => {
                      setSaved(false);
                      setForm({ ...form, timezone: e.target.value });
                    }}
                  >
                    {zones.map((z) => (
                      <option key={z} value={z}>
                        {z.replaceAll("_", " ")}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <p className="text-xs text-muted-foreground sm:col-span-3">
                  The country helps find your {lower(t.site.many)}&apos; addresses on the map. The time zone decides which
                  day something happened on, so {withArticle(t, "staff")} finishing late is counted on the right day.
                </p>
              </fieldset>

              <fieldset className="grid grid-cols-1 gap-5 sm:grid-cols-3">
                <legend className="mb-3 text-sm font-medium text-foreground">Registration and tax numbers</legend>
                {field("registration_number", "Company registration number")}
                {field("tax_number", "Taxpayer number (TIN)")}
                {field("vat_number", "VAT registration number")}
                <p className="text-xs text-muted-foreground sm:col-span-3">
                  Copied onto each tax invoice when it is issued, so changing them never alters one already sent. Your VAT
                  rate and payment terms are on Billing.
                </p>
              </fieldset>

              {canEditCompany && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={handleSave} disabled={saving}>
                    {saving ? "Saving…" : "Save changes"}
                  </Button>
                  {saved && <span className="text-sm text-muted-foreground">Saved.</span>}
                  {saveError && <span className="text-sm text-destructive">{saveError}</span>}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------------------------------------------- Operations */}
        <TabsContent value="operations" className="mt-4 space-y-4">
          {/* Capacity drives the schedule: the load strip, the capacity meter,
              the auto-spread and the plan review all measure against it. */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Planning</CardTitle>
              <CardDescription>
                Which days your team works and what one {lower(t.staff.one)} covers in a day. The schedule uses this to
                tell you whether {withArticle(t, "schedule_cycle")} can be done.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {capacityError && (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {capacityError}
                </p>
              )}
              <div className="space-y-1.5">
                <Label>Working days</Label>
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAYS.map((w) => {
                    const on = capacity.workingDays.includes(w.value);
                    return (
                      <button
                        key={w.value}
                        type="button"
                        aria-pressed={on}
                        disabled={!canEditCompany}
                        onClick={() => toggleWorkingDay(w.value)}
                        className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                          on
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {w.short}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="stores-per-day">{t.site.many} per day</Label>
                  <Input
                    id="stores-per-day"
                    type="number"
                    min={1}
                    max={50}
                    value={capacity.storesPerDay}
                    disabled={!canEditCompany}
                    onChange={(e) => {
                      setSavedCapacity(false);
                      setCapacity({ ...capacity, storesPerDay: Number(e.target.value) });
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    How many {lower(t.site.many)} one {lower(t.staff.one)} realistically covers in a day.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="default-frequency">How often a new {lower(t.site.one)} is visited</Label>
                  <NativeSelect
                    id="default-frequency"
                    value={capacity.defaultVisitFrequency}
                    disabled={!canEditCompany}
                    onChange={(e) => {
                      setSavedCapacity(false);
                      setCapacity({
                        ...capacity,
                        defaultVisitFrequency: e.target.value as OrgSettings["defaultVisitFrequency"],
                      });
                    }}
                  >
                    {FREQUENCIES.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </NativeSelect>
                  <p className="text-xs text-muted-foreground">Each {lower(t.site.one)} can be changed on its own.</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {capacity.workingDays.length} days × {count(t, "site", capacity.storesPerDay)} ={" "}
                <span className="font-medium text-foreground">
                  {count(t, "job", capacity.workingDays.length * capacity.storesPerDay)}
                </span>{" "}
                per {lower(t.staff.one)} per week.
              </p>
              {canEditCompany && (
                <div className="flex items-center gap-3">
                  <Button onClick={handleSaveCapacity} disabled={savingCapacity}>
                    {savingCapacity ? "Saving…" : "Save"}
                  </Button>
                  {savedCapacity && <span className="text-sm text-muted-foreground">Saved.</span>}
                </div>
              )}
            </CardContent>
          </Card>
          {org && <WorkdaySettingsCard orgId={org.id} canEdit={canEditCompany} />}
          {org && <WorkingHoursCard orgId={org.id} canEdit={canEditCompany} />}
          {org && <DashboardSettingsCard orgId={org.id} canEdit={canEditCompany} />}
        </TabsContent>

        {/* ------------------------------------------------------- Billing */}
        <TabsContent value="billing" className="mt-4 space-y-4">
          {org && <MoneySettingsCard orgId={org.id} canEdit={canEditCompany} />}
          {org && <DocumentStyleCard orgId={org.id} canEdit={canEditCompany} />}
        </TabsContent>

        {/* ------------------------------------------------ Communications */}
        <TabsContent value="communications" className="mt-4 space-y-4">
          {org && <EmailSettingsCard supportEmail={org.support_email ?? null} orgId={org.id} canEdit={canEditCompany} />}
          {hasAlerts && org && <AlertsSettingsCard orgId={org.id} canEdit={canEditCompany} />}
        </TabsContent>

        {/* ------------------------------------------------------ Branding */}
        <TabsContent value="branding" className="mt-4 space-y-4">
          {org && (
            <>
              <LogoCard orgId={org.id} initialLogoPath={org.logo_path} canEdit={canEditCompany} />
              <BrandColoursCard orgId={org.id} canEdit={canEditCompany} />
              <TerminologyCard orgId={org.id} canEdit={canEditCompany} />
            </>
          )}
        </TabsContent>

        {/* ---------------------------------------------------------- Plan */}
        <TabsContent value="plan" className="mt-4 space-y-4">
          <ModulesCard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
