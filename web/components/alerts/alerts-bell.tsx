"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { alertHref, alertText, fetchAlerts, markAlertsRead, type AlertItem } from "@/lib/alerts";
import { relativeTime } from "@/lib/hr/notifications";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { cn } from "@/lib/utils";
import type { Terms } from "@/lib/terms";

/** How often the count is fetched while the tab is open. */
const POLL_MS = 60_000;

/**
 * Alerts when something's off (Stage 8.4): the database finds them every five
 * minutes; this shows the unread count, the latest 30 in plain words, and
 * takes you to the day or the report they are about.
 *
 * The top bar renders it only for people who read reports (`insights`) at a
 * company with the module on; anywhere else the database refuses the call,
 * and a failed fetch hides the button rather than showing a broken one.
 *
 * Polls every minute while the tab is visible and again when it regains
 * focus. The detection itself runs every five minutes, so anything faster
 * would only fetch the same rows.
 */
export function AlertsBell() {
  const supabase = createClient();
  const router = useRouter();
  const t = useTerms();
  const config = useCompanyConfig();
  const timeZone = config?.timezone ?? "UTC";
  const [items, setItems] = useState<AlertItem[]>([]);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await fetchAlerts(supabase, 30));
      setFailed(false);
    } catch {
      setFailed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Behind an async boundary: nothing is set until the fetch returns.
    void (async () => {
      await load();
    })();
    const onFocus = () => void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  // A plain popover, as the notifications bell's: its rows are buttons, and
  // a menu that closes on any keypress fights them.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (failed) return null;

  const unread = items.filter((a) => a.unread).length;

  async function openItem(a: AlertItem) {
    setOpen(false);
    if (a.unread) {
      try {
        await markAlertsRead(supabase, [a.id]);
      } catch {
        /* Getting there matters more than the read mark. */
      }
    }
    void load();
    router.push(alertHref(a, config?.modules ?? null));
  }

  async function markAll() {
    try {
      await markAlertsRead(supabase, null);
      await load();
    } catch {
      /* The list simply stays as it is. */
    }
  }

  return (
    <div className="relative" ref={panelRef}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={unread > 0 ? `Alerts, ${unread} unread` : "Alerts"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <TriangleAlert className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold tabular-nums text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 z-50 mt-2">
          <AlertList
            items={items}
            terms={t}
            timeZone={timeZone}
            onOpen={(a) => void openItem(a)}
            onMarkAll={() => void markAll()}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The open panel: the list in words, newest first, unread ones marked, and
 * "Mark all read". Plain data in, so it can be looked at without a session.
 */
export function AlertList({
  items,
  terms,
  timeZone,
  onOpen,
  onMarkAll,
}: {
  items: AlertItem[];
  terms: Terms;
  timeZone: string;
  onOpen: (a: AlertItem) => void;
  onMarkAll: () => void;
}) {
  const unread = items.filter((a) => a.unread).length;
  return (
    <div className="w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-medium">Alerts</span>
        {unread > 0 && (
          <button
            type="button"
            className="min-h-8 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            onClick={onMarkAll}
          >
            Mark all read
          </button>
        )}
      </div>
      <div className="max-h-[60vh] overflow-y-auto">
        {items.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-pretty text-muted-foreground">
            Nothing to check. When something in the field is off, it shows here.
          </p>
        ) : (
          items.map((a) => {
            const { title, body } = alertText(a, terms, timeZone);
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => onOpen(a)}
                className={cn(
                  "block w-full border-b border-border px-3 py-2.5 text-left last:border-0 hover:bg-muted/50",
                  a.unread && "bg-amber-500/5"
                )}
              >
                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                  {a.unread && <span className="size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />}
                  {title}
                </p>
                <p className="mt-0.5 line-clamp-2 text-xs text-pretty text-muted-foreground">{body}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{relativeTime(a.occurred_at)}</p>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
