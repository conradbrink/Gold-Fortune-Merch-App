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
  "See what your field team actually did today, and what they sold. One app for your people in the field, one dashboard for you, with GPS check-ins and camera-only photos they can't fake. Runs on low-cost Android phones, works with no signal. Built for Southern Africa.";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: `${site.name} | ${site.headline}`,
  description,
  openGraph: {
    title: `${site.name}: ${site.headline}`,
    description,
    siteName: site.name,
    locale: "en_ZA",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f3d3e",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-ZA" className={`${outfit.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
