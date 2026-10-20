"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { biggestPlan, contactHref, planFor, site } from "@/lib/site";

const WORKING_DAYS = 22;
// Starting values (19 Oct 2026, for distributors): 5 reps, one order a day that
// each rep misses, and an example order value. The owner types their own.
const START = { reps: "5", missed: "1", order: { R: "1000", P: "1000" } } as const;
type Currency = keyof typeof START.order;

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const num = (v: string) => Math.max(0, Number(v) || 0);

export function CostCalculator() {
  const [reps, setReps] = useState<string>(START.reps);
  const [missed, setMissed] = useState<string>(START.missed);
  const [currency, setCurrency] = useState<Currency>("R");
  const [order, setOrder] = useState<string>(START.order.R);

  const people = Math.floor(num(reps));
  const missedOrders = people * num(missed) * WORKING_DAYS;
  const lost = missedOrders * num(order);
  // The anchor: what this many reps would pay, at the plan's normal price (the
  // founding discount is only for the first 3 months, so the lasting price is
  // the honest one). Prices are in rand, so only beside rand. Said as the
  // orders a month that pay for it: Tickd shows which stores were missed; the
  // reps still have to go and sell.
  const plan = people <= 0 ? null : planFor(people);
  const paysFor = plan && num(order) > 0 ? Math.ceil(plan.monthly / num(order)) : 0;

  // One look for the three boxes: the same height, big digits, a one-line
  // label above each (owner, 20 Oct 2026: "missed orders", then "order value").
  const field =
    "h-12 w-full min-w-0 rounded-lg bg-mint px-3 text-lg font-semibold tabular-nums text-teal-900 ring-1 ring-line focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-700";
  const label = "grid content-end gap-1.5 text-sm font-semibold leading-tight text-teal-900";
  // Room for two lines above every box, so the three boxes line up when a
  // label wraps on a narrow phone.
  const text = "flex min-h-[2.5em] items-end";

  return (
    <div className="grid max-w-3xl gap-5 rounded-2xl bg-white p-5 ring-1 ring-line sm:p-6">
      <div className="grid gap-2">
        <div className="grid grid-cols-[0.8fr_0.9fr_1.3fr] gap-2.5 sm:grid-cols-3 sm:gap-3">
          <label className={label}>
            <span className={text}>Reps</span>
            <input className={field} type="number" min={1} max={500} inputMode="numeric" value={reps} onChange={(e) => setReps(e.target.value)} />
          </label>
          <label className={label}>
            <span className={text}>Missed orders</span>
            <input
              className={field}
              type="number"
              min={0}
              max={20}
              step={0.5}
              inputMode="decimal"
              value={missed}
              onChange={(e) => setMissed(e.target.value)}
              aria-describedby="calc-hint"
            />
          </label>
          <div className={label}>
            <label htmlFor="order" className={text}>
              Order value
            </label>
            <span className="relative">
              {/* The currency sits inside the box, as R or P, and opens to change. */}
              <select
                aria-label="Currency"
                className="absolute inset-y-1 left-1 z-10 w-10 cursor-pointer appearance-none rounded-md bg-transparent pl-2 text-lg font-semibold text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
                value={currency}
                onChange={(e) => {
                  const c = e.target.value as Currency;
                  setCurrency(c);
                  setOrder(START.order[c]);
                }}
              >
                <option value="R">R</option>
                <option value="P">P</option>
              </select>
              <ChevronDown aria-hidden="true" className="pointer-events-none absolute left-6 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
              <input
                id="order"
                className={`${field} pl-10`}
                type="number"
                min={0}
                step={50}
                inputMode="decimal"
                value={order}
                onChange={(e) => setOrder(e.target.value)}
              />
            </span>
          </div>
        </div>
        <p id="calc-hint" className="text-sm text-muted">
          Per rep, per day. {WORKING_DAYS} work days a month.
        </p>
      </div>

      <div aria-live="polite" className="grid gap-4 border-t border-line pt-5">
        <p className="grid gap-1">
          <span className="flex flex-wrap items-baseline gap-x-2 font-display font-extrabold leading-tight text-flag">
            <strong className="text-5xl tabular-nums sm:text-6xl">{fmt(missedOrders)}</strong>
            <span className="text-2xl">missed {missedOrders === 1 ? "order" : "orders"} a month</span>
          </span>
          <span className="text-lg leading-snug text-ink">
            That&apos;s up to{" "}
            <strong className="tabular-nums text-teal-900">
              {currency}
              {fmt(lost)}
            </strong>{" "}
            in sales you don&apos;t make.
          </span>
        </p>
        {currency === "R" && plan && paysFor > 0 && (
          <p className="rounded-xl bg-teal-900 px-4 py-3.5 leading-snug text-teal-100">
            {site.name} pays for itself with{" "}
            <strong className="whitespace-nowrap font-display text-xl font-extrabold text-amber-500">
              {paysFor} {paysFor === 1 ? "order" : "orders"} a month
            </strong>
            .
          </p>
        )}
        {currency === "R" && people > biggestPlan.reps && (
          <p className="leading-snug text-ink">
            More than {biggestPlan.reps} reps?{" "}
            <a
              href={contactHref(`Hi, we have ${people} reps. What would ${site.name} cost us?`)}
              className="font-semibold text-teal-900 underline underline-offset-4 hover:text-teal-700"
            >
              Ask us for a price
            </a>
            .
          </p>
        )}
      </div>
    </div>
  );
}
