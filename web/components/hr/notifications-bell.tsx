"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import {
  fetchNotifications,
  markAllRead,
  markRead,
  relativeTime,
} from "@/lib/hr/notifications";
import { useHrLoad } from "@/lib/hr/use-load";
import type { HrNotification } from "@/lib/hr/types";
import { cn } from "@/lib/utils";

/**
 * The notification bell.
 *
 * A bell sat in this header once before as a bare icon with no handler behind
 * it, and was deliberately removed — "an advertisement for something that does
 * not exist", as the comment in `top-bar.tsx` put it. It is back only because
 * there is now something behind it.
 *
 * What it is: HR events that concern the signed-in person — a leave request to
 * decide, a decision on their own, a review ready to acknowledge, a case
 * waiting. Rows are written by database triggers and are readable only by their
 * recipient; nothing in the browser can create one.
 *
 * What it is not: real-time. It polls on mount and when the tab regains focus,
 * which is the right trade for a feed whose fastest-moving item is a leave
 * approval. A realtime subscription would hold a socket open on every page for
 * a handful of rows a day.
 */
export function NotificationsBell() {
  const supabase = createClient();
  const router = useRouter();
  const [items, setItems] = useState<HrNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await fetchNotifications(supabase, 20));
      setFailed(false);
    } catch {
      // A failed fetch hides the bell rather than showing a broken one. The
      // facts behind every notice are on the HR dashboard either way, so this
      // is a missing convenience and not a missing feature.
      setFailed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useHrLoad(load);

  // Polling, such as it is: refresh when the tab comes back rather than on a
  // timer. Somebody who left the dashboard open over lunch gets a current bell
  // when they return, and nobody's laptop wakes up to fetch twenty rows.
  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  // Close on an outside click. The panel is a plain popover rather than the
  // shared DropdownMenu because its rows are links with their own buttons, and
  // a menu that closes on any keypress fights that.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (failed) return null;

  const unread = items.filter((n) => !n.read_at).length;

  async function openItem(n: HrNotification) {
    setOpen(false);
    if (!n.read_at) {
      try {
        await markRead(supabase, n.id);
      } catch {
        /* Navigating matters more than the read flag. */
      }
    }
    await load();
    if (n.href) router.push(n.href);
  }

  return (
    <div className="relative" ref={panelRef}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-medium">Notifications</span>
            {unread > 0 && (
              <button
                type="button"
                className="text-xs text-muted-foreground underline"
                onClick={async () => {
                  try {
                    await markAllRead(supabase);
                    await load();
                  } catch {
                    /* Nothing to say; the list simply does not change. */
                  }
                }}
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                Nothing yet.
              </p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => openItem(n)}
                  className={cn(
                    "block w-full border-b border-border px-3 py-2.5 text-left last:border-0 hover:bg-muted/50",
                    !n.read_at && "bg-primary/5"
                  )}
                >
                  <p className="text-sm font-medium text-foreground">{n.title}</p>
                  {n.body && (
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {n.body}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {relativeTime(n.created_at)}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
