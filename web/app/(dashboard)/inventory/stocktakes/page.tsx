"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Snowflake } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ErrorBanner, EmptyRow } from "@/components/warehouse/stat-tile";
import { fetchLocations, type StockLocation } from "@/lib/warehouse";
import {
  fetchStocktakes,
  openStocktake,
  STOCKTAKE_TYPES,
  type StocktakeListRow,
} from "@/lib/stocktakes";

export default function StocktakesPage() {
  const supabase = createClient();
  const router = useRouter();

  const [rows, setRows] = useState<StocktakeListRow[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const [locationId, setLocationId] = useState("");
  const [type, setType] = useState("full");
  const [freeze, setFreeze] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, l] = await Promise.all([
          fetchStocktakes(supabase),
          fetchLocations(supabase),
        ]);
        if (cancelled) return;
        setRows(s);
        setLocations(l);
        setLocationId(l.find((x) => x.is_default)?.id ?? l[0]?.id ?? "");
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const result = await openStocktake(supabase, {
        locationId,
        type,
        freeze: type === "full" ? freeze : false,
      });
      router.push(`/inventory/stocktakes/${result.stocktake_id as string}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/inventory" className="text-sm text-muted-foreground hover:underline">
            ← Inventory
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Stocktakes</h1>
          <p className="text-sm text-muted-foreground">
            Counting what is really there, and reconciling it with what the system says.
          </p>
        </div>
        <Button onClick={() => setOpen(true)} disabled={loading}>
          <Plus className="mr-1.5 h-4 w-4" /> Start a count
        </Button>
      </div>

      <ErrorBanner message={error} />

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Count</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Location</TableHead>
              <TableHead className="text-right">Lines</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Started</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <EmptyRow colSpan={6}>Loading…</EmptyRow>
            ) : rows.length === 0 ? (
              <EmptyRow colSpan={6}>
                No counts yet. A full count freezes the location; a cycle or spot check
                does not.
              </EmptyRow>
            ) : (
              rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <Link
                      href={`/inventory/stocktakes/${s.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {s.stocktake_number}
                    </Link>
                    {s.freeze_movements &&
                      ["draft", "counting", "submitted"].includes(s.status) && (
                        <Badge
                          variant="outline"
                          className="ml-2 border-sky-500/50 text-sky-600"
                        >
                          <Snowflake className="mr-1 h-3 w-3" /> frozen
                        </Badge>
                      )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{s.stocktake_type}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {s.location_name ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{s.line_count}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        s.status === "approved"
                          ? "default"
                          : ["rejected", "cancelled"].includes(s.status)
                            ? "outline"
                            : "secondary"
                      }
                    >
                      {s.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {s.started_at ? new Date(s.started_at).toLocaleDateString() : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={(v) => !v && setOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start a stocktake</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="loc">Location</Label>
              <NativeSelect
                id="loc"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <Label htmlFor="sttype">Type</Label>
              <NativeSelect
                id="sttype"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                {STOCKTAKE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label} — {t.hint}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {type === "full" && (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={freeze}
                  onChange={(e) => setFreeze(e.target.checked)}
                  className="mt-0.5 h-4 w-4"
                />
                <span>
                  Freeze the location while counting.
                  <span className="block text-muted-foreground">
                    Nothing can be received, reserved, picked or dispatched there until
                    the count is approved or cancelled. Only a full count may do this.
                  </span>
                </span>
              </label>
            )}
            <p className="text-xs text-muted-foreground">
              The system quantity is snapshotted now, and read again when the sheet is
              handed in. The variance is measured against the second reading, so trade
              during the count is not counted twice.
            </p>
            {/* The RPC refuses several real cases — a location that already has
                an open count, most often. The dialog stays open on failure and
                the page banner is behind the overlay, so without this the
                button simply returns to "Start counting" unexplained. */}
            <ErrorBanner message={error} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={start} disabled={busy || !locationId}>
              {busy ? "Opening…" : "Start counting"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
