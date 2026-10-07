"use client";

import { useState } from "react";

const trades = [
  { name: "Cleaning", line: "Which rooms were cleaned, when your team was there, and how long they spent on site." },
  { name: "CCTV install", line: "How long your technicians spent on each site, and how many kilometres they drove to get there." },
  { name: "Patrols", line: "Proof that your guard was on site at 02:00, with the time and place on every check-in." },
  { name: "Maintenance", line: "How long each job took and what was fixed, with photos of the work." },
  { name: "Garden, pest, pool", line: "Every house on the route done, on time, with a photo to show for it." },
  { name: "Sales reps", line: "Which shops were visited, the orders taken, and how the shelves looked." },
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
        <p className="font-display text-2xl font-bold leading-snug text-teal-900">{t.line}</p>
      </div>
    </div>
  );
}
