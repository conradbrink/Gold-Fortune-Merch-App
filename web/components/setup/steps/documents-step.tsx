"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/hr/field";
import { StepCard } from "@/components/setup/step-card";
import { createClient } from "@/lib/supabase/client";
import { refreshCompanyConfig } from "@/lib/use-company-config";
import { validPrefix } from "@/lib/document-settings";
import { bankDetailsBoxes, bankDetailsText } from "@/lib/setup";
import type { StepProps } from "./types";

/**
 * Tax and payment details for quotes and invoices, asked in plain words: do
 * you charge VAT, at what rate (the country's usual one offered), and where
 * clients pay. The rest has sensible defaults under "More options".
 */
export function DocumentsStep({ org, setup, text, icon, onBack, onNext, reload }: StepProps) {
  const savedRate = Number(org.vat_rate ?? 0);
  const [chargesVat, setChargesVat] = useState(savedRate > 0 || !!org.vat_number);
  const [vatNumber, setVatNumber] = useState(org.vat_number ?? "");
  const [vatRate, setVatRate] = useState(
    savedRate > 0 ? String(savedRate) : setup.vatRateDefault !== null ? String(setup.vatRateDefault) : ""
  );
  const [inclusive, setInclusive] = useState(org.prices_include_vat);
  const [registration, setRegistration] = useState(org.registration_number ?? "");
  const [bank, setBank] = useState(() => bankDetailsBoxes(org.bank_details));
  const [bankTouched, setBankTouched] = useState(false);
  const [terms, setTerms] = useState(String(org.invoice_terms_days ?? 30));
  const [more, setMore] = useState(false);
  const [invoicePrefix, setInvoicePrefix] = useState(org.invoice_prefix);
  const [quotePrefix, setQuotePrefix] = useState(org.quote_prefix);
  const [validity, setValidity] = useState(String(org.quote_validity_days));
  const [footer, setFooter] = useState(org.invoice_footer ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    const rate = Number(vatRate);
    const days = Number(terms);
    const valid = Number(validity);
    if (chargesVat && !(vatRate.trim() !== "" && Number.isFinite(rate) && rate > 0 && rate < 100)) {
      return setError("Type your VAT rate, for example 15.");
    }
    if (!Number.isInteger(days) || days < 0 || days > 365) return setError("Payment terms are 0 to 365 days.");
    if (!validPrefix(invoicePrefix) || !validPrefix(quotePrefix)) {
      return setError("A prefix is two to six capital letters, like INV or QT.");
    }
    if (!Number.isInteger(valid) || valid < 0 || valid > 365) return setError("Quotes are valid for 0 to 365 days.");
    setBusy(true);
    const { error: e } = await createClient()
      .from("organizations")
      .update({
        vat_rate: chargesVat ? rate : 0,
        vat_number: chargesVat ? vatNumber.trim() || null : null,
        prices_include_vat: chargesVat ? inclusive : false,
        registration_number: registration.trim() || null,
        // Bank details typed on the settings page are kept as they were
        // unless they were changed here.
        ...(bankTouched ? { bank_details: bankDetailsText(bank) || null } : {}),
        invoice_terms_days: days,
        invoice_prefix: invoicePrefix,
        quote_prefix: quotePrefix,
        quote_validity_days: valid,
        invoice_footer: footer.trim() || null,
      })
      .eq("id", org.id);
    if (e) {
      setBusy(false);
      setError(`Nothing was saved: ${e.message}`);
      return;
    }
    refreshCompanyConfig();
    await reload();
    setBusy(false);
    onNext();
  }

  const setBankBox = (k: keyof typeof bank, v: string) => {
    setBankTouched(true);
    setBank((b) => ({ ...b, [k]: v }));
  };

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
      <div className="space-y-6">
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-foreground">Do you charge VAT?</legend>
          <div className="flex flex-wrap gap-2">
            {[true, false].map((yes) => (
              <button
                key={String(yes)}
                type="button"
                aria-pressed={chargesVat === yes}
                onClick={() => setChargesVat(yes)}
                className={
                  "rounded-lg border px-4 py-2 text-sm transition-colors " +
                  (chargesVat === yes
                    ? "border-primary bg-primary/5 font-medium text-foreground ring-1 ring-primary"
                    : "border-border text-muted-foreground hover:border-primary/40")
                }
              >
                {yes ? "Yes, I charge VAT" : "No"}
              </button>
            ))}
          </div>
          {chargesVat && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="VAT number" htmlFor="setup-vat-number">
                <Input id="setup-vat-number" value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} />
              </Field>
              <Field
                label="VAT rate (%)"
                htmlFor="setup-vat-rate"
                hint={setup.vatRateDefault !== null && savedRate === 0 ? "Your country's usual rate. Change it if yours differs." : undefined}
              >
                <Input
                  id="setup-vat-rate"
                  inputMode="decimal"
                  value={vatRate}
                  onChange={(e) => setVatRate(e.target.value)}
                />
              </Field>
              <label className="flex items-start gap-2 text-sm sm:col-span-2">
                <input type="checkbox" className="mt-0.5" checked={inclusive} onChange={(e) => setInclusive(e.target.checked)} />
                <span>
                  <span className="font-medium">My prices include VAT</span>
                  <span className="block text-xs text-muted-foreground">
                    Leave this off if you add VAT on top of your prices.
                  </span>
                </span>
              </label>
            </div>
          )}
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-foreground">Where clients pay you</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Bank" htmlFor="setup-bank">
              <Input id="setup-bank" value={bank.bank} onChange={(e) => setBankBox("bank", e.target.value)} />
            </Field>
            <Field label="Account name" htmlFor="setup-account-name">
              <Input id="setup-account-name" value={bank.accountName} onChange={(e) => setBankBox("accountName", e.target.value)} />
            </Field>
            <Field label="Account number" htmlFor="setup-account-number">
              <Input
                id="setup-account-number"
                inputMode="numeric"
                value={bank.accountNumber}
                onChange={(e) => setBankBox("accountNumber", e.target.value)}
              />
            </Field>
            <Field label="Branch code" htmlFor="setup-branch">
              <Input id="setup-branch" value={bank.branchCode} onChange={(e) => setBankBox("branchCode", e.target.value)} />
            </Field>
            <Field label="Payment terms (days)" htmlFor="setup-terms" hint="When an invoice is due, counted from its date.">
              <Input id="setup-terms" inputMode="numeric" value={terms} onChange={(e) => setTerms(e.target.value)} />
            </Field>
            <Field label="Company registration number (optional)" htmlFor="setup-reg">
              <Input id="setup-reg" value={registration} onChange={(e) => setRegistration(e.target.value)} />
            </Field>
          </div>
        </fieldset>

        <div>
          <button
            type="button"
            onClick={() => setMore((m) => !m)}
            aria-expanded={more}
            className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            <ChevronDown className={"size-4 transition-transform " + (more ? "rotate-180" : "")} aria-hidden />
            More options: numbering, how long quotes are valid, a footer
          </button>
          {more && (
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              <Field label="Invoice prefix" htmlFor="setup-inv-prefix">
                <Input id="setup-inv-prefix" value={invoicePrefix} onChange={(e) => setInvoicePrefix(e.target.value.toUpperCase())} />
              </Field>
              <Field label="Quote prefix" htmlFor="setup-quote-prefix">
                <Input id="setup-quote-prefix" value={quotePrefix} onChange={(e) => setQuotePrefix(e.target.value.toUpperCase())} />
              </Field>
              <Field label="Quotes valid for (days)" htmlFor="setup-validity">
                <Input id="setup-validity" inputMode="numeric" value={validity} onChange={(e) => setValidity(e.target.value)} />
              </Field>
              <Field label="Footer on every invoice" htmlFor="setup-footer" className="sm:col-span-3">
                <Textarea id="setup-footer" rows={2} value={footer} onChange={(e) => setFooter(e.target.value)} />
              </Field>
            </div>
          )}
        </div>
      </div>
    </StepCard>
  );
}
