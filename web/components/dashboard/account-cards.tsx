"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle, Clock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { can } from "@/lib/permissions";
import { usePermissions } from "@/lib/use-permissions";
import { useTerms } from "@/lib/use-company-config";
import {
  fillTermTokens,
  parseOnboarding,
  showOnboarding,
  trialState,
  type Onboarding,
} from "@/lib/onboarding";

/**
 * The top of the dashboard for whoever runs the company: the free-trial
 * countdown and the getting-started list (Stage 5).
 *
 * Both are facts from the database — `company_account.trial_ends_at` (which the
 * company can read but not change) and `my_onboarding()` (each step worked out
 * from what the company has actually done) — so this only decides how they
 * look. A company with no trial sees no banner; one that has put the list away,
 * or finished it, sees no list. Gold Fortune has neither.
 */
export function AccountCards() {
  const permissions = usePermissions();
  const manages = permissions !== null && can(permissions, "company_settings");
  if (!manages) return null;
  return <AccountCardsFor />;
}

function AccountCardsFor() {
  const terms = useTerms();
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState<Onboarding | null>(null);
  const [hiding, setHiding] = useState(false);
  const [hideError, setHideError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [account, list] = await Promise.all([
      supabase.from("company_account").select("trial_ends_at").maybeSingle(),
      supabase.rpc("my_onboarding"),
    ]);
    // Quietly absent on failure: these cards are a help, not the dashboard.
    if (!account.error) setTrialEndsAt(account.data?.trial_ends_at ?? null);
    if (!list.error) setOnboarding(parseOnboarding(list.data));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function hide() {
    setHiding(true);
    setHideError(null);
    const { error } = await createClient().rpc("dismiss_onboarding");
    setHiding(false);
    if (error) {
      setHideError(error.message);
      return;
    }
    await load();
  }

  const trial = trialState(trialEndsAt);
  const done = onboarding?.steps.filter((s) => s.done).length ?? 0;
  const total = onboarding?.steps.length ?? 0;

  return (
    <>
      {trial.kind !== "none" && (
        <div
          className={
            trial.kind === "ended"
              ? "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              : trial.kind === "ending"
                ? "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300"
                : "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-foreground"
          }
        >
          <span className="flex items-center gap-2 font-medium">
            <Clock className="size-4" aria-hidden />
            {trial.kind === "ended"
              ? "Your free trial has ended. Talk to us to keep going."
              : `${trial.daysLeft} ${trial.daysLeft === 1 ? "day" : "days"} left in your free trial`}
          </span>
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/plans" />}>
            {trial.kind === "ended" ? "Talk to us" : "View plans"}
          </Button>
        </div>
      )}

      {onboarding && showOnboarding(onboarding) && (
        <Card>
          <CardContent className="space-y-4 py-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">Getting started</h2>
                <p className="text-sm text-muted-foreground">A few steps to get your team up and running.</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-secondary px-2 py-1 text-xs font-medium tabular-nums">
                  {done}/{total}
                </span>
                <Button variant="ghost" size="icon-sm" onClick={hide} disabled={hiding} aria-label="Hide the getting-started list">
                  <X className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary" aria-hidden>
              <div className="h-full rounded-full bg-primary" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
            </div>
            <ul className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
              {onboarding.steps.map((s) => (
                <li key={s.code}>
                  <Link
                    href={s.href}
                    className="group flex items-start gap-2.5 rounded-md px-1 py-1.5 hover:bg-secondary/60"
                    title={fillTermTokens(s.description, terms)}
                  >
                    {s.done ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-label="Done" />
                    ) : (
                      <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="To do" />
                    )}
                    <span className={s.done ? "flex-1 text-sm text-muted-foreground line-through" : "flex-1 text-sm text-foreground"}>
                      {fillTermTokens(s.title, terms)}
                    </span>
                    {!s.done && <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden />}
                  </Link>
                </li>
              ))}
            </ul>
            {hideError && <p className="text-sm text-destructive">{hideError}</p>}
          </CardContent>
        </Card>
      )}
    </>
  );
}
