"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { refreshCompanyConfig, useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { validPrefix } from "@/lib/document-settings";
import {
  MONEY_WORKFLOWS,
  switchesOf,
  switchToggles,
  workflowPreset,
  type MoneySwitches,
  type MoneyWorkflow,
} from "@/lib/money-workflow";
import { saveMoneyWorkflow } from "@/lib/money-settings";

/**
 * Quotes and invoices: the details printed on them, and how the company gets
 * paid.
 *
 * The details are columns on the organisation, copied onto each invoice when
 * it is issued, so changing them never alters one already sent. The workflow
 * is company settings: picking a route sets its usual switches, and each
 * switch can still be changed on its own. The database refuses what a switch
 * turns off, so these are not only buttons hidden.
 */
export function MoneySettingsCard({ orgId, canEdit }: { orgId: string; canEdit: boolean }) {
  const supabase = createClient();
  const t = useTerms();
  const config = useCompanyConfig();

  const [doc, setDoc] = useState({
    registration_number: "",
    bank_details: "",
    prices_include_vat: false,
    invoice_prefix: "INV",
    quote_prefix: "QT",
    quote_validity_days: "30",
  });
  const [workflow, setWorkflow] = useState<MoneyWorkflow>("flexible");
  const [sw, setSw] = useState<MoneySwitches>({
    quotes: true,
    deposits: false,
    jobs: true,
    direct: true,
    contracts: false,
  });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error: e } = await supabase
        .from("organizations")
        .select("registration_number, bank_details, prices_include_vat, invoice_prefix, quote_prefix, quote_validity_days")
        .eq("id", orgId)
        .single();
      if (cancelled) return;
      if (e) {
        setError(e.message);
        return;
      }
      setDoc({
        registration_number: data.registration_number ?? "",
        bank_details: data.bank_details ?? "",
        prices_include_vat: data.prices_include_vat,
        invoice_prefix: data.invoice_prefix,
        quote_prefix: data.quote_prefix,
        quote_validity_days: String(data.quote_validity_days),
      });
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, orgId]);

  // The workflow and switches come with the company's configuration.
  useEffect(() => {
    if (!config) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWorkflow(config.settings.money_workflow);
    setSw(switchesOf(config.settings));
  }, [config]);

  async function save() {
    setError(null);
    setSaved(false);
    const days = Number(doc.quote_validity_days);
    if (!validPrefix(doc.invoice_prefix) || !validPrefix(doc.quote_prefix)) {
      return setError("A prefix is two to six capital letters, like INV or QT.");
    }
    if (!Number.isInteger(days) || days < 0 || days > 365) {
      return setError("Quotes are valid for 0 to 365 days.");
    }
    setSaving(true);
    try {
      const org = await supabase
        .from("organizations")
        .update({
          registration_number: doc.registration_number.trim() || null,
          bank_details: doc.bank_details.trim() || null,
          prices_include_vat: doc.prices_include_vat,
          invoice_prefix: doc.invoice_prefix,
          quote_prefix: doc.quote_prefix,
          quote_validity_days: days,
        })
        .eq("id", orgId);
      if (org.error) throw new Error(`Nothing was saved: ${org.error.message}`);
      try {
        await saveMoneyWorkflow(supabase, orgId, workflow, sw);
      } catch (e) {
        throw new Error(
          `The details on your quotes and invoices were saved, but how you get paid was not: ${e instanceof Error ? e.message : String(e)}`
        );
      }
      refreshCompanyConfig();
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const preset = workflowPreset(workflow, t);
  const toggles = switchToggles(t);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">How you get paid</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="money-workflow">Your usual route</Label>
            <NativeSelect
              id="money-workflow"
              value={workflow}
              disabled={!canEdit}
              onChange={(e) => {
                const w = e.target.value as MoneyWorkflow;
                setWorkflow(w);
                setSw(workflowPreset(w, t).switches);
              }}
            >
              {MONEY_WORKFLOWS.map((w) => (
                <option key={w} value={w}>
                  {workflowPreset(w, t).label}
                </option>
              ))}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">{preset.description}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {toggles.map((g) => (
              <label key={g.key} className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={sw[g.key]}
                  disabled={!canEdit}
                  onChange={(e) => setSw({ ...sw, [g.key]: e.target.checked })}
                />
                <span>
                  <span className="font-medium">{g.label}</span>
                  <span className="block text-xs text-muted-foreground">{g.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">On your quotes and invoices</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={doc.prices_include_vat}
              disabled={!canEdit || !loaded}
              onChange={(e) => setDoc({ ...doc, prices_include_vat: e.target.checked })}
            />
            <span>
              <span className="font-medium">Prices include VAT</span>
              <span className="block text-xs text-muted-foreground">
                Type prices with VAT in; the VAT shown is the part of them at your rate. New quotes and invoices
                take this when they are made.
              </span>
            </span>
          </label>
          <div className="space-y-1.5">
            <Label htmlFor="reg-number">Company registration number</Label>
            <Input
              id="reg-number"
              value={doc.registration_number}
              disabled={!canEdit}
              onChange={(e) => setDoc({ ...doc, registration_number: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="quote-days">Quotes are valid for (days)</Label>
            <Input
              id="quote-days"
              type="number"
              min={0}
              max={365}
              value={doc.quote_validity_days}
              disabled={!canEdit}
              onChange={(e) => setDoc({ ...doc, quote_validity_days: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-prefix">Invoice number prefix</Label>
            <Input
              id="inv-prefix"
              value={doc.invoice_prefix}
              disabled={!canEdit}
              onChange={(e) => setDoc({ ...doc, invoice_prefix: e.target.value.toUpperCase() })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="quote-prefix">Quote number prefix</Label>
            <Input
              id="quote-prefix"
              value={doc.quote_prefix}
              disabled={!canEdit}
              onChange={(e) => setDoc({ ...doc, quote_prefix: e.target.value.toUpperCase() })}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="bank-details">Bank details</Label>
            <Textarea
              id="bank-details"
              rows={3}
              value={doc.bank_details}
              disabled={!canEdit}
              onChange={(e) => setDoc({ ...doc, bank_details: e.target.value })}
              placeholder="Bank, account name, account number, branch code"
            />
            <p className="text-xs text-muted-foreground">
              Printed under &quot;How to pay&quot; on every invoice, quote and statement. Numbers carry on from where
              they are when a prefix changes.
            </p>
          </div>
          {canEdit && (
            <div className="flex items-center justify-end gap-3 sm:col-span-2">
              {error && <p className="text-sm text-destructive">{error}</p>}
              {saved && <p className="text-sm text-muted-foreground">Saved.</p>}
              <Button onClick={save} disabled={saving || !loaded}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
