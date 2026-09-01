"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Route } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import {
  applyStopOrder,
  fetchDaysToOrder,
  fetchRepStartAnchors,
  planStopOrder,
  type OrderSummary,
} from "@/lib/route-order";

/**
 * "Shorten the driving" — propose a shorter order within each scheduled day.
 *
 * Which day a shop belongs to and the order it is called on within that day are
 * separate decisions, and this makes only the second: no day, no rep and no
 * frequency changes, only the sequence the rep drives.
 *
 * Separate from generation on purpose — the days worth re-ordering are usually
 * ones that already exist, and a manager who has just moved a store between days
 * wants to re-order without creating anything.
 */
export function RouteOrderProposal({ weeks }: { weeks: number }) {
  const supabase = createClient();

  /** Non-null while a proposed stop order is waiting to be accepted. */
  const [order, setOrder] = useState<OrderSummary | null>(null);
  const [orderingBusy, setOrderingBusy] = useState<string | null>(null);
  const [orderDone, setOrderDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function proposeOrder() {
    setOrderingBusy("planning");
    setError(null);
    setOrderDone(null);
    try {
      const [anchors, { days, started }] = await Promise.all([
        fetchRepStartAnchors(supabase),
        fetchDaysToOrder(supabase, weeks),
      ]);
      const summary = planStopOrder(days, anchors);
      setOrder({ ...summary, started });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOrderingBusy(null);
    }
  }

  /** Distance over the days that would actually change, which is what is named. */
  const changedKm = useMemo(() => {
    const changed = (order?.days ?? []).filter((d) => d.changed);
    return {
      current: changed.reduce((n, d) => n + d.currentKm, 0),
      planned: changed.reduce((n, d) => n + d.plannedKm, 0),
    };
  }, [order]);

  async function acceptOrder() {
    if (!order) return;
    setOrderingBusy("applying");
    setError(null);
    try {
      const { daysWritten, stopsWritten } = await applyStopOrder(
        supabase,
        order.days
      );
      setOrderDone(
        daysWritten === 0
          ? "Every day was already in its shortest order."
          : `Re-ordered ${stopsWritten} stops across ${daysWritten} ${daysWritten === 1 ? "day" : "days"}.`
      );
      setOrder(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOrderingBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* Which day a shop belongs to, and the order it is called on within
          that day, are separate decisions — this one changes no day, no rep
          and no frequency, only the sequence the rep drives. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={proposeOrder}
          disabled={orderingBusy !== null}
        >
          <Route className="mr-1.5 h-3.5 w-3.5" />
          {orderingBusy === "planning"
            ? "Working out the order…"
            : "Shorten the driving"}
        </Button>
        <span className="text-xs text-muted-foreground">
          Re-orders the stops within each scheduled day, nearest first from
          where that rep usually starts. Nothing moves between days or reps.
        </span>
      </div>

      {orderDone && (
        <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-foreground">
          {orderDone}
        </p>
      )}

      {order && (
        <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
          {/* Distances over the days being changed, not every day planned.
              Unchanged days add the same figure to both totals and only
              dilute the percentage, and the sentence names the changed
              count — so the two halves described different sets of days. */}
          {order.days.filter((d) => d.changed).length === 0 ? (
            <p className="text-sm text-foreground">
              Every scheduled day is already in its shortest order. Nothing
              to change.
            </p>
          ) : (
            <>
              <p className="text-sm font-medium text-foreground">
                {order.days.filter((d) => d.changed).length} day
                {order.days.filter((d) => d.changed).length === 1
                  ? ""
                  : "s"}{" "}
                would be re-ordered:{" "}
                <span className="tabular-nums">
                  {Math.round(changedKm.current).toLocaleString("en-GB")} km
                </span>{" "}
                of driving becomes{" "}
                <span className="tabular-nums">
                  {Math.round(changedKm.planned).toLocaleString("en-GB")} km
                </span>
                {/* Only claimed when it is true. A day whose anchor leg
                    costs more than its inter-stop saving can come out
                    longer, and "-4% less" is not a sentence. */}
                {changedKm.current > 0 && changedKm.planned < changedKm.current && (
                  <>
                    {" "}
                    &mdash;{" "}
                    <span className="font-semibold text-emerald-700 dark:text-emerald-500">
                      {Math.round(
                        (1 - changedKm.planned / changedKm.current) * 100
                      )}
                      % less
                    </span>
                  </>
                )}
                .
              </p>
              {/* Said once, plainly, rather than attached to every figure:
                  this is crow-flies distance and it is not a drive time. */}
              <p className="text-xs text-muted-foreground">
                Straight-line distance, counted from where each rep usually
                starts their day. Roads are longer, so treat this as the
                shape of the saving rather than the number of kilometres.
              </p>
            </>
          )}

          {order.started > 0 && (
            <p className="text-xs text-muted-foreground">
              {order.started} day
              {order.started === 1 ? " is" : "s are"} already underway and
              left alone — renumbering a round a rep has started would move
              the ground under them.
            </p>
          )}

          {order.skipped > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {order.skipped} day
              {order.skipped === 1 ? "" : "s"} could not be ordered: fewer
              than two of their stops have a location on file.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {order.days.some((d) => d.changed) && (
              <Button
                size="sm"
                onClick={acceptOrder}
                disabled={orderingBusy !== null}
              >
                {orderingBusy === "applying"
                  ? "Applying…"
                  : "Apply the new order"}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOrder(null)}
            >
              Discard
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
