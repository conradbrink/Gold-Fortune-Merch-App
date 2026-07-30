"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { fetchOrgId } from "@/lib/representatives";
import {
  createTerritory,
  deleteTerritory,
  fetchSubStoreCounts,
  fetchTerritoryImpact,
  fetchTerritoryTree,
  renameTerritory,
  setTerritoryActive,
  type Territory,
  type TerritoryImpact,
  type TerritoryTree,
} from "@/lib/territories";

/**
 * The organisation's own sales geography.
 *
 * Presented as the tree it is rather than a flat table: a sub-territory only
 * means anything underneath its main, and a manager reading this is asking
 * "what is Gaborone divided into", not "list 47 rows".
 *
 * Writes are manager-only in RLS. A rep reaching this tab sees the structure
 * and gets a refusal on any change, which is the honest outcome — the tab is
 * not hidden, because knowing the shape of the estate is not privileged.
 */
export function TerritoriesPanel() {
  const supabase = createClient();

  const [tree, setTree] = useState<TerritoryTree[]>([]);
  const [subCounts, setSubCounts] = useState<Record<string, number>>({});
  const [orgId, setOrgId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Null = closed. `parent` null means a new main territory. */
  const [adding, setAdding] = useState<{ parent: Territory | null } | null>(null);
  const [newName, setNewName] = useState("");

  const [renaming, setRenaming] = useState<Territory | null>(null);
  const [renameTo, setRenameTo] = useState("");

  const [removing, setRemoving] = useState<Territory | null>(null);
  const [impact, setImpact] = useState<TerritoryImpact | null>(null);
  /** The territory whose impact fetch is the one still wanted. */
  const impactRequest = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, counts, org] = await Promise.all([
        fetchTerritoryTree(supabase),
        fetchSubStoreCounts(supabase),
        fetchOrgId(supabase),
      ]);
      setTree(t);
      setSubCounts(counts);
      setOrgId(org);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mount fetch — same reasoning as the sibling pages: the panel has nothing
  // external to synchronise with, the first render is the skeleton regardless,
  // and a lint-gated build should not break over it.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  /**
   * Opens the delete dialog and counts what the delete would take with it.
   *
   * Two things this must not do. It must not spin forever: `fetchTerritoryImpact`
   * throws on any refused query, and the call sites used to `await` it inside a
   * `() => void` prop, so the rejection went nowhere and the dialog sat on
   * "Checking what this would affect…". And it must not show one territory's
   * numbers under another's name — open Gaborone, change your mind, open Kasane,
   * and a late reply would have populated the dialog with Gaborone's counts,
   * which is what the manager would then click Delete against.
   */
  async function beginRemove(territory: Territory) {
    setError(null);
    setImpact(null);
    setRemoving(territory);
    impactRequest.current = territory.id;
    try {
      const next = await fetchTerritoryImpact(supabase, territory);
      if (impactRequest.current !== territory.id) return;
      setImpact(next);
    } catch (e) {
      if (impactRequest.current !== territory.id) return;
      // Close the dialog: it has nothing to show, and the banner behind it
      // says why.
      setRemoving(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Territories</h2>
          <p className="text-sm text-muted-foreground">
            {tree.length} main {tree.length === 1 ? "territory" : "territories"} ·
            a main territory is a town or region, divided into sub-territories.
          </p>
        </div>
        <Button
          className="gap-1.5"
          onClick={() => {
            setNewName("");
            setAdding({ parent: null });
          }}
        >
          <Plus className="h-4 w-4" />
          Add main territory
        </Button>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="divide-y divide-border rounded-md border border-border">
        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-9 animate-pulse rounded bg-muted/50" />
            ))}
          </div>
        ) : tree.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No territories yet. Add the first town or region above.
          </p>
        ) : (
          tree.map(({ main, subs, stores }) => {
            const open = expanded.has(main.id);
            return (
              <div key={main.id}>
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => toggle(main.id)}
                    aria-label={open ? "Collapse" : "Expand"}
                    aria-expanded={open}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    {open ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => toggle(main.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span
                      className={
                        main.active ? "text-sm font-medium" : "text-sm text-muted-foreground"
                      }
                    >
                      {main.name}
                    </span>
                    {!main.active && (
                      <Badge variant="outline" className="ml-2 font-normal">
                        Inactive
                      </Badge>
                    )}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {stores} {stores === 1 ? "store" : "stores"}
                      {subs.length > 0 &&
                        ` · ${subs.length} sub-${subs.length === 1 ? "territory" : "territories"}`}
                    </span>
                  </button>

                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5"
                    onClick={() => {
                      setNewName("");
                      setAdding({ parent: main });
                      setExpanded((p) => new Set(p).add(main.id));
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Sub
                  </Button>
                  <RowActions
                    territory={main}
                    busy={busy}
                    onRename={() => {
                      setRenameTo(main.name);
                      setRenaming(main);
                    }}
                    onToggleActive={() =>
                      run(() => setTerritoryActive(supabase, main.id, !main.active))
                    }
                    onRemove={() => beginRemove(main)}
                  />
                </div>

                {open && (
                  <ul className="border-t border-border bg-muted/20">
                    {subs.length === 0 ? (
                      <li className="px-3 py-2 pl-11 text-sm text-muted-foreground">
                        No sub-territories. {main.name} is covered as one area.
                      </li>
                    ) : (
                      subs.map((sub) => (
                        <li
                          key={sub.id}
                          className="flex items-center gap-2 px-3 py-2 pl-11"
                        >
                          <span className="min-w-0 flex-1">
                            <span
                              className={
                                sub.active
                                  ? "text-sm text-foreground"
                                  : "text-sm text-muted-foreground"
                              }
                            >
                              {sub.name}
                            </span>
                            {!sub.active && (
                              <Badge variant="outline" className="ml-2 font-normal">
                                Inactive
                              </Badge>
                            )}
                            <span className="ml-2 text-xs text-muted-foreground">
                              {subCounts[sub.id] ?? 0}{" "}
                              {(subCounts[sub.id] ?? 0) === 1 ? "store" : "stores"}
                            </span>
                          </span>
                          <RowActions
                            territory={sub}
                            busy={busy}
                            onRename={() => {
                              setRenameTo(sub.name);
                              setRenaming(sub);
                            }}
                            onToggleActive={() =>
                              run(() => setTerritoryActive(supabase, sub.id, !sub.active))
                            }
                            onRemove={() => beginRemove(sub)}
                          />
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Add ------------------------------------------------------------ */}
      <Dialog
        open={adding !== null}
        onOpenChange={(o) => !o && setAdding(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {adding?.parent
                ? `Add a sub-territory in ${adding.parent.name}`
                : "Add a main territory"}
            </DialogTitle>
            <DialogDescription>
              {adding?.parent
                ? "A part of this territory a rep can be given on its own."
                : "Normally a city, town or region."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="territory-name">Name</Label>
            <Input
              id="territory-name"
              value={newName}
              placeholder={adding?.parent ? "Gaborone North" : "Gaborone"}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              disabled={busy || !newName.trim() || !orgId}
              onClick={async () => {
                if (!orgId || !adding) return;
                const ok = await run(async () => {
                  await createTerritory(
                    supabase,
                    orgId,
                    newName,
                    adding.parent?.id ?? null
                  );
                });
                if (ok) setAdding(null);
              }}
            >
              {busy ? "Adding…" : "Add"}
            </Button>
            <Button variant="outline" onClick={() => setAdding(null)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename --------------------------------------------------------- */}
      <Dialog
        open={renaming !== null}
        onOpenChange={(o) => !o && setRenaming(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename {renaming?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="territory-rename">Name</Label>
            <Input
              id="territory-rename"
              value={renameTo}
              onChange={(e) => setRenameTo(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              disabled={busy || !renameTo.trim()}
              onClick={async () => {
                if (!renaming) return;
                const ok = await run(() =>
                  renameTerritory(supabase, renaming.id, renameTo)
                );
                if (ok) setRenaming(null);
              }}
            >
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button variant="outline" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete --------------------------------------------------------- */}
      <Dialog
        open={removing !== null}
        onOpenChange={(o) => {
          if (!o) {
            // Abandons any impact fetch still in flight, so its numbers cannot
            // arrive after the dialog has been dismissed.
            impactRequest.current = null;
            setRemoving(null);
            setImpact(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {removing?.name ?? "territory"}?</DialogTitle>
          </DialogHeader>

          {impact === null ? (
            <p className="text-sm text-muted-foreground">
              Checking what this would affect…
            </p>
          ) : (
            <div className="space-y-2 text-sm">
              {impact.stores > 0 ||
              impact.subTerritories > 0 ||
              impact.reps > 0 ||
              impact.upcomingRoutes > 0 ? (
                <>
                  <p className="flex items-start gap-1.5 text-foreground">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <span>Still in use:</span>
                  </p>
                  <ul className="ml-6 list-disc space-y-0.5 text-muted-foreground">
                    {impact.stores > 0 && (
                      <li>
                        {impact.stores} {impact.stores === 1 ? "store" : "stores"}
                      </li>
                    )}
                    {impact.subTerritories > 0 && (
                      <li>
                        {impact.subTerritories} sub-
                        {impact.subTerritories === 1 ? "territory" : "territories"}
                      </li>
                    )}
                    {impact.reps > 0 && (
                      <li>
                        {impact.reps} {impact.reps === 1 ? "rep" : "reps"} assigned
                      </li>
                    )}
                    {impact.upcomingRoutes > 0 && (
                      <li>
                        {impact.upcomingRoutes} scheduled{" "}
                        {impact.upcomingRoutes === 1 ? "visit" : "visits"} still to
                        come
                      </li>
                    )}
                  </ul>
                  <p className="text-muted-foreground">
                    Move the stores and sub-territories somewhere else first, or
                    deactivate this instead — that stops it being used for new
                    work and leaves everything already pointing at it alone.
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">
                  Nothing is using this territory, so it can be removed. This
                  cannot be undone.
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            {/* The same four counts the "Still in use" list above is built
                from. Gating on stores and sub-territories alone offered
                "Delete permanently" while the dialog was itself listing reps or
                scheduled visits — and unlike stores, `territory_reps` is ON
                DELETE CASCADE, so that delete would have gone through and taken
                the coverage with it silently. */}
            {impact &&
            impact.stores === 0 &&
            impact.subTerritories === 0 &&
            impact.reps === 0 &&
            impact.upcomingRoutes === 0 ? (
              <Button
                variant="destructive"
                disabled={busy}
                onClick={async () => {
                  if (!removing) return;
                  const ok = await run(() => deleteTerritory(supabase, removing.id));
                  if (ok) {
                    setRemoving(null);
                    setImpact(null);
                  }
                }}
              >
                {busy ? "Deleting…" : "Delete permanently"}
              </Button>
            ) : (
              impact && (
                <Button
                  disabled={busy || !removing}
                  onClick={async () => {
                    if (!removing) return;
                    const ok = await run(() =>
                      setTerritoryActive(supabase, removing.id, false)
                    );
                    if (ok) {
                      setRemoving(null);
                      setImpact(null);
                    }
                  }}
                >
                  {busy ? "Working…" : "Deactivate instead"}
                </Button>
              )
            )}
            <Button
              variant="outline"
              onClick={() => {
                setRemoving(null);
                setImpact(null);
              }}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RowActions({
  territory,
  busy,
  onRename,
  onToggleActive,
  onRemove,
}: {
  territory: Territory;
  busy: boolean;
  onRename: () => void;
  onToggleActive: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        size="icon"
        variant="ghost"
        disabled={busy}
        title="Rename"
        aria-label={`Rename ${territory.name}`}
        onClick={onRename}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={onToggleActive}
      >
        {territory.active ? "Deactivate" : "Reactivate"}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        disabled={busy}
        title="Delete"
        aria-label={`Delete ${territory.name}`}
        onClick={onRemove}
      >
        <Trash2 className="h-3.5 w-3.5 text-destructive" />
      </Button>
    </div>
  );
}
