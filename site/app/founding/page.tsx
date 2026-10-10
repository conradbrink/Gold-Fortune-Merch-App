import { Check, ChevronDown } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { FoundingForm } from "@/components/founding-form";
import { SpotsText } from "@/components/founding-spots";
import { ProductDemo } from "@/components/demo/product-demo";
import { Logo } from "@/components/logo";
import { MetaPixel } from "@/components/meta-pixel";
import { ProofSection } from "@/components/proof-section";
import { founding, foundingVideoUrl, pricing, rand, site } from "@/lib/site";

// The Founding 10 page, for visitors who arrive from Facebook: it has to make
// sense on its own. The words are the owner's, in the owner's order
// (~/Downloads/founding-10-site-prompt.md). Same look as the main page.
//
// Two lines differ from that file on purpose, because the owner's own rule
// says never to use these words: "no catch" is "no strings", and the owner's
// word "cheap" is kept as written.

export const metadata: Metadata = {
  title: `Become one of our Founding 10 | ${site.name}`,
  description: `We're picking ${founding.spots} businesses to run ${site.name} free for ${founding.days} days. We set it all up. You get proof of every job. We get your story.`,
};

const h2 = "font-display text-3xl font-bold leading-[1.1] tracking-tight text-balance text-teal-900 sm:text-[2.75rem]";
const wrap = "mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:gap-8 sm:px-6 sm:py-16";

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
const halfPriceSaved = (pricing.monthly.base - founding.price) * founding.priceMonths;
const gets: [label: string, value: string, worth: number][] = [
  [`${founding.days} days of ${site.name}, free`, rand(Math.round(pricing.monthly.base * (founding.days / 30))), Math.round(pricing.monthly.base * (founding.days / 30))],
  ["We set it all up for you", rand(pricing.setupValue), pricing.setupValue],
  ["A training day with your team, on site", rand(pricing.trainingValue), pricing.trainingValue],
  [`A direct WhatsApp line and a weekly check-in, for ${founding.days} days`, rand(pricing.supportValue), pricing.supportValue],
  [`Stay on? Half price for ${founding.priceMonths} months`, `${rand(halfPriceSaved)} saved`, halfPriceSaved],
];
const worth = gets.reduce((sum, [, , w]) => sum + w, 0);

const ask = [
  `Your whole team uses ${site.name} every workday for ${founding.days} days.`,
  "Two 15-minute calls. One at the start, one at the end.",
  "A 60-second phone video and a Google review.",
  "Two business owners you think it would help.",
];

const lookingFor = [
  "Teams of 5 to 25 people who work away from the office.",
  "Clients who ask you for proof.",
  "Cleaning, security, CCTV, maintenance, garden, pest, pool and sales teams. One per trade first.",
];

const steps = [
  `Apply by ${founding.closes}.`,
  "We call our top picks from 20 to 22 October.",
  `We tell the Founding ${founding.spots} on ${founding.tellsBy}.`,
  "We set you up from 26 October.",
  `Your ${founding.days} days start on Monday 2 November.`,
  "We pause the clock from 15 December to 5 January, so the holidays don't count.",
];

const faqs = [
  ["Why is it free?", `We want ${founding.spots} real stories. You give us yours. We give you ${founding.days} days on us.`],
  [
    `What happens after ${founding.days} days?`,
    `Stay at ${rand(founding.price)} a month for ${founding.priceMonths} months. Or walk away. No card, no strings.`,
  ],
  ["Who gets picked?", "Teams of 5 to 25 whose clients ask for proof. One per trade first."],
  ["What if I'm not picked?", "You're first on the list for the next round. You can still try Tickd free for 14 days."],
];

