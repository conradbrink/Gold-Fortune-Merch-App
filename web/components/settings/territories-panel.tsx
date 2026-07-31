"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { TerritoryStores } from "@/components/settings/territory-stores";
import {
  createTerritory,
  deleteTerritory,
  DRAG_TYPES,
  fetchTerritoryStoreCounts,
  fetchTerritoryImpact,
  fetchTerritoryTree,
  moveTerritory,
  renameTerritory,
  setStoreTerritory,
  setTerritoryActive,
  type Territory,
  type TerritoryImpact,
  type CountryTree,
  type TerritoryLevel,
} from "@/lib/territories";

/**
 * The organisation's own sales geography.
 *
 * Country → region → territory, and a store sits in a territory. A region is
 * how the estate is run ("Greater Gaborone"); a territory is the round a rep
 * drives ("Palapye"). A store is only ever in one place.
 *
 * Presented as the tree it is rather than a flat table: a territory only means
 * anything underneath its region, and a manager reading this is asking "what is
 * Greater Gaborone made of", not "list 27 rows".
 *
 * Writes are manager-only in RLS. A rep reaching this tab sees the structure
 * and gets a refusal on any change, which is the honest outcome — the tab is
 * not hidden, because knowing the shape of the estate is not privileged.
 */
export function TerritoriesPanel() {
  const supabase = createClient();

  const [tree, setTree] = useState<CountryTree[]>([]);
  const [territoryCounts, setTerritoryCounts] = useState<Record<string, number>>({});
  const [orgId, setOrgId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Null = closed. `level` says what is being added; a country has no parent. */
  const [adding, setAdding] = useState<{
    parent: Territory | null;
    level: TerritoryLevel;
  } | null>(null);
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
        fetchTerritoryStoreCounts(supabase),
        fetchOrgId(supabase),
      ]);
      setTree(t);
      setTerritoryCounts(counts);
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

  /**
   * Drag a store into a territory, or a territory into a region.
   *
   * The kind travels as the MIME type rather than in a shared variable,
   * because the store rows are rendered by `TerritoryStores` and the drop
   * targets by this component. `dataTransfer` is the only channel both sides
   * share, and during `dragover` a browser will disclose the *types* on offer
   * but not their values — so the type has to be what says whether a drop is
   * allowed, or every row would light up for every drag.
   */
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  function allowDrop(
    e: React.DragEvent,
    accepts: "store" | "territory",
    targetId: string
  ) {
    if (!e.dataTransfer.types.includes(DRAG_TYPES[accepts])) return;
    // Only now: preventDefault is what marks this element as a valid target,
    // so calling it unconditionally would accept a territory onto a territory.
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dropTarget !== targetId) setDropTarget(targetId);
  }

  async function handleDrop(
    e: React.DragEvent,
    accepts: "store" | "territory",
    targetId: string
  ) {
    const id = e.dataTransfer.getData(DRAG_TYPES[accepts]);
    if (!id) return;
    e.preventDefault();
    // Territories nest, so a drop on a territory would otherwise also fire on
    // the region behind it.
    e.stopPropagation();
    setDropTarget(null);
    if (id === targetId) return;

    await run(() =>
      accepts === "store"
        ? setStoreTerritory(supabase, id, targetId)
        : moveTerritory(supabase, id, targetId)
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Territories</h2>
          <p className="text-sm text-muted-foreground">
            {tree.length} {tree.length === 1 ? "country" : "countries"} ·
            a country holds regions, a region holds territories, and the stores
            sit in a territory. Drag a store into another territory, or a
            territory into another region.
          </p>
        </div>
        <Button
          className="gap-1.5"
          onClick={() => {
            setNewName("");
            setAdding({ parent: null, level: "country" });
          }}
        >
          <Plus className="h-4 w-4" />
          Add country
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
            No countries yet. Add the first one above.
          </p>
        ) : (
          tree.map(({ country, regions, stores: countryStores }) => {
            const countryOpen = expanded.has(country.id);
            return (
              <div key={country.id}>
                <div className="flex items-center gap-2 bg-muted/40 px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => toggle(country.id)}
                    aria-label={countryOpen ? "Collapse" : "Expand"}
                    aria-expanded={countryOpen}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    {countryOpen ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => toggle(country.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span
                      className={
                        country.active
                          ? "text-sm font-semibold"
                          : "text-sm font-semibold text-muted-foreground"
                      }
                    >
                      {country.name}
                    </span>
                    {!country.active && (
                      <Badge variant="outline" className="ml-2 font-normal">
                        Inactive
                      </Badge>
                    )}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {regions.length}{" "}
                      {regions.length === 1 ? "region" : "regions"}
                      {" · "}
                      {countryStores} {countryStores === 1 ? "store" : "stores"}
                    </span>
                  </button>

                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5"
                    onClick={() => {
                      setNewName("");
                      setAdding({ parent: country, level: "region" });
                      setExpanded((p) => new Set(p).add(country.id));
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Region
                  </Button>
                  <RowActions
                    territory={country}
                    busy={busy}
                    onRename={() => {
                      setRenameTo(country.name);
                      setRenaming(country);
                    }}
                    onToggleActive={() =>
                      run(() => setTerritoryActive(supabase, country.id, !country.active))
                    }
                    onRemove={() => beginRemove(country)}
                  />
                </div>

                {countryOpen && regions.length === 0 && (
                  <p className="border-t border-border px-3 py-2 pl-11 text-sm text-muted-foreground">
                    No regions in {country.name} yet.
                  </p>
                )}

                {countryOpen &&
                  regions.map(({ region, territories, stores }) => {
                    const regionOpen = expanded.has(region.id);
                    return (
                      <div
                        key={region.id}
                        className={`border-t border-border pl-4 ${
                          dropTarget === region.id ? "bg-primary/10" : ""
                        }`}
                        onDragOver={(e) => allowDrop(e, "territory", region.id)}
                        onDragLeave={() => setDropTarget(null)}
                        onDrop={(e) => handleDrop(e, "territory", region.id)}
                      >
                        <div className="flex items-center gap-2 px-3 py-2.5">
                          <button
                            type="button"
                            onClick={() => toggle(region.id)}
                            aria-label={regionOpen ? "Collapse" : "Expand"}
                            aria-expanded={regionOpen}
                            className="shrink-0 text-muted-foreground hover:text-foreground"
                          >
                            {regionOpen ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => toggle(region.id)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <span
                              className={
                                region.active
                                  ? "text-sm font-medium"
                                  : "text-sm text-muted-foreground"
                              }
                            >
                              {region.name}
                            </span>
                            {!region.active && (
                              <Badge variant="outline" className="ml-2 font-normal">
                                Inactive
                              </Badge>
                            )}
                            <span className="ml-2 text-xs text-muted-foreground">
                              {territories.length}{" "}
                              {territories.length === 1 ? "territory" : "territories"}
                              {" · "}
                              {stores} {stores === 1 ? "store" : "stores"}
                            </span>
                          </button>

                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1.5"
                            onClick={() => {
                              setNewName("");
                              setAdding({ parent: region, level: "territory" });
                              setExpanded((p) => new Set(p).add(region.id));
                            }}
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Territory
                          </Button>
                          <RowActions
                            territory={region}
                            busy={busy}
                            onRename={() => {
                              setRenameTo(region.name);
                              setRenaming(region);
                            }}
                            onToggleActive={() =>
                              run(() =>
                                setTerritoryActive(supabase, region.id, !region.active)
                              )
                            }
                            onRemove={() => beginRemove(region)}
                          />
                        </div>

                        {regionOpen && territories.length === 0 && (
                          <p className="border-t border-border px-3 py-2 pl-11 text-sm text-muted-foreground">
                            No territories in {region.name} yet.
                          </p>
                        )}

                        {regionOpen &&
                          territories.map((territory) => {
                            const open = expanded.has(territory.id);
                            const count = territoryCounts[territory.id] ?? 0;
                            return (
                              <div
                                key={territory.id}
                                className={`border-t border-border pl-4 ${
                                  dropTarget === territory.id ? "bg-primary/10" : ""
                                }`}
                                onDragOver={(e) => allowDrop(e, "store", territory.id)}
                                onDragLeave={() => setDropTarget(null)}
                                onDrop={(e) => handleDrop(e, "store", territory.id)}
                              >
                                <div
                                  className="flex items-center gap-2 px-3 py-2"
                                  draggable={!busy}
                                  onDragStart={(e) => {
                                    e.dataTransfer.setData(
                                      DRAG_TYPES.territory,
                                      territory.id
                                    );
                                    e.dataTransfer.effectAllowed = "move";
                                  }}
                                  onDragEnd={() => setDropTarget(null)}
                                >
                                  <button
                                    type="button"
                                    onClick={() => toggle(territory.id)}
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
                                  <GripVertical
                                    className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground/60"
                                    aria-hidden
                                  />

                                  <button
                                    type="button"
                                    onClick={() => toggle(territory.id)}
                                    className="min-w-0 flex-1 text-left"
                                  >
                                    <span
                                      className={
                                        territory.active
                                          ? "text-sm text-foreground"
                                          : "text-sm text-muted-foreground"
                                      }
                                    >
                                      {territory.name}
                                    </span>
                                    {!territory.active && (
                                      <Badge variant="outline" className="ml-2 font-normal">
                                        Inactive
                                      </Badge>
                                    )}
                                    <span className="ml-2 text-xs text-muted-foreground">
                                      {count} {count === 1 ? "store" : "stores"}
                                    </span>
                                  </button>

                                  <RowActions
                                    territory={territory}
                                    busy={busy}
                                    onRename={() => {
                                      setRenameTo(territory.name);
                                      setRenaming(territory);
                                    }}
                                    onToggleActive={() =>
                                      run(() =>
                                        setTerritoryActive(
                                          supabase,
                                          territory.id,
                                          !territory.active
                                        )
                                      )
                                    }
                                    onRemove={() => beginRemove(territory)}
                                  />
                                </div>

                                {/* Mounted only while expanded, so each territory's
                                    list is fetched when it is actually looked at
                                    rather than all 209 up front. */}
                                {open && (
                                  <TerritoryStores
                                    territory={territory}
                                    onChanged={load}
                                  />
                                )}
                              </div>
                            );
                          })}
                      </div>
                    );
                  })}
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
              {adding?.level === "country"
                ? "Add a country"
                : adding?.level === "region"
                  ? `Add a region in ${adding.parent?.name}`
                  : `Add a territory in ${adding?.parent?.name}`}
            </DialogTitle>
            <DialogDescription>
              {adding?.level === "country"
                ? "The top level. Everything else sits inside one."
                : adding?.level === "region"
                  ? "A group of territories, the way the country is split for selling."
                  : "The round a rep drives — normally a town. Stores go in these."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="territory-name">Name</Label>
            <Input
              id="territory-name"
              value={newName}
              placeholder={
                adding?.level === "country"
                  ? "Botswana"
                  : adding?.level === "region"
                    ? "Central Botswana"
                    : "Palapye"
              }
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
                    adding.parent?.id ?? null,
                    adding.level
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
              impact.children > 0 ||
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
                    {impact.children > 0 && (
                      <li>
                        {impact.children} sub-
                        {impact.children === 1 ? "territory" : "territories"}
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
            impact.children === 0 &&
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
                // The same abandonment `onOpenChange` performs. Escape and the
                // backdrop went through there and dropped the in-flight request;
                // this button did not, so a fetch started before Cancel could
                // still land and repopulate the dialog after it had been
                // dismissed — or worse, against the next territory opened.
                impactRequest.current = null;
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
  // One overflow menu rather than a row of buttons. Three controls per row, on
  // 47 mains plus their subs, made the list read as a wall of actions with the
  // names — the thing you are actually scanning — competing for attention.
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="icon"
            variant="ghost"
            disabled={busy}
            className="shrink-0"
            title={`Actions for ${territory.name}`}
            aria-label={`Actions for ${territory.name}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={onRename}>
          <Pencil className="h-3.5 w-3.5" />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onToggleActive}>
          {territory.active ? (
            <>
              <EyeOff className="h-3.5 w-3.5" />
              Deactivate
            </>
          ) : (
            <>
              <Eye className="h-3.5 w-3.5" />
              Reactivate
            </>
          )}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
