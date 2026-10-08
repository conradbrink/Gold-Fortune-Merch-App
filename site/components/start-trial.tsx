"use client";

import { useState } from "react";
import { contactHref, site } from "@/lib/site";

// The trades a visitor can pick, each with the app's industry template code:
// the app's sign-up (`/signup?industry=<code>`) pre-picks that trade, so the
// new account opens with that trade's words, checklists and settings. The
// codes are the app's `industry_templates`; "Something else" is `generic`.
const trades: [string, string][] = [
  ["Cleaning", "cleaning"],
  ["CCTV and installation", "installation"],
  ["Security and patrols", "security"],
  ["Maintenance", "maintenance"],
  ["Plumbing", "plumbing"],
  ["Garden", "garden"],
  ["Pest control", "pest_control"],
  ["Pools", "pool"],
  ["Sales and distribution", "distribution"],
  ["Delivery", "delivery"],
  ["Something else", "generic"],
];

// No form here: the free trial is the app's own sign-up, live on the app.
// This only sends the visitor there with their trade chosen.
export function StartTrial() {
  const [trade, setTrade] = useState<string | null>(null);
  const href = `${site.appUrl}/signup${trade ? `?industry=${encodeURIComponent(trade)}` : ""}`;

  return (
    <div className="grid gap-5">
      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-medium text-teal-100">What does your team do?</legend>
        <div role="radiogroup" className="flex flex-wrap gap-2">
          {trades.map(([label, code]) => (
            <button
              key={code}
              type="button"
              role="radio"
              aria-checked={trade === code}
              onClick={() => setTrade(code)}
              className={`min-h-11 rounded-full px-4 py-2 text-sm font-semibold ring-1 transition ${
                trade === code
                  ? "bg-amber-500 text-teal-950 ring-amber-500"
                  : "text-teal-100 ring-white/25 hover:bg-white/10"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
        <a
          href={href}
          className="w-full rounded-full bg-amber-500 px-6 py-4 text-center text-lg font-semibold text-teal-950 transition hover:bg-amber-400 sm:w-auto sm:py-3.5 sm:text-base"
        >
          Start free for {site.trialDays} days
        </a>
        <a
          href={contactHref(`Hi, I'd like to know more about ${site.name}.`)}
          className="text-center text-sm font-semibold text-teal-100 underline-offset-4 hover:text-sand hover:underline sm:text-left"
        >
          Talk to us first
        </a>
      </div>
      <p className="text-sm text-teal-100">
        Free for {site.trialDays} days. No card needed. Your team&apos;s setup is ready when you sign up.
      </p>
    </div>
  );
}
