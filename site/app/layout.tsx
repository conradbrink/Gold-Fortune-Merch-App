import type { Metadata, Viewport } from "next";
import { Inter, Outfit } from "next/font/google";
import { site } from "@/lib/site";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  weight: ["600", "700", "800"],
});

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

const description =
  "Tickd is the all-in-one app for teams that work on site. See who's at work and their hours, where everyone is, the kilometres they drive and every job done with photos. Send clients signed job reports, get alerts when something's off, and quote, invoice and see who owes you. Made for Southern Africa.";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: `${site.name} | ${site.whatItIs}`,
  description,
  openGraph: {
    title: `${site.name}: ${site.whatItIs}`,
    description,
    siteName: site.name,
    locale: "en_ZA",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#165455",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-ZA" className={`${outfit.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
