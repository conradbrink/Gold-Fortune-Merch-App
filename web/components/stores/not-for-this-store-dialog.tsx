"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { callRpc } from "@/lib/rpc";
import { EXCLUDE_REASONS } from "@/lib/store-range";
import { createClient } from "@/lib/supabase/client";
import { lower } from "@/lib/terms";
import { useTerms } from "@/lib/use-company-config";

const OTHER = "other";

/**
 * "Not for this store": products a store's range says it should have that it
 * never will (the branch may not sell vapes, the buyer said no). Pick a ready
 * reason or say another; they stop counting as missing there until somebody
 * counts them again (store_range_exclude / store_range_include).
 */
export function NotForThisStoreDialog({
  target,
  onClose,
  onDone,
}: {
  target: { storeId: string; storeName: string; products: { id: string; name: string }[] } | null;
  onClose: () => void;
  onDone: (n: number, storeName: string) => void;
}) {
  const t = useTerms();
  const [reason, setReason] = useState<string>(EXCLUDE_REASONS[0]);
  const [other, setOther] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // Each time it opens: the first reason, nothing typed, no old error.
    if (target) {
      setReason(EXCLUDE_REASONS[0]);
      setOther("");
      setError(null);
    }
  }, [target]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const said = reason === OTHER ? other.trim() : reason;

  async function save() {
    if (!target) return;
    if (!said) {
      setError("Say why, so your team knows.");
      return;
    }
    setSaving(true);
    setError(null);
    const { error: e } = await callRpc(createClient(), "store_range_exclude", {
      p_store_id: target.storeId,
      p_product_ids: target.products.map((p) => p.id),
      p_reason: said,
    });
    setSaving(false);
    if (e) {
      setError(e.message);
      return;
    }
    onDone(target.products.length, target.storeName);
  }

  const site = lower(t.site.one);
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Not for {target?.storeName ?? `this ${site}`}</DialogTitle>
          <DialogDescription>
            {target && target.products.length === 1
              ? `${target.products[0].name} will stop counting as missing at this ${site}.`
              : `These ${target?.products.length ?? 0} products will stop counting as missing at this ${site}.`}{" "}
            You can count {target && target.products.length === 1 ? "it" : "them"} again from the same list.
          </DialogDescription>
        </DialogHeader>
        {target && target.products.length > 1 && (
          <p className="text-sm text-foreground">{target.products.map((p) => p.name).join(", ")}</p>
        )}
        <fieldset className="space-y-1">
          <legend className="mb-1.5 text-sm font-medium text-foreground">Why?</legend>
          {[...EXCLUDE_REASONS, OTHER].map((r) => (
            <label
              key={r}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-muted/60 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring"
            >
              <input
                type="radio"
                name="not-for-reason"
                value={r}
                checked={reason === r}
                onChange={() => setReason(r)}
                className="h-4 w-4 accent-primary"
              />
              {r === OTHER ? "Something else" : r}
            </label>
          ))}
        </fieldset>
        {reason === OTHER && (
          <div className="space-y-1.5">
            <Label htmlFor="not-for-other">Say why</Label>
            <Input
              id="not-for-other"
              value={other}
              maxLength={200}
              aria-describedby={error ? "not-for-error" : undefined}
              onChange={(e) => setOther(e.target.value)}
            />
          </div>
        )}
        {error && (
          <p id="not-for-error" role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Keep counting {target && target.products.length === 1 ? "it" : "them"}
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : `Not for this ${site}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
