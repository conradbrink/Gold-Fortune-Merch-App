import Link from "next/link";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, ChevronRight } from "lucide-react";

type StatTileProps = {
  label: string;
  value: string | number;
  sublabel?: string;
  deltaPct?: number;
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
  icon,
  tone = "solid",
  className,
  href,
}: StatTileProps) {
  const isSolid = tone === "solid";

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
            <>
              <span>Previous Week:</span>
              <span
                className={cn(
                  "flex items-center gap-0.5 font-semibold",
                  deltaPct < 0 ? "text-red-300" : "text-emerald-300"
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
