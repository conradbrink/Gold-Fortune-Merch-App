import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Gold Fortune Merchandising",
  description: "Field merchandising management for Gold Fortune",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning is required, not defensive: the script below
    // adds the `dark` class to this element before React exists, so the DOM
    // deliberately differs from what the server rendered. It suppresses the
    // warning for this element's own attributes only — children are unaffected.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Runs during HTML parsing, ahead of the first paint, so the theme is
            never seen changing. See lib/theme.ts for why this cannot be an
            effect, and next/dist/docs/01-app/02-guides/
            preventing-flash-before-hydration for the pattern. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="h-full bg-background">{children}</body>
    </html>
  );
}
