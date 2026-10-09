"use client";

import { Check, ShieldCheck } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { confirmed, contactHref, planPrice, pricing, rand, site, type Billing } from "@/lib/site";

// Copy: ~/Downloads/site-copy-final-v7.md, section 7, plus the day-one and
// no-card lines from the 8 Oct offer audit. One Monthly | Yearly choice
// drives the plan card and the team-size calculator.
// Done for you and the promise wait on `confirmed` in lib/site.ts.

function Toggle({ billing, onChange }: { billing: Billing; onChange: (b: Billing) => void }) {
  const opt = (b: Billing, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={billing === b}
      onClick={() => onChange(b)}
      className={`min-h-11 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition sm:flex-none sm:px-5 ${
        b === "yearly" ? "flex-1" : "flex-none"
      } ${
        billing === b ? "bg-teal-900 text-sand shadow-sm" : "text-teal-900 hover:bg-white"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div role="radiogroup" aria-label="Billing" className="flex w-full rounded-full bg-mint p-1 ring-1 ring-line sm:inline-flex sm:w-auto sm:justify-self-start">
      {opt("monthly", "Monthly")}
      {opt("yearly", "Yearly (2 months free)")}
    </div>
  );
}

function Item({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2.5 leading-relaxed">
      <Check className="mt-1 size-4 shrink-0 text-teal-700" strokeWidth={3} />
      <span>{children}</span>
    </li>
  );
}

function Calculator({ billing }: { billing: Billing }) {
  const [users, setUsers] = useState(10);
  const id = useId();
  const total = planPrice(users, billing);
  const extra = Math.max(0, users - pricing.includedUsers);
  return (
    <div className="grid gap-4 rounded-2xl bg-teal-900 p-5 text-sand sm:p-7">
      <label htmlFor={id} className="flex items-baseline justify-between gap-4">
        <span className="font-semibold">How many people will use {site.name}?</span>
        <span className="font-display text-3xl font-extrabold tabular-nums text-amber-500">{users}</span>
      </label>
      <input
        id={id}
        type="range"
        min={1}
        max={30}
        step={1}
        value={users}
        onChange={(e) => setUsers(Number(e.target.value))}
        className="w-full accent-amber-500"
      />
      <div className="border-t border-white/15 pt-4" aria-live="polite">
        <p className="font-display text-4xl font-extrabold tabular-nums">
          {rand(total)}
          <span className="text-base font-medium text-teal-100"> {billing === "yearly" ? "a year" : "a month"}</span>
        </p>
        <p className="mt-1 text-sm text-teal-100">
          {billing === "yearly"
            ? `${rand(Math.round(total / 12))} a month, paid yearly.`
            : `${rand(pricing.monthly.base)} for the first ${pricing.includedUsers} users${
                extra > 0 ? ` + ${extra} × ${rand(pricing.monthly.perExtra)}` : ""
              }.`}
        </p>
      </div>
    </div>
  );
}

export function PricingSection() {
  const [billing, setBilling] = useState<Billing>("yearly");
  const yearly = billing === "yearly";
  const p = pricing[billing];

  return (
    <div className="grid gap-6">
      <Toggle billing={billing} onChange={setBilling} />

      {/* Done for you leads on desktop as the anchor; on a phone the main plan comes first. */}
      <div
        className={`grid gap-4 lg:items-stretch ${
          confirmed.doneForYou ? "lg:grid-cols-3" : "md:grid-cols-[1.4fr_1fr]"
        }`}
      >
        {confirmed.doneForYou && (
        <div className="order-2 grid content-start gap-4 rounded-2xl bg-white p-5 ring-1 ring-line sm:p-6 lg:order-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted">Done for you</p>
          <p className="font-display text-3xl font-extrabold text-teal-900">
            {rand(pricing.doneForYou)} <span className="text-base font-medium text-muted">a month</span>
          </p>
          <p className="font-semibold">Everything in {site.name}, plus:</p>
          <ul className="grid gap-2">
            <Item>We check your team&apos;s day every morning</Item>
            <Item>A weekly report and a 15-minute call</Item>
            <Item>We train your team on site</Item>
          </ul>
          <a
            href={contactHref("Hi, I'd like to talk about the Done for you plan.")}
            className="mt-auto flex min-h-12 items-center justify-center rounded-full px-5 py-3 font-semibold text-teal-900 ring-1 ring-teal-900/25 hover:bg-mint"
          >
            Talk to us
          </a>
        </div>
        )}

        <div className="relative order-1 grid content-start gap-4 rounded-2xl bg-white p-5 ring-2 ring-amber-500 sm:p-6 lg:order-2">
          <span className="justify-self-start rounded-full bg-amber-500 px-3 py-1 text-xs font-bold text-teal-950">Most popular</span>
          <div className="grid gap-1">
            <p className="text-xl leading-snug">
              <strong className="font-display text-3xl font-extrabold text-teal-900">
                {rand(p.base)} {yearly ? "a year" : "a month"}
              </strong>{" "}
              for {pricing.includedUsers} users.
            </p>
            <p className="leading-snug">
              <strong className="text-teal-900">
                {rand(p.perExtra)} {yearly ? "a year" : "a month"}
              </strong>{" "}
              for each extra user.
            </p>
            <p className="text-sm font-semibold text-teal-700">
              {yearly ? "That's 2 months free." : "No contract. Cancel any time."}
            </p>
          </div>
          <ul className="grid gap-2">
            <Item>Everything included: jobs, photos, tracking, timesheets, quotes and invoices</Item>
            <Item>
              <strong>Setup worth {rand(pricing.setupValue)}:</strong>{" "}
              {yearly ? "Free" : `${rand(pricing.setupValue)} once-off`}
            </Item>
            <Item>
              <strong>Checklists for your type of work:</strong> Ready on day one
            </Item>
            <Item>
              <strong>A free day of hands-on training:</strong> your team learns the app, and you learn your way around
              the dashboard
            </Item>
          </ul>
          <div className="mt-auto grid gap-2">
            <a
              href={site.signupUrl}
              className="flex min-h-12 items-center justify-center rounded-full bg-amber-500 px-5 py-3 text-lg font-semibold text-teal-950 transition-[background-color,transform] duration-150 ease-out hover:bg-amber-400 active:scale-[0.97] sm:text-base"
            >
              Get {site.name} free for {site.trialDays} days
            </a>
            <p className="text-center text-sm text-muted">No card needed for the trial.</p>
          </div>
        </div>

        <div className="order-3 grid content-start gap-4 rounded-2xl bg-mint p-5 ring-1 ring-line sm:p-6">
          <h3 className="font-display text-xl font-bold text-teal-900">Add-ons</h3>
          <ul className="grid gap-3">
            <li className="grid gap-0.5">
              <span className="font-display text-lg font-bold text-teal-900">HR</span>
              <span className="leading-relaxed text-muted">R199 a month (up to 5 staff), R499 (6 to 30)</span>
            </li>
            <li className="grid gap-0.5">
              <span className="font-display text-lg font-bold text-teal-900">Warehouse and deliveries</span>
              <span className="leading-relaxed text-muted">R499 a month per warehouse</span>
            </li>
          </ul>
        </div>
      </div>

      <p className="text-center font-display text-xl font-bold text-teal-900">That&apos;s about R18 a person a day.</p>

      <Calculator billing={billing} />

      {confirmed.promise && (
        <div className="flex gap-3 rounded-2xl bg-teal-50 p-4 ring-1 ring-teal-100 sm:items-center sm:p-5">
          <ShieldCheck className="size-8 shrink-0 text-teal-700" />
          <p className="leading-relaxed text-teal-950">
            <strong>The {site.name} promise:</strong> Use it every workday for 30 days. If it doesn&apos;t pay for
            itself, your first month is free.
          </p>
        </div>
      )}
    </div>
  );
}
