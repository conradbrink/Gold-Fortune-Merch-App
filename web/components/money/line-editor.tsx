"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { documentTotals, lineTotal, validPrice, validQty } from "@/lib/money-docs";
import { formatMoney } from "@/lib/money";
import type { ServiceItem } from "@/lib/service-items";

/**
 * The lines of a quote or an invoice that are services or free text: a
 * description, a quantity (fractional — hours, square metres), a unit and a
 * price. Picking from the price list copies its name, unit and price into the
 * line; each can then be changed for this document only.
 */

export type EditableLine = {
  key: string;
  serviceItemId: string | null;
  description: string;
  unit: string;
  qty: string;
  price: string;
};

let seq = 0;
export function blankLine(item?: Pick<ServiceItem, "id" | "name" | "unit" | "unit_price"> | null): EditableLine {
  seq += 1;
  return {
    key: `l${Date.now()}-${seq}`,
    serviceItemId: item?.id ?? null,
    description: item?.name ?? "",
    unit: item?.unit ?? "",
    qty: "1",
    price: item?.unit_price === null || item?.unit_price === undefined ? "" : String(item.unit_price),
  };
}

/** The first problem with the lines, in words, or null when they can be saved. */
export function lineProblem(lines: EditableLine[]): string | null {
  if (lines.length === 0) return "Add at least one line.";
  if (lines.some((l) => l.description.trim() === "")) return "Every line needs a description.";
  if (lines.some((l) => !validQty(l.qty))) return "A quantity is more than zero, to two decimals.";
  if (lines.some((l) => !validPrice(l.price))) return "Every line needs a price, to the cent.";
  return null;
}

export function editableTotals(lines: EditableLine[], vatRate: number, inclusive: boolean) {
  return documentTotals(
    lines.map((l) => ({ qty: Number(l.qty) || 0, unitPrice: Number(l.price) || 0 })),
    vatRate,
    inclusive
  );
}

export function LineEditor({
  lines,
  onChange,
  items,
  currency,
  vatRate,
  pricesIncludeVat,
  disabled,
}: {
  lines: EditableLine[];
  onChange: (lines: EditableLine[]) => void;
  items: ServiceItem[];
  currency: string;
  vatRate: number;
  pricesIncludeVat: boolean;
  disabled?: boolean;
}) {
  const totals = editableTotals(lines, vatRate, pricesIncludeVat);
  const byId = new Map(items.map((i) => [i.id, i]));
  const update = (key: string, patch: Partial<EditableLine>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <div className="space-y-3">
      {lines.length > 0 && (
        <div className="space-y-2">
          <div className="hidden gap-2 px-1 text-xs font-medium text-muted-foreground sm:grid sm:grid-cols-[1fr_5rem_5.5rem_7rem_6.5rem_2.5rem]">
            <span>Description</span>
            <span>Qty</span>
            <span>Unit</span>
            <span>{pricesIncludeVat ? "Price incl. VAT" : "Price"}</span>
            <span className="text-right">Line total</span>
            <span />
          </div>
          {lines.map((l) => (
            <div
              key={l.key}
              className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 border-b border-border pb-2 sm:grid-cols-[1fr_5rem_5.5rem_7rem_6.5rem_2.5rem] sm:border-0 sm:pb-0"
            >
              <Input
                className="col-span-3 sm:col-span-1"
                value={l.description}
                onChange={(e) => update(l.key, { description: e.target.value })}
                placeholder={l.serviceItemId ? (byId.get(l.serviceItemId)?.name ?? "") : "What was done or supplied"}
                aria-label="Description"
                disabled={disabled}
              />
              <Input
                type="number"
                min={0}
                step="0.25"
                value={l.qty}
                onChange={(e) => update(l.key, { qty: e.target.value })}
                placeholder="Qty"
                aria-label="Quantity"
                disabled={disabled}
              />
              <Input
                className="col-span-2 sm:col-span-1"
                value={l.unit}
                onChange={(e) => update(l.key, { unit: e.target.value })}
                placeholder="each"
                aria-label="Unit"
                disabled={disabled}
              />
              <Input
                type="number"
                min={0}
                step="0.01"
                value={l.price}
                onChange={(e) => update(l.key, { price: e.target.value })}
                placeholder="0.00"
                aria-label="Price per unit"
                disabled={disabled}
              />
              <span className="text-right text-sm tabular-nums max-sm:col-span-1">
                {formatMoney(lineTotal(Number(l.qty) || 0, Number(l.price) || 0), currency)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove line"
                disabled={disabled}
                onClick={() => onChange(lines.filter((x) => x.key !== l.key))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {items.length > 0 && (
          <NativeSelect
            value=""
            aria-label="Add from the price list"
            disabled={disabled}
            onChange={(e) => {
              const item = byId.get(e.target.value);
              if (item) onChange([...lines, blankLine(item)]);
            }}
            className="w-64"
          >
            <option value="">Add from the price list…</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
                {i.unit_price !== null ? ` — ${formatMoney(i.unit_price, currency)} / ${i.unit}` : ` (per ${i.unit})`}
              </option>
            ))}
          </NativeSelect>
        )}
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => onChange([...lines, blankLine()])}>
          <Plus className="mr-1 h-4 w-4" /> Free-text line
        </Button>
      </div>

      <div className="ml-auto w-64 space-y-0.5 border-t border-border pt-2 text-sm">
        {vatRate > 0 && (
          <>
            <p className="flex justify-between text-muted-foreground">
              Subtotal (excl. VAT)
              <span className="tabular-nums text-foreground">{formatMoney(totals.subtotal, currency)}</span>
            </p>
            <p className="flex justify-between text-muted-foreground">
              {pricesIncludeVat ? `VAT ${vatRate}% (included)` : `VAT ${vatRate}%`}
              <span className="tabular-nums text-foreground">{formatMoney(totals.vat, currency)}</span>
            </p>
          </>
        )}
        <p className="flex justify-between font-medium">
          Total <span className="tabular-nums">{formatMoney(totals.total, currency)}</span>
        </p>
      </div>
    </div>
  );
}
