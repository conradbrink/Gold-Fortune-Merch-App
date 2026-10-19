import type { Metadata, Viewport } from "next";
import { Inter, Outfit } from "next/font/google";
import { site } from "@/lib/site";
import { Analytics } from "@/components/analytics";
import { MetaPixel } from "@/components/meta-pixel";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  weight: ["600", "700", "800"],
});

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

const description =
  "Tickd is the app for distributors with 3 to 20 reps. See which stores each rep visited and when, get orders from their phones straight to your warehouse, photos of the shelf and your promotions, each rep's sales against target, the kilometres they drive, and invoices for every order. Made for Southern Africa.";

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
      <body>
        {children}
        <Analytics />
        <MetaPixel />
      </body>
    </html>
  );
}
