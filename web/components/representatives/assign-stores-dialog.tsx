"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { createClient } from "@/lib/supabase/client";
import {
  assignStore,
  setRepActive,
  unassignStore,
  updateRep,
  type Assignment,
  type RepSummary,
  type StoreOption,
} from "@/lib/representatives";

/**
 * Assign stores to one rep, grouped by retail chain.
 *
 * Chains are the unit a merchandising manager thinks in ("give Nancy the Target
 * estate"), and a flat list stops working the moment a chain has more than a
 * handful of branches. Groups collapse by default; any group the rep already
 * covers starts expanded so their current patch is visible without hunting.
 *
 * A store may be covered by several reps.
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyStore, setBusyStore] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [savingDetails, setSavingDetails] = useState(false);
  const [savedDetails, setSavedDetails] = useState(false);

  const supabase = createClient();

  /** This rep's assignments, by store. */
  const mineByStore = useMemo(() => {
    const m = new Map<string, Assignment>();
    for (const a of assignments) {
      if (rep && a.rep_id === rep.rep_id) m.set(a.store_id, a);
    }
    return m;
  }, [assignments, rep]);

  /** How many *other* reps cover each store, so reassigning isn't done blind. */
  const otherCover = useMemo(() => {
    const c = new Map<string, number>();
    for (const a of assignments) {
      if (!rep || a.rep_id !== rep.rep_id) {
        c.set(a.store_id, (c.get(a.store_id) ?? 0) + 1);
      }
    }
    return c;
  }, [assignments, rep]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matching = q
      ? stores.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            (s.city ?? "").toLowerCase().includes(q) ||
            (s.group_name ?? "").toLowerCase().includes(q)
        )
      : stores;

    const map = new Map<string, { name: string; stores: StoreOption[] }>();
    for (const s of matching) {
      // Stores with no group still need a home, or they vanish from the UI.
      const key = s.group_id ?? "__ungrouped__";
      const name = s.group_name ?? "Ungrouped";
      if (!map.has(key)) map.set(key, { name, stores: [] });
      map.get(key)!.stores.push(s);
    }
    return [...map.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [stores, query]);

  useEffect(() => {
    if (!open || !rep) return;
    setPhone(rep.phone ?? "");
    setJobTitle(rep.job_title ?? "");
    setSavedDetails(false);
  }, [open, rep]);

  // Open the groups this rep already covers; searching opens everything so
  // matches are never hidden behind a collapsed header.
  useEffect(() => {
    if (!open) return;
    if (query.trim()) {
      setExpanded(new Set(groups.map((g) => g.key)));
      return;
    }
    const covered = new Set<string>();
    for (const s of stores) {
      if (mineByStore.has(s.id)) covered.add(s.group_id ?? "__ungrouped__");
    }
    setExpanded(covered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rep?.rep_id, query]);

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

  function toggleGroup(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{rep?.rep_name ?? "Rep"}</DialogTitle>
          <DialogDescription>
            Tick a store to assign it to this rep. A store can be covered by
            more than one rep.
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

        <div className="space-y-3 rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-foreground">Details</p>
            {rep && !rep.is_active && (
              <Badge variant="destructive">Deactivated</Badge>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rep-phone">Phone</Label>
              <Input
                id="rep-phone"
                value={phone}
                placeholder="+267 71 000 000"
                onChange={(e) => {
                  setPhone(e.target.value);
                  setSavedDetails(false);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rep-title">Job title</Label>
              <Input
                id="rep-title"
                value={jobTitle}
                placeholder="Field merchandiser"
                onChange={(e) => {
                  setJobTitle(e.target.value);
                  setSavedDetails(false);
                }}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {rep?.email ?? "—"}
            {rep?.joined_at &&
              ` · joined ${new Date(rep.joined_at).toLocaleDateString()}`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={savingDetails || !rep}
              onClick={async () => {
                if (!rep) return;
                setSavingDetails(true);
                setError(null);
                try {
                  await updateRep(supabase, rep.rep_id, {
                    phone: phone.trim() || null,
                    job_title: jobTitle.trim() || null,
                  });
                  setSavedDetails(true);
                  onChanged();
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setSavingDetails(false);
                }
              }}
            >
              {savingDetails ? "Saving…" : savedDetails ? "Saved" : "Save details"}
            </Button>
            {rep && (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  setError(null);
                  try {
                    await setRepActive(supabase, rep.rep_id, !rep.is_active);
                    onChanged();
                    onOpenChange(false);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  }
                }}
              >
                {rep.is_active ? "Deactivate rep" : "Reactivate rep"}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Deactivating keeps their visit history — it only stops new work being
            assigned.
          </p>
        </div>

        <Input
          placeholder="Search chains, stores or cities…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="divide-y divide-border rounded-md border border-border">
          {groups.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No stores match &ldquo;{query}&rdquo;.
            </p>
          )}

          {groups.map((g) => {
            const isOpen = expanded.has(g.key);
            const assignedHere = g.stores.filter((s) =>
              mineByStore.has(s.id)
            ).length;

            return (
              <div key={g.key}>
                <button
                  type="button"
                  onClick={() => toggleGroup(g.key)}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/50"
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="flex-1 text-sm font-medium text-foreground">
                    {g.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {g.stores.length} {g.stores.length === 1 ? "store" : "stores"}
                  </span>
                  {assignedHere > 0 && (
                    <Badge variant="secondary" className="shrink-0">
                      {assignedHere} assigned
                    </Badge>
                  )}
                </button>

                {isOpen && (
                  <ul className="border-t border-border bg-muted/20">
                    {g.stores.map((s) => {
                      const mine = mineByStore.get(s.id);
                      const others = otherCover.get(s.id) ?? 0;
                      const busy = busyStore === s.id;
                      return (
                        <li
                          key={s.id}
                          className="flex items-center gap-3 px-3 py-2 pl-9"
                        >
                          <Checkbox
                            checked={Boolean(mine)}
                            disabled={busy || !orgId}
                            aria-label={`Assign ${s.name}`}
                            onCheckedChange={() =>
                              run(s.id, () =>
                                mine
                                  ? unassignStore(supabase, mine.id)
                                  : assignStore(supabase, orgId!, s.id, rep!.rep_id)
                              )
                            }
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-foreground">
                              {s.name}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {s.city ?? "—"}
                              {others > 0 && (
                                <span className="ml-1.5">
                                  · also covered by {others} other
                                  {others === 1 ? "" : "s"}
                                </span>
                              )}
                            </p>
                          </div>

                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
