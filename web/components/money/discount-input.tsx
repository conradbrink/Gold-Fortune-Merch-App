"use client";

import { Input } from "@/components/ui/input";
import { currencySymbol, formatMoney } from "@/lib/money";
import { netUnitPrice, type DiscountKind } from "@/lib/orders";
import { cn } from "@/lib/utils";

/**
 * A line's discount: a percentage, or an amount off the whole line.
 *
 * One box with a two-way switch at its end, "%" or the currency's symbol, so
 * it fits the Discount column of a line beside the quantity. The value stays
 * as typed when the switch changes; the person sees what they typed and what
 * it now means.
 */
export function DiscountInput({
  value,
  kind,
  onChange,
  currency,
  disabled,
  className,
  "aria-label": ariaLabel = "Discount",
}: {
  value: string;
  kind: DiscountKind;
  onChange: (value: string, kind: DiscountKind) => void;
  currency: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  // The generic currency sign only until the company's currency has loaded.
  const symbol = (currency && currencySymbol(currency)) || "¤";
  const options: { kind: DiscountKind; text: string; label: string }[] = [
    { kind: "pct", text: "%", label: "Percentage off" },
    { kind: "amount", text: symbol, label: "Amount off the whole line" },
  ];
  return (
    <div
      data-slot="discount-input"
      className={cn(
        "flex h-8 w-full min-w-0 items-center rounded-lg border border-input bg-transparent transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
        disabled && "cursor-not-allowed opacity-50",
        className
      )}
    >
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        max={kind === "pct" ? 100 : undefined}
        step={kind === "pct" ? "0.5" : "0.01"}
        value={value}
        onChange={(e) => onChange(e.target.value, kind)}
        placeholder="0"
        aria-label={`${ariaLabel}, ${kind === "pct" ? "percentage" : "amount off the line"}`}
        disabled={disabled}
        className="h-full rounded-none border-0 bg-transparent pr-1 shadow-none focus-visible:ring-0 dark:bg-transparent [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <div role="group" aria-label={`${ariaLabel} as`} className="mr-0.5 flex shrink-0 rounded-md bg-muted p-0.5">
        {options.map((o) => (
          <button
            key={o.kind}
            type="button"
            aria-pressed={kind === o.kind}
            aria-label={o.label}
            title={o.label}
            disabled={disabled}
            onClick={() => onChange(value, o.kind)}
            className={cn(
              "h-5 min-w-5 rounded-[5px] px-1 text-xs font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none",
              kind === o.kind && "bg-background text-foreground shadow-xs"
            )}
          >
            {o.text}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The price each once an amount is spread over the line, "P16.67 each".
 *
 * P50 off 3 cannot be split evenly, and the cent goes the way the database
 * rounds it, so the line shows what it will actually charge. Nothing for a
 * percentage, or before there is a price and a quantity to work from.
 */
export function DiscountNote({
  listPrice,
  qty,
  discount,
  kind,
  currency,
  className,
}: {
  listPrice: number | null;
  qty: number;
  discount: number;
  kind: DiscountKind;
  currency: string;
  className?: string;
}) {
  if (kind !== "amount" || !(discount > 0) || listPrice == null || !(qty > 0)) return null;
  const each = netUnitPrice(listPrice, qty, discount, "amount");
  if (each < 0) return null;
  return (
    <p className={cn("mt-1 text-xs tabular-nums text-muted-foreground", className)}>
      {formatMoney(each, currency)} each
    </p>
  );
}
