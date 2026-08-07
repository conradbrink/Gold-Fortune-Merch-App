"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBanner } from "@/components/warehouse/stat-tile";
import { fetchOrgId } from "@/lib/representatives";
import { fetchLocations, type StockLocation } from "@/lib/warehouse";
import { createTransfer, fetchSourceStock, type SourceStock } from "@/lib/stock-moves";

type Draft = { key: string; sourceKey: string; qty: string };

const blank = (): Draft => ({ key: crypto.randomUUID(), sourceKey: "", qty: "1" });

/** A balance row is identified by its product and batch together. */
const keyOf = (s: SourceStock) => `${s.product_id}::${s.batch_id ?? "none"}`;

/**
 * What a location is holding of something it cannot send.
 *
 * Only the buckets that are actually carrying units, so the label reads
 * "100 expired" rather than "0 damaged, 100 expired, 0 promotional".
 */
const heldElsewhere = (s: SourceStock) =>
  [
    [s.qty_expired, "expired"],
    [s.qty_damaged, "damaged"],
    [s.qty_promotional, "promotional"],
  ]
    .filter(([n]) => Number(n) > 0)
    .map(([n, label]) => `${n} ${label}`)
    .join(", ");

/**
 * Sending stock somewhere else.
 *
 * Lines are chosen from what is actually on the shelf at the source, batch by
 * batch, rather than from the whole catalogue. Transferring a product the source
 * does not hold is not a data-entry mistake worth allowing — the dispatch would
 * be refused by the ledger anyway, and this way the clerk never gets that far.
 */
