"use client";

import { cn } from "@/lib/utils";
import { logoUrl, type Branding } from "@/lib/branding";

/**
 * The signed-in company's logo, or the first letter of its name in its own
 * colour when it has not uploaded one.
 *
 * A plain <img> rather than next/image: the logo is a public file in the
 * Supabase `branding` bucket, and next/image refuses a remote host that
 * `next.config.ts` does not list. The file is already small and versioned by
 * name, so the optimiser would add a hop and buy nothing.
 */
export function CompanyMark({
  branding,
  className,
}: {
  /** Null while the configuration loads: an empty square holds the space. */
  branding: Branding | null;
  className?: string;
}) {
  const box = cn("h-8 w-8 shrink-0 rounded-md", className);
  if (branding === null) return <div aria-hidden className={box} />;

  const src = logoUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!, branding.logoPath);
  if (src) {
    // The whole logo at its own shape: as tall as the square, as wide as it
    // needs up to three squares. Cropped to a square, a wide logo lost its
    // ends ("aQua blast" read "Qu bla", 30 Oct 2026). A caller with no room to
    // spare narrows it with `max-w-8`, and the logo then shrinks to fit.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={branding.name}
        className={cn("h-8 w-auto max-w-24 shrink-0 rounded-md object-contain", className)}
      />
    );
  }

  // `bg-primary` is the company's main colour (the dashboard layout sets the
  // variable), so the badge is theirs even without a logo.
  const initial = branding.name.trim().charAt(0).toUpperCase();
  return (
    <div
      aria-hidden
      className={cn(
        box,
        "flex items-center justify-center bg-primary text-sm font-bold text-primary-foreground"
      )}
    >
      {initial}
    </div>
  );
}
