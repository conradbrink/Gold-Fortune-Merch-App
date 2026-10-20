import { Check, ChevronDown, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { founding, foundingStack, foundingWorth, growthPlan, objections, rand, site } from "@/lib/site";

// The Founding 10 distributors package (owner, 19 Oct 2026), on the main page
// and on /founding: what they get and what each part is worth first, then the
// price, which looks small next to it (Hormozi: never show the price alone).
// Then the guarantee, and the doubts answered under the form.

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
      <div className="grid gap-1 rounded-xl bg-teal-900 px-5 py-4 text-sand">
        <p className="flex items-baseline justify-between gap-4 text-lg">
          <span>Total value</span>
          <span className="font-semibold tabular-nums line-through decoration-amber-500 decoration-2">{rand(foundingWorth)}</span>
        </p>
        <p className="flex flex-wrap items-baseline justify-between gap-x-4 font-display text-2xl font-extrabold text-amber-500 sm:text-3xl">
          <span>Founding price</span>
          <span className="tabular-nums">
            {rand(founding.price)}
            <span className="font-sans text-base font-medium text-teal-100"> a month</span>
          </span>
        </p>
        <p className="text-sm leading-snug text-teal-100">
          For {founding.priceMonths} months. That&apos;s {founding.percentOff}% off our Growth plan (
          <span className="line-through">{rand(growthPlan.monthly)}</span> a month), with the AI Manager, the setup and the bonuses included.
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
          Run {site.name} for {founding.guaranteeDays} days. If your reps aren&apos;t visiting more stores, we refund your month, and you
          keep the Rep Leak Audit.
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
