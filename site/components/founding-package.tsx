import { Check, ChevronDown, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { founding, foundingPrice, foundingStack, foundingWorth, objections, pricing, rand, site } from "@/lib/site";

// The Founding 10 distributors package (owner, 19 Oct 2026), on the main page
// and on /founding: what they get and what each part is worth first, then the
// discount on each plan (owner, 20 Oct 2026: 40% off the plan that fits, for
// the first 3 months). Then the guarantee, and the doubts.

export function FoundingStack({ applyHref }: { applyHref: string }) {
  return (
    <div className="grid content-start gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-teal-900/15 sm:p-7">
      <h3 className="font-display text-2xl font-extrabold leading-tight text-teal-900">What you get as a founding distributor</h3>
      <ul className="grid gap-2.5">
        {foundingStack.map((b) => (
          <li key={b.name} className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-0.5 border-b border-line pb-2.5">
            <span className="flex gap-2.5 font-semibold leading-snug text-ink">
              <Check className="mt-0.5 size-5 shrink-0 text-teal-700" strokeWidth={3} aria-hidden="true" />
              {b.name}
            </span>
            <span className="text-right font-semibold tabular-nums text-teal-900">{rand(b.worth)}</span>
            <span className="col-start-1 pl-[1.875rem] text-sm leading-snug text-muted">{b.note}</span>
          </li>
        ))}
      </ul>
      <div className="grid gap-3 rounded-xl bg-teal-900 px-5 py-4 text-sand">
        <p className="text-lg leading-snug">
          All of this, worth <span className="font-semibold tabular-nums">{rand(foundingWorth)}</span>, is included.
        </p>
        <div className="grid gap-1.5 border-t border-white/15 pt-3">
          <p className="font-display text-xl font-extrabold text-amber-500 sm:text-2xl">
            Then {founding.percentOff}% off your plan for {founding.priceMonths} months
          </p>
          <ul className="grid gap-1">
            {pricing.plans.map((p) => (
              <li key={p.reps} className="flex items-baseline justify-between gap-3">
                <span className="whitespace-nowrap text-teal-100">Up to {p.reps} reps and drivers</span>
                <span className="whitespace-nowrap tabular-nums">
                  <span className="text-sm text-teal-100 line-through">{rand(p.monthly)}</span>{" "}
                  <strong className="font-display text-xl font-extrabold text-sand">{rand(foundingPrice(p))}</strong>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm leading-snug text-teal-100">
          A month, for your first {founding.priceMonths} months. Then your plan&apos;s normal price. No contract.
        </p>
      </div>
      <a
        href={applyHref}
        className="flex min-h-12 items-center justify-center rounded-full bg-amber-500 px-6 py-3.5 text-lg font-semibold text-teal-950 transition-[background-color,transform] duration-150 ease-out hover:bg-amber-400 active:scale-[0.97] sm:text-base"
      >
        Start my free {founding.pilotDays}-day pilot
      </a>
      <p className="text-center text-sm font-medium text-muted">The pilot is free. No card, no contract.</p>
    </div>
  );
}

export function FoundingGuarantee() {
  return (
    <div className="flex gap-3 rounded-2xl bg-amber-500 px-5 py-4 text-teal-950 shadow-md ring-2 ring-amber-600">
      <ShieldCheck className="mt-0.5 size-8 shrink-0" strokeWidth={2.5} aria-hidden="true" />
      <div className="grid gap-1">
        <p className="font-display text-xl font-extrabold leading-snug">Our promise</p>
        <p className="text-lg font-semibold leading-snug">
          Run {site.name} for {founding.guaranteeDays} days, if you&apos;re unhappy we refund you.
        </p>
        <Link href="/terms#guarantee" className="w-fit text-sm font-medium underline underline-offset-2">
          T&amp;Cs apply.
        </Link>
      </div>
    </div>
  );
}

/** The doubts at the form first, then any `more` questions, in one list. */
export function Objections({ heading = "Questions", more = [] }: { heading?: string; more?: [q: string, a: string][] }) {
  return (
    <div className="grid gap-5">
      <h2 className="font-display text-2xl font-bold leading-[1.1] tracking-tight text-balance text-teal-900 sm:text-4xl">{heading}</h2>
      <div className="divide-y divide-line border-y border-line">
        {[...objections, ...more].map(([q, a]) => (
          <details key={q} className="group">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 font-display text-lg font-bold text-teal-900 [&::-webkit-details-marker]:hidden">
              {q}
              <ChevronDown
                className="size-5 shrink-0 text-teal-700 transition-transform duration-200 ease-out group-open:rotate-180 motion-reduce:transition-none"
                aria-hidden="true"
              />
            </summary>
            <p className="max-w-2xl pb-5 leading-relaxed text-ink">{a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
