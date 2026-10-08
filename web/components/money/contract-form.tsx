"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineEditor, lineProblem, type EditableLine } from "@/components/money/line-editor";
import { firstBilledPeriod, periodLabel } from "@/lib/contract-periods";
import { formatDateOnly } from "@/lib/format-date";
import type { ServiceItem } from "@/lib/service-items";
import type { ContractInput } from "@/lib/contracts";
import { useTerms } from "@/lib/use-company-config";
import { lower, type Terms } from "@/lib/terms";

/**
 * A contract's terms and lines. Once a period has been invoiced, how it is
 * billed (site, period, in advance or arrears, day, start) is fixed — the
 * database refuses a change — so those fields are read-only then.
 */

export type ContractDraft = Omit<ContractInput, "invoiceDay" | "endsOn" | "reference" | "notes"> & {
  invoiceDay: string;
  endsOn: string;
  reference: string;
  notes: string;
};

export function contractProblem(d: ContractDraft, lines: EditableLine[], t: Terms): string | null {
  if (!d.storeId) return `Choose the ${lower(t.site.one)}.`;
  if (d.name.trim() === "") return "Give the contract a name the client will recognise.";
  const day = Number(d.invoiceDay);
  if (!Number.isInteger(day) || day < 1 || day > 28) return "The invoice day is 1 to 28.";
  if (!d.startsOn) return "Say when the service starts.";
  if (d.endsOn && d.endsOn < d.startsOn) return "The end date is before the start.";
  return lineProblem(lines);
}

export function ContractForm({
  draft,
  onChange,
  lines,
  onLinesChange,
  stores,
  items,
  currency,
  vatRate,
  pricesIncludeVat,
  termsFixed,
  today,
  disabled,
}: {
  draft: ContractDraft;
  onChange: (d: ContractDraft) => void;
  lines: EditableLine[];
  onLinesChange: (l: EditableLine[]) => void;
  stores: { id: string; name: string; city: string | null }[];
  items: ServiceItem[];
  currency: string;
  vatRate: number;
  pricesIncludeVat: boolean;
  /** Invoiced already: how it is billed cannot change. */
  termsFixed: boolean;
  /** For the preview of a new contract's first invoice (YYYY-MM-DD, local). */
  today: string | null;
  disabled?: boolean;
}) {
  const t = useTerms();
  const set = (patch: Partial<ContractDraft>) => onChange({ ...draft, ...patch });
  const day = Number(draft.invoiceDay);
  const first =
    today && draft.startsOn && Number.isInteger(day) && day >= 1 && day <= 28
      ? firstBilledPeriod(draft.startsOn, { period: draft.period, billing: draft.billing, invoiceDay: day }, today)
      : null;
  const fixed = termsFixed || disabled;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">The contract</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="c-store">{t.site.one}</Label>
            <NativeSelect id="c-store" value={draft.storeId} disabled={fixed} onChange={(e) => set({ storeId: e.target.value })}>
              <option value="">{`Choose the ${lower(t.site.one)}…`}</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.city ? ` — ${s.city}` : ""}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="c-name">Name</Label>
            <Input
              id="c-name"
              value={draft.name}
              disabled={disabled}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="What the client calls it, e.g. Office cleaning, weekdays"
            />
          </div>
          <div>
            <Label htmlFor="c-period">Invoiced</Label>
            <NativeSelect
              id="c-period"
              value={draft.period}
              disabled={fixed}
              onChange={(e) => set({ period: e.target.value as ContractDraft["period"] })}
            >
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
            </NativeSelect>
          </div>
          <div>
            <Label htmlFor="c-billing">For the period</Label>
            <NativeSelect
              id="c-billing"
              value={draft.billing}
              disabled={fixed}
              onChange={(e) => set({ billing: e.target.value as ContractDraft["billing"] })}
            >
              <option value="advance">In advance (at its start)</option>
              <option value="arrears">In arrears (after it ends)</option>
            </NativeSelect>
          </div>
          <div>
            <Label htmlFor="c-day">Invoice day of the month</Label>
            <Input
              id="c-day"
              type="number"
              min={1}
              max={28}
              value={draft.invoiceDay}
              disabled={fixed}
              onChange={(e) => set({ invoiceDay: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="c-start">Service starts</Label>
            <Input id="c-start" type="date" value={draft.startsOn} disabled={fixed} onChange={(e) => set({ startsOn: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="c-end">Service ends (optional)</Label>
            <Input id="c-end" type="date" value={draft.endsOn} disabled={disabled} onChange={(e) => set({ endsOn: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="c-ref">The client&apos;s reference</Label>
            <Input
              id="c-ref"
              value={draft.reference}
              disabled={disabled}
              onChange={(e) => set({ reference: e.target.value })}
              placeholder="Order or contract number, printed on each invoice"
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="c-notes">Notes</Label>
            <Textarea id="c-notes" rows={2} value={draft.notes} disabled={disabled} onChange={(e) => set({ notes: e.target.value })} />
          </div>
          <p className="text-sm text-muted-foreground sm:col-span-2">
            {termsFixed
              ? "This contract has been invoiced, so how it is billed is fixed. End it and start a new one to change that."
              : first
                ? `First invoice on ${formatDateOnly(first.invoiceOn)}, for ${periodLabel(first.start, first.end)}. Billing starts with the first whole month, and nothing before today is invoiced by itself.`
                : "Billing starts with the first whole month after the service starts."}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Each {draft.period === "quarterly" ? "quarter" : "month"} it invoices</CardTitle>
        </CardHeader>
        <CardContent>
          <LineEditor
            lines={lines}
            onChange={onLinesChange}
            items={items}
            currency={currency}
            vatRate={vatRate}
            pricesIncludeVat={pricesIncludeVat}
            disabled={disabled}
          />
        </CardContent>
      </Card>
    </div>
  );
}
