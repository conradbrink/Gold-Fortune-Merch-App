"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ErrorBanner, EmptyRow } from "@/components/warehouse/stat-tile";
import { fetchOrgId } from "@/lib/representatives";
import { fetchRepsForOrder, fetchStoresForOrder } from "@/lib/orders";
import {
  BASIS_LABELS,
  deleteRule,
  describeRule,
  fetchRules,
  KIND_LABELS,
  saveRule,
  tiersOf,
  type CommissionRule,
  type RuleInput,
} from "@/lib/commissions";

type TierDraft = { from: string; to: string; rate: string };
type Draft = {
  name: string;
  description: string;
  kind: RuleInput["kind"];
  rate: string;
  fixedAmount: string;
  tiers: TierDraft[];
  basis: string;
  appliesTo: RuleInput["appliesTo"];
  repId: string;
  storeId: string;
  minOrderValue: string;
  priority: string;
  active: boolean;
};

const EMPTY: Draft = {
  name: "",
  description: "",
  kind: "percentage",
  rate: "",
  fixedAmount: "",
  tiers: [{ from: "0", to: "", rate: "" }],
  basis: "revenue_excl_vat",
  appliesTo: "all",
  repId: "",
  storeId: "",
  minOrderValue: "0",
  priority: "0",
  active: true,
};

function toDraft(r: CommissionRule): Draft {
  return {
    name: r.name,
    description: r.description ?? "",
    kind: r.kind as Draft["kind"],
    rate: r.rate == null ? "" : String(r.rate),
    fixedAmount: r.fixed_amount == null ? "" : String(r.fixed_amount),
    tiers: tiersOf(r).length
      ? tiersOf(r).map((t) => ({ from: String(t.from), to: t.to == null ? "" : String(t.to), rate: String(t.rate) }))
      : EMPTY.tiers,
    basis: r.basis,
    appliesTo: r.applies_to as Draft["appliesTo"],
    repId: r.rep_id ?? "",
    storeId: r.store_id ?? "",
    minOrderValue: String(r.min_order_value),
    priority: String(r.priority),
    active: r.active,
  };
}

/**
 * The rules commissions are worked out from.
 *
 * Changing a rule does not touch commissions already worked out — the page
 * says so, and Recalculate on the Commissions page is the deliberate way to
 * apply a change to a period. Approved and paid commissions never move.
 */
