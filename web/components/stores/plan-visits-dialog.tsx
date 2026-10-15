"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { fetchRepsForOrder } from "@/lib/orders";
import { planVisits } from "@/lib/store-reorder";
import { lower, withArticle } from "@/lib/terms";
import { useTerms } from "@/lib/use-company-config";

/**
 * Puts stores due for an order on somebody's day: one person, one date, every
 * store chosen. The stops are manual ones, as the schedule's "Add stop" makes,
 * so the call cycle leaves them alone; a store already on that day is left as
 * it is.
 */
export function PlanVisitsDialog({
  orgId,
  stores,
  open,
  onOpenChange,
  tomorrow,
  lastDay,
  onPlanned,
}: {
  orgId: string;
  stores: { id: string; name: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The company's tomorrow, YYYY-MM-DD: the first day offered. */
  tomorrow: string;
  /** The last day offered: as far ahead as the page looks for planned visits. */
  lastDay: string;
  onPlanned: (added: number, already: number, day: string, repName: string) => void;
}) {
  const t = useTerms();
  const [reps, setReps] = useState<{ id: string; full_name: string }[]>([]);
  const [repId, setRepId] = useState("");
  const [day, setDay] = useState(tomorrow);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // Each time it opens: the company's tomorrow, as it is now.
    if (open) setDay(tomorrow);
  }, [open, tomorrow]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    // Once: the people do not change between one store and the next.
    if (!open || reps.length > 0) return;
    let stale = false;
    fetchRepsForOrder(createClient())
      .then((r) => {
        if (!stale) setReps(r);
      })
      .catch((e: unknown) => {
        if (!stale) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      stale = true;
    };
  }, [open, reps.length]);

  // The picker's min and max only limit the calendar; a typed date is checked
  // here, so a visit is never planned in the past or beyond what the page can
  // show as planned.
  const dayOk = day >= tomorrow && day <= lastDay;

  async function save() {
    if (!repId || !dayOk) return;
    setSaving(true);
    setError(null);
    try {
      const { added, already } = await planVisits(createClient(), orgId, repId, stores.map((s) => s.id), day);
      onPlanned(added, already, day, reps.find((r) => r.id === repId)?.full_name ?? "");
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const n = stores.length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {n === 1 ? `Plan a ${lower(t.job.one)} to ${stores[0]?.name}` : `Plan ${lower(t.job.many)} to ${n} ${lower(t.site.many)}`}
          </DialogTitle>
          <DialogDescription>
            They go on that person&apos;s day after the {lower(t.site.many)} already there, and show on their phone that
            morning.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="plan-rep">Who goes</Label>
            <NativeSelect id="plan-rep" value={repId} onChange={(e) => setRepId(e.target.value)}>
              <option value="" disabled>
                Choose {withArticle(t, "staff")}
              </option>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.full_name || `Unnamed ${lower(t.staff.one)}`}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-day">On</Label>
            <Input
              id="plan-day"
              type="date"
              className="w-44"
              min={tomorrow}
              max={lastDay}
              value={day}
              aria-describedby="plan-day-help"
              onChange={(e) => setDay(e.target.value)}
            />
            <p id="plan-day-help" className={`text-xs ${dayOk ? "text-muted-foreground" : "text-destructive"}`}>
              Choose a day from tomorrow up to two weeks ahead.
            </p>
          </div>
          {n > 1 && (
            <p className="text-xs text-muted-foreground">
              {stores
                .slice(0, 6)
                .map((s) => s.name)
                .join(", ")}
              {n > 6 ? ` and ${n - 6} more` : ""}.
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving || !repId || !dayOk || n === 0}>
            {saving ? "Planning…" : n === 1 ? `Plan the ${lower(t.job.one)}` : `Plan ${n} ${lower(t.job.many)}`}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
