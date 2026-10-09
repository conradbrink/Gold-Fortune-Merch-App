"use client";

import { useState } from "react";
import { planPrice, rand, site } from "@/lib/site";

const WORKING_DAYS = 22;
// R30.23 is South Africa's national minimum wage from 1 March 2026; the
// pula figure is still an example. The owner types their own either way.
const defaultRate = { R: 30.23, P: 15 } as const;
type Currency = keyof typeof defaultRate;

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const num = (v: string) => Math.max(0, Number(v) || 0);

export function CostCalculator() {
  // Starting values the owner chose (9 Oct 2026): a small team, two hours a day.
  const [staff, setStaff] = useState("5");
  const [lost, setLost] = useState("2");
  const [currency, setCurrency] = useState<Currency>("R");
  const [rate, setRate] = useState(String(defaultRate.R));

  const people = Math.floor(num(staff));
  const hours = people * num(lost) * WORKING_DAYS;
  const monthly = hours * num(rate);
  // The anchor: Tickd's monthly price for the same team, from the same
  // numbers as the pricing section. Prices are in rand, so only beside rand.
  // Every active login is a paid seat (billing_seats_used), the owner's too,
  // so the price is for the staff on site plus you.
  const tickd = people > 0 ? planPrice(people + 1, "monthly") : 0;

  const field =
    "w-full min-h-11 rounded-lg bg-mint px-3 py-2.5 ring-1 ring-line focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-700";

  return (
    <div className="grid gap-8 rounded-2xl bg-white p-5 ring-1 ring-line sm:p-8 md:grid-cols-2">
      <div className="grid content-start gap-4">
        <label className="grid gap-1.5 text-sm font-medium">
          Staff who work out on site
          <input className={field} type="number" min={1} max={500} inputMode="numeric" value={staff} onChange={(e) => setStaff(e.target.value)} />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Hours each person loses a day to waiting and paperwork
          <input className={field} type="number" min={0} max={8} step={0.25} inputMode="decimal" value={lost} onChange={(e) => setLost(e.target.value)} />
        </label>
        <div className="grid gap-1.5 text-sm font-medium">
          <label htmlFor="rate">Pay per hour</label>
          <div className="grid grid-cols-[6.5rem_1fr] gap-2">
            <select
              aria-label="Currency"
              className={field}
              value={currency}
              onChange={(e) => {
                const c = e.target.value as Currency;
                setCurrency(c);
                setRate(String(defaultRate[c]));
              }}
            >
              <option value="R">ZAR (R)</option>
              <option value="P">BWP (P)</option>
            </select>
            <input id="rate" className={field} type="number" min={0} step={0.01} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
          </div>
        </div>
        <p className="text-sm text-muted">
          {WORKING_DAYS} work days a month. R30.23 is the SA minimum wage.
        </p>
      </div>
      <div aria-live="polite" className="grid content-center gap-5 border-t border-line pt-6 md:border-l md:border-t-0 md:pl-8 md:pt-0">
        <p className="text-xl leading-snug sm:text-2xl">
          That&apos;s{" "}
          <strong className="block font-display text-5xl font-extrabold tabular-nums text-flag sm:text-6xl">
            {fmt(hours)} hours
          </strong>
          a month you&apos;re paying for and could win back. That&apos;s about{" "}
          <strong className="tabular-nums text-flag">
            {currency}
            {fmt(monthly)}
          </strong>{" "}
          a month.
        </p>
        {currency === "R" && tickd > 0 && (
          <p className="flex flex-wrap items-baseline gap-x-2 border-t border-line pt-5 text-lg leading-snug">
            <span>
              {site.name} for {people} {people === 1 ? "person" : "people"} and you:
            </span>
            <strong className="font-display text-2xl font-extrabold tabular-nums text-teal-900">{rand(tickd)} a month</strong>
          </p>
        )}
      </div>
    </div>
  );
}
