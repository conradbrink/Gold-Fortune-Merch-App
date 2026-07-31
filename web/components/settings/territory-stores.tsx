"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GripVertical, MoreHorizontal, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import {
  DRAG_TYPES,
  fetchTerritoryStores,
  searchStoresOutside,
  setStoreTerritory,
  type Territory,
  type TerritoryStore,
} from "@/lib/territories";

/**
 * The stores inside one territory, and the controls to move them.
 *
 * The Territories page could say a territory held 75 stores and gave no way to
 * see which, or to put a store into one — the only path was the bulk action in
 * Schedule → Coverage, which is about *rep* coverage and is not where anybody
 * looks to answer "what is in Gaborone?".
 *
 * Loaded when a territory is expanded, not with the page: 209 stores across 27
 * territories, and fetching all of them to render counts is the mistake the
 * dashboard RPCs exist to undo.
 */
export function TerritoryStores({
  territory,
  onChanged,
}: {
  territory: Territory;
  /** Refreshes the counts on the row above, which this changes. */
  onChanged: () => void;
}) {
  const supabase = createClient();

  const [stores, setStores] = useState<TerritoryStore[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  /** Store ids with a move in flight, so a row cannot be double-submitted. */
  const [moving, setMoving] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStores(await fetchTerritoryStores(supabase, territory.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStores(null);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [territory.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function move(store: TerritoryStore, territoryId: string | null) {
    setMoving((prev) => new Set(prev).add(store.id));
    setError(null);
    try {
      await setStoreTerritory(supabase, store.id, territoryId);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMoving((prev) => {
        const next = new Set(prev);
        next.delete(store.id);
        return next;
      });
    }
  }

  const visible = (stores ?? []).filter((s) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return (
      s.name.toLowerCase().includes(q) ||
      (s.city ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="border-t border-border bg-background/40 px-3 py-3 pl-11">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Stores in {territory.name}
        </h4>
        <div className="flex items-center gap-2">
          {(stores?.length ?? 0) > 8 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter these stores"
                className="h-8 w-48 pl-7 text-sm"
                aria-label={`Filter stores in ${territory.name}`}
              />
            </div>
          )}
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" />
            Add stores
          </Button>
        </div>
      </div>

      {error && (
        <p className="mb-2 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
          {error}
        </p>
      )}

      {loading ? (
        <p className="py-3 text-sm text-muted-foreground">Loading stores…</p>
      ) : stores === null ? (
        <Button size="sm" variant="outline" onClick={load}>
          Retry
        </Button>
      ) : stores.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">
          No stores in {territory.name} yet. Use <span className="font-medium">Add stores</span> to
          put some here.
        </p>
      ) : visible.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">
          No store here matches &ldquo;{filter.trim()}&rdquo;.
        </p>
      ) : (
        <ul className="space-y-1">
          {visible.map((store) => (
            <li
              key={store.id}
              // Draggable onto any territory row in the panel above. The id
              // travels under a store-specific MIME type so a region, which
              // only takes territories, does not light up for it.
              draggable={!moving.has(store.id)}
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPES.store, store.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5"
            >
              <GripVertical
                className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground/60"
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="text-sm text-foreground">{store.name}</span>
                {store.city && (
                  <span className="ml-2 text-xs text-muted-foreground">{store.city}</span>
                )}
              </span>

              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground"
                      disabled={moving.has(store.id)}
                      title={`Actions for ${store.name}`}
                      aria-label={`Actions for ${store.name}`}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => move(store, null)}
                  >
                    <X className="h-3.5 w-3.5" />
                    Remove from {territory.name}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}

      <AddStoresDialog
        open={adding}
        onOpenChange={setAdding}
        main={territory}
        onAdded={async () => {
          await load();
          onChanged();
        }}
      />
    </div>
  );
}

/**
 * Picks stores from anywhere in the estate and puts them in this territory.
 *
 * It searches *all* stores, not just unplaced ones. Every store here already has
 * a territory — they were seeded from the town — so a picker limited to the
 * unplaced would be permanently empty and read as broken. Each candidate shows
 * where it is now, because adding it is really a move.
 */
function AddStoresDialog({
  open,
  onOpenChange,
  main,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  main: Territory;
  onAdded: () => Promise<void>;
}) {
  const supabase = createClient();

  const [term, setTerm] = useState("");
  const [results, setResults] = useState<TerritoryStore[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(open);
  /** Newest search, so a slow one cannot land on top of a newer. */
  const runSeq = useRef(0);

  // Seeded once per opening, so reopening does not show the last search.
  if (open && !seeded) {
    setSeeded(true);
    setTerm("");
    setError(null);
  } else if (!open && seeded) {
    setSeeded(false);
  }

  useEffect(() => {
    if (!open) return;
    const runId = ++runSeq.current;
    // Debounced, so the spinner is set inside the timer rather than in the effect
    // body — which is also why this needs no suppression.
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const [found, territories] = await Promise.all([
          searchStoresOutside(supabase, main.id, term),
          supabase.from("territories").select("id, name"),
        ]);
        if (runId !== runSeq.current) return;
        setResults(found);
        setNames(
          Object.fromEntries(
            ((territories.data ?? []) as { id: string; name: string }[]).map((t) => [
              t.id,
              t.name,
            ])
          )
        );
        setError(null);
      } catch (e) {
        if (runId !== runSeq.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setResults([]);
      } finally {
        if (runId === runSeq.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, open, main.id]);

  async function add(store: TerritoryStore) {
    setBusy(true);
    setError(null);
    try {
      // Sub cleared: a sub belongs to one main, so carrying the old one across
      // is the disagreement `stores_enforce_territory` refuses anyway.
      await setStoreTerritory(supabase, store.id, main.id);
      setResults((prev) => prev.filter((s) => s.id !== store.id));
      await onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="grid-cols-1 max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add stores to {main.name}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Search the estate and add a store here. A store belongs to one territory,
          so adding it moves it out of the one it is in now.
        </p>

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="add-store-search">Search by name or town</Label>
          <Input
            id="add-store-search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="e.g. Choppies, or Kasane"
          />
        </div>

        {searching ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Searching…</p>
        ) : results.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {term.trim()
              ? `Nothing outside ${main.name} matches “${term.trim()}”.`
              : `Every store is already in ${main.name}.`}
          </p>
        ) : (
          <ul className="space-y-1">
            {results.map((store) => (
              <li
                key={store.id}
                className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">{store.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {store.city ?? "No town"}
                    {" · "}
                    {store.territory_id
                      ? `in ${names[store.territory_id] ?? "another territory"}`
                      : "no territory"}
                  </span>
                </span>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => add(store)}>
                  Add
                </Button>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
