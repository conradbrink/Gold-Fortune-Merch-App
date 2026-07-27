"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Store as StoreIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AssignStoresDialog } from "@/components/representatives/assign-stores-dialog";
import { createClient } from "@/lib/supabase/client";
import {
  fetchAssignments,
  fetchOrgId,
  fetchRepDirectory,
  fetchStores,
  formatLastActive,
  type Assignment,
  type RepSummary,
  type StoreOption,
} from "@/lib/representatives";

/**
 * Representatives.
 *
 * There is deliberately no "Invite rep" button: creating an auth user needs the
 * service-role key, which must never reach a browser bundle. Reps are created
 * out of band; this page manages who covers which store.
 */
export default function RepresentativesPage() {
  const supabase = createClient();

  const [reps, setReps] = useState<RepSummary[]>([]);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<RepSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, s, a, o] = await Promise.all([
        fetchRepDirectory(supabase),
        fetchStores(supabase),
        fetchAssignments(supabase),
        fetchOrgId(supabase),
      ]);
      setReps(r);
      setStores(s);
      setAssignments(a);
      setOrgId(o);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return reps;
    return reps.filter(
      (r) =>
        (r.rep_name ?? "").toLowerCase().includes(q) ||
        (r.email ?? "").toLowerCase().includes(q)
    );
  }, [reps, query]);

  // Stores nobody owns are the actionable gap this page exists to surface.
  const unassignedStores = useMemo(() => {
    const owned = new Set(assignments.map((a) => a.store_id));
    return stores.filter((s) => !owned.has(s.id));
  }, [stores, assignments]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Representatives
        </h1>
        <p className="text-sm text-muted-foreground">
          {reps.length} field {reps.length === 1 ? "rep" : "reps"} · who covers
          which store
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <p className="font-medium">Could not load representatives</p>
          <p className="mt-1">{error}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={load}>
            Retry
          </Button>
        </div>
      )}

      {!loading && unassignedStores.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <StoreIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-foreground">
            <span className="font-medium">
              {unassignedStores.length}{" "}
              {unassignedStores.length === 1 ? "store has" : "stores have"} no
              rep assigned
            </span>{" "}
            <span className="text-muted-foreground">
              — {unassignedStores.map((s) => s.name).slice(0, 4).join(", ")}
              {unassignedStores.length > 4 &&
                ` +${unassignedStores.length - 4} more`}
            </span>
          </p>
        </div>
      )}

      <Input
        placeholder="Search reps…"
        className="max-w-sm"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <Card>
        <CardContent className="px-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-9 animate-pulse rounded bg-muted/50" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {reps.length === 0
                ? "No field reps in this organisation yet."
                : `No reps match "${query}".`}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rep</TableHead>
                  <TableHead className="text-right">Stores</TableHead>
                  <TableHead className="hidden sm:table-cell text-right">
                    Primary
                  </TableHead>
                  <TableHead className="hidden md:table-cell text-right">
                    Visits (30d)
                  </TableHead>
                  <TableHead className="text-right">Last active</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.rep_id}>
                    <TableCell className="font-medium">
                      {r.rep_name ?? "Unnamed rep"}
                      <span className="block text-xs text-muted-foreground">
                        {r.email ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.assigned_stores === 0 ? (
                        <Badge variant="outline" className="font-normal">
                          None
                        </Badge>
                      ) : (
                        r.assigned_stores
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-right tabular-nums text-muted-foreground">
                      {r.primary_stores}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-right tabular-nums">
                      {r.visits_30d}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {formatLastActive(r.last_active_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelected(r)}
                      >
                        Manage
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AssignStoresDialog
        rep={selected}
        stores={stores}
        assignments={assignments}
        orgId={orgId}
        open={selected !== null}
        onOpenChange={(o) => !o && setSelected(null)}
        onChanged={load}
      />
    </div>
  );
}
