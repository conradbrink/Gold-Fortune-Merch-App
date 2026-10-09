"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorBanner, EmptyRow } from "@/components/warehouse/stat-tile";
import { fetchOrgId } from "@/lib/representatives";
import {
  createVehicle,
  fetchVehicles,
  setVehicleActive,
  updateVehicle,
  vehicleProblem,
  type LogbookVehicle,
  type VehicleInput,
} from "@/lib/vehicle-logbook";

const empty: VehicleInput = { name: "", registration: "", notes: "", active: true };

const toDraft = (v: LogbookVehicle): VehicleInput => ({
  name: v.name,
  registration: v.registration,
  notes: v.notes ?? "",
  active: v.active,
});

/**
 * The company's vehicles, for the logbook. A vehicle that was driven stays in
 * the logbook, so it is never deleted: it goes out of use and off the list of
 * vehicles to assign, and can come back.
 */
export default function LogbookVehiclesPage() {
  const supabase = createClient();
  const [vehicles, setVehicles] = useState<LogbookVehicle[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<VehicleInput>(empty);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [org, list] = await Promise.all([fetchOrgId(supabase), fetchVehicles(supabase)]);
      setOrgId(org);
      setVehicles(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const p = vehicleProblem(draft);
    if (p) return setError(p);
    if (!orgId) return;
    await run(async () => {
      if (adding) await createVehicle(supabase, orgId, draft);
      else if (editing) await updateVehicle(supabase, editing, draft);
      setAdding(false);
      setEditing(null);
    });
  }

  const cancel = () => {
    setAdding(false);
    setEditing(null);
    setError(null);
  };

  const inUse = vehicles.filter((v) => v.active).length;

  const editRow = (key: string) => (
    <TableRow key={key}>
      <TableCell className="min-w-40 align-top">
        <Input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="Silver Hilux"
          aria-label="Name"
          autoFocus
        />
        <Input
          className="mt-1"
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          placeholder="Make and model (optional)"
          aria-label="Notes"
        />
      </TableCell>
      <TableCell className="min-w-32 align-top">
        <Input
          value={draft.registration}
          onChange={(e) => setDraft({ ...draft, registration: e.target.value })}
          placeholder="ABC 123"
          aria-label="Registration"
          className="uppercase"
        />
      </TableCell>
      <TableCell className="text-right align-top whitespace-nowrap">
        <Button variant="outline" size="sm" disabled={busy} onClick={cancel}>
          Cancel
        </Button>{" "}
        <Button size="sm" disabled={busy} onClick={save}>
          Save
        </Button>
      </TableCell>
    </TableRow>
  );

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/logbook"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Vehicle logbook
        </Link>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Vehicles</h1>
          <p className="text-sm text-pretty text-muted-foreground">
            The vehicles your team drives for work. Each one in use can be put in the logbook for a day.
          </p>
        </div>
        <Button
          disabled={busy || adding || editing !== null}
          onClick={() => {
            setDraft(empty);
            setAdding(true);
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" /> Add vehicle
        </Button>
      </div>

      <ErrorBanner message={error} />

      {!loading && vehicles.length > 0 && (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">{inUse}</span> in use
          {vehicles.length > inUse && (
            <>
              , <span className="tabular-nums">{vehicles.length - inUse}</span> out of use
            </>
          )}
          .
        </p>
      )}

      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vehicle</TableHead>
              <TableHead>Registration</TableHead>
              <TableHead className="w-44" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <EmptyRow colSpan={3}>Loading…</EmptyRow>}
            {!loading && vehicles.length === 0 && !adding && (
              <EmptyRow colSpan={3}>No vehicles yet. Add the first one to start the logbook.</EmptyRow>
            )}
            {adding && editRow("new")}
            {vehicles.map((v) =>
              editing === v.id ? (
                editRow(v.id)
              ) : (
                <TableRow key={v.id} className={v.active ? undefined : "text-muted-foreground"}>
                  <TableCell className="max-w-48">
                    <span className="block truncate font-medium">{v.name}</span>
                    {v.notes && <span className="block truncate text-xs text-muted-foreground">{v.notes}</span>}
                    {!v.active && <span className="block text-xs">Out of use</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{v.registration}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy || adding || editing !== null}
                      onClick={() => {
                        setDraft(toDraft(v));
                        setEditing(v.id);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy || adding || editing !== null}
                      onClick={() => run(() => setVehicleActive(supabase, v.id, !v.active))}
                    >
                      {v.active ? "Stop using" : "Use again"}
                    </Button>
                  </TableCell>
                </TableRow>
              )
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
