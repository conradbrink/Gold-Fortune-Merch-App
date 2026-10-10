import { Check, ChevronDown } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { FoundingForm } from "@/components/founding-form";
import { SpotsText } from "@/components/founding-spots";
import { Logo } from "@/components/logo";
import { ProofSection } from "@/components/proof-section";
import { founding, pricing, rand, site } from "@/lib/site";

// The Founding 10 page, for visitors who arrive from Facebook: it has to make
// sense on its own, and the offer has to be the first thing they see. So the
// headline and the value stack share the top of the page, and everything under
// them is kept short. The words are the owner's (~/Downloads/founding-10-site-prompt.md).
//
// Two lines differ from that file on purpose, because the owner's own rule
// says never to use these words: "no catch" is "no strings", and the owner's
// word "cheap" is kept as written.

export const metadata: Metadata = {
  title: `Become one of our Founding 10 | ${site.name}`,
  description: `We're taking on our first founding businesses to run ${site.name} free for ${founding.days} days. We set it all up. You get proof of every job. We get your story.`,
};

const h2 = "font-display text-2xl font-bold leading-[1.1] tracking-tight text-balance text-teal-900 sm:text-4xl";

const does = [
  ["Every job, proven.", "Time on site, photos and a signed report."],
  ["No more WhatsApp chaos.", "Your team sees today's jobs in one tap."],
  ["Know about missed tasks before your client does.", ""],
  ["Late work gets paid.", "Every hour lands on the timesheet."],
  ["Quote, invoice and get paid from one app.", ""],
  ["Works on cheap Androids, with no signal.", ""],
];

// What a founder gets, each with what it is worth. Half price for 12 months
// is what they save against the normal price.
const daysWorth = Math.round(pricing.monthly.base * (founding.days / 30));
const halfPriceSaved = (pricing.monthly.base - founding.price) * founding.priceMonths;
const gets: [label: string, value: string, worth: number][] = [
  [`${founding.days} days of ${site.name}, free`, rand(daysWorth), daysWorth],
  ["We set it all up for you", rand(pricing.setupValue), pricing.setupValue],
  ["A training day with your team, on site", rand(pricing.trainingValue), pricing.trainingValue],
  [`A direct WhatsApp line and a weekly check-in, for ${founding.days} days`, rand(pricing.supportValue), pricing.supportValue],
  [`Stay on? Half price for ${founding.priceMonths} months`, `${rand(halfPriceSaved)} saved`, halfPriceSaved],
];
const worth = gets.reduce((sum, [, , w]) => sum + w, 0);

const ask = [
  `Your whole team uses ${site.name} every workday for ${founding.days} days.`,
  "A 5-minute check-in call every week, so we can find out how to help.",
  "A 60-second phone video and a Google review.",
  "Two business owners you think it would help.",
];

const lookingFor = [
  "Teams of 2 to 15 people who work away from the office.",
  "Clients who ask you for proof.",
  "Cleaning, security, CCTV, maintenance, garden, pest, pool and sales teams.",
];

// How it works: a date and what happens on it.
const steps: [when: string, what: string][] = [
  [`Apply by ${founding.closes}`, `Apply by ${founding.closes}.`],
  ["20 to 22 October", "We call everyone who applies, from 20 to 22 October."],
  [founding.tellsBy, `We confirm your place by ${founding.tellsBy}.`],
  ["From 26 October", "We set you up from 26 October."],
  ["Monday 2 November", `Your ${founding.days} days start on Monday 2 November.`],
  ["15 December to 5 January", "We pause the clock from 15 December to 5 January, so the holidays don't count."],
];

const faqs = [
  ["Why is it free?", `We want ${founding.spots} real stories. You give us yours. We give you ${founding.days} days on us.`],
  [
    `What happens after ${founding.days} days?`,
    `Stay at ${rand(founding.price)} a month for ${founding.priceMonths} months. Or walk away. No card, no strings.`,
  ],
  ["Who can apply?", "Teams of 2 to 15 whose clients ask for proof."],
  ["What happens after I apply?", `We call you between 20 and 22 October and confirm your place by ${founding.tellsBy}. Then we set everything up for you.`],
];

