"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { proof, site } from "@/lib/site";

// A short slide of what happened at Gold Fortune, and what it could mean for
// the visitor. First the sales at one of their retailers (as Gold Fortune
// reports it), then three numbers from the app (see `proof` in lib/site.ts),
// then one slide about what it could mean. Moves by itself every 6 seconds until the visitor touches it,
// and not at all for people who ask their device for less motion.

type Fact = {
  label: string;
  before: string;
  after: string;
  beforeN: number;
  afterN: number;
  badge: string;
  line: string;
  /** What the two bars are, when it is not the first two weeks against mid September. */
  when?: [string, string];
};

const facts: Fact[] = [
  {
    ...proof.retailer,
    badge: proof.retailer.up.replace(/\.$/, ""),
    line: "More sales from the same store, as Gold Fortune reports it.",
    when: ["Before", "After"],
  },
  {
    ...proof.perRepDay,
    badge: proof.perRepDay.up.replace(/\.$/, ""),
    line: "Each rep gets to more stores in a day.",
  },
  {
    ...proof.stores2w,
    badge: proof.stores2w.up.replace(/\.$/, ""),
    line: "More of your area gets served.",
  },
  {
    ...proof.atDoor,
    badge: "Up 20 points",
    line: "Every visit is checked in at the store, so you can prove it.",
  },
];

const SLIDES = facts.length + 1;

function Bars({ before, after, beforeN, afterN, when }: Pick<Fact, "before" | "after" | "beforeN" | "afterN" | "when">) {
  const top = Math.max(beforeN, afterN);
  const [first, second] = when ?? ["First 2 weeks", "Mid September"];
  const bars = [
    [before, beforeN, first, "bg-white/30"],
    [after, afterN, second, "bg-amber-500"],
  ] as const;
  return (
    <div className="grid gap-1.5">
      <div className="grid h-28 grid-cols-2 items-end gap-4 border-b border-white/20">
        {bars.map(([text, n, when, colour]) => (
          <div key={when} className="flex h-full flex-col justify-end gap-1">
            <span className="font-display text-2xl font-extrabold text-sand">{text}</span>
            <span className={`w-full rounded-t-md ${colour}`} style={{ height: `${Math.round((n / top) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4 text-sm font-medium text-teal-100">
        {bars.map(([, , when]) => (
          <span key={when}>{when}</span>
        ))}
      </div>
    </div>
  );
}

export function ProofSlides({ applyHref }: { applyHref: string }) {
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(true);

  const go = useCallback((n: number) => setI(((n % SLIDES) + SLIDES) % SLIDES), []);

  useEffect(() => {
    if (!auto) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((c) => (c + 1) % SLIDES), 6000);
    return () => clearInterval(t);
  }, [auto]);

  const touch = (n: number) => {
    setAuto(false);
    go(n);
  };

  return (
    <section
      aria-roledescription="carousel"
      aria-label="What happened at Gold Fortune"
      className="grid gap-4 rounded-2xl bg-teal-900 p-5 text-sand sm:p-6"
    >
      <div className="flex items-center gap-3">
        <Image
          src="/gold-fortune-logo.png"
          alt="Gold Fortune logo"
          width={256}
          height={256}
          className="size-12 shrink-0 rounded-lg bg-white object-contain p-0.5 ring-1 ring-white/30"
        />
        <p className="grid leading-tight">
          <span className="font-display text-lg font-bold">Gold Fortune</span>
          <span className="text-sm text-teal-100">
            {proof.reps} reps, {proof.stores} stores, on {site.name}
          </span>
        </p>
      </div>

      <div className="min-h-[14.5rem] sm:min-h-[15.5rem]" aria-live={auto ? "off" : "polite"}>
        {i < facts.length ? (
          <div key={i} className="tk-slide grid gap-3" role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${SLIDES}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-display text-lg font-bold leading-tight">{facts[i].label}</p>
              <span className="rounded-full bg-amber-500 px-3 py-0.5 text-sm font-bold text-teal-950">{facts[i].badge}</span>
            </div>
            <Bars {...facts[i]} />
            <p className="text-teal-100">{facts[i].line}</p>
          </div>
        ) : (
          <div key="you" className="tk-slide grid content-start gap-3" role="group" aria-roledescription="slide" aria-label={`${SLIDES} of ${SLIDES}`}>
            <p className="font-display text-2xl font-extrabold leading-tight text-amber-500">What could this mean for you?</p>
            <ul className="grid gap-1.5 text-lg leading-snug">
              <li>More visits in the same day.</li>
              <li>More of your area covered.</li>
              <li>Proof for every client, with the time, the place and photos.</li>
            </ul>
            <a
              href={applyHref}
              className="mt-1 w-fit rounded-full bg-amber-500 px-5 py-2.5 font-semibold text-teal-950 transition-[background-color,transform] duration-150 ease-out hover:bg-amber-400 active:scale-[0.97]"
            >
              Apply for a spot
            </a>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-2" role="group" aria-label="Choose a slide">
          {Array.from({ length: SLIDES }, (_, n) => (
            <button
              key={n}
              type="button"
              onClick={() => touch(n)}
              aria-label={`Slide ${n + 1} of ${SLIDES}`}
              aria-current={n === i}
              className="grid size-6 place-items-center"
            >
              <span className={`block h-2 rounded-full transition-all duration-300 ${n === i ? "w-6 bg-amber-500" : "w-2 bg-white/35"}`} />
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => touch(i - 1)}
            aria-label="Previous slide"
            className="grid size-11 place-items-center rounded-full ring-1 ring-white/30 hover:bg-white/10"
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => touch(i + 1)}
            aria-label="Next slide"
            className="grid size-11 place-items-center rounded-full ring-1 ring-white/30 hover:bg-white/10"
          >
            <ChevronRight className="size-5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}
