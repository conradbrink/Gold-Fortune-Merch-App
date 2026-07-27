import { MapPin, MapPinOff, AlertTriangle, HelpCircle, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistance, type Verdict } from "@/lib/activities";

type VerdictStyle = {
  label: string;
  className: string;
  icon: typeof MapPin;
  /** Shown on hover — says what the colour actually means. */
  hint: string;
};

/**
 * Deliberately separate from `components/dashboard/status-pill.tsx`, which is
 * closed over the four visit statuses and has no dark-mode variants.
 */
export const VERDICT_STYLES: Record<Verdict, VerdictStyle> = {
  at_store: {
    label: "At store",
    icon: Check,
    className:
      "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    hint: "Inside the store's geofence — location confirmed.",
  },
  nearby: {
    label: "Nearby",
    icon: MapPin,
    className:
      "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    hint: "Just outside the geofence. Normal for a large site or ordinary GPS drift.",
  },
  off_site: {
    label: "Off site",
    icon: MapPinOff,
    className: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
    hint: "More than 500 m from the store — a genuine discrepancy worth checking.",
  },
  invalid_gps: {
    label: "Invalid GPS",
    icon: AlertTriangle,
    className: "bg-secondary text-muted-foreground",
    hint: "Reading is over 5 km out and cannot be true. Treated as a faulty fix, not as behaviour.",
  },
  unknown: {
    label: "No fix",
    icon: HelpCircle,
    className: "bg-secondary text-muted-foreground",
    hint: "No GPS position was recorded for this event, so location cannot be confirmed.",
  },
};

export function LocationVerdict({
  verdict,
  distanceM,
  className,
}: {
  verdict: Verdict;
  distanceM: number | null;
  className?: string;
}) {
  const style = VERDICT_STYLES[verdict] ?? VERDICT_STYLES.unknown;
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
