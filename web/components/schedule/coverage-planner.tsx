"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { createClient } from "@/lib/supabase/client";
import {
  assignStore,
  unassignStore,
  type Assignment,
  type RepSummary,
} from "@/lib/representatives";
import {
  FREQUENCIES,
  WEEKDAYS,
  setAssignmentDay,
  setStoreFrequency,
  type VisitFrequency,
} from "@/lib/schedule";
import {
  fetchTerritories,
  setStoreTerritory,
  type Territory,
} from "@/lib/territories";

/**
 * Coverage: who covers which stores, and how often.
 *
 * The per-store planner works well for correcting a handful of stores and not
 * at all for setting up an estate. On 209 stores it is 600-odd interactions —
 * a checkbox to assign a rep, a dropdown for the day, a dropdown for the
 * frequency, each one a round trip.
 *
 * This is the bulk half: filter to a set, select it, act on all of it at once.
 * Filtering is by town, chain, frequency and rep — attributes that come from
 * whatever the customer imported, so nothing here assumes this estate's
 * geography or its retail groups. Search covers the rest: an estate that names
 * stores "Hyper" and "Value Store" gets its size tiers from a text match
 * rather than from a column somebody has to invent.
 */

type StoreRow = {
  id: string;
  name: string;
  city: string | null;
  store_group_id: string | null;
  visit_frequency: VisitFrequency;
  territory_id: string | null;
  sub_territory_id: string | null;
};

type BulkAction =
  | "assign"
  | "unassign"
  | "frequency"
  | "day"
  | "clear-day"
  | "territory";

/**
 * The rep directory, the assignments and the org id come from the page.
 *
 * They were fetched here as well, and the page renders a rep table off exactly
 * the same three queries — so opening /representatives ran each of them twice,
 * and every coverage change ran them twice again. Passed down instead: one
 * fetch, one source of truth, and no window where the table above disagrees
 * with the planner below about who covers what.
 *
 * Stores, groups and territories stay local. The page's `fetchStores` selects
 * different columns, and a bulk action can change a store's frequency or
 * territory, so this still owns re-reading them.
 */
