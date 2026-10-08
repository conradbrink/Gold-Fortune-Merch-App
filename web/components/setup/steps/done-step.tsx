"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { lower } from "@/lib/terms";
import { switchesOf } from "@/lib/money-workflow";
import { firstDocument } from "@/lib/setup";
import type { StepProps } from "./types";

/**
 * The finish: what is now in place, the one button that makes the company's
 * first quote or contract (its first place already picked), and what happens
 * next. Either way out marks the wizard finished.
 */
export function DoneStep({ org, setup, icon: Icon, onBack, onFinish }: StepProps) {
  const t = useTerms();
  const config = useCompanyConfig();
  const [firstSite, setFirstSite] = useState<string | null>(null);
  const [going, setGoing] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data } = await createClient()
        .from("stores")
        .select("id")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      setFirstSite((data as { id: string } | null)?.id ?? null);
    })();
  }, []);

  const c = setup.counts;
  const team = Math.max(0, c.people - 1);
  const doc = config ? firstDocument(config.settings.money_workflow, switchesOf(config.settings), firstSite) : null;
  const ready = [
    `${c.sites} ${c.sites === 1 ? lower(t.site.one) : lower(t.site.many)}`,
    `${c.pricedItems} price${c.pricedItems === 1 ? "" : "s"}`,
    `${team} ${team === 1 ? lower(t.staff.one) : lower(t.staff.many)}`,
    ...(org.bank_details ? ["your bank details on every invoice"] : []),
  ];

  function go(href: string) {
    setGoing(true);
    onFinish(href);
  }

  return (
    <section className="rounded-2xl border border-border bg-card shadow-lg">
      <div className="flex flex-col items-center gap-3 px-6 pb-2 pt-8 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Icon className="size-7" aria-hidden />
        </span>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          {doc ? `You're ready to send your first ${doc.kind}` : "You're ready"}
        </h2>
        <p className="max-w-prose text-sm text-muted-foreground">Set up: {ready.join(" · ")}.</p>
      </div>
      <div className="flex flex-col items-center gap-3 px-6 py-6">
        {doc && (
          <Button size="lg" onClick={() => go(doc.href)} disabled={going}>
            {doc.label} <ArrowRight className="ml-1.5 size-4" aria-hidden />
          </Button>
        )}
        <Button variant="ghost" onClick={() => go("/")} disabled={going}>
          Go to the dashboard
        </Button>
      </div>
      <div className="border-t border-border px-6 py-5">
        <h3 className="text-sm font-semibold text-foreground">What happens next</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Your {lower(t.staff.many)} install the app from your WhatsApp message and sign in.</li>
          <li>
            Their first {lower(t.job.one)} shows on your map, with photos and the time on site. Your dashboard tells you
            who has signed in.
          </li>
          <li>Then plan your recurring {lower(t.job.many)} from the getting-started list on your dashboard.</li>
        </ol>
      </div>
      {onBack && (
        <div className="border-t border-border px-6 py-4">
          <Button variant="outline" onClick={onBack} disabled={going}>
            Back
          </Button>
        </div>
      )}
    </section>
  );
}