export default function NewTransferPage() {
  const supabase = createClient();
  const router = useRouter();

  const [orgId, setOrgId] = useState<string | null>(null);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [notes, setNotes] = useState("");
  const [source, setSource] = useState<SourceStock[]>([]);
  // Held at the source but not transferable — every unit sitting in the
  // expired, damaged or promotional buckets. Kept apart from `source` so it can
  // never be picked, and kept at all because silently dropping these rows is
  // what made the list look like it was missing products: eight ZYN lines are
  // written off as expired, so the select showed 15 of 23 with nothing on
  // screen to explain the other eight.
  const [blocked, setBlocked] = useState<SourceStock[]>([]);
  const [lines, setLines] = useState<Draft[]>([blank()]);

  const [loading, setLoading] = useState(true);
  // True from the start. The first source fetch is kicked off as soon as a
  // default `from` location is assigned, and starting at false meant the card
  // asserted "there is no available stock at that location" during that first
  // fetch — stating as fact something not yet known.
  const [loadingStock, setLoadingStock] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        setFromId(locs.find((l) => l.is_default)?.id ?? locs[0]?.id ?? "");
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

  // Reloads whenever the source changes; the lines are cleared with it, because
  // a batch at one warehouse means nothing at another.
  //
  // The "reading the shelf" flag is switched on by the select's own handler
  // rather than here. Setting it in the effect — even tucked inside the async
  // body, where the lint rule stops seeing it — is still a synchronous setState
  // during the effect and still costs the extra render the rule is about. The
  // user's click is what starts the load, so the user's click is what says so.
  useEffect(() => {
    if (!fromId) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await fetchSourceStock(supabase, fromId);
        if (cancelled) return;
        setSource(s.filter((x) => x.qty_available > 0));
        // A row with nothing in any bucket is not "held back", it is simply
        // not there — listing it would be noise rather than an explanation.
        setBlocked(s.filter((x) => x.qty_available === 0 && heldElsewhere(x) !== ""));
        setLines([blank()]);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoadingStock(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, fromId]);

  const byKey = useMemo(() => new Map(source.map((s) => [keyOf(s), s])), [source]);
  const used = new Set(lines.map((l) => l.sourceKey).filter(Boolean));

  function update(key: string, patch: Partial<Draft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function save() {
    setError(null);
    if (!orgId) return setError("Could not work out your organisation. Reload and try again.");
    if (!toId) return setError("Choose where the stock is going.");
    if (fromId === toId) return setError("A transfer has to go somewhere else.");

    const filled = lines.filter((l) => l.sourceKey && Number(l.qty) > 0);
    if (filled.length === 0) return setError("Add at least one line with a quantity.");
    // Whole units, for the same reason every other quantity on this module is.
    if (filled.some((l) => !Number.isInteger(Number(l.qty)))) {
      return setError("Quantities are whole units. Round each line to a whole number.");
    }

    for (const l of filled) {
      const s = byKey.get(l.sourceKey);
      if (!s) return setError("One of the lines no longer matches the stock on hand.");
      if (Number(l.qty) > s.qty_available) {
        return setError(
          `Only ${s.qty_available} of ${s.product_name} available at the source.`
        );
      }
    }

    setSaving(true);
    try {
      const id = await createTransfer(supabase, {
        orgId,
        fromLocationId: fromId,
        toLocationId: toId,
        notes: notes.trim() || null,
        lines: filled.map((l) => {
          const s = byKey.get(l.sourceKey)!;
          return { productId: s.product_id, batchId: s.batch_id, qtySent: Number(l.qty) };
        }),
      });
      router.push(`/inventory/transfers/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link
          href="/inventory/transfers"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Transfers
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">New transfer</h1>
        <p className="text-sm text-muted-foreground">
          Saved as a draft. Nothing moves until it is sent.
        </p>
      </div>

      <ErrorBanner message={error} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Where to and from</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="from">From</Label>
            <NativeSelect
              id="from"
              value={fromId}
              onChange={(e) => {
                setLoadingStock(true);
                setFromId(e.target.value);
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
            <Label htmlFor="to">To</Label>
            <NativeSelect
              id="to"
              value={toId}
              onChange={(e) => setToId(e.target.value)}
              disabled={loading}
            >
              <option value="">Choose a destination</option>
              {locations
                .filter((l) => l.id !== fromId)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} {l.type !== "warehouse" ? `(${l.type})` : ""}
                  </option>
                ))}
            </NativeSelect>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="notes">Notes</Label>
            <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What is going</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* `fromId` is part of the test because the effect that clears
              `loadingStock` returns early without a source location. Reading
              the flag alone would spin for ever when no location exists. */}
          {fromId && loadingStock ? (
            <p className="text-sm text-muted-foreground">Reading what is on the shelf…</p>
          ) : source.length === 0 ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-sm text-amber-700 dark:text-amber-500">
              <p>There is no available stock at that location to transfer.</p>
              {blocked.length > 0 && (
                <p className="mt-1">
                  {blocked.length === 1 ? "One product is" : `${blocked.length} products are`}{" "}
                  held here but written off, so cannot be sent:{" "}
                  {blocked.map((x) => `${x.product_name} (${heldElsewhere(x)})`).join(", ")}.
                </p>
              )}
            </div>
          ) : (
            lines.map((l) => {
              const s = l.sourceKey ? byKey.get(l.sourceKey) : null;
              const over = s ? Number(l.qty) > s.qty_available : false;
              return (
                <div key={l.key} className="grid gap-2 sm:grid-cols-[1fr_7rem_2.5rem]">
                  <div>
                    <NativeSelect
                      value={l.sourceKey}
                      onChange={(e) => update(l.key, { sourceKey: e.target.value })}
                      aria-label="Product and batch"
                    >
                      <option value="">Choose from what is in stock</option>
                      {source
                        .filter((x) => keyOf(x) === l.sourceKey || !used.has(keyOf(x)))
                        .map((x) => (
                          <option key={keyOf(x)} value={keyOf(x)}>
                            {x.product_name}
                            {x.batch_number ? ` · ${x.batch_number}` : ""}
                            {x.expiry_date
                              ? ` · exp ${new Date(x.expiry_date).toLocaleDateString()}`
                              : ""}
                            {` — ${x.qty_available} available`}
                          </option>
                        ))}
                      {/* Shown, greyed, never selectable. The clerk asked for
                          these by name; the answer is "it is here but written
                          off", which is only an answer if they can see it. */}
                      {blocked.length > 0 && (
                        <optgroup label="Held here, not transferable">
                          {blocked.map((x) => (
                            <option key={keyOf(x)} value={keyOf(x)} disabled>
                              {x.product_name}
                              {x.batch_number ? ` · ${x.batch_number}` : ""}
                              {` — 0 available (${heldElsewhere(x)})`}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </NativeSelect>
                    {over && s && (
                      <p className="mt-1 text-xs text-destructive">
                        Only {s.qty_available} available.
                      </p>
                    )}
                  </div>
                  <Input
                    type="number"
                    min={1}
                    max={s?.qty_available}
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

          {source.length > 0 && (
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
          render={<Link href="/inventory/transfers" />}
        >
          Cancel
        </Button>
        <Button onClick={save} disabled={saving || loading || source.length === 0}>
          {saving ? "Saving…" : "Save draft"}
        </Button>
      </div>
    </div>
  );
}
