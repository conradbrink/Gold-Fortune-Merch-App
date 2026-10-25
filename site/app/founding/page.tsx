import type { Metadata } from "next";
import { FoundingPage } from "@/components/founding-page";
import { founding, site } from "@/lib/site";

// The Founding 10 distributors page, where the Founding adverts land (the Meta
// ads link here with their own utm_ tags; keep the address). Since 25 Oct 2026
// it is its own short page: the hero, the video and the form
// (components/founding-page.tsx). The video is the owner's final 3-minute cut,
// from this site, not YouTube (owner, 25 Oct 2026): components/founding-video.tsx,
// public/founding.
//
// The offer, as the ads say it: a free 14-day pilot where we set up the whole
// business, and that month's fee back after 30 days if they're not happy. Only
// 10 spots; the number left is the owner's, from the database.

// The words a shared link or a search result shows, the same as the hero's, so
// a WhatsApp or Facebook preview promises what the page does (without its own
// openGraph the page would show the main page's).
const title = `A free ${founding.pilotDays}-day pilot. We set up your entire business. | ${site.name}`;
const description = `For distributors: a free ${founding.pilotDays}-day pilot of ${site.name}, with all your stores set up for you. Not happy after ${founding.guaranteeDays} days? We give you that month's fee back. Only ${founding.spots} founding spots.`;

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, siteName: site.name, locale: "en_ZA", type: "website", url: `${site.url}${site.foundingPath}` },
};

export default function Founding() {
  return <FoundingPage />;
}
