"use client";

import { useEffect, useState } from "react";
import { Plus, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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
import { currentPlan, availablePlans } from "@/lib/mock-data";

type Organization = Tables<"organizations">;
type Profile = Tables<"profiles">;

const roleTone: Record<string, string> = {
  manager: "bg-primary text-primary-foreground",
  rep: "bg-secondary text-secondary-foreground",
};

export default function CompanyProfilePage() {
  const supabase = createClient();
  const [org, setOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [inviteNote, setInviteNote] = useState(false);
  const [form, setForm] = useState({
    name: "",
    legal_name: "",
    industry: "",
    website: "",
    address: "",
    support_email: "",
    vat_rate: "",
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
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    if (!org) return;
    setSaving(true);
    setSaved(false);
    await supabase
      .from("organizations")
      .update({
        name: form.name,
        legal_name: form.legal_name || null,
        industry: form.industry || null,
        website: form.website || null,
        address: form.address || null,
        support_email: form.support_email || null,
        vat_rate: Number(form.vat_rate) || 0,
      })
      .eq("id", org.id);
    setSaving(false);
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
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Company Profile
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage your organization&apos;s details, team members, and
          subscription plan.
        </p>
      </div>

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Company Details</TabsTrigger>
          <TabsTrigger value="team">Team Members</TabsTrigger>
          <TabsTrigger value="plan">Plan &amp; Billing</TabsTrigger>
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
                  never restates an invoice a customer is holding. 0 charges no
                  VAT.
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
                What one rep-day holds, and which days your team works. Used by
                the schedule to tell you whether a call cycle is deliverable.
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
                  <Label htmlFor="stores-per-day">Stores per day</Label>
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
                    How many stops one rep realistically makes in a day.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="default-frequency">
                    Default visit frequency
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
                    Applied to newly imported stores.
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
                  {capacity.storesPerDay} stores ={" "}
                  <span className="font-medium text-foreground">
                    {capacity.workingDays.length * capacity.storesPerDay} visits
                  </span>{" "}
                  per rep per week.
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
                        {member.role === "manager" ? "Manager" : "Rep"}
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

        <TabsContent value="plan" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Current plan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-bold text-foreground">
                      {currentPlan.name}
                    </span>
                    <Badge className="bg-gold text-gold-foreground">
                      Current plan
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {currentPlan.price} {currentPlan.billingCycle} · renews{" "}
                    {currentPlan.renewsOn}
                  </p>
                </div>
                <Button variant="outline">Manage billing</Button>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Seats used</span>
                    <span className="font-medium text-foreground">
                      {members.length} / {currentPlan.seatsIncluded}
                    </span>
                  </div>
                  <Progress
                    value={(members.length / currentPlan.seatsIncluded) * 100}
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Stores used</span>
                    <span className="font-medium text-foreground">
                      {currentPlan.storesUsed} / {currentPlan.storesIncluded}
                    </span>
                  </div>
                  <Progress
                    value={(currentPlan.storesUsed / currentPlan.storesIncluded) * 100}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Billing isn&apos;t connected to a payment provider yet — this
                tab is illustrative until Stripe (or similar) is integrated.
              </p>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {availablePlans.map((plan) => {
              const active = plan.name === currentPlan.name;
              return (
                <Card
                  key={plan.id}
                  className={active ? "border-primary" : undefined}
                >
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between text-base">
                      {plan.name}
                      {active && (
                        <Badge className="bg-primary text-primary-foreground">
                          Active
                        </Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-2xl font-bold text-foreground">
                      {plan.price}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {plan.seats === Infinity ? "Unlimited" : plan.seats} seats
                      · {plan.stores === Infinity ? "Unlimited" : plan.stores}{" "}
                      places
                    </p>
                    <Button
                      variant={active ? "outline" : "default"}
                      className={
                        active
                          ? "w-full"
                          : "w-full bg-primary text-primary-foreground hover:bg-primary/90"
                      }
                      disabled={active}
                    >
                      {active ? "Current plan" : "Switch plan"}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
