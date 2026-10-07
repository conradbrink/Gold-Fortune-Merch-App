"use client";

import {
  MapPin,
  MapPinOff,
  AlertTriangle,
  HelpCircle,
  Check,
  Handshake,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistance, type Verdict } from "@/lib/activities";
import type { Terms } from "@/lib/terms";
import { useTerms } from "@/lib/use-company-config";
import { verdictWords, type VerdictWords } from "@/lib/verdict-words";

type VerdictStyle = VerdictWords & {
  className: string;
  icon: typeof MapPin;
};

/** The look of each verdict; the words come from `verdictWords`. */
const VERDICT_LOOK: Record<Verdict, Pick<VerdictStyle, "className" | "icon">> = {
  at_store: {
    icon: Check,
    className:
      "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  },
  nearby: {
    icon: MapPin,
    className:
      "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  off_site: {
    icon: MapPinOff,
    className: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  },
  invalid_gps: {
    icon: AlertTriangle,
    className: "bg-secondary text-muted-foreground",
  },
  unknown: {
    icon: HelpCircle,
    className: "bg-secondary text-muted-foreground",
  },
  prospect: {
    icon: Handshake,
    className: "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  },
};

/**
 * Each verdict's badge in the company's words.
 *
 * Deliberately separate from `components/dashboard/status-pill.tsx`, which is
 * closed over the four visit statuses and has no dark-mode variants.
 */
export function verdictStyles(t: Terms): Record<Verdict, VerdictStyle> {
  const words = verdictWords(t);
  const out = {} as Record<Verdict, VerdictStyle>;
  for (const v of Object.keys(VERDICT_LOOK) as Verdict[]) {
    out[v] = { ...words[v], ...VERDICT_LOOK[v] };
  }
  return out;
}

export function LocationVerdict({
  verdict,
  distanceM,
  className,
}: {
  verdict: Verdict;
  distanceM: number | null;
  className?: string;
}) {
  const styles = verdictStyles(useTerms());
  const style = styles[verdict] ?? styles.unknown;
  const Icon = style.icon;

  return (
    <span
      title={style.hint}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold",
        style.className,
        className
      )}
    >
      <Icon className="h-3 w-3 shrink-0" />
      {style.label}
      {/* An unknown fix must never render "0 m" — a false green is the worst
          possible failure on this page. */}
      {verdict !== "unknown" && distanceM !== null && (
        <span className="font-normal opacity-80">
          · {formatDistance(distanceM)}
        </span>
      )}
    </span>
  );
}
