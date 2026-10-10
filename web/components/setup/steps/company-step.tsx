"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/hr/field";
import { LogoUpload } from "@/components/settings/logo-card";
import { StepCard } from "@/components/setup/step-card";
import { createClient } from "@/lib/supabase/client";
import { useCompanyConfig } from "@/lib/use-company-config";
import { countryName } from "@/lib/geocode-country";
import type { StepProps } from "./types";

/** The company's logo and contact details: what heads every document. */
export function CompanyStep({ org, text, icon, ownerEmail, onBack, onNext, reload }: StepProps) {
  const config = useCompanyConfig();
  const [form, setForm] = useState({
    phone: org.phone ?? "",
    email: org.support_email ?? ownerEmail,
    website: org.website ?? "",
    address: org.address ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setBusy(true);
    setError(null);
    const { error: e } = await createClient()
      .from("organizations")
      .update({
        phone: form.phone.trim() || null,
        support_email: form.email.trim() || null,
        website: form.website.trim() || null,
        address: form.address.trim() || null,
      })
      .eq("id", org.id);
    if (e) {
      setBusy(false);
      setError(`Nothing was saved: ${e.message}`);
      return;
    }
    await reload();
    setBusy(false);
    onNext();
  }

  const where = [countryName(config?.settings.country_code || null), config?.settings.currency_code, config?.timezone]
    .filter(Boolean)
    .join(" · ");

  return (
    <StepCard
      icon={icon}
      title={text.title}
      subtitle={text.subtitle}
      time={text.time}
      onBack={onBack}
      onContinue={save}
      busy={busy}
      error={error}
    >
      <div className="space-y-5">
        <LogoUpload orgId={org.id} initialLogoPath={org.logo_path} canEdit />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone" htmlFor="setup-phone">
            <Input id="setup-phone" type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="Email on your documents" htmlFor="setup-email">
            <Input id="setup-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field label="Website" htmlFor="setup-website" className="sm:col-span-2">
            <Input id="setup-website" value={form.website} onChange={(e) => set("website", e.target.value)} />
          </Field>
          <Field label="Address" htmlFor="setup-address" className="sm:col-span-2">
            <Textarea id="setup-address" rows={2} value={form.address} onChange={(e) => set("address", e.target.value)} />
          </Field>
        </div>
        {where && (
          <p className="text-xs text-muted-foreground">
            {where}, from your sign-up. Change them in Company settings.
          </p>
        )}
      </div>
    </StepCard>
  );
}
