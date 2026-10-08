"use client";

import {
  Bug,
  Cctv,
  Droplets,
  Shapes,
  ShieldCheck,
  ShoppingCart,
  SprayCan,
  Sprout,
  Truck,
  Waves,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { contactHref, site } from "@/lib/site";

// The trades a visitor can pick, each with the app's industry template code:
// the app's sign-up (`/signup?industry=<code>`) pre-picks that trade, so the
// new account opens with that trade's words, checklists and settings. The
// codes are the app's `industry_templates`; "Something else" is `generic`.
// Electricians use the Installation trade ("CCTV, solar, electrical and
// satellite installers"); there is no separate electrical template.
const trades: [string, string, LucideIcon][] = [
  ["Cleaning", "cleaning", SprayCan],
  ["CCTV, electrical and solar", "installation", Cctv],
  ["Security and patrols", "security", ShieldCheck],
  ["Maintenance", "maintenance", Wrench],
  ["Plumbing", "plumbing", Droplets],
  ["Garden", "garden", Sprout],
  ["Pest control", "pest_control", Bug],
  ["Pools", "pool", Waves],
  ["Sales and distribution", "distribution", ShoppingCart],
  ["Delivery", "delivery", Truck],
  ["Something else", "generic", Shapes],
];

// No form here: the free trial is the app's own sign-up, live on the app.
// Picking a trade is optional (sign-up asks again); it only pre-picks it.
// On a phone the trades are one row you swipe, so the button stays close;
// from sm up they wrap.
export function StartTrial() {
  const [trade, setTrade] = useState<string | null>(null);
  const href = `${site.signupUrl}${trade ? `?industry=${encodeURIComponent(trade)}` : ""}`;

  return (
    <div className="grid gap-6">
      <fieldset className="grid gap-2.5">
        <legend className="mb-2.5 text-sm font-medium text-teal-100">
          What does your team do? <span className="text-teal-100/70">Optional, we&apos;ll set it up for you.</span>
        </legend>
        <div
          role="radiogroup"
          className="-mx-6 -my-1.5 flex snap-x snap-mandatory scroll-px-6 gap-2 overflow-x-auto px-6 py-1.5 [mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)] [scrollbar-width:none] sm:mx-0 sm:my-0 sm:flex-wrap sm:overflow-visible sm:p-0 sm:[mask-image:none] [&::-webkit-scrollbar]:hidden"
        >
          {trades.map(([label, code, Icon]) => {
            const on = trade === code;
            return (
              <button
                key={code}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setTrade(on ? null : code)}
                className={`flex min-h-11 shrink-0 snap-start items-center gap-2 whitespace-nowrap rounded-full px-3.5 text-sm font-semibold transition-[background-color,color,box-shadow] duration-150 ease-out ${
                  on ? "bg-amber-500 text-teal-950" : "bg-white/[0.07] text-sand ring-1 ring-white/15 hover:bg-white/15"
                }`}
              >
                <Icon className={`size-4 shrink-0 ${on ? "text-teal-950" : "text-amber-500"}`} strokeWidth={2.25} aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:flex sm:items-center sm:gap-6">
        <a
          href={href}
          className="flex min-h-12 items-center justify-center rounded-full bg-amber-500 px-7 py-3 text-base font-semibold text-teal-950 transition-[background-color,transform] duration-150 ease-out hover:bg-amber-400 active:scale-[0.97] sm:text-lg"
        >
          Start free for {site.trialDays} days
        </a>
        <a
          href={contactHref(`Hi, I'd like to know more about ${site.name}.`)}
          className="py-2 text-center text-sm font-semibold text-teal-100 underline-offset-4 hover:text-sand hover:underline sm:text-left"
        >
          Talk to us first
        </a>
      </div>
      <p className="text-sm text-teal-100">No card needed. Your trade&apos;s words and checklists are ready when you sign up.</p>
    </div>
  );
}
