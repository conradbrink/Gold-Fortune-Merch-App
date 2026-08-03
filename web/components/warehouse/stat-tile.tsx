"use client";

import { cn } from "@/lib/utils";

/**
 * One number with its name under it.
 *
 * `tone` is for the two cases where a figure is not just information: `warn`
 * for something that needs looking at this week, `bad` for something wrong
 * right now. Everything else stays neutral — if every tile is coloured, none
 * of them mean anything.
 */
export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "neutral" | "warn" | "bad";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        tone === "bad"
          ? "border-destructive/40 bg-destructive/5"
          : tone === "warn"
            ? "border-amber-500/40 bg-amber-500/5"
            : "border-border bg-card"
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "bad"
            ? "text-destructive"
            : tone === "warn"
              ? "text-amber-600 dark:text-amber-500"
              : "text-foreground"
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** The inline error banner this app uses everywhere; there is no toast. */
export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    // The banner appears in place of anything happening, so a screen reader has
    // to be told. Without this the action simply seems not to have worked.
    <p
      role="alert"
      className="rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-sm text-destructive"
    >
      {message}
    </p>
  );
}

/**
 * What a table says when it has nothing to show.
 *
 * Distinguishes "nothing matched your filter" from "there is nothing here yet",
 * because the second is a setup problem and the first is not.
 */
export function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-8 text-center text-sm text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}
