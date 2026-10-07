"use client";

import { useState } from "react";

const trades = [
  {
    name: "Contract cleaning",
    scene: "The building manager says the bathrooms weren't done on Tuesday. Your contract is up for renewal next month.",
    team: "Cleaners at offices, clinics and complexes",
    prove: "That the site was cleaned, and for how long, to your client.",
    how: "Check-in and check-out times, before-and-after photos and the client's signature, in a proof-of-work report after every clean.",
  },
  {
    name: "Security and CCTV installation",
    scene: "A job quoted at four hours shows up as a full day on the timesheet, plus 80 km of fuel.",
    team: "Installers and technicians",
    prove: "Time on site, the work done, and kilometres per job.",
    how: "Day replay shows time at each site. Photos and your checklist show the work. Kilometres are recorded per day.",
  },
  {
    name: "Security patrols",
    scene: "There's a break-in at 02:00. The client asks one question: was your guard on the property?",
    team: "Guards and patrol officers",
    prove: "That every site was visited, when they said.",
    how: "GPS check-ins at each site, a recorded route, and scorecards that show missed visits.",
  },
  {
    name: "Maintenance and facilities",
    scene: "The client says your technician was there for twenty minutes and the leak is back. Your technician says two hours.",
    team: "Technicians",
    prove: "Response, time on site, and what was fixed.",
    how: "Time-stamped check-ins and time on site, plus a proof-of-work report with photos, what was fixed and the client's signature.",
  },
  {
    name: "Garden, pest control, pool service",
    scene: "Forty properties on the round this week. One was skipped. You'll find out when that client cancels.",
    team: "Small crews on repeat rounds",
    prove: "Every property done, on schedule.",
    how: "Repeat visits on the schedule, and scorecards that show who keeps to it.",
  },
  {
    name: "Distribution and FMCG",
    scene: "Your rep says they visited twelve stores today. The orders say four. The shelves at store nine are empty.",
    team: "Sales reps and merchandisers",
    prove: "Store visits, orders taken, shelves checked.",
    how: "Orders and in-store compliance checks happen on the same visit, in the same app. Tax invoices, payments and what each store still owes are on your dashboard.",
  },
];

export function TradeTabs() {
  const [active, setActive] = useState(0);
  const t = trades[active];

  return (
    <div className="grid gap-5">
      <div role="tablist" aria-label="Trades" className="flex flex-wrap gap-2">
        {trades.map((tr, i) => (
          <button
            key={tr.name}
            type="button"
            role="tab"
            id={`trade-tab-${i}`}
            aria-selected={i === active}
            aria-controls="trade-panel"
            onClick={() => setActive(i)}
            className={`rounded-full px-4 py-2 text-sm font-medium ring-1 transition ${
              i === active ? "bg-teal-900 text-sand ring-teal-900" : "bg-white text-ink ring-line hover:ring-teal-700"
            }`}
          >
            {tr.name}
          </button>
        ))}
      </div>
      <div
        id="trade-panel"
        role="tabpanel"
        aria-labelledby={`trade-tab-${active}`}
        className="grid max-w-3xl gap-3 rounded-2xl bg-white p-6 ring-1 ring-line"
      >
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">{t.team}</p>
        <p className="border-l-[3px] border-flag pl-3 italic leading-relaxed">{t.scene}</p>
        <h3 className="font-display text-2xl font-bold text-teal-900">You need to prove: {t.prove}</h3>
        <p className="leading-relaxed text-muted">{t.how}</p>
      </div>
    </div>
  );
}
