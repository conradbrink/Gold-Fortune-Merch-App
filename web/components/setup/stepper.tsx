"use client";

import {
  Building2,
  Check,
  CircleCheck,
  MapPin,
  ReceiptText,
  Route,
  Sparkles,
  Tag,
  Users,
  type LucideIcon,
} from "lucide-react";
import { SETUP_STEPS, stepIndex, type SetupStep } from "@/lib/setup";

export const STEP_ICONS: Record<SetupStep, LucideIcon> = {
  welcome: Sparkles,
  company: Building2,
  documents: ReceiptText,
  workflow: Route,
  prices: Tag,
  sites: MapPin,
  team: Users,
  done: CircleCheck,
};

/**
 * Where the owner is: eight circles with their names on a wide screen,
 * "Step n of 8" and a bar on a phone. Every step can be opened from here; none
 * has to be finished first.
 */
export function Stepper({
  current,
  labels,
  onPick,
}: {
  current: SetupStep;
  labels: Record<SetupStep, string>;
  onPick: (step: SetupStep) => void;
}) {
  const at = stepIndex(current);
  return (
    <nav aria-label="Set-up steps" className="space-y-3">
      <ol className="hidden grid-cols-8 gap-1 sm:grid">
        {SETUP_STEPS.map((s, i) => {
          const Icon = i < at ? Check : STEP_ICONS[s];
          return (
            <li key={s} className="min-w-0">
              <button
                type="button"
                onClick={() => onPick(s)}
                aria-current={i === at ? "step" : undefined}
                className="group flex w-full flex-col items-center gap-1.5 rounded-md py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span
                  className={
                    "flex size-9 items-center justify-center rounded-full border transition-colors " +
                    (i === at
                      ? "border-primary bg-primary text-primary-foreground"
                      : i < at
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground group-hover:border-primary/40")
                  }
                >
                  <Icon className="size-4" aria-hidden />
                </span>
                <span
                  className={
                    "max-w-full truncate text-xs " + (i === at ? "font-medium text-foreground" : "text-muted-foreground")
                  }
                >
                  {labels[s]}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="text-sm font-medium text-foreground sm:hidden">
        Step {at + 1} of {SETUP_STEPS.length}: {labels[current]}
      </p>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-border" aria-hidden>
        <div
          className="h-full rounded-full bg-gold transition-[width] duration-300"
          style={{ width: `${((at + 1) / SETUP_STEPS.length) * 100}%` }}
        />
      </div>
    </nav>
  );
}
