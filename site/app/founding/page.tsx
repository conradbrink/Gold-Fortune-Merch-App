import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { SectionViews } from "@/components/analytics";
import { FoundingForm } from "@/components/founding-form";
import { FoundingGuarantee, Objections } from "@/components/founding-package";
import { SpotsText } from "@/components/founding-spots";
import { Logo } from "@/components/logo";
import { SiteFooter } from "@/components/site-footer";
import { firstPlan, founding, foundingFrom, proof, rand, site } from "@/lib/site";

// The Founding 10 distributors page, where the Meta video ads land (every ad
// links here with its own utm_ tags, and ends "fill in the form down below").
// Since 25 Oct 2026 it is form-first (owner: "when they land, then it's
// basically just the form"): the offer in one headline, the form straight
// under it on a phone, then the trust and the doubts. On a computer the offer
// and the trust sit beside the form. The long page is the main page
// (components/landing-page.tsx). Keep the address: the ads link to it.
//
// The offer: a free 14-day pilot, set up for them, then 40% off the plan that
// fits for the first 3 months (lib/site.ts `founding`). Only 10 spots; the
// number left is the owner's, from the database.
//
// No video: the old one (public/founding, components/founding-video.tsx) stays
// off (owner, 25 Oct 2026: "I don't want to put it up"); the owner is
// recording a new one for the main page.
//
// Mobile first: every style below is the phone's; sm:/md:/lg: only add room.

export const metadata: Metadata = {
  title: `Become one of our Founding ${founding.spots} distributors | ${site.name}`,
  description: `A free ${founding.pilotDays}-day pilot of ${site.name}, set up for you. Then ${founding.percentOff}% off your plan for ${founding.priceMonths} months, from ${rand(foundingFrom)} a month. Only ${founding.spots} founding spots.`,
};

// The price shows on arrival, so the funnel's "viewed the prices" step is the
// first screen.
const SECTION_EVENTS = { offer: "pricing_view" };

// After the doubts every applicant has (lib/site.ts `objections`).
const faqs: [q: string, a: string][] = [
  ["Who is it for?", "Distributors with 3 to 30 reps who visit stores, take orders and check the shelves."],
  [
    `What happens after the ${founding.priceMonths} founding months?`,
    `You go onto your plan's normal price, from ${rand(firstPlan.monthly)} a month for up to ${firstPlan.reps} reps.`,
  ],
  ["Do my reps need new phones?", "No. Tickd runs on the Android phones your reps already have."],
];

export default function FoundingPage() {
  return (
    <>
      <SectionViews sections={SECTION_EVENTS} />
      <header className="border-b border-line/70 bg-mint">
        <div className="mx-auto flex h-14 max-w-6xl items-center px-4 sm:h-16 sm:px-6">
          <Link href="/" aria-label={`${site.name} home`}>
            <Logo />
          </Link>
        </div>
      </header>

      <main>
        <section
          id="offer"
          className="mx-auto grid max-w-6xl gap-6 px-4 pb-12 pt-5 sm:px-6 sm:pt-10 lg:grid-cols-[1fr_minmax(0,34rem)] lg:grid-rows-[auto_1fr] lg:gap-x-14 lg:gap-y-8 lg:pb-16 lg:pt-14"
        >
          {/* The offer the ad promised, in as few lines as will do. */}
          <div className="tk-hero grid content-start gap-3 sm:gap-4 lg:col-start-1 lg:row-start-1">
            <p className="text-sm font-bold uppercase tracking-wide text-teal-700">
              Founding {founding.spots} · For 3 to 30 reps
            </p>
            <h1 className="font-display text-[1.9rem] font-extrabold leading-[1.06] tracking-tight text-balance text-teal-900 sm:text-5xl lg:text-[3.4rem]">
              A free {founding.pilotDays}-day pilot,{" "}
              <span className="relative whitespace-nowrap">
                set up for you.
                <span aria-hidden="true" className="tk-underline absolute inset-x-0 bottom-[-0.02em] h-[0.12em] rounded-full bg-amber-500" />
              </span>
            </h1>
            <p className="max-w-xl text-base leading-relaxed text-pretty text-ink sm:text-xl">
              Then {founding.percentOff}% off your plan for {founding.priceMonths} months, from {rand(foundingFrom)} a month.
            </p>
            <SpotsText
              urgent
              className="inline-block w-fit rounded-full bg-amber-500 px-4 py-1.5 text-sm font-extrabold uppercase tracking-wide text-teal-950"
            />
          </div>

          {/* The form, straight under the offer on a phone. */}
          <div
            id="apply"
            className="grid scroll-mt-4 content-start gap-5 rounded-2xl bg-teal-900 p-5 text-sand sm:p-8 lg:col-start-2 lg:row-span-2 lg:row-start-1"
          >
            <div className="grid gap-1">
              <h2 className="font-display text-2xl font-extrabold leading-tight sm:text-3xl">Apply for a founding spot</h2>
              <p className="leading-relaxed text-teal-100">It takes a minute. We&apos;ll email you to set up your pilot.</p>
            </div>
            <FoundingForm />
            <p className="text-center text-sm font-semibold text-teal-100 sm:text-left">No card · No contract</p>
          </div>

          {/* The trust, under the form on a phone and under the offer on a computer. */}
          <div className="grid content-start gap-4 lg:col-start-1 lg:row-start-2">
            <div className="flex items-center gap-3 rounded-2xl bg-white p-4 ring-1 ring-line">
              <Image
                src="/gold-fortune-logo.png"
                alt="Gold Fortune logo"
                width={256}
                height={256}
                className="size-11 shrink-0 rounded-lg bg-white object-contain p-0.5 ring-1 ring-line"
              />
              <p className="grid leading-snug">
                <span className="font-display text-lg font-extrabold text-teal-900 sm:text-xl">
                  R184k <span aria-label="to">→</span> R340k a month at one retailer
                </span>
                <span className="text-sm text-muted">
                  Gold Fortune · {proof.reps} reps · {proof.stores} stores
                </span>
              </p>
            </div>
            <FoundingGuarantee />
          </div>
        </section>

        <section id="faq" className="border-t border-line">
          <div className="mx-auto grid max-w-3xl gap-6 px-4 py-10 sm:px-6 sm:py-16">
            <Objections more={faqs} />
            <a
              href="#apply"
              className="flex min-h-12 w-full items-center justify-center rounded-full bg-amber-500 px-6 py-3 text-lg font-semibold text-teal-950 transition-[background-color,transform] duration-150 ease-out hover:bg-amber-400 active:scale-[0.97] sm:w-fit"
            >
              Start my free {founding.pilotDays}-day pilot
            </a>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
