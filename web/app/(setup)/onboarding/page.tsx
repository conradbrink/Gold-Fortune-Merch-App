"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { moduleEnabled } from "@/lib/modules";
import { trialState } from "@/lib/onboarding";
import {
  nextStep,
  openingStep,
  parseSetup,
  previousStep,
  SETUP_STEPS,
  stepText,
  type Setup,
  type SetupStep,
} from "@/lib/setup";
import { Stepper, STEP_ICONS } from "@/components/setup/stepper";
import { WelcomeStep } from "@/components/setup/steps/welcome-step";
import { CompanyStep } from "@/components/setup/steps/company-step";
import { DocumentsStep } from "@/components/setup/steps/documents-step";
import { WorkflowStep } from "@/components/setup/steps/workflow-step";
import { PricesStep } from "@/components/setup/steps/prices-step";
import { SitesStep } from "@/components/setup/steps/sites-step";
import { TeamStep } from "@/components/setup/steps/team-step";
import { DoneStep } from "@/components/setup/steps/done-step";
import type { Org, StepProps } from "@/components/setup/steps/types";

const STEPS: Record<SetupStep, (p: StepProps) => React.ReactNode> = {
  welcome: WelcomeStep,
  company: CompanyStep,
  documents: DocumentsStep,
  workflow: WorkflowStep,
  prices: PricesStep,
  sites: SitesStep,
  team: TeamStep,
  done: DoneStep,
};

/**
 * Set up your company (Stage 7 Part 2): where sign-up lands. Eight steps in
 * one card, each skippable, ending on the company's first quote or contract.
 * The step is remembered, so leaving and coming back carries on where it was;
 * a company that has finished it (or never had it, like an exempt one) is
 * sent to its dashboard.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const t = useTerms();
  const config = useCompanyConfig();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [ownerEmail, setOwnerEmail] = useState("");
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  const [step, setStep] = useState<SetupStep | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const supabase = createClient();
    const [s, user, account] = await Promise.all([
      supabase.rpc("my_setup"),
      supabase.auth.getUser(),
      supabase.from("company_account").select("trial_ends_at").maybeSingle(),
    ]);
    if (s.error) throw new Error(s.error.message);
    const { data: profile, error: pe } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", user.data.user?.id ?? "")
      .single();
    if (pe) throw new Error(pe.message);
    const { data: row, error: oe } = await supabase.from("organizations").select("*").eq("id", profile.org_id).single();
    if (oe) throw new Error(oe.message);
    const parsed = parseSetup(s.data);
    setSetup(parsed);
    setOrg(row as Org);
    setOwnerEmail(user.data.user?.email ?? "");
    setTrialEndsAt(account.data?.trial_ends_at ?? null);
    return parsed;
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const parsed = await reload();
        if (!parsed.show) {
          router.replace("/");
          return;
        }
        setStep(openingStep(new URLSearchParams(window.location.search).get("step"), parsed.step));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [reload, router]);

  function go(to: SetupStep) {
    setStep(to);
    window.scrollTo({ top: 0, behavior: "smooth" });
    // Where it was left; a failure here costs only the resume point.
    void createClient().rpc("save_setup_step", { p_step: to });
  }

  async function finish(href: string) {
    await createClient().rpc("save_setup_step", { p_step: "done", p_finished: true });
    router.push(href);
    router.refresh();
  }

  const products = !!config && moduleEnabled(config.modules, "distribution");
  // "Other / general" names no trade worth repeating back.
  const main = setup?.industries[0];
  const trade = main && main.code !== "generic" ? main.name : "";
  const labels = Object.fromEntries(
    SETUP_STEPS.map((s) => [s, stepText(s, t, { products, trade }).label])
  ) as Record<SetupStep, string>;
  const trial = trialState(trialEndsAt);

  if (error) {
    return (
      <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        Set-up could not be opened: {error}. <Link href="/" className="underline">Go to the dashboard</Link>
      </p>
    );
  }
  if (!setup || !org || !step) {
    return <p className="py-16 text-center text-sm text-muted-foreground">Loading your company…</p>;
  }

  const Step = STEPS[step];
  return (
    <div className="space-y-6">
      {(trial.kind === "active" || trial.kind === "ending") && (
        <p className="flex items-center gap-2 rounded-lg border border-gold/50 bg-gold/10 px-4 py-2 text-sm text-foreground">
          <Clock className="size-4" aria-hidden />
          {trial.daysLeft} {trial.daysLeft === 1 ? "day" : "days"} left in your free trial
        </p>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Set up {org.name}</h1>
          <p className="text-sm text-muted-foreground">About 8 minutes. You can change all of it later.</p>
        </div>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
          Skip for now
        </Link>
      </div>
      <Stepper current={step} labels={labels} onPick={go} />
      <Step
        org={org}
        setup={setup}
        text={stepText(step, t, { products, trade })}
        icon={STEP_ICONS[step]}
        ownerEmail={ownerEmail}
        onBack={step === "welcome" ? undefined : () => go(previousStep(step))}
        onNext={() => go(nextStep(step))}
        reload={async () => {
          await reload();
        }}
        onFinish={(href) => void finish(href)}
      />
    </div>
  );
}
