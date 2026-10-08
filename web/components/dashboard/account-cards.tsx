"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle, Clock, Sparkles, X } from "lucide-react";
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
import { parseSetup, SETUP_STEPS, stepIndex, type Setup } from "@/lib/setup";
import { lower } from "@/lib/terms";

type TeamLine = { id: string; name: string; signedIn: boolean; startedWorkday: boolean };

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
  const [setup, setSetup] = useState<Setup | null>(null);
  const [team, setTeam] = useState<TeamLine[]>([]);
  const [hiding, setHiding] = useState(false);
  const [hideError, setHideError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [account, list, wizard] = await Promise.all([
      supabase.from("company_account").select("trial_ends_at").maybeSingle(),
      supabase.rpc("my_onboarding"),
      supabase.rpc("my_setup"),
    ]);
    // Quietly absent on failure: these cards are a help, not the dashboard.
    if (!account.error) setTrialEndsAt(account.data?.trial_ends_at ?? null);
    const steps = list.error ? null : parseOnboarding(list.data);
    setOnboarding(steps);
    if (!wizard.error) setSetup(parseSetup(wizard.data));
    // Who has signed in matters only while the getting-started list shows.
    if (!steps || !showOnboarding(steps)) return;
    const [status, user] = await Promise.all([supabase.rpc("my_team_status"), supabase.auth.getUser()]);
    if (!status.error && status.data && status.data.length > 0) {
      const ids = status.data.map((r) => r.profile_id);
      const { data: names } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      const nameOf = new Map(((names ?? []) as { id: string; full_name: string | null }[]).map((n) => [n.id, n.full_name]));
      setTeam(
        status.data
          .filter((r) => r.profile_id !== user.data.user?.id)
          .map((r) => ({
            id: r.profile_id,
            name: nameOf.get(r.profile_id) ?? "Unnamed",
            signedIn: r.signed_in,
            startedWorkday: r.started_workday,
          }))
      );
    }
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

      {setup?.show && (
        <Card className="border-primary/30">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Sparkles className="size-5" aria-hidden />
              </span>
              <div>
                <h2 className="text-base font-semibold text-foreground">Finish setting up your company</h2>
                <p className="text-sm text-muted-foreground">
                  {setup.step
                    ? `You stopped at step ${stepIndex(setup.step) + 1} of ${SETUP_STEPS.length}. About ${Math.max(1, 8 - stepIndex(setup.step))} minutes to go.`
                    : "About 8 minutes to your first quote, with your logo, VAT and bank details."}
                </p>
              </div>
            </div>
            <Button nativeButton={false} render={<Link href="/onboarding" />}>
              Continue setting up <ArrowRight className="ml-1.5 size-4" aria-hidden />
            </Button>
          </CardContent>
        </Card>
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
            {team.some((p) => !p.startedWorkday) && (
              <div className="space-y-2 border-t border-border pt-4">
                <h3 className="text-sm font-semibold text-foreground">Your {lower(terms.staff.many)} on the app</h3>
                <ul className="space-y-1 text-sm">
                  {team.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                      <span className="font-medium text-foreground">{p.name}</span>
                      <span className={p.signedIn ? "text-primary" : "text-muted-foreground"}>
                        {p.signedIn ? "Signed in" : "Not signed in yet"}
                      </span>
                      <span className={p.startedWorkday ? "text-primary" : "text-muted-foreground"}>
                        {p.startedWorkday
                          ? `Started a ${lower(terms.workday.one)}`
                          : `No ${lower(terms.workday.one)} yet`}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Someone lost their message? Set a new password in{" "}
                  <Link href="/settings/users" className="underline">
                    Settings → Users
                  </Link>{" "}
                  and send it again.
                </p>
              </div>
            )}
            {hideError && <p className="text-sm text-destructive">{hideError}</p>}
          </CardContent>
        </Card>
      )}
    </>
  );
}