function Ticks({ items, tone = "dark" }: { items: string[]; tone?: "dark" | "light" }) {
  return (
    <ul className="grid gap-2.5">
      {items.map((t) => (
        <li key={t} className={`flex items-start gap-2.5 leading-snug ${tone === "light" ? "text-sand" : "text-ink"}`}>
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
      <MetaPixel />
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
        {/* The video goes here when it is ready. */}
        <section aria-label="Video" className="mx-auto max-w-3xl px-4 pt-6 sm:px-6 sm:pt-10">
          {foundingVideoUrl ? (
            <video
              src={foundingVideoUrl}
              controls
              playsInline
              preload="metadata"
              className="aspect-video w-full rounded-2xl bg-teal-950 ring-1 ring-line"
            />
          ) : (
            <div className="grid aspect-video w-full place-items-center rounded-2xl border-2 border-dashed border-teal-700/40 bg-white p-6 text-center text-sm font-semibold text-teal-700">
              [Video goes here]
            </div>
          )}
        </section>

        {/* 1. The ask */}
        <section className="mx-auto grid max-w-3xl gap-5 px-4 pb-10 pt-8 text-center sm:px-6 sm:pb-16 sm:pt-12">
          <p className="text-sm font-bold uppercase tracking-wide text-teal-700">
            Only {founding.spots} spots · Applications close {founding.closes}
          </p>
          <h1 className="font-display text-[2.6rem] font-extrabold leading-[1.02] tracking-tight text-balance text-teal-900 sm:text-6xl">
            Become one of our Founding {founding.spots}.
          </h1>
          <p className="mx-auto max-w-xl text-lg leading-relaxed text-pretty text-ink sm:text-xl">
            We&apos;re picking {founding.spots} businesses to run {site.name} free for {founding.days} days. We set it all up. You get
            proof of every job. We get your story.
          </p>
          <div className="grid justify-items-center gap-2">
            <a
              href="#apply"
              className="flex w-full items-center justify-center rounded-full bg-amber-500 px-6 py-4 text-lg font-semibold text-teal-950 transition-[background-color,transform] duration-150 ease-out hover:bg-amber-400 active:scale-[0.97] sm:inline-flex sm:w-auto sm:py-3.5 sm:text-base"
            >
              Apply for a spot
            </a>
            <SpotsText className="text-sm font-semibold text-teal-700" />
          </div>
        </section>

        {/* 2. What Tickd does for you, with the phone demo */}
        <section className="border-y border-line bg-white">
          <div className={`${wrap} lg:grid-cols-[1fr_0.9fr] lg:items-center lg:gap-14`}>
            <div className="grid content-start gap-6">
              <h2 className={h2}>What {site.name} does for you</h2>
              <ul className="grid gap-4">
                {does.map(([title, body]) => (
                  <li key={title} className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-teal-700 text-white"
                    >
                      <Check className="size-4" strokeWidth={3.5} />
                    </span>
                    <span className="text-lg leading-snug text-ink">
                      <strong className="font-display font-bold text-teal-900">{title}</strong>
                      {body ? ` ${body}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <figure className="grid gap-3">
              <ProductDemo />
              <figcaption className="text-center text-sm text-muted">
                <Link href="/" className="font-semibold text-teal-900 underline underline-offset-4 hover:text-teal-700">
                  See everything {site.name} does
                </Link>
              </figcaption>
            </figure>
          </div>
        </section>

        {/* 3. Proof, straight under what Tickd does */}
        <ProofSection />

        {/* 4. What you get as a founder */}
        <section>
          <div className={`${wrap} max-w-3xl`}>
            <h2 className={h2}>What you get as a founder</h2>
            <ul className="grid gap-3 rounded-2xl bg-white p-5 ring-1 ring-line sm:p-7">
              {gets.map(([label, value]) => (
                <li key={label} className="flex items-baseline justify-between gap-4 border-b border-line pb-3 last:border-0">
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
              <li className="flex items-baseline justify-between gap-4 border-t border-line pt-4 font-display text-xl font-extrabold text-teal-900 sm:text-2xl">
                <span>Worth {rand(worth)}.</span>
                <span className="text-amber-700">You pay {rand(0)}.</span>
              </li>
            </ul>
          </div>
        </section>

        {/* 5. What we ask in return */}
        <section className="border-y border-line bg-white">
          <div className={`${wrap} max-w-3xl`}>
            <h2 className={h2}>What we ask in return</h2>
            <Ticks items={ask} />
            <p className="font-display text-lg font-bold leading-snug text-teal-900">
              No card. No contract. If it&apos;s not for you after {founding.days} days, walk away.
            </p>
          </div>
        </section>

        {/* 6. Who we're looking for */}
        <section>
          <div className={`${wrap} max-w-3xl`}>
            <h2 className={h2}>Who we&apos;re looking for</h2>
            <Ticks items={lookingFor} />
          </div>
        </section>

        {/* 7. How it works */}
        <section className="border-y border-line bg-white">
          <div className={`${wrap} max-w-3xl`}>
            <h2 className={h2}>How it works</h2>
            <ol className="grid gap-4">
              {steps.map((s, i) => (
                <li key={s} className="grid grid-cols-[2rem_1fr] items-start gap-3">
                  <span className="grid size-8 place-items-center rounded-full bg-amber-500 font-display font-extrabold text-teal-950">
                    {i + 1}
                  </span>
                  <span className="pt-0.5 text-lg leading-snug text-ink">{s}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* 8. Apply */}
        <section id="apply" className="scroll-mt-20 px-4 pb-14 pt-10 sm:px-6 sm:pb-16 sm:pt-16">
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

        {/* 9. Questions */}
        <section className="border-t border-line">
          <div className={`${wrap} max-w-3xl`}>
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
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
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
