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
  "Tickd is the app for teams that work on site. Your team checks in at every job and takes photos. You see where they are, how long they stay and what got done. Then you invoice and get paid, all in one app. Made for Southern Africa.";

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
