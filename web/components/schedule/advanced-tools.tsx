"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

/**
 * The planning tools that are worth having and not worth looking at.
 *
 * The call-cycle screen used to stack all of them open at once — a capacity
 * meter, two proposal engines with their accept/discard panels, a week-load
 * strip, a counts line and an AI review — above the grid that is the reason
 * anybody opened the page. Six panels of answers to questions nobody had asked
 * yet, and the thing being planned pushed below the fold.
 *
 * None of it is deleted. It is one click away, and the click is a native
 * `<details>`: no state to fall out of sync, correct for a keyboard and a
 * screen reader without any of it being written here.
 *
 * Children are mounted **lazily**, on first open. A collapsed `<details>` still
 * mounts its subtree, so panels that fetch on mount would go on making the
 * primary screen do the work this component exists to avoid.
 */
export function AdvancedTools({
  children,
  summary = "Advanced planning tools",
  hint,
}: {
  children: ReactNode;
  summary?: string;
  /** One line on what is inside, so opening it is not a guess. */
  hint?: string;
}) {
  const [opened, setOpened] = useState(false);

  return (
    <details
      className="group rounded-lg border border-border bg-card"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) setOpened(true);
      }}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm font-medium text-foreground hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        {summary}
        {hint && (
          <span className="truncate font-normal text-muted-foreground">
            — {hint}
          </span>
        )}
      </summary>

      {/* Nothing renders until it has been opened once; after that it stays
          mounted, so closing and reopening does not refetch. */}
      {opened && <div className="space-y-3 border-t border-border p-3">{children}</div>}
    </details>
  );
}
