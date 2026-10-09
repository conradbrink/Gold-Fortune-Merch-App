"use client";

import { Cctv, FileCheck2, ShieldCheck, ShoppingCart, SprayCan, Sprout, Wrench, Zap } from "lucide-react";
import { useRef, useState } from "react";

const trades = [
  { name: "Cleaning", icon: SprayCan, line: "Which rooms were cleaned, when your team was there, and how long they spent on site." },
  { name: "CCTV install", icon: Cctv, line: "How long your technicians spent on each site, and how many kilometres they drove that day." },
  { name: "Electricians", icon: Zap, line: "Photos of the finished work, the hours on every job, and the kilometres driven that day." },
  { name: "Patrols", icon: ShieldCheck, line: "Proof that your guard was on site at 02:00, with the time and place on every check-in." },
  { name: "Maintenance", icon: Wrench, line: "How long each job took and what was fixed, with photos of the work." },
  { name: "Garden, pest, pool", icon: Sprout, line: "Every house on the route done, on time, with a photo to show for it." },
  { name: "Sales reps", icon: ShoppingCart, line: "Which shops were visited, the orders taken, and how the shelves looked." },
];

// On a phone the trades are one row you swipe sideways (no ragged wrap); from
// md up they are a list down the left with the answer beside it. ARIA tabs:
// arrow keys move and select, Home/End jump, only the selected tab is in the
// Tab order. The answer fades in on a click, never on a key (design rule:
// keyboard actions are not animated).
export function TradeTabs() {
  const [active, setActive] = useState(0);
  const [animate, setAnimate] = useState(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const t = trades[active];
  const Icon = t.icon;

  function select(i: number, viaKey: boolean) {
    setAnimate(!viaKey);
    setActive(i);
    tabs.current[i]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function onKeyDown(e: React.KeyboardEvent, i: number) {
    const last = trades.length - 1;
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? (i === last ? 0 : i + 1)
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i === 0 ? last : i - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    select(next, true);
    tabs.current[next]?.focus();
  }

  return (
    <div className="grid gap-4 md:grid-cols-[15rem_1fr] md:gap-6">
      <div
        role="tablist"
        aria-label="Trades"
        className="-mx-4 -my-1.5 flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto px-4 py-1.5 [mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)] [scrollbar-width:none] md:mx-0 md:my-0 md:flex-col md:overflow-visible md:p-0 md:[mask-image:none] [&::-webkit-scrollbar]:hidden"
      >
        {trades.map((tr, i) => {
          const TabIcon = tr.icon;
          const on = i === active;
          return (
            <button
              key={tr.name}
              type="button"
              role="tab"
              id={`trade-tab-${i}`}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              aria-selected={on}
              aria-controls="trade-panel"
              tabIndex={on ? 0 : -1}
              onClick={() => select(i, false)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`flex min-h-11 shrink-0 snap-start items-center gap-2.5 whitespace-nowrap rounded-full px-4 text-sm font-semibold transition-[background-color,color,box-shadow] duration-150 ease-out md:min-h-12 md:rounded-xl md:px-4 md:text-base ${
                on
                  ? "bg-teal-900 text-sand"
                  : "bg-white text-teal-900 ring-1 ring-line md:bg-transparent md:ring-0 md:hover:bg-white"
              }`}
            >
              <TabIcon className={`size-4 shrink-0 md:size-5 ${on ? "text-amber-500" : "text-teal-700"}`} strokeWidth={2.25} aria-hidden="true" />
              {tr.name}
            </button>
          );
        })}
      </div>

      <div
        id="trade-panel"
        role="tabpanel"
        aria-labelledby={`trade-tab-${active}`}
        className="grid content-between gap-6 rounded-2xl bg-white p-5 ring-1 ring-line sm:p-8"
      >
        <div key={active} className={`grid gap-4 ${animate ? "tk-swap" : ""}`}>
          <span className="tk-icon-spring grid size-12 place-items-center rounded-xl bg-amber-500 text-teal-950">
            <Icon className="size-6" strokeWidth={2.25} aria-hidden="true" />
          </span>
          <p className="max-w-2xl font-display text-xl font-bold leading-snug text-balance text-teal-900 sm:text-3xl sm:leading-tight">
            {t.line}
          </p>
        </div>
        <p className="flex items-start gap-2.5 border-t border-line pt-4 font-medium leading-relaxed text-ink">
          <FileCheck2 className="mt-0.5 size-5 shrink-0 text-teal-700" strokeWidth={2.25} aria-hidden="true" />
          Whatever your trade, every job ends with a signed report you can send straight to your client.
        </p>
      </div>
    </div>
  );
}