const button =
  "flex w-full items-center justify-center rounded-full bg-amber-500 px-6 py-4 text-lg font-semibold text-teal-950 transition-[background-color,transform] duration-150 ease-out hover:bg-amber-400 active:scale-[0.97] sm:inline-flex sm:w-auto sm:py-3.5 sm:text-base";

function Ticks({ items }: { items: string[] }) {
  return (
    <ul className="grid gap-2">
      {items.map((t) => (
        <li key={t} className="flex items-start gap-2.5 leading-snug text-ink">
          <Check className="mt-0.5 size-5 shrink-0 text-teal-700" strokeWidth={3} aria-hidden="true" />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

export default function FoundingPage() {
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line/70 bg-mint/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:h-16 sm:px-6">
          <Link href="/" aria-label={`${site.name} home`}>
            <Logo />
          </Link>
          <a
            href="#apply"
            className="rounded-full bg-teal-900 px-4 py-2 text-sm font-semibold text-sand transition-[background-color,transform] duration-150 ease-out hover:bg-teal-800 active:scale-[0.97]"
          >
            Apply for a spot
          </a>
        </div>
      </header>

      <main>
        {/* 1. The offer, first: the ask on the left, what you get on the right. */}
        <section className="mx-auto grid max-w-6xl gap-6 px-4 pb-8 pt-6 sm:px-6 sm:pb-12 sm:pt-10 lg:grid-cols-2 lg:gap-x-12 lg:gap-y-6">
          <div className="grid content-start gap-4 sm:gap-5 lg:col-start-1 lg:row-start-1">
            <p className="text-sm font-bold uppercase tracking-wide text-teal-700">
              Only {founding.spots} spots · Applications close {founding.closes}
            </p>
            <h1 className="font-display text-[2.4rem] font-extrabold leading-[1.02] tracking-tight text-balance text-teal-900 sm:text-6xl">
              Become one of our Founding {founding.spots}.
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-pretty text-ink sm:text-xl">
              We&apos;re taking on our first founding businesses to run {site.name} free for {founding.days} days. We set it all up. You get
              proof of every job. We get your story.
            </p>
            <div className="grid justify-items-start gap-2">
              <a href="#apply" className={button}>
                Apply for a spot
              </a>
              <SpotsText className="text-sm font-semibold text-teal-700" />
            </div>
          </div>

          <div className="grid content-start gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-teal-900/15 sm:p-7 lg:col-start-2 lg:row-start-1">
            <h2 className="font-display text-2xl font-extrabold leading-tight text-teal-900">What you get as a founder</h2>
            <ul className="grid gap-2.5">
              {gets.map(([label, value]) => (
                <li key={label} className="flex items-baseline justify-between gap-4 border-b border-line pb-2.5">
                  <span className="flex gap-2.5 font-medium leading-snug text-ink">
                    <Check className="mt-0.5 size-5 shrink-0 text-teal-700" strokeWidth={3} aria-hidden="true" />
                    {label}
                  </span>
                  <span className="shrink-0 font-semibold text-teal-900">{value}</span>
                </li>
              ))}
              <li className="flex gap-2.5 font-medium leading-snug text-ink">
                <Check className="mt-0.5 size-5 shrink-0 text-teal-700" strokeWidth={3} aria-hidden="true" />
                Your logo on our site as a founder, and a say in what we build next.
              </li>
            </ul>
            <div className="grid gap-1 rounded-xl bg-teal-900 px-5 py-4 text-sand">
              <p className="flex items-baseline justify-between gap-4 text-lg">
                <span>Worth</span>
                <span className="font-semibold line-through decoration-amber-500 decoration-2">{rand(worth)}</span>
              </p>
              <p className="flex items-baseline justify-between gap-4 font-display text-3xl font-extrabold text-amber-500">
                <span>You pay</span>
                <span>{rand(0)}</span>
              </p>
            </div>
            <p className="text-sm font-medium text-muted">No card. No contract. If it&apos;s not for you after {founding.days} days, walk away.</p>
            <a href="#apply" className={`${button} sm:w-full`}>
              Apply for a spot
            </a>
          </div>

        </section>

        {/* 2. Proof, straight under the offer */}
        <ProofSection applyHref="#apply" />

        {/* 3. What it does, what we ask, who we want: side by side to keep the page short */}
        <section>
          <div className="mx-auto grid max-w-6xl gap-4 px-4 py-8 sm:px-6 sm:py-12 lg:grid-cols-3 lg:gap-6">
            <div className="grid content-start gap-4 rounded-2xl bg-white p-5 ring-1 ring-line sm:p-6">
              <h2 className={h2}>What {site.name} does for you</h2>
              <ul className="grid gap-3">
                {does.map(([title, body]) => (
                  <li key={title} className="flex items-start gap-2.5 leading-snug text-ink">
                    <Check className="mt-0.5 size-5 shrink-0 text-teal-700" strokeWidth={3} aria-hidden="true" />
                    <span>
                      <strong className="font-display font-bold text-teal-900">{title}</strong>
                      {body ? ` ${body}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
              <Link href="/" className="text-sm font-semibold text-teal-900 underline underline-offset-4 hover:text-teal-700">
                See everything {site.name} does
              </Link>
            </div>
            <div className="grid content-start gap-4 rounded-2xl bg-white p-5 ring-1 ring-line sm:p-6">
              <h2 className={h2}>What we ask in return</h2>
              <Ticks items={ask} />
            </div>
            <div className="grid content-start gap-4 rounded-2xl bg-white p-5 ring-1 ring-line sm:p-6">
              <h2 className={h2}>Who we&apos;re looking for</h2>
              <Ticks items={lookingFor} />
            </div>
          </div>
        </section>

        {/* 4. How it works: six dates in a row */}
        <section className="border-y border-line bg-white">
          <div className="mx-auto grid max-w-6xl gap-5 px-4 py-8 sm:px-6 sm:py-12">
            <h2 className={h2}>How it works</h2>
            <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {steps.map(([when, what], i) => (
                <li key={when} className="grid grid-cols-[2rem_1fr] items-start gap-3 rounded-xl bg-mint p-4 ring-1 ring-line">
                  <span className="grid size-8 place-items-center rounded-full bg-amber-500 font-display font-extrabold text-teal-950">
                    {i + 1}
                  </span>
                  <span className="leading-snug text-ink">{what}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* 5. Apply */}
        <section id="apply" className="scroll-mt-20 px-4 pb-10 pt-8 sm:px-6 sm:pb-14 sm:pt-12">
          <div className="mx-auto grid max-w-3xl gap-6 rounded-2xl bg-teal-900 p-6 text-sand sm:p-10">
            <div className="grid gap-2">
              <h2 className="font-display text-3xl font-extrabold leading-[1.1] tracking-tight text-balance sm:text-5xl">
                Apply for a spot.
              </h2>
              <p className="leading-relaxed text-teal-100 sm:text-lg">It takes 2 minutes. We read every one.</p>
              <SpotsText className="text-sm font-semibold text-amber-500" />
            </div>
            <FoundingForm />
          </div>
        </section>

        {/* 6. Questions */}
        <section className="border-t border-line">
          <div className="mx-auto grid max-w-3xl gap-5 px-4 py-8 sm:px-6 sm:py-12">
            <h2 className={h2}>Questions</h2>
            <div className="divide-y divide-line border-y border-line">
              {faqs.map(([q, a]) => (
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
        </section>
      </main>

      <footer className="bg-teal-950 text-teal-100">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 sm:px-6 md:flex-row md:items-center md:justify-between">
          <p>
            {site.name} · {site.tagline}
          </p>
          <Link href="/" className="py-1 font-semibold underline underline-offset-4 hover:text-sand">
            Back to the main page
          </Link>
        </div>
      </footer>
    </>
  );
}
