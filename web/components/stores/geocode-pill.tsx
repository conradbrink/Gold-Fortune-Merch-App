import {
  AlertTriangle,
  Check,
  HelpCircle,
  LocateFixed,
  MapPinOff,
  PenLine,
  Search,
  SearchX,
  Signpost,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { GeocodeState } from "@/lib/geocode";

type GeocodeStyle = {
  label: string;
  className: string;
  icon: typeof MapPinOff;
  /** Shown on hover — says what the colour actually means. */
  hint: string;
};

/**
 * A separate style map from `components/activities/location-verdict.tsx`, for
 * the reason that file gives: a new semantic pill gets its own map rather than
 * bending an existing one to a second meaning.
 *
 * The colour answers one question — **can I trust this coordinate?** — and not
 * "is there a task outstanding here". So amber is reserved strictly for a point
 * that exists and should not be fully believed, and the two states with no
 * coordinate read muted rather than competing with it; the banner above the
 * table already carries the task framing for those. Today that paints most of
 * the estate amber, which is the honest picture, and it drains to green as reps
 * capture locations in the field.
 */
export const GEOCODE_STATE_STYLES: Record<GeocodeState, GeocodeStyle> = {
  rep: {
    label: "Rep on site",
    icon: LocateFixed,
    className:
      "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    hint: "Captured on a rep's phone inside the shop during a visit. The most reliable source here, and the only one with a measured accuracy.",
  },
  manual: {
    label: "Checked by hand",
    icon: PenLine,
    className:
      "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    hint: "A person looked at the map and accepted this point. Judgement rather than measurement, but someone did look.",
  },
  places: {
    label: "Places guess",
    icon: Search,
    className:
      "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    hint: "Matched by shop name through Google Places. Usually right, but where it cannot find a specific branch it returns the chain's nearest listing instead.",
  },
  geocoding: {
    label: "Address lookup",
    icon: Signpost,
    className:
      "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    hint: "Matched by address. The weakest source here: an address it cannot parse still comes back with a confident answer, once 5.7 km from the real shop.",
  },
  rejected: {
    label: "Match rejected",
    icon: SearchX,
    className: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
    hint: "No location. A lookup did answer and the answer was wrong, so it was removed — the bad match is kept on record so it is not accepted a second time.",
  },
  missing: {
    label: "No location",
    icon: MapPinOff,
    className: "bg-secondary text-muted-foreground",
    hint: "No coordinates and no lookup on record. Nothing to geofence against, so a check-in here can never be confirmed.",
  },
  unsourced: {
    label: "Source unknown",
    icon: HelpCircle,
    className: "bg-secondary text-muted-foreground",
    hint: "Has coordinates but no record of where they came from, so it cannot be judged without checking it again.",
  },
};

/** Most trustworthy first — the order the filter offers them in. */
export const GEOCODE_STATE_ORDER: GeocodeState[] = [
  "rep",
  "manual",
  "places",
  "geocoding",
  "unsourced",
  "rejected",
  "missing",
];

export function GeocodePill({
  state,
  accuracyM,
  shared,
  confirmed,
  onClick,
  className,
}: {
  state: GeocodeState;
  /** Rendered only for a rep capture; every other state's value is stale. */
  accuracyM?: number | null;
  /** Shares a coordinate with another store — orthogonal to the source. */
  shared?: boolean;
  /** A person has checked this point. Also orthogonal: a Places guess someone
      has verified is still a Places guess, but it is no longer a guess nobody
      has looked at, and that is the difference the review queue exists to
      make. */
  confirmed?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const style = GEOCODE_STATE_STYLES[state] ?? GEOCODE_STATE_STYLES.unsourced;
  const Icon = style.icon;

  const body = (
    <>
      <Icon className="h-3 w-3 shrink-0" />
      {style.label}
      {confirmed && (
        <span
          title="Checked by a person. An automatic lookup will not overwrite this."
          className="inline-flex"
        >
          <Check className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
        </span>
      )}
      {/* Gated on the state, not on the value being present: clearing a
          coordinate leaves the old accuracy behind, so a rejected store would
          otherwise advertise a tolerance for a point it no longer has. */}
      {state === "rep" && accuracyM !== null && accuracyM !== undefined && (
        <span className="font-normal opacity-80">± {Math.round(accuracyM)} m</span>
      )}
      {shared && (
        // A `title` on an <svg> is not a reliable tooltip; the span carries it.
        <span
          title="Another store sits on exactly this coordinate. At most one of them can be right."
          className="inline-flex"
        >
          <AlertTriangle className="h-3 w-3 shrink-0 text-red-600 dark:text-red-400" />
        </span>
      )}
    </>
  );

  const shape = cn(
    "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold",
    style.className,
    className
  );

  if (!onClick) return <span title={style.hint} className={shape}>{body}</span>;

  return (
    <button
      type="button"
      onClick={onClick}
      title={style.hint}
      className={cn(
        shape,
        "cursor-pointer hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      )}
    >
      {body}
    </button>
  );
}
