import Link from "next/link";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, ChevronRight } from "lucide-react";

type StatTileProps = {
  label: string;
  value: string | number;
  sublabel?: string;
  /** Percentage change vs the comparison period. `null` renders an em dash. */
  deltaPct?: number | null;
  /** Defaults to "vs previous period"; pass the real span where known. */
  deltaLabel?: string;
  /**
   * For metrics where down is good (out-of-stock rate, missed visits), so the
   * colouring doesn't congratulate a manager on a rising failure rate.
   */
  invertDelta?: boolean;
  icon?: React.ReactNode;
  tone?: "solid" | "outline";
  className?: string;
  href?: string;
};

export function StatTile({
  label,
  value,
  sublabel,
  deltaPct,
  deltaLabel = "vs previous period",
  invertDelta = false,
  icon,
  tone = "solid",
  className,
  href,
}: StatTileProps) {
  const isSolid = tone === "solid";
  const isGood = deltaPct == null ? false : invertDelta ? deltaPct < 0 : deltaPct > 0;
  // The -300 shades are tuned for the navy tile and wash out on white.
  const deltaTone = isGood
    ? isSolid
      ? "text-emerald-300"
      : "text-emerald-700 dark:text-emerald-400"
    : isSolid
      ? "text-red-300"
      : "text-red-700 dark:text-red-400";

  const body = (
    <>
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "text-sm font-medium",
            isSolid ? "text-primary-foreground/90" : "text-muted-foreground"
          )}
        >
          {label}
        </span>
        {icon}
      </div>
      <div className="mt-3 flex items-center gap-2 text-3xl font-bold tracking-tight">
        {value}
        {href && (
          <ChevronRight
            className={cn(
              "h-5 w-5 opacity-0 transition-opacity group-hover/tile:opacity-70",
              isSolid ? "text-primary-foreground" : "text-muted-foreground"
            )}
          />
        )}
      </div>
      {(sublabel || deltaPct !== undefined) && (
        <div
          className={cn(
            "mt-3 flex items-center gap-1 border-t pt-2 text-xs",
            isSolid
              ? "border-primary-foreground/20 text-primary-foreground/90"
              : "border-border text-muted-foreground"
          )}
        >
          {deltaPct !== undefined ? (
            deltaPct === null ? (
              // No previous data. "0%" here would assert "no change" when the
              // truth is "nothing to compare against".
              <span>No comparison data</span>
            ) : (
              <>
                <span>{deltaLabel}</span>
                <span
                  className={cn(
                    "flex items-center gap-0.5 font-semibold",
                    deltaTone
                  )}
                >
                  {deltaPct < 0 ? (
                    <ArrowDown className="h-3 w-3" />
                  ) : (
                    <ArrowUp className="h-3 w-3" />
                  )}
                  {Math.abs(deltaPct)}%
                </span>
              </>
            )
          ) : (
            <span>{sublabel}</span>
          )}
        </div>
      )}
    </>
  );

  const classes = cn(
    "group/tile flex flex-col justify-between rounded-lg p-5",
    isSolid
      ? "bg-primary text-primary-foreground"
      : "border border-border bg-card text-card-foreground",
    href && "transition-shadow hover:shadow-md",
    className
  );

  if (href) {
    return (
      <Link href={href} className={classes}>
        {body}
      </Link>
    );
  }

  return <div className={classes}>{body}</div>;
}