export function CoveragePlanner({
  reps,
  assignments,
  orgId,
  onChanged,
}: {
  reps: RepSummary[];
  assignments: Assignment[];
  orgId: string | null;
  /** Re-reads what the page owns — call after anything that writes. */
  onChanged?: () => void;
}) {
  const supabase = createClient();

  const [stores, setStores] = useState<StoreRow[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState<string | null>(null);

  const [territories, setTerritories] = useState<Territory[]>([]);

  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  /** "all" · "none" · "main:<id>" · "sub:<id>". Replaced the town filter:
      territories were seeded from the towns and are the thing that gets
      planned, so two near-identical dropdowns would just compete. */
  const [territoryFilter, setTerritoryFilter] = useState("all");
  const [freqFilter, setFreqFilter] = useState("all");
  const [repFilter, setRepFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [action, setAction] = useState<BulkAction>("assign");
  const [actionRep, setActionRep] = useState("");
  const [actionFreq, setActionFreq] = useState<VisitFrequency>("monthly");
  const [actionDay, setActionDay] = useState("1");
  const [actionMain, setActionMain] = useState("");

  /** Only what this component owns — the page fetches the rest. */
  async function load() {
    setLoading(true);
    try {
      const [storeRes, groupRes, territoryRows] = await Promise.all([
        supabase
          .from("stores")
          .select(
            "id, name, city, store_group_id, visit_frequency, territory_id, sub_territory_id"
          )
          .eq("active", true)
          .order("name"),
        supabase.from("store_groups").select("id, name").order("name"),
        fetchTerritories(supabase),
      ]);
      if (storeRes.error) throw new Error(storeRes.error.message);
      setStores((storeRes.data ?? []) as StoreRow[]);
      setGroups((groupRes.data ?? []) as { id: string; name: string }[]);
      setTerritories(territoryRows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Behind an async boundary so the loader's own `setLoading(true)`
    // is not a synchronous setState in the effect body. Same call, same
    // tick — `load` still starts before this returns.
    void (async () => {
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const repsByStore = useMemo(() => {
    const nameById: Record<string, string> = {};
    for (const r of reps) nameById[r.rep_id] = r.rep_name ?? "Unnamed";
    const out: Record<string, { assignmentId: string; repId: string; name: string }[]> = {};
    for (const a of assignments) {
      (out[a.store_id] ??= []).push({
        assignmentId: a.id,
        repId: a.rep_id,
        name: nameById[a.rep_id] ?? "Unknown",
      });
    }
    return out;
  }, [assignments, reps]);

  /** Regions, each with its territories — the shape the dropdown and the
      toolbar both read, so the nesting is derived once.
   *
   * Selected by `level`, never by `parent_id === null`: a parentless row is a
   * *country*, and a store goes in a territory, so filtering the old way would
   * offer countries as destinations and drop every real territory. */
  const tree = useMemo(() => {
    const regions = territories
      .filter((t) => t.level === "region")
      .sort((a, b) => a.name.localeCompare(b.name));
    return regions.map((region) => ({
      region,
      territories: territories
        .filter((t) => t.level === "territory" && t.parent_id === region.id)
        .sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }, [territories]);

  const territoryName = useMemo(() => {
    const byId: Record<string, string> = {};
    for (const t of territories) byId[t.id] = t.name;
    return byId;
  }, [territories]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stores.filter((s) => {
      if (groupFilter !== "all" && (s.store_group_id ?? "none") !== groupFilter) return false;
      if (territoryFilter !== "all") {
        // A region takes every store in every territory under it; a territory
        // takes its own.
        if (territoryFilter === "none") {
          if (s.territory_id !== null) return false;
        } else if (territoryFilter.startsWith("region:")) {
          const inRegion = tree
            .find((r) => r.region.id === territoryFilter.slice(7))
            ?.territories.map((t) => t.id);
          if (!inRegion || !s.territory_id || !inRegion.includes(s.territory_id)) {
            return false;
          }
        } else if (s.territory_id !== territoryFilter.slice(2)) {
          return false;
        }
      }
      if (freqFilter !== "all" && s.visit_frequency !== freqFilter) return false;
      if (repFilter !== "all") {
        const mine = repsByStore[s.id] ?? [];
        if (repFilter === "none" ? mine.length > 0 : !mine.some((m) => m.repId === repFilter)) {
          return false;
        }
      }
      if (q && !`${s.name} ${s.city ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
    // `tree` belongs here: filtering by region reads it to find which
    // territories are inside, so leaving it out would keep filtering against
    // the shape the page loaded with after a territory is dragged elsewhere.
  }, [stores, query, groupFilter, territoryFilter, freqFilter, repFilter, repsByStore, tree]);

  /** Selection is intersected with the filter so an action can never touch a
      store the manager cannot currently see. */
  const effective = useMemo(
    () => filtered.filter((s) => selected.has(s.id)),
    [filtered, selected]
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runBulk() {
    if (!orgId) {
      setError("Could not determine your organisation.");
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);
    setProgress(0);

    try {
      const targets = effective;
      // Batched rather than one request per store: 209 sequential writes is a
      // minute of waiting and 209 chances to fail half way. Kept modest — a
      // write was silently lost at 25 in flight during auto-spread testing.
      const BATCH = 8;
      for (let i = 0; i < targets.length; i += BATCH) {
        const slice = targets.slice(i, i + BATCH);
        await Promise.all(
          slice.map(async (s) => {
            const mine = repsByStore[s.id] ?? [];
            switch (action) {
              case "assign":
                if (!mine.some((m) => m.repId === actionRep)) {
                  await assignStore(supabase, orgId, s.id, actionRep);
                }
                return;
              case "unassign":
                await Promise.all(
                  mine
                    .filter((m) => actionRep === "" || m.repId === actionRep)
                    .map((m) => unassignStore(supabase, m.assignmentId))
                );
                return;
              case "frequency":
                await setStoreFrequency(supabase, s.id, actionFreq);
                return;
              case "day":
                // The day lives on the assignment, so a store nobody covers
                // has nowhere to put it — skipped rather than silently lost.
                // The week comes from the STORE's frequency, not the toolbar's
                // frequency picker, which belongs to a different action.
                await Promise.all(
                  mine.map((m) =>
                    setAssignmentDay(
                      supabase,
                      m.assignmentId,
                      Number(actionDay),
                      s.visit_frequency === "weekly" ? null : 1
                    )
                  )
                );
                return;
              case "clear-day":
                await Promise.all(
                  mine.map((m) => setAssignmentDay(supabase, m.assignmentId, null, null))
                );
                return;
              case "territory":
                // Places stores in a territory, and moves them out of whatever
                // they were in. Choosing a sub implies its main, because the
                // database refuses a sub without one.
                await setStoreTerritory(supabase, s.id, actionMain || null);
                return;
            }
          })
        );
        setProgress(Math.min(i + BATCH, targets.length));
      }

      await load();
      setSelected(new Set());
      setDone(`Updated ${targets.length} store${targets.length === 1 ? "" : "s"}.`);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const unassignedCount = stores.filter((s) => !(repsByStore[s.id]?.length)).length;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Users className="h-4 w-4" />
          Coverage
        </p>
        {unassignedCount > 0 && (
          <Badge variant="secondary">
            {unassignedCount} store{unassignedCount === 1 ? "" : "s"} with no rep
          </Badge>
        )}
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {done && (
        <p className="flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-foreground">
          <Check className="h-4 w-4" />
          {done}
        </p>
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Input
          placeholder="Search name or town…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <NativeSelect value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} aria-label="Filter by chain">
          <option value="all">All chains</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
          <option value="none">Ungrouped</option>
        </NativeSelect>
        {/* Sub-territories sit inside their main rather than in a second
            dropdown: they are a subdivision of it, so a list that nests says
            what the structure is without needing to be explained. */}
        <NativeSelect
          value={territoryFilter}
          onChange={(e) => setTerritoryFilter(e.target.value)}
          aria-label="Filter by territory"
        >
          <option value="all">All territories</option>
          {tree.map(({ region, territories: inRegion }) => (
            <optgroup key={region.id} label={region.name}>
              <option value={`region:${region.id}`}>All of {region.name}</option>
              {inRegion.map((t) => (
                <option key={t.id} value={`t:${t.id}`}>
                  {t.name}
                </option>
              ))}
            </optgroup>
          ))}
          <option value="none">No territory</option>
        </NativeSelect>
        <NativeSelect value={freqFilter} onChange={(e) => setFreqFilter(e.target.value)} aria-label="Filter by frequency">
          <option value="all">Any frequency</option>
          {FREQUENCIES.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </NativeSelect>
        <NativeSelect value={repFilter} onChange={(e) => setRepFilter(e.target.value)} aria-label="Filter by rep">
          <option value="all">Any rep</option>
          <option value="none">Unassigned</option>
          {reps.map((r) => (
            <option key={r.rep_id} value={r.rep_id}>{r.rep_name ?? "Unnamed"}</option>
          ))}
        </NativeSelect>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setSelected(new Set(filtered.map((s) => s.id)))}
          disabled={filtered.length === 0}
        >
          Select all {filtered.length}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setSelected(new Set())}
          disabled={selected.size === 0}
        >
          Clear
        </Button>
        <span className="text-muted-foreground">
          {effective.length} selected of {filtered.length} shown
        </span>
      </div>

      {effective.length > 0 && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-primary/40 bg-primary/5 p-2.5">
          <div className="w-44 space-y-1">
            <Label htmlFor="bulk-action" className="text-xs">Action</Label>
            <NativeSelect
              id="bulk-action"
              value={action}
              onChange={(e) => setAction(e.target.value as BulkAction)}
            >
              <option value="assign">Assign to rep</option>
              <option value="unassign">Remove rep</option>
              <option value="frequency">Set frequency</option>
              <option value="day">Set day</option>
              <option value="clear-day">Clear day</option>
              <option value="territory">Move to territory</option>
            </NativeSelect>
          </div>

          {action === "territory" && (
            <>
              <div className="w-44 space-y-1">
                <Label htmlFor="bulk-territory" className="text-xs">
                  Territory
                </Label>
                <NativeSelect
                  id="bulk-territory"
                  value={actionMain}
                  onChange={(e) => setActionMain(e.target.value)}
                >
                  <option value="">Out of any territory</option>
                  {/* Active only. Deactivating a territory means it "stops being
                      offered for new work" (see setTerritoryActive), and moving
                      stores into one is new work. The *filter* dropdown above
                      still lists inactive territories, because stores already
                      sitting in a retired one have to stay findable. */}
                  {tree.map(({ region, territories: inRegion }) => (
                    <optgroup key={region.id} label={region.name}>
                      {inRegion
                        .filter((t) => t.active)
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </NativeSelect>
              </div>

            </>
          )}

          {(action === "assign" || action === "unassign") && (
            <div className="w-44 space-y-1">
              <Label htmlFor="bulk-rep" className="text-xs">Rep</Label>
              <NativeSelect
                id="bulk-rep"
                value={actionRep}
                onChange={(e) => setActionRep(e.target.value)}
              >
                <option value="">
                  {action === "unassign" ? "Every rep" : "Select a rep"}
                </option>
                {reps.map((r) => (
                  <option key={r.rep_id} value={r.rep_id}>{r.rep_name ?? "Unnamed"}</option>
                ))}
              </NativeSelect>
            </div>
          )}

          {action === "frequency" && (
            <div className="w-40 space-y-1">
              <Label htmlFor="bulk-freq" className="text-xs">Frequency</Label>
              <NativeSelect
                id="bulk-freq"
                value={actionFreq}
                onChange={(e) => setActionFreq(e.target.value as VisitFrequency)}
              >
                {FREQUENCIES.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </NativeSelect>
            </div>
          )}

          {action === "day" && (
            <div className="w-36 space-y-1">
              <Label htmlFor="bulk-day" className="text-xs">Day</Label>
              <NativeSelect
                id="bulk-day"
                value={actionDay}
                onChange={(e) => setActionDay(e.target.value)}
              >
                {WEEKDAYS.map((w) => (
                  <option key={w.value} value={w.value}>{w.long}</option>
                ))}
              </NativeSelect>
            </div>
          )}

          <Button
            size="sm"
            onClick={runBulk}
            disabled={busy || (action === "assign" && !actionRep)}
          >
            {busy
              ? `Working ${progress}/${effective.length}…`
              : `Apply to ${effective.length}`}
          </Button>
        </div>
      )}

      <div className="max-h-[40vh] overflow-y-auto rounded-md border border-border">
        {loading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Loading stores…</p>
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No stores match these filters.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((s) => {
              const mine = repsByStore[s.id] ?? [];
              return (
                <li key={s.id} className="flex items-center gap-2.5 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(s.id)}
                    onChange={() => toggle(s.id)}
                    aria-label={`Select ${s.name}`}
                    className="h-4 w-4 shrink-0 accent-primary"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">{s.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {/* Territory rather than town: it is what the filter and
                          the plan are expressed in, and a store placed nowhere
                          needs to be visible as such. */}
                      {s.territory_id
                        ? `${territoryName[s.territory_id] ?? "Unknown"}${
                            s.sub_territory_id
                              ? ` › ${territoryName[s.sub_territory_id] ?? "Unknown"}`
                              : ""
                          }`
                        : "No territory"}{" "}
                      · {FREQUENCIES.find((f) => f.value === s.visit_frequency)?.label}
                    </p>
                  </div>
                  <p className="shrink-0 text-xs text-muted-foreground">
                    {mine.length > 0 ? (
                      mine.map((m) => m.name).join(", ")
                    ) : (
                      <span className="text-amber-700 dark:text-amber-400">No rep</span>
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
