"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBanner } from "@/components/warehouse/stat-tile";
import { fetchOrgId } from "@/lib/representatives";
import { fetchLocations, type StockLocation } from "@/lib/warehouse";
import {
  ADJUSTMENT_REASONS,
  BUCKETS,
  createAdjustment,
  fetchSourceStock,
  type SourceStock,
} from "@/lib/stock-moves";

type Draft = { key: string; sourceKey: string; qty: string; note: string };

const blank = (): Draft => ({
  key: crypto.randomUUID(),
  sourceKey: "",
  qty: "1",
  note: "",
});

const keyOf = (s: SourceStock) => `${s.product_id}::${s.batch_id ?? "none"}`;

/**
 * Raising an adjustment.
 *
 * The bucket movement is derived from the reason rather than picked separately:
 * "available → damaged" *is* what damage means, and offering the two as
 * independent choices invites an adjustment that says one thing and does
 * another. `Something else` is the exception and asks for both.
 *
 * The quantity available in the *source* bucket is shown per line, because a
 * write-off comes out of damaged and a damage adjustment comes out of available,
 * and getting that wrong is refused at approval — days later, by which point
 * nobody remembers.
 */
export default function NewAdjustmentPage() {
  const supabase = createClient();
  const router = useRouter();

  const [orgId, setOrgId] = useState<string | null>(null);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [locationId, setLocationId] = useState("");
  const [reasonCode, setReasonCode] = useState<string>("damage");
  const [reasonNote, setReasonNote] = useState("");
  const [customFrom, setCustomFrom] = useState<string>("available");
  const [customTo, setCustomTo] = useState<string>("damaged");
  const [source, setSource] = useState<SourceStock[]>([]);
  // True from the start, and cleared only when a fetch finishes. Without it the
  // card below asserts "there is nothing at that location" during the very
  // first read, which is a statement of fact about something not yet known.
  const [loadingStock, setLoadingStock] = useState(true);
  const [lines, setLines] = useState<Draft[]>([blank()]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reason = ADJUSTMENT_REASONS.find((r) => r.value === reasonCode)!;
  const isCustom = reasonCode === "other";
  const fromBucket = isCustom ? customFrom : reason.from;
  const toBucket = isCustom ? customTo : reason.to;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [org, locs] = await Promise.all([
          fetchOrgId(supabase),
          fetchLocations(supabase),
        ]);
        if (cancelled) return;
        setOrgId(org);
        setLocations(locs);
        setLocationId(locs.find((l) => l.is_default)?.id ?? locs[0]?.id ?? "");
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

  useEffect(() => {
    if (!locationId) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await fetchSourceStock(supabase, locationId);
        if (!cancelled) setSource(s);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoadingStock(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, locationId]);

  const byKey = useMemo(() => new Map(source.map((s) => [keyOf(s), s])), [source]);

  /** How many are in the bucket this adjustment takes from. */
  function availableInSource(s: SourceStock): number | null {
    if (!fromBucket) return null;
    switch (fromBucket) {
      case "available":
        return s.qty_available;
      case "damaged":
        return s.qty_damaged;
      case "expired":
        return s.qty_expired;
      case "promotional":
        return s.qty_promotional;
      default:
        return null;
    }
  }

  // "Found" stock arrives from nowhere, so there is no source bucket to draw
  // from and every balance row is a legitimate target.
  //
  // ⚠️ Known gap, deliberately not closed here. These choices come from
  // `stock_balances`, so a `found` adjustment can only name a product that
  // already has a balance row at this location — and the case `found` exists
  // for is stock that is physically present and has never been received here,
  // which by definition has no row. Closing it means offering the product
  // catalogue for this reason code and letting the clerk name a batch that
  // does not exist yet, which is a different screen rather than a smaller one.
  // Recorded on the pull request.
  const choices = source.filter((s) => {
    if (!fromBucket) return true;
    const n = availableInSource(s);
    return n === null || n > 0;
  });

  const used = new Set(lines.map((l) => l.sourceKey).filter(Boolean));

  function update(key: string, patch: Partial<Draft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function save() {
    setError(null);
    if (!orgId) return setError("Could not work out your organisation. Reload and try again.");
    if (!locationId) return setError("Choose a location.");
    if (isCustom) {
      if (!reasonNote.trim()) return setError("Say what this adjustment is for.");
      if (customFrom === customTo) return setError("The two buckets have to differ.");
    }

    const filled = lines.filter((l) => l.sourceKey && Number(l.qty) > 0);
    if (filled.length === 0) return setError("Add at least one line with a quantity.");

    for (const l of filled) {
      const s = byKey.get(l.sourceKey);
      if (!s) return setError("One of the lines no longer matches the stock on hand.");
      // A number input does not enforce `step`, and the ledger counts in whole
      // units. Caught here so the clerk gets a sentence, not a cast error.
      if (!Number.isInteger(Number(l.qty))) {
        return setError(`${s.product_name} has a quantity that is not a whole number.`);
      }
      const avail = availableInSource(s);
      if (avail !== null && Number(l.qty) > avail) {
        return setError(
          `Only ${avail} of ${s.product_name} in ${fromBucket} stock — the adjustment would be refused.`
        );
      }
    }

    setSaving(true);
    try {
      const id = await createAdjustment(supabase, {
        orgId,
        locationId,
        reasonCode,
        reasonNote: reasonNote.trim() || null,
        lines: filled.map((l) => {
          const s = byKey.get(l.sourceKey)!;
          return {
            productId: s.product_id,
            batchId: s.batch_id,
            fromBucket,
            toBucket,
            qty: Number(l.qty),
            note: l.note.trim() || null,
          };
        }),
      });
      router.push(`/inventory/adjustments/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link
          href="/inventory/adjustments"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Adjustments
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Raise an adjustment</h1>
        <p className="text-sm text-muted-foreground">
          Saved as a draft. Nothing changes until a manager approves it.
        </p>
      </div>

      <ErrorBanner message={error} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What and where</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="loc">Location</Label>
              <NativeSelect
                id="loc"
                value={locationId}
                onChange={(e) => {
                  setLoadingStock(true);
                  setLocationId(e.target.value);
                }}
                disabled={loading}
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <Label htmlFor="reason">Reason</Label>
              <NativeSelect
                id="reason"
                value={reasonCode}
                onChange={(e) => {
                  setReasonCode(e.target.value);
                  setLines([blank()]);
                }}
              >
                {ADJUSTMENT_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </NativeSelect>
              <p className="mt-1 text-xs text-muted-foreground">{reason.hint}</p>
            </div>
          </div>

          {isCustom && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="fromb">From</Label>
                <NativeSelect
                  id="fromb"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                >
                  {BUCKETS.map((b) => (
                    <option key={b} value={b}>
                      {b.replace("_", " ")}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div>
                <Label htmlFor="tob">To</Label>
                <NativeSelect
                  id="tob"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                >
                  {BUCKETS.map((b) => (
                    <option key={b} value={b}>
                      {b.replace("_", " ")}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
            <span className="font-medium">{fromBucket ?? "outside the system"}</span>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{toBucket ?? "outside the system"}</span>
            <span className="text-muted-foreground">
              — this is what approving will do to the stock
            </span>
          </div>

          <div>
            <Label htmlFor="note">
              {isCustom ? "Why? (required)" : "Note (optional)"}
            </Label>
            <Input
              id="note"
              value={reasonNote}
              onChange={(e) => setReasonNote(e.target.value)}
              placeholder="What happened, and who saw it"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Which stock</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {locationId && loadingStock ? (
            <p className="text-sm text-muted-foreground">Reading what is on the shelf…</p>
          ) : choices.length === 0 ? (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-sm text-amber-700 dark:text-amber-500">
              {fromBucket
                ? `There is nothing in ${fromBucket} stock at that location to adjust.`
                : // A `found` adjustment has no source bucket, so "nothing in
                  // stock" is not the condition blocking the user. What blocks
                  // them is that this screen can only name products that
                  // already have a balance row here — see the note by
                  // `choices`.
                  "This location has no stock on record yet, so there is nothing here to select."}
            </p>
          ) : (
            lines.map((l) => {
              const s = l.sourceKey ? byKey.get(l.sourceKey) : null;
              const avail = s ? availableInSource(s) : null;
              const over = avail !== null && s ? Number(l.qty) > avail : false;
              return (
                <div key={l.key} className="grid gap-2 sm:grid-cols-[1fr_6rem_2.5rem]">
                  <div>
                    <NativeSelect
                      value={l.sourceKey}
                      onChange={(e) => update(l.key, { sourceKey: e.target.value })}
                      aria-label="Product and batch"
                    >
                      <option value="">Choose the stock</option>
                      {choices
                        .filter((x) => keyOf(x) === l.sourceKey || !used.has(keyOf(x)))
                        .map((x) => {
                          const n = availableInSource(x);
                          return (
                            <option key={keyOf(x)} value={keyOf(x)}>
                              {x.product_name}
                              {x.batch_number ? ` · ${x.batch_number}` : ""}
                              {n !== null ? ` — ${n} in ${fromBucket}` : ""}
                            </option>
                          );
                        })}
                    </NativeSelect>
                    {over && (
                      <p className="mt-1 text-xs text-destructive">
                        Only {avail} in {fromBucket} stock.
                      </p>
                    )}
                    <Input
                      className="mt-1"
                      value={l.note}
                      onChange={(e) => update(l.key, { note: e.target.value })}
                      placeholder="Line note (optional)"
                      aria-label="Line note"
                    />
                  </div>
                  <Input
                    type="number"
                    min={1}
                    value={l.qty}
                    onChange={(e) => update(l.key, { qty: e.target.value })}
                    aria-label="Quantity"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove line"
                    onClick={() =>
                      setLines((prev) =>
                        prev.length === 1 ? [blank()] : prev.filter((x) => x.key !== l.key)
                      )
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })
          )}

          {choices.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLines((prev) => [...prev, blank()])}
            >
              <Plus className="mr-1.5 h-4 w-4" /> Add a line
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/inventory/adjustments" />}
        >
          Cancel
        </Button>
        <Button onClick={save} disabled={saving || loading || choices.length === 0}>
          {saving ? "Saving…" : "Save draft"}
        </Button>
      </div>
    </div>
  );
}
