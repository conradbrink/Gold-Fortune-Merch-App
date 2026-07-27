"use client";

import { useMemo, useState } from "react";
import { Star, Plus, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import {
  assignStore,
  clearPrimary,
  setPrimary,
  unassignStore,
  type Assignment,
  type RepSummary,
  type StoreOption,
} from "@/lib/representatives";

/**
 * Assign stores to one rep.
 *
 * A store may have several reps but only one primary — `store_assignments`
 * enforces that with a partial unique index, so promoting demotes the previous
 * holder rather than failing.
 */
export function AssignStoresDialog({
  rep,
  stores,
  assignments,
  orgId,
  open,
  onOpenChange,
  onChanged,
}: {
  rep: RepSummary | null;
  stores: StoreOption[];
  assignments: Assignment[];
  orgId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [query, setQuery] = useState("");
  const [busyStore, setBusyStore] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byStore = useMemo(() => {
    const mine = new Map<string, Assignment>();
    for (const a of assignments) {
      if (rep && a.rep_id === rep.rep_id) mine.set(a.store_id, a);
    }
    return mine;
  }, [assignments, rep]);

  // Who else already covers a store, so reassigning isn't done blind.
  const otherReps = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of assignments) {
      if (!rep || a.rep_id !== rep.rep_id) {
        counts.set(a.store_id, (counts.get(a.store_id) ?? 0) + 1);
      }
    }
    return counts;
  }, [assignments, rep]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return stores;
    return stores.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.city ?? "").toLowerCase().includes(q)
    );
  }, [stores, query]);

  async function run(storeId: string, fn: () => Promise<void>) {
    setBusyStore(storeId);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyStore(null);
    }
  }

  const supabase = createClient();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{rep?.rep_name ?? "Rep"}&rsquo;s stores</DialogTitle>
          <DialogDescription>
            A store can have several reps, but only one primary owner.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {!orgId && (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            Could not determine your organisation — assignments are disabled.
          </p>
        )}

        <Input
          placeholder="Search stores…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <ul className="divide-y divide-border">
          {filtered.length === 0 && (
            <li className="py-6 text-center text-sm text-muted-foreground">
              No stores match &ldquo;{query}&rdquo;.
            </li>
          )}
          {filtered.map((s) => {
            const mine = byStore.get(s.id);
            const others = otherReps.get(s.id) ?? 0;
            const busy = busyStore === s.id;
            return (
              <li key={s.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {s.name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {s.city ?? "—"}
                    {others > 0 && (
                      <span className="ml-2">
                        · also covered by {others} other{others === 1 ? "" : "s"}
                      </span>
                    )}
                  </p>
                </div>

                {mine?.is_primary && (
                  <Badge variant="secondary" className="shrink-0">
                    Primary
                  </Badge>
                )}

                {mine && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    title={mine.is_primary ? "Remove primary" : "Make primary"}
                    onClick={() =>
                      run(s.id, () =>
                        mine.is_primary
                          ? clearPrimary(supabase, mine.id)
                          : setPrimary(supabase, s.id, mine.id)
                      )
                    }
                  >
                    <Star
                      className={
                        mine.is_primary
                          ? "h-4 w-4 fill-current text-amber-500"
                          : "h-4 w-4 text-muted-foreground"
                      }
                    />
                  </Button>
                )}

                <Button
                  size="sm"
                  variant={mine ? "outline" : "default"}
                  disabled={busy || !orgId}
                  onClick={() =>
                    run(s.id, () =>
                      mine
                        ? unassignStore(supabase, mine.id)
                        : assignStore(supabase, orgId!, s.id, rep!.rep_id)
                    )
                  }
                >
                  {mine ? (
                    <>
                      <X className="mr-1 h-3.5 w-3.5" />
                      Remove
                    </>
                  ) : (
                    <>
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Assign
                    </>
                  )}
                </Button>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
