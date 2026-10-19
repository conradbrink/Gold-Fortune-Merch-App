"use client";

import { useState } from "react";
import { useSpotsLeft } from "@/components/founding-spots";
import { biggestPlan, contactHref, founding, planFor, rand, site } from "@/lib/site";

const WORKING_DAYS = 22;
// Starting values (19 Oct 2026, for distributors): 5 reps, one store a day that
// each rep doesn't get to, and an example order. The owner types their own.
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
  const visits = people * num(missed) * WORKING_DAYS;
  const orders = visits * num(order);
  // The anchor: what this many reps would pay, from the same numbers as the
  // offer: the founding price up to its reps, else the plan that fits. Prices
  // are in rand, so only beside rand. Said as the orders a month that pay for
  // it: Tickd shows which stores were missed; the reps still have to go and sell.
  // Once every founding spot is taken (the database says 0 left), the normal plan.
  const spotsLeft = useSpotsLeft();
  const foundingOpen = spotsLeft === null || spotsLeft > 0;
  const plan =
    people <= 0
      ? null
      : foundingOpen && people <= founding.reps
        ? { reps: founding.reps, monthly: founding.price, founding: true }
        : planFor(people);
  const paysFor = plan && num(order) > 0 ? Math.ceil(plan.monthly / num(order)) : 0;

  const field =
    "w-full min-h-11 rounded-lg bg-mint px-3 py-2.5 ring-1 ring-line focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-700";

  return (
    <div className="grid gap-8 rounded-2xl bg-white p-5 ring-1 ring-line sm:p-8 md:grid-cols-2">
      <div className="grid content-start gap-4">
        <label className="grid gap-1.5 text-sm font-medium">
          How many reps you have
          <input className={field} type="number" min={1} max={500} inputMode="numeric" value={reps} onChange={(e) => setReps(e.target.value)} />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Stores each rep misses a day
          <input
            className={field}
            type="number"
            min={0}
            max={20}
            step={0.5}
            inputMode="decimal"
            value={missed}
            onChange={(e) => setMissed(e.target.value)}
            aria-describedby="missed-why"
          />
          <span id="missed-why" className="font-normal text-muted">
            A late start, a long lunch, or a store skipped on the way.
          </span>
        </label>
        <div className="grid gap-1.5 text-sm font-medium">
          <label htmlFor="order">Your average order from a store</label>
          <div className="grid grid-cols-[6.5rem_1fr] gap-2">
            <select
              aria-label="Currency"
              className={field}
              value={currency}
              onChange={(e) => {
                const c = e.target.value as Currency;
                setCurrency(c);
                setOrder(START.order[c]);
              }}
            >
              <option value="R">ZAR (R)</option>
              <option value="P">BWP (P)</option>
            </select>
            <input id="order" className={field} type="number" min={0} step={50} inputMode="decimal" value={order} onChange={(e) => setOrder(e.target.value)} />
          </div>
        </div>
        <p className="text-sm text-muted">{WORKING_DAYS} work days a month.</p>
      </div>
      <div aria-live="polite" className="grid content-center gap-5 border-t border-line pt-6 md:border-l md:border-t-0 md:pl-8 md:pt-0">
        <p className="text-xl leading-snug sm:text-2xl">
          That&apos;s{" "}
          <strong className="block font-display text-5xl font-extrabold tabular-nums text-flag sm:text-6xl">
            {fmt(visits)} {visits === 1 ? "visit" : "visits"}
          </strong>
          a month where nobody takes an order. That could be up to{" "}
          <strong className="tabular-nums text-flag">
            {currency}
            {fmt(orders)}
          </strong>{" "}
          in orders a month.
        </p>
        {currency === "R" && plan && (
          <p className="flex flex-wrap items-baseline gap-x-2 border-t border-line pt-5 text-lg leading-snug">
            <span>
              {site.name} for up to {plan.reps} reps{"founding" in plan ? ", at the founding price" : ""}:
            </span>
            <strong className="font-display text-2xl font-extrabold tabular-nums text-teal-900">{rand(plan.monthly)} a month</strong>
          </p>
        )}
        {currency === "R" && plan && paysFor > 0 && (
          <p className="grid gap-1 rounded-2xl bg-teal-900 px-5 py-4 text-sand">
            <span className="leading-snug text-teal-100">{site.name} pays for itself when your reps win back</span>
            <strong className="font-display text-3xl font-extrabold tabular-nums text-amber-500 sm:text-4xl">
              {paysFor} {paysFor === 1 ? "order" : "orders"} a month
            </strong>
          </p>
        )}
        {currency === "R" && people > biggestPlan.reps && (
          <p className="border-t border-line pt-5 text-lg leading-snug">
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
