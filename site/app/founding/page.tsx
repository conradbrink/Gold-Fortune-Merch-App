import { Check } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { FoundingForm } from "@/components/founding-form";
import { FoundingGuarantee, FoundingStack, Objections } from "@/components/founding-package";
import { SpotsText } from "@/components/founding-spots";
import { FoundingVideo } from "@/components/founding-video";
import { Logo } from "@/components/logo";
import { ProofSection } from "@/components/proof-section";
import { founding, foundingFrom, rand, site } from "@/lib/site";

// The Founding 10 distributors page, for visitors who arrive from an advert:
// it has to make sense on its own, and the offer has to be the first thing
// they see. So the headline and the value stack share the top of the page,
// and everything under them is kept short. The video sits right under the
// headline and plays by itself (components/founding-video.tsx).
//
// Since 19 Oct 2026 the offer is the owner's Founding 10 distributors package
// (it replaced "60 days free, then R749 a month"): a free 14-day pilot, set up
// for them, then 40% off the plan that fits for the first 3 months (owner,
// 20 Oct 2026; it was R2,097 a month for 12 months), with
// the stack, the bonuses and the guarantee in lib/site.ts and
// components/founding-package.tsx. Only 10 spots, because our team onboards
// each one personally; the number left is the owner's, from the database.

export const metadata: Metadata = {
  title: `Become one of our Founding 10 distributors | ${site.name}`,
  description: `A free ${founding.pilotDays}-day pilot of ${site.name}, set up for you. Then ${founding.percentOff}% off your plan for ${founding.priceMonths} months, from ${rand(foundingFrom)} a month. Only ${founding.spots} founding spots.`,
};

const h2 = "font-display text-2xl font-bold leading-[1.1] tracking-tight text-balance text-teal-900 sm:text-4xl";

const does = [
  ["Every store visit, proven.", "The time, the place and photos of the shelf."],
  ["No more orders on WhatsApp.", "Reps take the order on the phone, and it goes straight to your warehouse."],
  ["See which stores have stopped ordering, before you lose them.", ""],
  ["See each rep's sales against their target.", ""],
  ["Every order becomes an invoice.", ""],
  ["Works on cheap Androids, with no signal.", ""],
];

const lookingFor = [
  "Distributors with 3 to 30 reps.",
  "Reps who visit stores, take orders and check the shelves.",
  "You deliver the orders from your own warehouse.",
];

// How it works, in order. No dates: the pilot starts when we've set you up.
const steps = [
  "Send us the short form below.",
  `We WhatsApp you within ${founding.replyMinutes} minutes during work hours.`,
  "We load your stores, products and reps for you.",
  "We train your reps on a video call.",
  `Your free ${founding.pilotDays}-day pilot starts. No card needed.`,
  `Like it? Stay on with ${founding.percentOff}% off your plan for ${founding.priceMonths} months.`,
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
            Start my free pilot
          </a>
        </div>
      </header>

      <main>
        {/* 1. The offer, first: the outcome on the left, the value stack on the right. */}
        <section className="mx-auto grid max-w-6xl gap-6 px-4 pb-8 pt-6 sm:px-6 sm:pb-12 sm:pt-10 lg:grid-cols-2 lg:gap-x-12 lg:gap-y-6">
          <div className="grid content-start gap-4 sm:gap-5 lg:col-start-1 lg:row-start-1">
            <p className="text-sm font-bold uppercase tracking-wide text-teal-700">
              Only {founding.spots} spots, because our team onboards each one personally
            </p>
            <h1 className="font-display text-[2.4rem] font-extrabold leading-[1.02] tracking-tight text-balance text-teal-900 sm:text-6xl">
              Become one of our Founding {founding.spots} distributors.
            </h1>
            <FoundingVideo />
            <p className="max-w-xl text-lg leading-relaxed text-pretty text-ink sm:text-xl">
              A free {founding.pilotDays}-day pilot, set up for you. Then {founding.percentOff}% off your plan for {founding.priceMonths}{" "}
              months, from {rand(foundingFrom)} a month.
            </p>
            <div className="grid justify-items-start gap-2">
              <a href="#apply" className={button}>
                Start my free {founding.pilotDays}-day pilot
              </a>
              <SpotsText className="text-sm font-semibold text-teal-700" />
            </div>
          </div>

          <div className="grid content-start gap-4 lg:col-start-2 lg:row-start-1">
            <FoundingStack applyHref="#apply" />
            <FoundingGuarantee />
          </div>
        </section>

        {/* 2. Proof, straight under the offer */}
        <ProofSection applyHref="#apply" />

        {/* 3. What it does, who we want, how it works: side by side to keep the page short */}
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
              <h2 className={h2}>Who we&apos;re looking for</h2>
              <Ticks items={lookingFor} />
            </div>
            <div className="grid content-start gap-4 rounded-2xl bg-white p-5 ring-1 ring-line sm:p-6">
              <h2 className={h2}>How it works</h2>
              <ol className="grid gap-3">
                {steps.map((what, i) => (
                  <li key={what} className="grid grid-cols-[2rem_1fr] items-start gap-3">
                    <span className="grid size-8 place-items-center rounded-full bg-amber-500 font-display font-extrabold text-teal-950">
                      {i + 1}
                    </span>
                    <span className="pt-1 leading-snug text-ink">{what}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* 4. The pilot form */}
        <section id="apply" className="scroll-mt-20 border-t border-line px-4 pb-10 pt-8 sm:px-6 sm:pb-14 sm:pt-12">
          <div className="mx-auto grid max-w-3xl gap-6 rounded-2xl bg-teal-900 p-6 text-sand sm:p-10">
            <div className="grid gap-2">
              <h2 className="font-display text-3xl font-extrabold leading-[1.1] tracking-tight text-balance sm:text-5xl">
                Start your free {founding.pilotDays}-day pilot.
              </h2>
              <p className="leading-relaxed text-teal-100 sm:text-lg">
                It takes a minute. We WhatsApp you within {founding.replyMinutes} minutes during work hours.
              </p>
              <SpotsText className="text-sm font-semibold text-amber-500" />
            </div>
            <FoundingForm />
          </div>
        </section>

        {/* 5. The doubts, answered just under the form */}
        <section>
          <div className="mx-auto grid max-w-3xl gap-5 px-4 py-8 sm:px-6 sm:py-12">
            <Objections />
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
