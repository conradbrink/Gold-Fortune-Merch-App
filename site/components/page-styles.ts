// Styles the main page and /founding share, so the two read as one site.

// One spacing rhythm for every section: 80px between sections on a phone, 128px
// from sm up, and 24px (32px) between a heading block and what follows it.
// Headings are 36px on a phone and 48px from sm; body copy is 18px.
export const wrap = "mx-auto grid gap-6 px-4 py-10 sm:gap-8 sm:px-6 sm:py-16";
// Section headings on the left again (owner, 21 Oct 2026); a size smaller on a
// phone, where 36px read too big.
export const h2 = "tk-reveal font-display text-3xl font-bold leading-[1.1] tracking-tight text-balance text-teal-900 sm:text-5xl";

export const pilotButton =
  "flex min-h-12 w-full items-center justify-center text-balance text-center rounded-full bg-amber-500 px-6 py-3 text-lg font-semibold text-teal-950 transition-[background-color,transform] duration-150 ease-out hover:bg-amber-400 active:scale-[0.97] sm:inline-flex sm:w-auto sm:py-3.5";
