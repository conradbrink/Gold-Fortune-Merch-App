"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";

/**
 * One step: an icon, a title and a line under it, the step's own content,
 * then Back and Continue, always in the same place.
 */
export function StepCard({
  icon: Icon,
  title,
  subtitle,
  time,
  children,
  onBack,
  onContinue,
  continueLabel = "Continue",
  busy = false,
  error,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  time: string;
  children: React.ReactNode;
  onBack?: () => void;
  onContinue: () => void;
  continueLabel?: string;
  busy?: boolean;
  error?: string | null;
}) {
  return (
    <section className="rounded-2xl bg-card ring-1 ring-foreground/10">
      <div className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {time && <span className="shrink-0 pt-1 text-xs text-muted-foreground">{time}</span>}
      </div>
      <div className="px-5 py-5 sm:px-6">{children}</div>
      {error && (
        <p role="alert" className="mx-5 mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive sm:mx-6">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4 sm:px-6">
        {onBack ? (
          <Button variant="outline" onClick={onBack} disabled={busy}>
            <ArrowLeft className="mr-1.5 size-4" aria-hidden /> Back
          </Button>
        ) : (
          <span />
        )}
        <Button onClick={onContinue} disabled={busy}>
          {busy ? "Saving…" : continueLabel}
          {!busy && <ArrowRight className="ml-1.5 size-4" aria-hidden />}
        </Button>
      </div>
    </section>
  );
}
