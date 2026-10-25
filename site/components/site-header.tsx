import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { site } from "@/lib/site";

/**
 * The sticky header of the main page and /founding. One focus: the logo and
 * the one button, to the form, with the main page's offer banner above them.
 * Solid, not blurred: a blurred bar over the page as it scrolls is heavy work
 * on an iPhone and made scrolling stutter (owner, 21 Oct 2026).
 */
export function SiteHeader({ banner, cta }: { banner?: ReactNode; cta: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-mint">
      {banner}
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:h-16 sm:px-6">
        <a href="#top" aria-label={`${site.name} home`}>
          <Logo />
        </a>
        <a
          href="#apply"
          className="flex min-h-11 items-center rounded-full bg-teal-900 px-4 text-sm font-semibold text-sand transition-[background-color,transform] duration-150 ease-out hover:bg-teal-800 active:scale-[0.97]"
        >
          {cta}
        </a>
      </div>
    </header>
  );
}
