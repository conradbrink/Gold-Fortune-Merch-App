import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { SectionViews } from "@/components/analytics";
import { ApplySection } from "@/components/apply-section";
import { FoundingCallForm } from "@/components/founding-call-form";
import { SpotsText } from "@/components/founding-spots";
import { FoundingVideo } from "@/components/founding-video";
import { h2, pilotButton, wrap } from "@/components/page-styles";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { founding } from "@/lib/site";

// /founding, where the Meta video ads land (every ad links here with its own
// utm_ tags and ends "fill in the form down below"). Since 25 Oct 2026 it is
// only the hero, the video and the form, so the lead isn't distracted (owner:
// "it should be very simple for them"), with the main page's header, form
// section and footer. The main page is components/landing-page.tsx.
//
// Mobile first: every style below is the phone's; sm:/md:/lg: only add room.

// The hero holds the offer, so arriving is the funnel's "viewed the offer"
// (pricing_view, as on the main page's offer section).
const SECTION_EVENTS = { offer: "pricing_view" };

/**
 * The hero: the promise every video ad ends on, in the ad's own words, so the
 * page picks up where the video left off (owner, 25 Oct 2026: "the promises we
 * made in the CTA should be there"). Hormozi's hero order: who it's for, the
 * outcome, how little it takes, the risk taken away, then one button, Apply
 * now, to the form, with the spots under it. One centred column, four blocks
 * (the stagger in globals.css), no Gold Fortune line. The refund line is the
 * ads' wording, kept on purpose (owner, 25 Oct 2026); /terms#guarantee is the
 * owner's to bring in line.
 */
function FoundingHero() {
  return (
    <section id="offer" className="mx-auto max-w-3xl px-4 pb-10 pt-6 sm:px-6 sm:pb-16 sm:pt-12 lg:max-w-5xl lg:pt-16">
      <div className="tk-hero grid justify-items-center gap-4 text-center sm:gap-6">
        <p className="text-sm font-bold uppercase tracking-wide text-teal-700">For distributors</p>
        <h1 className="font-display text-[2.1rem] font-extrabold leading-[1.06] tracking-tight text-balance text-teal-900 sm:text-5xl lg:text-[3.6rem]">
          Get a{" "}
          <span className="relative whitespace-nowrap">
            free {founding.pilotDays}-day pilot
            <span aria-hidden="true" className="tk-underline absolute inset-x-0 bottom-[-0.02em] h-[0.12em] rounded-full bg-amber-500" />
          </span>
          .<span className="block">We set up your entire business.</span>
        </h1>
        <div className="grid justify-items-center gap-3">
          <p className="max-w-xl text-base leading-relaxed text-pretty text-ink sm:text-xl">
            All your stores included. Then our team helps you grow your business.
          </p>
          <p className="flex max-w-xl items-start gap-2 text-left text-base font-semibold leading-snug text-teal-900 sm:text-lg">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-teal-700" strokeWidth={2.5} />
            <span>
              Not happy after {founding.guaranteeDays} days? We give you that month&apos;s fee back.{" "}
              <Link href="/terms#guarantee" className="whitespace-nowrap text-sm font-medium text-muted underline underline-offset-2">
                T&amp;Cs apply
              </Link>
            </span>
          </p>
        </div>
        <div className="grid w-full justify-items-center gap-2 pt-1 sm:w-fit">
          <a href="#apply" className={pilotButton}>
            Apply now
          </a>
          <p className="text-sm font-semibold text-teal-900">No card · No contract</p>
          <SpotsText
            urgent
            className="mt-1 inline-block w-fit rounded-full bg-amber-500 px-4 py-1.5 text-sm font-extrabold uppercase tracking-wide text-teal-950"
          />
        </div>
      </div>
    </section>
  );
}

export function FoundingPage() {
  return (
    <>
      {/* No offer banner: the hero says it all on the first screen, and there
          it would only be a third "Apply now". */}
      <SiteHeader cta="Apply now" />
      <SectionViews sections={SECTION_EVENTS} />
      <main id="top">
        <FoundingHero />

        {/* The video, then the form. The hero's button goes straight to the
            form, so nobody has to watch the video first. */}
        <section id="video" aria-labelledby="video-title" className="border-t border-line bg-white">
          <div className={`${wrap} max-w-4xl`}>
            <h2 id="video-title" className={`${h2} text-center`}>
              Watch how it works (3 minutes)
            </h2>
            <FoundingVideo />
          </div>
        </section>

        <div className="border-t border-line pt-10 sm:pt-16">
          <ApplySection
            intro={`It takes a minute. ${founding.caller} will call you himself, usually within minutes. No card, no contract.`}
          >
            <FoundingCallForm />
          </ApplySection>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
