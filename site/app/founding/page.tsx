import type { Metadata } from "next";
import { LandingPage } from "@/components/landing-page";
import { founding, foundingFrom, rand, site } from "@/lib/site";

// The Founding 10 distributors page, where the Founding adverts land. Since
// 20 Oct 2026 it is the main landing page (components/landing-page.tsx) with
// a hero that leads with the offer the adverts promise (owner: "the founding
// page should be redesigned to fit our current landing page"). It used to be
// its own shorter page with the video at the top (components/founding-video.tsx,
// kept for a distributor cut of the video).
//
// The offer: a free 14-day pilot, set up for them, then 40% off the plan that
// fits for the first 3 months (lib/site.ts `founding`). Only 10 spots; the
// number left is the owner's, from the database.

export const metadata: Metadata = {
  title: `Become one of our Founding ${founding.spots} distributors | ${site.name}`,
  description: `A free ${founding.pilotDays}-day pilot of ${site.name}, set up for you. Then ${founding.percentOff}% off your plan for ${founding.priceMonths} months, from ${rand(foundingFrom)} a month. Only ${founding.spots} founding spots.`,
};

export default function FoundingPage() {
  return <LandingPage hero="founding" />;
}
