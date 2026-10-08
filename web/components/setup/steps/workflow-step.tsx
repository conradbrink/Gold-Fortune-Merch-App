"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { StepCard } from "@/components/setup/step-card";
import { createClient } from "@/lib/supabase/client";
import { refreshCompanyConfig, useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { moduleEnabled } from "@/lib/modules";
import {
  MONEY_WORKFLOWS,
  switchesOf,
  switchToggles,
  workflowPreset,
  type MoneySwitches,
  type MoneyWorkflow,
} from "@/lib/money-workflow";
import { saveMoneyWorkflow } from "@/lib/money-settings";
import type { StepProps } from "./types";

/**
 * How the company gets paid. Its trade's route is already chosen at sign-up,
 * so most owners only read it and continue; the others are one tap away, and
 * the five switches wait under "Fine-tune".
 */
export function WorkflowStep({ org, setup, text, icon, onBack, onNext, reload }: StepProps) {
  const t = useTerms();
  const config = useCompanyConfig();
  const [workflow, setWorkflow] = useState<MoneyWorkflow | null>(config?.settings.money_workflow ?? null);
  const [sw, setSw] = useState<MoneySwitches | null>(config ? switchesOf(config.settings) : null);
  const [fine, setFine] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The configuration can arrive after the first render.
  const chosen = workflow ?? config?.settings.money_workflow ?? "flexible";
  const switches = sw ?? (config ? switchesOf(config.settings) : workflowPreset(chosen, t).switches);
  const trade = setup.tradeWorkflow;
  const main = setup.industries[0];
  const tradeName = main && main.code !== "generic" ? main.name : null;
  const offered = MONEY_WORKFLOWS.filter(
    (w) => w !== "order_invoice" || (config && moduleEnabled(config.modules, "distribution"))
  );

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await saveMoneyWorkflow(createClient(), org.id, chosen, switches);
      refreshCompanyConfig();
      await reload();
      setBusy(false);
      onNext();
    } catch (e) {
      setBusy(false);
      setError(`Nothing was saved: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

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
      <div className="space-y-4" role="radiogroup" aria-label="How you get paid">
        <div className="grid gap-3 sm:grid-cols-2">
          {offered.map((w) => {
            const p = workflowPreset(w, t);
            const on = w === chosen;
            return (
              <button
                key={w}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  setWorkflow(w);
                  setSw(p.switches);
                }}
                className={
                  "rounded-xl border p-4 text-left transition-colors " +
                  (on ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:border-primary/40")
                }
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{p.label}</span>
                  {w === trade && (
                    <span className="rounded-full bg-gold/20 px-2 py-0.5 text-xs font-medium text-foreground">
                      {tradeName ? `Usual for ${tradeName.toLowerCase()}` : "Usual for your trade"}
                    </span>
                  )}
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">{p.description}</span>
              </button>
            );
          })}
        </div>
        <div>
          <button
            type="button"
            onClick={() => setFine((f) => !f)}
            aria-expanded={fine}
            className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            <ChevronDown className={"size-4 transition-transform " + (fine ? "rotate-180" : "")} aria-hidden />
            Fine-tune: which documents you use
          </button>
          {fine && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {switchToggles(t).map((g) => (
                <label key={g.key} className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={switches[g.key]}
                    onChange={(e) => setSw({ ...switches, [g.key]: e.target.checked })}
                  />
                  <span>
                    <span className="font-medium">{g.label}</span>
                    <span className="block text-xs text-muted-foreground">{g.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
    </StepCard>
  );
}
