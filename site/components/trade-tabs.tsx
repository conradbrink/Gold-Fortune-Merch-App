"use client";

import { Cctv, FileCheck2, ShieldCheck, ShoppingCart, SprayCan, Sprout, Wrench, Zap } from "lucide-react";
import { useRef, useState } from "react";
import { PhoneShot } from "@/components/phone-shot";

// Each trade shows the staff-app screen closest to its line. The screens
// come from one example company, so they share its places and names.
const trades = [
  {
    name: "Cleaning",
    icon: SprayCan,
    line: "Which rooms were cleaned, when your team was there, and how long they spent on site.",
    screen: "05b-photo-taken",
    alt: "A cleaning checklist on the phone, with photos of the bathrooms taken in the app.",
  },
  {
    name: "CCTV install",
    icon: Cctv,
    line: "How long your technicians spent on each site, and how many kilometres they drove that day.",
    screen: "08-synced",
    alt: "The workday on the phone: 33 minutes worked, 6.8 km driven, and each site marked done or in progress.",
  },
  {
    name: "Electricians",
    icon: Zap,
    line: "Photos of the finished work, the hours on every job, and the kilometres driven that day.",
    screen: "04-site-checked-in",
    alt: "A job on the phone after checking in at 7:31, with the forms to fill in before checking out.",
  },
  {
    name: "Patrols",
    icon: ShieldCheck,
    line: "Proof that your guard was on site at 02:00, with the time and place on every check-in.",
    screen: "03-site-before-checkin",
    alt: "The check-in button on the phone. The GPS location is recorded at check-in and check-out.",
  },
  {
    name: "Maintenance",
    icon: Wrench,
    line: "How long each job took and what was fixed, with photos of the work.",
    screen: "02-day-started",
    alt: "The workday running on the phone, with the time worked and today's jobs.",
  },
  {
    name: "Garden, pest, pool",
    icon: Sprout,
    line: "Every house on the route done, on time, with a photo to show for it.",
    screen: "01-day-before",
    alt: "Today's route on the phone: three places, each with its time.",
  },
  {
    name: "Sales reps",
    icon: ShoppingCart,
    line: "Which shops were visited, the orders taken, and how the shelves looked.",
    screen: "10-order-sent",
    alt: "A shop visit on the phone, with the promotions checked on the shelf and the order saved.",
  },
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
        className="grid gap-6 overflow-hidden rounded-2xl bg-white p-5 ring-1 ring-line sm:p-8 md:grid-cols-[1fr_auto] md:gap-8"
      >
        <div className="grid content-between gap-6">
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
        {/* Every screen is mounted once and stacked, and the chosen one shows:
            changing trade never waits on an image. On a phone only the top
            of the screen rises out of the panel's bottom edge. */}
        <figure className="-mx-5 -mb-5 grid justify-items-center bg-amber-100/70 px-5 pt-6 sm:-mx-8 sm:-mb-8 md:m-0 md:bg-transparent md:p-0">
          <div className="grid h-64 w-48 overflow-hidden md:h-auto md:w-52 md:overflow-visible lg:w-56">
            {trades.map((tr, i) => (
              <PhoneShot
                key={tr.screen}
                src={`/demo/phone/${tr.screen}.webp`}
                alt={i === active ? tr.alt : ""}
                className={`col-start-1 row-start-1 self-start ${i === active ? "opacity-100" : "opacity-0"} ${
                  animate ? "transition-opacity duration-200 ease-out motion-reduce:transition-none" : ""
                }`}
              />
            ))}
          </div>
          <figcaption className="sr-only md:not-sr-only md:mt-3 md:max-w-56 md:text-center md:text-xs md:text-muted">Real screen from the app, with example data.</figcaption>
        </figure>
      </div>
    </div>
  );
}
