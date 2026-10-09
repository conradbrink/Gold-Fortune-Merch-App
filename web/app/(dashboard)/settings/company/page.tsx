"use client";

import { useEffect, useState } from "react";
import { Plus, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import {
  DEFAULT_ORG_SETTINGS,
  fetchOrgSettings,
  updateOrgSettings,
  type OrgSettings,
} from "@/lib/org-settings";
import { FREQUENCIES, WEEKDAYS } from "@/lib/schedule";
import type { Tables } from "@/lib/supabase/types";
import { FieldSettingsCard } from "@/components/settings/field-settings-card";
import { MoneySettingsCard } from "@/components/settings/money-settings-card";
import { DashboardSettingsCard } from "@/components/settings/dashboard-settings-card";
import { ReportsSettingsCard } from "@/components/settings/reports-settings-card";
import { EmailSettingsCard } from "@/components/settings/email-settings-card";
import { ModulesCard } from "@/components/settings/modules-card";
import { TerminologyCard } from "@/components/settings/terminology-card";
import { LogoCard } from "@/components/settings/logo-card";
import { BrandColoursCard } from "@/components/settings/brand-colours-card";
import { usePermissions } from "@/lib/use-permissions";
import { can } from "@/lib/permissions";
import { useTerms } from "@/lib/use-company-config";
import { count, lower, withArticle } from "@/lib/terms";

type Organization = Tables<"organizations">;
type Profile = Tables<"profiles">;

const roleTone: Record<string, string> = {
  manager: "bg-primary text-primary-foreground",
  rep: "bg-secondary text-secondary-foreground",
};

export default function CompanyProfilePage() {
  const supabase = createClient();
  const t = useTerms();
  // The page is already behind `company_settings` (proxy.ts); this only
  // decides whether the branding cards offer their controls, and stays
  // read-only until the answer is known.
  const permissions = usePermissions();
  const canEditCompany = permissions !== null && can(permissions, "company_settings");
  const [org, setOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [inviteNote, setInviteNote] = useState(false);
  const [form, setForm] = useState({
    name: "",
    legal_name: "",
    industry: "",
    website: "",
    address: "",
    support_email: "",
    vat_rate: "",
    timezone: "",
    tax_number: "",
    vat_number: "",
    phone: "",
    invoice_terms_days: "30",
    invoice_footer: "",
  });
  /** Planning capacity. Kept separate: it saves with its own button, because
      it changes what the whole schedule is measured against. */
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
        vat_rate: String(orgRow.vat_rate ?? 0),
        timezone: orgRow.timezone ?? "",
        tax_number: orgRow.tax_number ?? "",
        vat_number: orgRow.vat_number ?? "",
        phone: orgRow.phone ?? "",
        invoice_terms_days: String(orgRow.invoice_terms_days ?? 30),
        invoice_footer: orgRow.invoice_footer ?? "",
      });
    }

    setCapacity(await fetchOrgSettings(supabase));

    const { data: memberRows } = await supabase
      .from("profiles")
      .select("*")
      .order("role")
      .order("full_name");
    setMembers(memberRows ?? []);
    setLoading(false);
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
      // Never allow zero working days — nothing could ever be scheduled, and
      // the check constraint would reject the save anyway.
      if (has && prev.workingDays.length === 1) return prev;
      return {
        ...prev,
        workingDays: has
          ? prev.workingDays.filter((d) => d !== day)
          : [...prev.workingDays, day].sort((a, b) => a - b),
      };
    });
  }

  useEffect(() => {
    // Behind an async boundary so the loader's own `setLoading(true)`
    // is not a synchronous setState in the effect body. Same call, same
    // tick — `load` still starts before this returns.
    void (async () => {
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    if (!org) return;
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    // The error was discarded here and "Saved." shown regardless. Harmless
    // while every field was free text; the timezone is not — a value that is
    // not an IANA zone is refused by `organizations_validate_timezone`, and the
    // org would have gone on running in the old zone while the screen said it
    // had changed. Which day a visit belongs to depends on that answer.
    const { error } = await supabase
      .from("organizations")
      .update({
        name: form.name,
        legal_name: form.legal_name || null,
        industry: form.industry || null,
        website: form.website || null,
        address: form.address || null,
        support_email: form.support_email || null,
        vat_rate: Number(form.vat_rate) || 0,
        // Left out when blank: the database refuses an empty zone, and a
        // company with none set must still be able to save its other fields.
        ...(form.timezone.trim() ? { timezone: form.timezone.trim() } : {}),
        tax_number: form.tax_number.trim() || null,
        vat_number: form.vat_number.trim() || null,
        phone: form.phone.trim() || null,
        invoice_terms_days: Math.max(0, Math.min(365, Math.round(Number(form.invoice_terms_days) || 0))),
        invoice_footer: form.invoice_footer.trim() || null,
      })
      .eq("id", org.id);
    setSaving(false);
    if (error) {
      setSaveError(error.message);
      return;
    }
    setSaved(true);
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card py-16 text-center text-sm text-muted-foreground">
        Loading company profile…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Company Profile
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage your organization&apos;s details, team members, field
          settings, terminology, branding and plan.
        </p>
      </div>

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Company Details</TabsTrigger>
          <TabsTrigger value="team">Team Members</TabsTrigger>
          <TabsTrigger value="field">Field settings</TabsTrigger>
          <TabsTrigger value="money">Quotes &amp; invoices</TabsTrigger>
          <TabsTrigger value="dashboard">Dashboard &amp; reports</TabsTrigger>
          <TabsTrigger value="emails">Emails</TabsTrigger>
          <TabsTrigger value="branding">Terminology &amp; branding</TabsTrigger>
          <TabsTrigger value="plan">Plan</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Company details</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="company-name">Company name</Label>
                <Input
                  id="company-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="legal-name">Legal entity name</Label>
                <Input
                  id="legal-name"
                  value={form.legal_name}
                  onChange={(e) => setForm({ ...form, legal_name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="industry">Industry</Label>
                <Input
                  id="industry"
                  value={form.industry}
                  onChange={(e) => setForm({ ...form, industry: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="website">Website</Label>
                <Input
                  id="website"
                  value={form.website}
                  onChange={(e) => setForm({ ...form, website: e.target.value })}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="address">Business address</Label>
                <Input
                  id="address"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="support-email">Support email</Label>
                <Input
                  id="support-email"
                  value={form.support_email}
                  onChange={(e) => setForm({ ...form, support_email: e.target.value })}
                />
              </div>
              {/* Printed on every tax invoice, and copied onto it when it is
                  issued — changing these never alters an invoice already out. */}
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tax-number">Taxpayer number (TIN)</Label>
                <Input
                  id="tax-number"
                  value={form.tax_number}
                  onChange={(e) => setForm({ ...form, tax_number: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vat-number">VAT registration number</Label>
                <Input
                  id="vat-number"
                  value={form.vat_number}
                  onChange={(e) => setForm({ ...form, vat_number: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="terms">Invoice payment terms (days)</Label>
                <Input
                  id="terms"
                  type="number"
                  min={0}
                  max={365}
                  value={form.invoice_terms_days}
                  onChange={(e) => setForm({ ...form, invoice_terms_days: e.target.value })}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="invoice-footer">Invoice footer</Label>
                <Textarea
                  id="invoice-footer"
                  rows={3}
                  value={form.invoice_footer}
                  onChange={(e) => setForm({ ...form, invoice_footer: e.target.value })}
                  placeholder="Bank details and payment instructions, printed at the foot of every invoice"
                />
                <p className="text-xs text-muted-foreground">
                  The name, address, TIN, VAT number, phone and footer are copied onto each tax
                  invoice when it is issued, so changing them never alters one already sent.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vat-rate">VAT rate (%)</Label>
                <Input
                  id="vat-rate"
                  type="number"
                  min={0}
                  max={100}
                  step="0.001"
                  value={form.vat_rate}
                  onChange={(e) => setForm({ ...form, vat_rate: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Applied to every order captured from now on. Orders already
                  taken keep the rate they were captured at, so changing this
                  never restates an invoice {withArticle(t, "client")} is
                  holding. 0 charges no VAT.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="timezone">Timezone</Label>
                <Input
                  id="timezone"
                  list="iana-timezones"
                  value={form.timezone}
                  onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                />
                {/* A short list of the ones a customer here is likely to want,
                    as suggestions rather than a closed set — the database
                    accepts any IANA name and refuses anything else, so a
                    dropdown of six would be a smaller lie than a free field. */}
                <datalist id="iana-timezones">
                  <option value="Africa/Gaborone" />
                  <option value="Africa/Johannesburg" />
                  <option value="Africa/Windhoek" />
                  <option value="Africa/Harare" />
                  <option value="Africa/Lusaka" />
                  <option value="Africa/Maputo" />
                  <option value="Africa/Nairobi" />
                  <option value="Africa/Lagos" />
                  <option value="Europe/London" />
                  <option value="UTC" />
                </datalist>
                <p className="text-xs text-muted-foreground">
                  Decides which calendar day something falls on — attendance,
                  the {lower(t.workday.one)} card and every dashboard read it.
                  Not a display preference: {withArticle(t, "staff")} finishing
                  at 23:30 lands on the wrong day if this is wrong, and the day
                  after shows a start with no end. An IANA name; anything else
                  is refused.
                </p>
              </div>
              <div className="flex items-end gap-3 sm:col-span-2">
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {saving ? "Saving…" : "Save changes"}
                </Button>
                {saved && (
                  <span className="text-sm text-emerald-700">Saved.</span>
                )}
                {saveError && (
                  <span className="text-sm text-destructive">{saveError}</span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Capacity drives the call cycle: the load strip, the capacity
              meter, the auto-spread and the AI plan review all measure against
              these. They were constants in the code, which fitted exactly one
              business. */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Planning capacity</CardTitle>
              <CardDescription>
                What one {lower(t.staff.one)} covers in a day, and which days your
                team works. Used by the schedule to tell you whether{" "}
                {withArticle(t, "schedule_cycle")} is deliverable.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {capacityError && (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {capacityError}
                </p>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="stores-per-day">{t.site.many} per day</Label>
                  <Input
                    id="stores-per-day"
                    type="number"
                    min={1}
                    max={50}
                    value={capacity.storesPerDay}
                    onChange={(e) => {
                      setSavedCapacity(false);
                      setCapacity({
                        ...capacity,
                        storesPerDay: Number(e.target.value),
                      });
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    How many {lower(t.site.many)} one {lower(t.staff.one)}{" "}
                    realistically covers in a day.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="default-frequency">
                    Default {lower(t.job.one)} frequency
                  </Label>
                  <NativeSelect
                    id="default-frequency"
                    value={capacity.defaultVisitFrequency}
                    onChange={(e) => {
                      setSavedCapacity(false);
                      setCapacity({
                        ...capacity,
                        defaultVisitFrequency: e.target
                          .value as OrgSettings["defaultVisitFrequency"],
                      });
                    }}
                  >
                    {FREQUENCIES.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </NativeSelect>
                  <p className="text-xs text-muted-foreground">
                    Applied to newly imported {lower(t.site.many)}.
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Working days</Label>
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAYS.map((w) => {
                    const on = capacity.workingDays.includes(w.value);
                    return (
                      <button
                        key={w.value}
                        type="button"
                        onClick={() => toggleWorkingDay(w.value)}
                        className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
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
                <p className="text-xs text-muted-foreground">
                  {capacity.workingDays.length} days ×{" "}
                  {count(t, "site", capacity.storesPerDay)} ={" "}
                  <span className="font-medium text-foreground">
                    {count(t, "job", capacity.workingDays.length * capacity.storesPerDay)}
                  </span>{" "}
                  per {lower(t.staff.one)} per week.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  onClick={handleSaveCapacity}
                  disabled={savingCapacity}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {savingCapacity ? "Saving…" : "Save capacity"}
                </Button>
                {savedCapacity && (
                  <span className="text-sm text-emerald-700">Saved.</span>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="team" className="mt-4 space-y-4">
          <div className="flex flex-col items-end gap-2">
            <Button
              className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => setInviteNote(true)}
            >
              <Plus className="h-4 w-4" />
              Invite team member
            </Button>
            {inviteNote && (
              <p className="max-w-sm text-right text-xs text-muted-foreground">
                Email invites require a server-side admin key (Supabase
                service role) that isn&apos;t wired up yet — coming soon. For
                now, new accounts can be created directly in the Supabase
                dashboard.
              </p>
            )}
          </div>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="font-medium text-foreground">
                      {member.full_name ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {member.email}
                    </TableCell>
                    <TableCell>
                      <Badge className={roleTone[member.role] ?? ""}>
                        {member.role === "manager" ? "Manager" : t.staff.one}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      <span className="text-emerald-700">Active</span>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {members.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                      No team members found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="field" className="mt-4 space-y-4">
          {org && <FieldSettingsCard orgId={org.id} />}
        </TabsContent>

        <TabsContent value="money" className="mt-4 space-y-4">
          {org && <MoneySettingsCard orgId={org.id} canEdit={canEditCompany} />}
        </TabsContent>

        <TabsContent value="dashboard" className="mt-4 space-y-4">
          {org && <DashboardSettingsCard orgId={org.id} canEdit={canEditCompany} />}
          {org && <ReportsSettingsCard orgId={org.id} canEdit={canEditCompany} />}
        </TabsContent>

        <TabsContent value="emails" className="mt-4 space-y-4">
          <EmailSettingsCard supportEmail={form.support_email || null} />
        </TabsContent>

        <TabsContent value="branding" className="mt-4 space-y-4">
          {org && (
            <>
              <TerminologyCard orgId={org.id} canEdit={canEditCompany} />
              <LogoCard
                orgId={org.id}
                initialLogoPath={org.logo_path}
                canEdit={canEditCompany}
              />
              <BrandColoursCard orgId={org.id} canEdit={canEditCompany} />
            </>
          )}
        </TabsContent>

        <TabsContent value="plan" className="mt-4 space-y-4">
          <ModulesCard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
