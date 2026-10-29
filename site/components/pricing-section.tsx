import { Check, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { biggestPlan, confirmed, contactHref, founding, pricing, rand, site } from "@/lib/site";

// Three fixed plans by the number of reps (owner, 19 Oct 2026): no slider and
// no Monthly | Yearly switch, just the three prices, side by side from md up
// and one under the other on a phone, with the middle plan marked. What every
// plan includes sits once underneath, so the cards stay short. Yearly is one
// line ("2 months free"), not a second set of prices. These are the prices
// after the Founding 10, so the bonuses and the way in are the Founding
// package's (components/founding-package.tsx), not repeated here.
// Done for you and the promise wait on `confirmed` in lib/site.ts.

function Item({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2.5 leading-relaxed">
      <Check className="mt-1 size-4 shrink-0 text-teal-700" strokeWidth={3} aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}

export function PricingSection() {
  return (
    <div className="grid gap-6">
      <ul className={`grid gap-4 ${confirmed.doneForYou ? "md:grid-cols-4" : "md:grid-cols-3"} md:items-end`}>
        {pricing.plans.map((p) => {
          const popular = p.reps === pricing.popularReps;
          return (
            <li
              key={p.reps}
              className={`grid content-start gap-1 rounded-2xl bg-white p-5 sm:p-6 ${
                popular ? "ring-2 ring-amber-500 md:py-8" : "ring-1 ring-line"
              }`}
            >
              {popular && (
                <span className="mb-2 justify-self-start rounded-full bg-amber-500 px-3 py-1 text-xs font-bold text-teal-950">
                  Most popular
                </span>
              )}
              <h3 className="font-display text-xl font-bold text-teal-900">Up to {p.reps} reps and drivers</h3>
              <p className="flex flex-wrap items-baseline gap-x-1.5">
                <strong className="font-display text-4xl font-extrabold tabular-nums text-teal-900">{rand(p.monthly)}</strong>
                <span className="text-base font-medium text-muted">a month</span>
              </p>
            </li>
          );
        })}
        {confirmed.doneForYou && (
          <li className="grid content-start gap-3 rounded-2xl bg-white p-5 ring-1 ring-line sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted">Done for you</p>
            <p className="font-display text-3xl font-extrabold text-teal-900">
              {rand(pricing.doneForYou)} <span className="text-base font-medium text-muted">a month</span>
            </p>
            <ul className="grid gap-2">
              <Item>We check your reps&apos; day every morning</Item>
              <Item>A weekly report and a 15-minute call</Item>
            </ul>
            <a
              href={contactHref("Hi, I'd like to talk about the Done for you plan.")}
              className="flex min-h-12 items-center justify-center rounded-full px-5 py-3 font-semibold text-teal-900 ring-1 ring-teal-900/25 hover:bg-mint"
            >
              Talk to us
            </a>
          </li>
        )}
      </ul>

      <p className="text-center font-semibold text-teal-700">No contract. Cancel any time. Pay yearly and you get 2 months free.</p>

      <div className="grid gap-4 md:grid-cols-[1.4fr_1fr] md:items-start">
        <div className="grid content-start gap-4 rounded-2xl bg-white p-5 ring-1 ring-line sm:p-6">
          <h3 className="font-display text-xl font-bold text-teal-900">Every plan includes</h3>
          <ul className="grid gap-2">
            <Item>Everything: store visits, orders, photos, routes and kilometres, invoices and reports</Item>
            <Item>
              <strong>Our AI Manager:</strong> Ask about your business, and get a plan to grow
            </Item>
            <Item>
              <strong>Your stores, products and price lists:</strong> We load them for you
            </Item>
            <Item>
              <strong>Setup:</strong> {rand(pricing.setupValue)} once-off. It&apos;s free if you pay yearly.
            </Item>
          </ul>
          <a
            href="#offer"
            className="w-fit py-1 font-semibold text-teal-900 underline underline-offset-4 hover:text-teal-700"
          >
            Or join the Founding {founding.spots} at {founding.percentOff}% off
          </a>
        </div>

        <div className="grid content-start gap-5 rounded-2xl bg-mint p-5 ring-1 ring-line sm:p-6">
          <div className="grid gap-1.5">
            <h3 className="font-display text-xl font-bold text-teal-900">More than {biggestPlan.reps} reps?</h3>
            <p className="leading-relaxed text-ink">We&apos;ll give you a price for your team.</p>
            <a
              href={contactHref(`Hi, we have more than ${biggestPlan.reps} reps. What would ${site.name} cost us?`)}
              className="w-fit py-1 font-semibold text-teal-900 underline underline-offset-4 hover:text-teal-700"
            >
              Ask us for a price
            </a>
          </div>
          <div className="grid gap-3 border-t border-line pt-4">
            {/* HR and the warehouse are one add-on at one price (owner, 20 Oct 2026). */}
            <h3 className="font-display text-xl font-bold text-teal-900">Add-on</h3>
            <div className="grid gap-0.5">
              <span className="font-display text-lg font-bold text-teal-900">Warehouse, deliveries and HR</span>
              <span className="leading-relaxed text-muted">R495 a month for both</span>
            </div>
          </div>
        </div>
      </div>

      {confirmed.promise && (
        <div className="flex gap-3 rounded-2xl bg-teal-50 p-4 ring-1 ring-teal-100 sm:items-center sm:p-5">
          <ShieldCheck className="size-8 shrink-0 text-teal-700" aria-hidden="true" />
          <p className="leading-relaxed text-teal-950">
            <strong>The {site.name} promise:</strong> Use it every workday for 30 days. If it doesn&apos;t pay for
            itself, your first month is free.
          </p>
        </div>
      )}
    </div>
  );
}
