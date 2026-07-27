"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { UserPlus } from "lucide-react";
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
import { InviteRepDialog } from "@/components/representatives/invite-rep-dialog";
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
 * Inviting a rep goes through /api/reps/invite because creating an auth user
 * needs the service-role key, which must never reach a browser bundle.
 */
export default function RepresentativesPage() {
  const supabase = createClient();

  const [reps, setReps] = useState<RepSummary[]>([]);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<RepSummary | null>(null);
  const [inviting, setInviting] = useState(false);
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Representatives
          </h1>
          <p className="text-sm text-muted-foreground">
            {reps.length} field {reps.length === 1 ? "rep" : "reps"} · who covers
            which store
          </p>
        </div>
        <Button className="gap-1.5" onClick={() => setInviting(true)}>
          <UserPlus className="h-4 w-4" />
          Add rep
        </Button>
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
                  <TableHead className="hidden lg:table-cell">Contact</TableHead>
                  <TableHead className="text-right">Stores</TableHead>
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
                      <span className={r.is_active ? "" : "text-muted-foreground"}>
                        {r.rep_name ?? "Unnamed rep"}
                      </span>
                      {!r.is_active && (
                        <Badge variant="outline" className="ml-2 font-normal">
                          Inactive
                        </Badge>
                      )}
                      <span className="block text-xs text-muted-foreground">
                        {r.job_title ?? "Field rep"}
                      </span>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                      {r.email ?? "—"}
                      <span className="block text-xs">{r.phone ?? "No phone"}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      {r.assigned_stores === 0 ? (
                        <Badge variant="outline" className="font-normal">
                          None
                        </Badge>
                      ) : (
                        // Names live in the Manage dialog; the list only needs
                        // the count. Hover still reveals them.
                        <span
                          className="tabular-nums"
                          title={r.store_names ?? undefined}
                        >
                          {r.assigned_stores}
                        </span>
                      )}
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

      <InviteRepDialog
        open={inviting}
        onOpenChange={setInviting}
        onInvited={load}
      />

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
