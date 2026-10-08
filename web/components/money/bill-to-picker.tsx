"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTerms } from "@/lib/use-company-config";
import { lower, type Terms } from "@/lib/terms";

/**
 * Who a quote or an invoice is for: one of the company's places on the books,
 * or someone who is not (yet) — a name, and an email and address if known.
 */

export type BillTo = { mode: "store" | "new"; storeId: string; name: string; email: string; address: string };

type PickableStore = { id: string; name: string; address: string | null; city: string | null };

/** The first problem, in words, or null when the choice is complete. */
export function billToProblem(b: BillTo, t: Terms): string | null {
  if (b.mode === "store" && !b.storeId) return `Choose the ${lower(t.site.one)}, or someone new.`;
  if (b.mode === "new" && b.name.trim() === "") return `Give the ${lower(t.client.one)}'s name.`;
  return null;
}

export function BillToPicker({
  value,
  onChange,
  stores,
  disabled,
}: {
  value: BillTo;
  onChange: (b: BillTo) => void;
  stores: PickableStore[];
  disabled?: boolean;
}) {
  const t = useTerms();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? stores.filter((s) => s.name.toLowerCase().includes(q) || (s.city ?? "").toLowerCase().includes(q))
      : stores;
    return list.slice(0, 8);
  }, [stores, query]);
  // The chosen place's name when nothing is being typed: the choice survives
  // switching between "someone new" and back, and a value set from outside.
  const chosen = stores.find((s) => s.id === value.storeId);
  const shown = query !== "" || !chosen ? query : chosen.name + (chosen.city ? ` — ${chosen.city}` : "");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="bill-to"
            checked={value.mode === "new"}
            disabled={disabled}
            onChange={() => onChange({ ...value, mode: "new" })}
          />
          {`Someone new`}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="bill-to"
            checked={value.mode === "store"}
            disabled={disabled}
            onChange={() => onChange({ ...value, mode: "store" })}
          />
          {`A ${lower(t.site.one)} on the books`}
        </label>
      </div>

      {value.mode === "store" ? (
        <div className="relative">
          <Label htmlFor="bill-store">{t.site.one}</Label>
          <Input
            id="bill-store"
            value={shown}
            placeholder="Search by name or town"
            autoComplete="off"
            disabled={disabled}
            onFocus={() => setOpen(true)}
            // Delayed, as on the order form: on touch screens blur can land
            // before the tap, and the list would unmount before the choice.
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              if (value.storeId) onChange({ ...value, storeId: "" });
            }}
          />
          {open && !value.storeId && (
            <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-md">
              {matches.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange({ ...value, storeId: m.id });
                    setQuery(m.name + (m.city ? ` — ${m.city}` : ""));
                    setOpen(false);
                  }}
                >
                  {m.name}
                  {m.city && <span className="text-muted-foreground"> — {m.city}</span>}
                </button>
              ))}
              {matches.length === 0 && (
                <p className="px-3 py-2 text-sm text-muted-foreground">{`No ${lower(t.site.one)} matches.`}</p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="bill-name">Name</Label>
            <Input
              id="bill-name"
              value={value.name}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, name: e.target.value })}
              placeholder="A person or a business"
            />
          </div>
          <div>
            <Label htmlFor="bill-email">Email</Label>
            <Input
              id="bill-email"
              type="email"
              value={value.email}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, email: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="bill-address">Address</Label>
            <Input
              id="bill-address"
              value={value.address}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, address: e.target.value })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
