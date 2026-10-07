"use client";

import { useState } from "react";

const WORKING_DAYS = 22;
// R30.23 is South Africa's national minimum wage from 1 March 2026; the
// pula figure is still an example. The owner types their own either way.
const defaultRate = { R: 30.23, P: 15 } as const;
type Currency = keyof typeof defaultRate;

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const num = (v: string) => Math.max(0, Number(v) || 0);

export function CostCalculator() {
  const [staff, setStaff] = useState("10");
  const [lost, setLost] = useState("1");
  const [currency, setCurrency] = useState<Currency>("R");
  const [rate, setRate] = useState(String(defaultRate.R));

  const hours = num(staff) * num(lost) * WORKING_DAYS;
  const monthly = hours * num(rate);

  const field = "w-full rounded-lg bg-sand px-3 py-2.5 ring-1 ring-line focus:outline-none focus:ring-2 focus:ring-teal-700";

  return (
    <div className="grid gap-8 rounded-2xl bg-white p-6 ring-1 ring-line md:grid-cols-2 md:p-8">
      <div className="grid gap-4">
        <label className="grid gap-1.5 text-sm font-medium">
          People in the field
          <input className={field} type="number" min={1} max={500} inputMode="numeric" value={staff} onChange={(e) => setStaff(e.target.value)} />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Hours lost a day to delays and admin
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
      <div aria-live="polite" className="grid content-center gap-2 border-t border-line pt-6 md:border-l md:border-t-0 md:pl-8 md:pt-0">
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
      </div>
    </div>
  );
}
