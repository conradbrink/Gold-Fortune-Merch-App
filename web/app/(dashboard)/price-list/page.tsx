"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  createServiceItem,
  deleteServiceItem,
  fetchServiceItems,
  updateServiceItem,
  type ServiceItem,
} from "@/lib/service-items";
import { validPrice } from "@/lib/money-docs";
import { formatMoney } from "@/lib/money";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { lower } from "@/lib/terms";

type Draft = { name: string; unit: string; price: string; description: string; active: boolean };

const toDraft = (i: ServiceItem): Draft => ({
  name: i.name,
  unit: i.unit,
  price: i.unit_price === null ? "" : String(i.unit_price),
  description: i.description ?? "",
  active: i.active,
});

const empty: Draft = { name: "", unit: "", price: "", description: "", active: true };

/**
 * The price list: what the company charges for, per unit. Quotes and invoices
 * pick from it; each line copies the name, unit and price, so a change here
 * never alters a document already written. The trade's usual items arrive
 * without prices — blank means "not set yet" — and can be renamed, priced,
 * hidden or removed.
 */
export default function PriceListPage() {
  const supabase = createClient();
  const t = useTerms();
  const currency = useCompanyConfig()?.settings.currency_code ?? "";
  const [items, setItems] = useState<ServiceItem[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(empty);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [org, list] = await Promise.all([fetchOrgId(supabase), fetchServiceItems(supabase)]);
      setOrgId(org);
      setItems(list);
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

  function problem(d: Draft): string | null {
    if (d.name.trim() === "") return "An item needs a name.";
    if (d.unit.trim() === "") return `Say what it is charged per: each, hour, ${lower(t.job.one)}, m²…`;
    if (d.unit.trim().length > 20) return "A unit is up to 20 characters.";
    if (d.price.trim() !== "" && !validPrice(d.price)) return "A price is zero or more, to the cent.";
    return null;
  }

  async function save() {
    const p = problem(draft);
    if (p) return setError(p);
    if (!orgId) return;
    setBusy(true);
    setError(null);
    const input = {
      name: draft.name,
      unit: draft.unit,
      unitPrice: draft.price.trim() === "" ? null : Number(draft.price),
      description: draft.description || null,
      active: draft.active,
    };
    try {
      if (adding) {
        const last = items.reduce((n, i) => Math.max(n, i.sort_order), 0);
        await createServiceItem(supabase, orgId, input, last + 10);
      } else if (editing) {
        await updateServiceItem(supabase, editing, input);
      }
      setAdding(false);
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(i: ServiceItem) {
    if (!window.confirm(`Remove "${i.name}" from the price list? Quotes and invoices that used it keep their lines.`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteServiceItem(supabase, i.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const unpriced = items.filter((i) => i.active && i.unit_price === null).length;

  const editRow = (key: string) => (
    <TableRow key={key}>
      <TableCell>
        <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Name" autoFocus />
        <Input
          className="mt-1"
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          placeholder="Description (optional)"
          aria-label="Description"
        />
      </TableCell>
      <TableCell>
        <Input value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} placeholder="hour" aria-label="Unit" />
      </TableCell>
      <TableCell>
        <Input
          type="number"
          min={0}
          step="0.01"
          value={draft.price}
          onChange={(e) => setDraft({ ...draft, price: e.target.value })}
          placeholder="Not set"
          aria-label="Price"
          className="text-right"
        />
      </TableCell>
      <TableCell>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
          In use
        </label>
      </TableCell>
      <TableCell className="text-right whitespace-nowrap">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => { setAdding(false); setEditing(null); setError(null); }}>
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Price list</h1>
          <p className="text-sm text-muted-foreground">
            What you charge for. Quotes and invoices pick from it; changing a price here never changes a document already written.
          </p>
        </div>
        <Button
          disabled={busy || adding || editing !== null}
          onClick={() => {
            setDraft(empty);
            setAdding(true);
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" /> Add item
        </Button>
      </div>

      <ErrorBanner message={error} />

      {unpriced > 0 && (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
          {unpriced} item{unpriced === 1 ? " has" : "s have"} no price yet. Set your prices so quotes and invoices fill them in.
        </p>
      )}

      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="w-32">Per</TableHead>
              <TableHead className="w-36 text-right">Price</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-40" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <EmptyRow colSpan={5}>Loading…</EmptyRow>}
            {!loading && items.length === 0 && !adding && (
              <EmptyRow colSpan={5}>Nothing on the price list yet. Add what you charge for.</EmptyRow>
            )}
            {adding && editRow("new")}
            {items.map((i) =>
              editing === i.id ? (
                editRow(i.id)
              ) : (
                <TableRow key={i.id} className={i.active ? undefined : "text-muted-foreground"}>
                  <TableCell>
                    <span className="font-medium">{i.name}</span>
                    {i.description && <div className="text-xs text-muted-foreground">{i.description}</div>}
                  </TableCell>
                  <TableCell>{i.unit}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {i.unit_price === null ? <span className="text-muted-foreground">Not set</span> : formatMoney(i.unit_price, currency)}
                  </TableCell>
                  <TableCell>{i.active ? "In use" : "Hidden"}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy || adding || editing !== null}
                      onClick={() => {
                        setDraft(toDraft(i));
                        setEditing(i.id);
                      }}
                    >
                      Edit
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={`Remove ${i.name}`} disabled={busy} onClick={() => remove(i)}>
                      <Trash2 className="h-4 w-4" />
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
