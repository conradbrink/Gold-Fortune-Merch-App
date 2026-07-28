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
  fetchAssignments,
  fetchOrgId,
  fetchRepDirectory,
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
};

type BulkAction = "assign" | "unassign" | "frequency" | "day" | "clear-day";

export function CoveragePlanner({ onChanged }: { onChanged?: () => void }) {
  const supabase = createClient();

  const [stores, setStores] = useState<StoreRow[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [reps, setReps] = useState<RepSummary[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [freqFilter, setFreqFilter] = useState("all");
  const [repFilter, setRepFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [action, setAction] = useState<BulkAction>("assign");
  const [actionRep, setActionRep] = useState("");
  const [actionFreq, setActionFreq] = useState<VisitFrequency>("monthly");
  const [actionDay, setActionDay] = useState("1");

  async function load() {
    setLoading(true);
    try {
      const [storeRes, groupRes, repRows, assignmentRows, org] = await Promise.all([
        supabase
          .from("stores")
          .select("id, name, city, store_group_id, visit_frequency")
          .eq("active", true)
          .order("name"),
        supabase.from("store_groups").select("id, name").order("name"),
        fetchRepDirectory(supabase),
        fetchAssignments(supabase),
        fetchOrgId(supabase),
      ]);
      if (storeRes.error) throw new Error(storeRes.error.message);
      setStores((storeRes.data ?? []) as StoreRow[]);
      setGroups((groupRes.data ?? []) as { id: string; name: string }[]);
      setReps(repRows.filter((r) => r.is_active));
      setAssignments(assignmentRows);
      setOrgId(org);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
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

  const cities = useMemo(() => {
    const seen: Record<string, true> = {};
    for (const s of stores) if (s.city) seen[s.city] = true;
    return Object.keys(seen).sort((a, b) => a.localeCompare(b));
  }, [stores]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stores.filter((s) => {
      if (groupFilter !== "all" && (s.store_group_id ?? "none") !== groupFilter) return false;
      if (cityFilter !== "all") {
        if (cityFilter === "none" ? s.city !== null : s.city !== cityFilter) return false;
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
  }, [stores, query, groupFilter, cityFilter, freqFilter, repFilter, repsByStore]);

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
        <NativeSelect value={cityFilter} onChange={(e) => setCityFilter(e.target.value)} aria-label="Filter by town">
          <option value="all">All towns</option>
          {cities.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
          <option value="none">No town</option>
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
            </NativeSelect>
          </div>

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
                      {s.city ?? "No town"} ·{" "}
                      {FREQUENCIES.find((f) => f.value === s.visit_frequency)?.label}
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