export default function CommissionRulesPage() {
  const supabase = createClient();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [rules, setRules] = useState<CommissionRule[]>([]);
  const [reps, setReps] = useState<{ id: string; full_name: string }[]>([]);
  const [stores, setStores] = useState<{ id: string; name: string; city: string | null }[]>([]);
  const [editing, setEditing] = useState<{ id?: string; draft: Draft } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [org, r, rp, st] = await Promise.all([
        fetchOrgId(supabase),
        fetchRules(supabase),
        fetchRepsForOrder(supabase),
        fetchStoresForOrder(supabase),
      ]);
      setOrgId(org);
      setRules(r);
      setReps(rp);
      setStores(st);
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

  const repName = (id: string | null) => reps.find((r) => r.id === id)?.full_name ?? "a rep";
  const storeName = (id: string | null) => stores.find((s) => s.id === id)?.name ?? "a store";

  async function save() {
    if (!editing || !orgId) return;
    const d = editing.draft;
    setError(null);
    if (!d.name.trim()) return setError("Give the rule a name.");
    if (d.kind === "percentage" && !(Number(d.rate) >= 0 && d.rate !== "" && Number(d.rate) <= 100))
      return setError("The rate is a percentage between 0 and 100.");
    if (d.kind === "fixed" && !(d.fixedAmount !== "" && Number(d.fixedAmount) >= 0))
      return setError("Enter the amount paid per order.");
    if (d.kind === "tiered" && d.tiers.some((t) => t.rate === "" || t.from === ""))
      return setError("Every tier needs a starting value and a rate.");
    if (d.appliesTo === "rep" && !d.repId) return setError("Choose the rep this rule is for.");
    if (d.appliesTo === "store" && !d.storeId) return setError("Choose the store this rule is for.");

    setSaving(true);
    try {
      await saveRule(
        supabase,
        orgId,
        {
          name: d.name.trim(),
          description: d.description.trim() || null,
          kind: d.kind,
          rate: d.rate === "" ? null : Number(d.rate),
          fixedAmount: d.fixedAmount === "" ? null : Number(d.fixedAmount),
          tiers: d.tiers
            .map((t) => ({ from: Number(t.from), to: t.to === "" ? null : Number(t.to), rate: Number(t.rate) }))
            .sort((a, b) => a.from - b.from),
          basis: d.basis,
          appliesTo: d.appliesTo,
          repId: d.repId || null,
          storeId: d.storeId || null,
          minOrderValue: Number(d.minOrderValue) || 0,
          priority: Number(d.priority) || 0,
          active: d.active,
        },
        editing.id
      );
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const set = (patch: Partial<Draft>) =>
    setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/commissions" className="text-sm text-muted-foreground hover:text-foreground">
            ← Commissions
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground">Commission rules</h1>
          <p className="text-sm text-muted-foreground">
            Each delivered order earns from the highest-priority rule that matches it. A rule for
            one rep or store beats a rule for everyone at the same priority.
          </p>
        </div>
        {!editing && (
          <Button onClick={() => setEditing({ draft: { ...EMPTY } })}>
            <Plus className="mr-1.5 h-4 w-4" /> Add rule
          </Button>
        )}
      </div>

      <ErrorBanner message={error} />

      {editing && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{editing.id ? "Edit rule" : "New rule"}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={editing.draft.name} onChange={(e) => set({ name: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="desc">Description</Label>
              <Input id="desc" value={editing.draft.description} onChange={(e) => set({ description: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="kind">Type</Label>
              <NativeSelect id="kind" value={editing.draft.kind} onChange={(e) => set({ kind: e.target.value as Draft["kind"] })}>
                {Object.entries(KIND_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {editing.draft.kind !== "fixed" && (
              <div>
                <Label htmlFor="basis">Calculated on</Label>
                <NativeSelect id="basis" value={editing.draft.basis} onChange={(e) => set({ basis: e.target.value })}>
                  {Object.entries(BASIS_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
            {editing.draft.kind === "percentage" && (
              <div>
                <Label htmlFor="rate">Rate (%)</Label>
                <Input id="rate" type="number" min={0} max={100} step="0.1" value={editing.draft.rate} onChange={(e) => set({ rate: e.target.value })} />
              </div>
            )}
            {editing.draft.kind === "fixed" && (
              <div>
                <Label htmlFor="fixed">Amount per order</Label>
                <Input id="fixed" type="number" min={0} step="0.01" value={editing.draft.fixedAmount} onChange={(e) => set({ fixedAmount: e.target.value })} />
              </div>
            )}
            {editing.draft.kind === "tiered" && (
              <div className="space-y-2 sm:col-span-2">
                <Label>Tiers, by order value excl. VAT — the matching tier&apos;s rate applies to the whole order</Label>
                {editing.draft.tiers.map((t, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input type="number" min={0} value={t.from} placeholder="From" className="w-32" aria-label="From"
                      onChange={(e) => set({ tiers: editing.draft.tiers.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)) })} />
                    <span className="text-sm text-muted-foreground">to</span>
                    <Input type="number" min={0} value={t.to} placeholder="No limit" className="w-32" aria-label="To"
                      onChange={(e) => set({ tiers: editing.draft.tiers.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)) })} />
                    <span className="text-sm text-muted-foreground">=</span>
                    <Input type="number" min={0} max={100} step="0.1" value={t.rate} placeholder="%" className="w-24" aria-label="Rate"
                      onChange={(e) => set({ tiers: editing.draft.tiers.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)) })} />
                    <span className="text-sm text-muted-foreground">%</span>
                    {editing.draft.tiers.length > 1 && (
                      <Button variant="ghost" size="icon" aria-label="Remove tier"
                        onClick={() => set({ tiers: editing.draft.tiers.filter((_, j) => j !== i) })}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button variant="outline" size="sm"
                  onClick={() => {
                    const last = editing.draft.tiers.at(-1);
                    set({ tiers: [...editing.draft.tiers, { from: last?.to ?? "", to: "", rate: "" }] });
                  }}>
                  <Plus className="mr-1.5 h-4 w-4" /> Add tier
                </Button>
              </div>
            )}
            <div>
              <Label htmlFor="applies">Applies to</Label>
              <NativeSelect id="applies" value={editing.draft.appliesTo} onChange={(e) => set({ appliesTo: e.target.value as Draft["appliesTo"] })}>
                <option value="all">All orders</option>
                <option value="rep">One rep</option>
                <option value="store">One store</option>
              </NativeSelect>
            </div>
            {editing.draft.appliesTo === "rep" && (
              <div>
                <Label htmlFor="rep">Rep</Label>
                <NativeSelect id="rep" value={editing.draft.repId} onChange={(e) => set({ repId: e.target.value })}>
                  <option value="">Choose a rep</option>
                  {reps.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.full_name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
            {editing.draft.appliesTo === "store" && (
              <div>
                <Label htmlFor="store">Store</Label>
                <NativeSelect id="store" value={editing.draft.storeId} onChange={(e) => set({ storeId: e.target.value })}>
                  <option value="">Choose a store</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.city ? ` — ${s.city}` : ""}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
            <div>
              <Label htmlFor="min">Minimum order value (excl. VAT)</Label>
              <Input id="min" type="number" min={0} value={editing.draft.minOrderValue} onChange={(e) => set({ minOrderValue: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="priority">Priority (higher wins)</Label>
              <Input id="priority" type="number" value={editing.draft.priority} onChange={(e) => set({ priority: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Checkbox checked={editing.draft.active} onCheckedChange={(on) => set({ active: Boolean(on) })} />
              Active
            </label>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Saving does not change commissions already worked out. Use Recalculate period on the
              Commissions page to apply it; approved and paid commissions never change.
            </p>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save rule"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rule</TableHead>
              <TableHead>Pays</TableHead>
              <TableHead>Applies to</TableHead>
              <TableHead className="text-right">Min. order</TableHead>
              <TableHead className="text-right">Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <EmptyRow colSpan={7}>Loading…</EmptyRow>}
            {!loading && rules.length === 0 && <EmptyRow colSpan={7}>No rules yet. Add one to start earning commission.</EmptyRow>}
            {rules.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">
                  {r.name}
                  {r.description && <div className="text-xs font-normal text-muted-foreground">{r.description}</div>}
                </TableCell>
                <TableCell className="text-sm">{describeRule(r)}</TableCell>
                <TableCell className="text-sm">
                  {r.applies_to === "rep" ? repName(r.rep_id) : r.applies_to === "store" ? storeName(r.store_id) : "All orders"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{Number(r.min_order_value).toFixed(2)}</TableCell>
                <TableCell className="text-right tabular-nums">{r.priority}</TableCell>
                <TableCell>
                  <Badge variant={r.active ? "secondary" : "outline"}>{r.active ? "Active" : "Off"}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => setEditing({ id: r.id, draft: toDraft(r) })}>
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      if (!window.confirm(`Delete "${r.name}"? Commissions already worked out keep its name.`)) return;
                      try {
                        await deleteRule(supabase, r.id);
                        await load();
                      } catch (e) {
                        setError(e instanceof Error ? e.message : String(e));
                      }
                    }}
                  >
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
