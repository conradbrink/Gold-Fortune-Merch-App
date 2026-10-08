"use client";

import { StepCard } from "@/components/setup/step-card";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { switchesOf, workflowPreset } from "@/lib/money-workflow";
import { firstDocument } from "@/lib/setup";
import { lower } from "@/lib/terms";
import type { StepProps } from "./types";

/**
 * What the company's trade already gave it, shown before anything is asked:
 * its words, its checklists, its price list and how it gets paid. All of it
 * was made at sign-up; this is where the owner first sees it.
 */
export function WelcomeStep({ setup, text, icon, onNext }: StepProps) {
  const t = useTerms();
  const config = useCompanyConfig();
  const route = config ? workflowPreset(config.settings.money_workflow, t) : null;
  const first = config ? firstDocument(config.settings.money_workflow, switchesOf(config.settings), null).kind : "quote";
  const c = setup.counts;
  const tiles = [
    { title: "Your words", body: `${t.staff.one}, ${t.site.one}, ${t.job.one}` },
    {
      title: `${c.checklists} ready-made checklist${c.checklists === 1 ? "" : "s"}`,
      body: `Your ${lower(t.staff.many)} tick them off on the phone.`,
    },
    {
      title: `${c.items} item${c.items === 1 ? "" : "s"} on your price list`,
      body: c.pricedItems === 0 ? "Add your prices in step 5." : `${c.pricedItems} already priced.`,
    },
    ...(route ? [{ title: route.label, body: route.description }] : []),
  ];

  return (
    <StepCard
      icon={icon}
      title={text.title}
      subtitle={text.subtitle}
      time={text.time}
      onContinue={onNext}
      continueLabel="Start (about 8 minutes)"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {tiles.map((tile) => (
          <div key={tile.title} className="rounded-xl bg-secondary/60 p-4">
            <p className="font-medium text-foreground">{tile.title}</p>
            <p className="text-sm text-muted-foreground">{tile.body}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        Next: your details, your prices, your first {lower(t.site.one)} and your team, then your first {first} is
        ready to send. Skip any step; everything can be changed later in Settings.
      </p>
    </StepCard>
  );
}
