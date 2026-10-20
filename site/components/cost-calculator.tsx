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
    "w-full min-h-12 rounded-lg bg-mint px-3 py-2 text-lg tabular-nums ring-1 ring-line focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-700";
  const label = "grid content-start gap-1 text-sm font-medium leading-tight";
  // Two lines kept for every label, so the three boxes line up.
  const text = "flex min-h-[2.5em] items-end";

  // Small enough to sit on one phone screen with its heading (owner, 20 Oct
  // 2026): three boxes on one row, the answer in one sentence, and the price
  // inside the "pays for itself" line.
  return (
    <div className="grid gap-5 rounded-2xl bg-white p-4 ring-1 ring-line sm:p-6 md:grid-cols-2 md:gap-8">
      <div className="grid grid-cols-3 content-start gap-2 sm:gap-3">
        <label className={label}>
          <span className={text}>Reps</span>
          <input className={field} type="number" min={1} max={500} inputMode="numeric" value={reps} onChange={(e) => setReps(e.target.value)} />
        </label>
        <label className={label}>
          <span className={text}>Missed a day per rep</span>
          <input
            className={field}
            type="number"
            min={0}
            max={20}
            step={0.5}
            inputMode="decimal"
            value={missed}
            onChange={(e) => setMissed(e.target.value)}
          />
        </label>
        <div className={label}>
          <span className={`${text} justify-between gap-1`}>
            <label htmlFor="order">Average order</label>
            <select
              aria-label="Currency"
              className="rounded bg-transparent text-sm font-semibold text-teal-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
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
          </span>
          <input id="order" className={field} type="number" min={0} step={50} inputMode="decimal" value={order} onChange={(e) => setOrder(e.target.value)} />
        </div>
      </div>
      <div aria-live="polite" className="grid content-center gap-4">
        <p className="text-lg leading-snug">
          <strong className="font-display text-4xl font-extrabold tabular-nums text-flag sm:text-5xl">
            {fmt(visits)} {visits === 1 ? "visit" : "visits"}
          </strong>{" "}
          a month with no order ({WORKING_DAYS} work days). That&apos;s up to{" "}
          <strong className="tabular-nums text-flag">
            {currency}
            {fmt(orders)}
          </strong>{" "}
          in orders.
        </p>
        {currency === "R" && plan && paysFor > 0 && (
          <p className="rounded-xl bg-teal-900 px-4 py-3 leading-snug text-teal-100">
            At {rand(plan.monthly)} a month{"founding" in plan ? " (founding price)" : ""}, {site.name} pays for itself when your reps win
            back{" "}
            <strong className="font-display text-2xl font-extrabold tabular-nums text-amber-500">
              {paysFor} {paysFor === 1 ? "order" : "orders"} a month
            </strong>
            .
          </p>
        )}
        {currency === "R" && people > biggestPlan.reps && (
          <p className="leading-snug">
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
