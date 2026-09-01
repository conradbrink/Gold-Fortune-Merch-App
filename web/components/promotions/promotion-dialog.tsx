"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { fetchStores, type StoreOption } from "@/lib/representatives";
import {
  answeredStoreIds,
  createPromotion,
  fetchPromotionDetail,
  updatePromotion,
  type PromotionInput,
} from "@/lib/promotions";
import type { Tables } from "@/lib/supabase/types";

type ProductRow = Tables<"products">;

/** Today in the viewer's timezone. `toISOString` is UTC and flips at 02:00 here. */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function PromotionDialog({
  promotionId,
  open,
  onOpenChange,
  orgId,
  onSaved,
}: {
  /** Null creates; an id edits. */
  promotionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string | null;
  onSaved: () => void;
}) {
  const supabase = createClient();

  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [startsOn, setStartsOn] = useState(todayLocal());
  const [endsOn, setEndsOn] = useState(todayLocal());
  const [productIds, setProductIds] = useState<Set<string>>(new Set());
  const [storeIds, setStoreIds] = useState<Set<string>>(new Set());

  const [products, setProducts] = useState<ProductRow[]>([]);
  const [stores, setStores] = useState<StoreOption[]>([]);
  /** Ids that already hold answers — removing them costs figures. */
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  /** What the promotion covered when the form opened, to spot removals. */
  const [initialStores, setInitialStores] = useState<Set<string>>(new Set());
  const [initialProducts, setInitialProducts] = useState<Set<string>>(new Set());
  const [started, setStarted] = useState(false);

  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  /**
   * True while an existing promotion's detail is on its way.
   *
   * The reset above clears the form the instant the dialog opens, which leaves
   * an editable empty form sitting there until the fetch lands — and then
   * `setName(detail.name)` and the rest overwrite whatever was typed into it.
   * Only an edit is affected: a new promotion has no detail to fetch.
   */
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    // Cleared before anything is awaited, not after.
    //
    // The reset used to sit inside the async body, so a load that failed — or
    // simply had not come back yet — left the *previous* promotion's name,
    // dates and lines on screen while `promotionId` already pointed at a
    // different row. Pressing Save then wrote the old promotion over the new
    // one, or created a fresh promotion out of its values.
    //
    // It also leaves the form unsaveable until the load succeeds: Save is
    // disabled on an empty name, so a failure cannot be written anywhere.
    // Clearing before the load is the fix for the stale-form bug described
    // above; deriving instead would reintroduce it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    setQuery("");
    setName("");
    setBrief("");
    setStartsOn(todayLocal());
    setEndsOn(todayLocal());
    setProductIds(new Set());
    setStoreIds(new Set());
    setInitialStores(new Set());
    setInitialProducts(new Set());
    setAnswered(new Set());
    setStarted(false);
    setExpanded(new Set());
    setLoadingDetail(promotionId !== null);

    // Opening B while A is still in flight must not let A's reply land on B's
    // form, so every await is followed by a check that this run still owns it.
    let cancelled = false;

    (async () => {
      try {
        const [{ data: prod, error: productsError }, storeList] =
          await Promise.all([
            supabase.from("products").select("*").eq("active", true).order("name"),
            fetchStores(supabase),
          ]);
        if (cancelled) return;
        if (productsError) throw new Error(productsError.message);
        setProducts((prod ?? []) as ProductRow[]);
        setStores(storeList);

        if (!promotionId) return;

        const detail = await fetchPromotionDetail(supabase, promotionId);
        if (cancelled) return;
        if (!detail) {
          // Deleted, or invisible to this caller. Saying so beats a blank form
          // that reads as a promotion with no lines and no outlets.
          throw new Error(
            "That promotion could not be read. Close and reopen it, or refresh the list."
          );
        }
        setName(detail.name);
        setBrief(detail.brief ?? "");
        setStartsOn(detail.starts_on);
        setEndsOn(detail.ends_on);
        setProductIds(new Set(detail.product_ids));
        setStoreIds(new Set(detail.store_ids));
        setInitialStores(new Set(detail.store_ids));
        setInitialProducts(new Set(detail.product_ids));
        setStarted(detail.starts_on <= todayLocal());

        const answers = await answeredStoreIds(supabase, promotionId);
        if (cancelled) return;
        setAnswered(answers);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        // Also on failure: leaving the form locked would make an unreadable
        // promotion unrecoverable without closing the dialog.
        if (!cancelled) setLoadingDetail(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, promotionId]);

  // Chains are the unit a manager thinks in — "give this to the Choppies
  // estate" — and a flat list of 209 stops working immediately.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? stores.filter((s) =>
          [s.name, s.city, s.group_name]
            .filter(Boolean)
            .some((v) => (v as string).toLowerCase().includes(q))
        )
      : stores;
    const byGroup: Record<string, { name: string; stores: StoreOption[] }> = {};
    for (const s of matched) {
      const key = s.group_id ?? "__ungrouped__";
      (byGroup[key] ??= { name: s.group_name ?? "Ungrouped", stores: [] }).stores.push(s);
    }
    return Object.entries(byGroup)
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [stores, query]);

  // A search that leaves matches hidden inside collapsed groups is a search
  // that does nothing.
  useEffect(() => {
    // Expanding on search is a deliberate one-way nudge, not derived state —
    // the user may collapse a group again while the query stands.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (query.trim() !== "") setExpanded(new Set(groups.map((g) => g.key)));
  }, [query, groups]);

  function toggle(set: Set<string>, id: string, apply: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    apply(next);
  }

  const removedAnswered = Array.from(initialStores).filter(
    (id) => !storeIds.has(id) && answered.has(id)
  ).length;
  const addedProducts = Array.from(productIds).filter((id) => !initialProducts.has(id)).length;
  const datesBackwards = endsOn < startsOn;

  async function save() {
    if (!orgId || !name.trim() || datesBackwards) return;
    setSaving(true);
    setError(null);
    const input: PromotionInput = {
      name: name.trim(),
      brief: brief.trim() === "" ? null : brief.trim(),
      starts_on: startsOn,
      ends_on: endsOn,
      productIds: Array.from(productIds),
      storeIds: Array.from(storeIds),
    };
    try {
      if (promotionId) await updatePromotion(supabase, promotionId, input);
      else await createPromotion(supabase, orgId, input);
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{promotionId ? "Edit promotion" : "New promotion"}</DialogTitle>
        </DialogHeader>

        {error && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-sm text-destructive">
            {error}
          </p>
        )}

        {loadingDetail && (
          <p className="text-sm text-muted-foreground">
            Loading this promotion…
          </p>
        )}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              value={name}
              placeholder="e.g. August vape push"
              disabled={loadingDetail}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>What should the rep be looking for?</Label>
            <Input
              value={brief}
              placeholder="e.g. Gondola end display, shelf talkers on all facings"
              disabled={loadingDetail}
              onChange={(e) => setBrief(e.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Starts</Label>
              <Input
                type="date"
                value={startsOn}
                disabled={loadingDetail}
                onChange={(e) => setStartsOn(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Ends</Label>
              <Input
                type="date"
                value={endsOn}
                disabled={loadingDetail}
                onChange={(e) => setEndsOn(e.target.value)}
              />
            </div>
          </div>
          {datesBackwards && (
            <p className="text-xs text-destructive">
              The end date is before the start date.
            </p>
          )}
        </div>

        <section>
          <h3 className="mb-1.5 text-sm font-semibold text-foreground">
            Lines ({productIds.size} of {products.length})
          </h3>
          <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
            {products.length === 0 && (
              <p className="p-2 text-sm text-muted-foreground">
                No active products. Add some on the Products page first.
              </p>
            )}
            {products.map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted/50"
              >
                <Checkbox
                  checked={productIds.has(p.id)}
                  onCheckedChange={() => toggle(productIds, p.id, setProductIds)}
                />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {p.brand && (
                  <span className="shrink-0 text-xs text-muted-foreground">{p.brand}</span>
                )}
              </label>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-1.5 text-sm font-semibold text-foreground">
            Outlets ({storeIds.size} of {stores.length})
          </h3>
          <Input
            placeholder="Search chains, outlets or towns…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mb-2"
          />
          <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
            {groups.map((g) => {
              const isOpen = expanded.has(g.key);
              const picked = g.stores.filter((s) => storeIds.has(s.id)).length;
              return (
                <div key={g.key} className="border-b border-border last:border-b-0">
                  <div className="flex items-center gap-2 bg-muted/30 px-2 py-1.5">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm font-medium"
                      onClick={() =>
                        toggle(expanded, g.key, setExpanded)
                      }
                    >
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4 shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0" />
                      )}
                      <span className="truncate">{g.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {picked > 0 ? `${picked}/${g.stores.length}` : g.stores.length}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="shrink-0 text-xs text-primary hover:underline"
                      onClick={() => {
                        const next = new Set(storeIds);
                        const all = g.stores.every((s) => next.has(s.id));
                        for (const s of g.stores) {
                          if (all) next.delete(s.id);
                          else next.add(s.id);
                        }
                        setStoreIds(next);
                      }}
                    >
                      {g.stores.every((s) => storeIds.has(s.id)) ? "None" : "All"}
                    </button>
                  </div>
                  {isOpen && (
                    <ul>
                      {g.stores.map((s) => (
                        <li key={s.id}>
                          <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 pl-8 text-sm hover:bg-muted/40">
                            <Checkbox
                              checked={storeIds.has(s.id)}
                              onCheckedChange={() => toggle(storeIds, s.id, setStoreIds)}
                            />
                            <span className="min-w-0 flex-1 truncate">{s.name}</span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {s.city ?? "—"}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Both of these look exactly like data loss and are not, so they are
            said out loud before the button rather than discovered afterwards. */}
        {(removedAnswered > 0 || (started && addedProducts > 0)) && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
            <p className="flex items-center gap-1.5 font-semibold">
              <AlertTriangle className="h-3.5 w-3.5" />
              Before you save
            </p>
            {removedAnswered > 0 && (
              <p className="mt-1">
                {removedAnswered} outlet{removedAnswered === 1 ? "" : "s"} you are
                removing {removedAnswered === 1 ? "has" : "have"} already been
                checked. Their answers will disappear from this promotion&apos;s
                figures.
              </p>
            )}
            {started && addedProducts > 0 && (
              <p className="mt-1">
                This promotion has already started and you are adding{" "}
                {addedProducts} line{addedProducts === 1 ? "" : "s"}. Every outlet
                will read as only partly checked until the new one
                {addedProducts === 1 ? " is" : "s are"} answered too.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            onClick={save}
            // `save()` refuses without an org, so without this the button was
            // live and did nothing when clicked.
            disabled={
              saving || loadingDetail || !orgId || !name.trim() || datesBackwards
            }
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving ? "Saving…" : promotionId ? "Save changes" : "Create promotion"}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
