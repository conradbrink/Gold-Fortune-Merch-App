import {
  CalendarDays,
  Check,
  ClipboardList,
  MapPin,
  MessageSquareText,
  MessagesSquare,
  PackageX,
  Repeat,
  Store,
  Target,
  TrendingUp,
  Users,
  UserX,
} from "lucide-react";
import Image from "next/image";
import { CostCalculator } from "@/components/cost-calculator";
import { ProductDemo } from "@/components/demo/product-demo";
import { FoundingForm } from "@/components/founding-form";
import { FoundingGuarantee, FoundingStack, Objections } from "@/components/founding-package";
import { SpotsText } from "@/components/founding-spots";
import { Logo } from "@/components/logo";
import { PricingSection } from "@/components/pricing-section";
import { ProofSection } from "@/components/proof-section";
import { SectionViews } from "@/components/analytics";
import { confirmed, firstPlan, founding, foundingFrom, proof, rand, site } from "@/lib/site";

// Copy: ~/Downloads/site-copy-final-v7.md, reworked on 8 Oct 2026 with the
// Hormozi offer skills, then rewritten on 9 Oct 2026 to read the way you'd say
// it to an owner: one idea per sentence, no puns, body text in ink (grey is
// for small print), as few words as will do, no dashes, and only live
// features. Lines v7 marks [CONFIRM] sit behind `confirmed` in lib/site.ts.
// Since 19 Oct 2026 the site is only for distributors whose reps visit stores,
// teams of 3 to 30 reps. The result shown is Gold Fortune's, a distributor
// that is the owner's own family business, so no line calls it a client.
//
// On 20 Oct 2026 the owner set the page's order (worksheet:
// ~/.claude/plans/site-landing/worksheet.md): hero, proof, the problem, the
// benefits, how it works, the doubts (the Founding package, the prices, the
// questions), then the form to close. One focus: the header has no links but
// the one button, and "Sign in" for customers is in the footer. There are no
// reviews or client logos yet, so the trust shown is Gold Fortune's real result.
// Mobile first: every style below is the phone's; sm:/md:/lg: only add room.
// Light only, on purpose: owners read this on a phone outdoors, between jobs,
// and the brand is built on the sand ground.

// 3. The old way: what an owner lives with before Tickd.
const pains = [
  { icon: UserX, title: "You can't prove who went where.", body: "A store says nobody came, and your rep says he did." },
  {
    icon: MessagesSquare,
    title: "Orders come in on WhatsApp and paper.",
    body: "Someone types them up again at night, and the mistakes reach your warehouse.",
  },
  { icon: Store, title: "Good stores go quiet.", body: "Nobody notices for weeks, and by then a competitor has the shelf." },
  {
    icon: PackageX,
    title: "Reps take whatever order they're given.",
    body: "Nobody sells in the products a store doesn't stock yet, so every visit stays small.",
  },
];

// 4. What changes: each live feature, and what it means for the owner.
// Visits: check-ins with the distance from the store, photos only from the
// app's camera, the missed_planned and off_site_checkin alerts, the live map
// and kilometres (/tracking). Sales: the win-back list (/stores/reorder),
// "Same again", "Don't stock", sales against target, invoices and /owed.
const benefits = [
  {
    icon: MapPin,
    title: "Every visit, proven",
    body: "Reps check in at the store, and shelf photos can only be taken in the app, with the time and place. A missed store visit is flagged, to improve your team's efficiency.",
  },
  {
    icon: CalendarDays,
    title: "Every store visited, planned ahead",
    body: "Make sure all your stores are visited, and plan your reps' visits months in advance.",
  },
  {
    icon: ClipboardList,
    title: "Orders straight to your warehouse",
    body: "Orders taken by your reps show up on the system automatically.",
  },
  {
    icon: Store,
    title: "More sales per store",
    body: "The stores that have stopped ordering, biggest buyers first, with a number to ring. You hear about them while they can still be won back.",
  },
  {
    icon: Repeat,
    title: "More data",
    body: "The app prompts your reps from each store's purchase history, and reminds them to take an order when a store hasn't ordered like it usually does.",
  },
  {
    icon: Target,
    title: "Targets for every rep",
    body: "Give your reps targets, and make sure they achieve them.",
  },
];

// The AI Manager, live on main: Ask answers from the company's own data (the
// tools in the app's lib/assistant-tools.ts), plans a rep's month of visits
// (#186), and every report has its summary (/api/insights).
const ai = [
  { icon: MessageSquareText, text: "Ask about your stores, reps, sales, orders and stock, and get the answer in seconds." },
  // Added by the owner (20 Oct 2026). Ask answers from the company's own
  // lookups and drafts plans from them; a list it shows can be downloaded
  // (ExportMenu). There is no "send to the team" yet, so it says download.
  { icon: TrendingUp, text: "Ask it how to grow your sales in an area, and it draws up a plan." },
  { icon: Users, text: "Ask about each rep's performance, and download the report to share with your team." },
];

// What the form at the foot of the page gets them, in three lines.
const youGet = [
  "Every store visit, proven.",
  "Orders on the phone, straight to your warehouse.",
  "Set up for you, and your reps trained.",
];

// The rest of the questions, after the doubts (lib/site.ts `objections`).
const faqs: [q: string, a: string][] = [
  ["Who is it for?", "Distributors with 3 to 30 reps who visit stores, take orders and check the shelves."],
  [
    `What happens after the ${founding.priceMonths} founding months?`,
    `You go onto your plan's normal price, from ${rand(firstPlan.monthly)} a month for up to ${firstPlan.reps} reps. The plans are above.`,
  ],
  ["Do my reps need new phones?", "No. Tickd runs on the Android phones your reps already have."],
  ["Can I trust the shelf photos?", "Yes. They can only be taken inside the app, and each one shows the time and place."],
  [
    "Can a rep check in without going to the store?",
    "Tickd flags it. Every check-in records how far the rep was from the store, so one made from somewhere else stands out.",
  ],
  [
    "Will my reps mind?",
    "It only works while they're clocked in, and it proves the stores they did visit and the orders they took. That protects them too.",
  ],
  ...(confirmed.legalFaq
    ? ([["Is it legal?", "Yes, when you tell your reps how it works. We cover that on the training day."]] as [string, string][])
    : []),
  ["Who is it not for?", "A one-person business, or a team with no reps visiting stores."],
];

// One spacing rhythm for every section: 80px between sections on a phone, 128px
// from sm up, and 24px (32px) between a heading block and what follows it.
// Headings are 36px on a phone and 48px from sm; body copy is 18px.
const wrap = "mx-auto grid gap-6 px-4 py-10 sm:gap-8 sm:px-6 sm:py-16";
const h2 = "tk-reveal font-display text-4xl font-bold leading-[1.08] tracking-tight text-balance text-teal-900 sm:text-5xl";
const h3 = "tk-reveal font-display text-2xl font-bold leading-tight text-balance text-teal-900 sm:text-3xl";
const lead = "max-w-2xl text-lg leading-relaxed text-pretty text-ink";
// The one line a section ends on.
const verdict = "font-display text-2xl font-extrabold leading-snug text-balance text-teal-900 sm:text-3xl";

const pilotButton =
  "flex min-h-14 w-full items-center justify-center text-balance text-center rounded-full bg-amber-500 px-6 py-4 text-lg font-semibold text-teal-950 transition-[background-color,transform] duration-150 ease-out hover:bg-amber-400 active:scale-[0.97] sm:inline-flex sm:w-auto sm:py-3.5";

function Points({ items, badge }: { items: { icon: typeof Store; text: string }[]; badge: string }) {
  return (
    <ul className="grid gap-4">
      {items.map(({ icon: Icon, text }) => (
        <li key={text} className="tk-reveal tk-timeline flex items-center gap-3.5">
          <span className={`tk-pop tk-icon-hover grid size-10 shrink-0 place-items-center rounded-xl ${badge}`}>
            <Icon className="tk-draw size-5" strokeWidth={2.25} aria-hidden="true" />
          </span>
          <span className="text-lg leading-snug text-ink">{text}</span>
        </li>
      ))}
    </ul>
  );
}

// A real dashboard screenshot (example data), cut to the page's own content
// edges (public/demo/dash/site-*.webp, cropped from the full screens), so
// nothing is sliced through and the whole thing shows at its own shape.
function Shot({
  src,
  alt,
  width,
  height,
  className = "",
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
}) {
  return (
    <figure className={`tk-reveal grid gap-2 ${className}`}>
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        unoptimized
        sizes="(min-width: 1024px) 560px, 100vw"
        className="h-auto w-full rounded-2xl bg-white ring-1 ring-line"
      />
    </figure>
  );
}

// The funnel's "viewed the prices" and "read what it does" steps (Google Analytics).
// The Founding package is where the price first shows, so it alone sends
// pricing_view (one per visit); the normal prices below it don't send it again.
const SECTION_EVENTS = {
  offer: "pricing_view",
  benefits: "feature_view",
  ai: "feature_view",
};

export default function Home() {
  return (
    <>
      {/* One focus: the banner and the one button, both to the form. */}
      <header className="sticky top-0 z-40 border-b border-line/70 bg-mint/90 backdrop-blur">
        <div className="bg-teal-900 px-4 py-2 text-center text-sm text-sand">
          Founding {founding.spots}: free {founding.pilotDays}-day pilot + {founding.percentOff}% off for {founding.priceMonths} months.{" "}
          <SpotsText short className="font-semibold" />{" "}
          <a href="#apply" className="whitespace-nowrap font-semibold text-amber-500 underline underline-offset-4 hover:text-amber-400">
            Start my free pilot
          </a>
        </div>
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:h-16 sm:px-6">
          <a href="#top" aria-label={`${site.name} home`}>
            <Logo />
          </a>
          <a
            href="#apply"
            className="flex min-h-11 items-center rounded-full bg-teal-900 px-4 text-sm font-semibold text-sand transition-[background-color,transform] duration-150 ease-out hover:bg-teal-800 active:scale-[0.97]"
          >
            Start my free pilot
          </a>
        </div>
      </header>

      <SectionViews sections={SECTION_EVENTS} />
      <main id="top">
        {/* 1. Hero, in the owner's words (19 Oct 2026): who it's for, the
            outcome, how, the effort it doesn't take, the way in, and the
            first trust signal (Gold Fortune's result). */}
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-10 pt-8 sm:px-6 sm:pb-16 sm:pt-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14 lg:pt-12">
          <div className="tk-hero grid gap-5 sm:gap-6">
            <p className="text-sm font-bold uppercase tracking-wide text-teal-700">For distributors with 3 to 30 reps</p>
            <h1 className="font-display text-5xl font-extrabold leading-[1.02] tracking-tight text-balance text-teal-900 sm:text-6xl lg:text-[4rem]">
              Turn every visit into an{" "}
              <span className="relative whitespace-nowrap">
                order.
                <span aria-hidden="true" className="tk-underline absolute inset-x-0 bottom-[-0.02em] h-[0.12em] rounded-full bg-amber-500" />
              </span>
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-pretty text-ink sm:text-xl">
              Every store visited. Every visit proven. Your whole sales team on one screen.
            </p>
            <p className="flex max-w-xl items-start gap-2.5 text-lg font-semibold leading-relaxed text-teal-900">
              <span aria-hidden="true" className="mt-1 grid size-6 shrink-0 place-items-center rounded-full bg-teal-700 text-white">
                <Check className="size-4" strokeWidth={3.5} />
              </span>
              We set everything up. You just add your reps.
            </p>
            <div className="grid justify-items-start gap-2">
              <a href="#apply" className={pilotButton}>
                Start my free pilot
              </a>
              <p className="text-sm font-semibold text-teal-900">No card · No contract</p>
            </div>
            <div className="flex max-w-xl items-center gap-3 border-t border-line pt-5">
              <Image
                src="/gold-fortune-logo.png"
                alt="Gold Fortune logo"
                width={256}
                height={256}
                className="size-11 shrink-0 rounded-lg bg-white object-contain p-0.5 ring-1 ring-line"
              />
              <p className="grid leading-snug">
                <span className="font-display text-xl font-extrabold text-teal-900">
                  R184k <span aria-label="to">→</span> R340k a month at one retailer
                </span>
                <span className="text-sm text-muted">
                  Gold Fortune · {proof.reps} reps · {proof.stores} stores
                </span>
              </p>
            </div>
          </div>
          <figure className="tk-hero-demo grid gap-3">
            <ProductDemo />
          </figure>
        </section>

        {/* 2. Social proof: Gold Fortune's real numbers, straight under the hero. */}
        <ProofSection applyHref="#apply" />

        {/* 3. The problem: the old way, then what it costs (the calculator). */}
        <section id="problem" aria-labelledby="problem-title">
          <div className={`${wrap} max-w-6xl`}>
            <div className="grid gap-3">
              <h2 id="problem-title" className={h2}>
                The old way is costing you orders.
              </h2>
              <p className={lead}>This is how most reps are still run.</p>
            </div>
            <ul className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
              {pains.map(({ icon: Icon, title, body }) => (
                <li key={title} className="tk-reveal tk-timeline flex gap-3.5 border-t border-line pt-5">
                  <span className="tk-pop grid size-10 shrink-0 place-items-center rounded-xl bg-flag/10 text-flag ring-1 ring-flag/20">
                    <Icon className="size-5" strokeWidth={2.25} aria-hidden="true" />
                  </span>
                  <span className="grid gap-1">
                    <span className="font-display text-xl font-bold leading-snug text-teal-900">{title}</span>
                    <span className="text-lg leading-relaxed text-ink">{body}</span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="grid gap-3 pt-4 sm:pt-6">
              <h3 className={h3}>Every missed visit is an order you never see.</h3>
              <p className={lead}>Put in your numbers to see what missed visits cost you.</p>
            </div>
            <div className="tk-reveal">
              <CostCalculator />
            </div>
          </div>
        </section>

        {/* 4. The solution: each benefit with what it means (the live map and
            dashboard pictures came off, owner 20 Oct 2026). */}
        <section id="benefits" aria-labelledby="benefits-title" className="scroll-mt-28 border-t border-line bg-white">
          <div className={`${wrap} max-w-6xl`}>
            <div className="grid gap-3">
              <h2 id="benefits-title" className={h2}>
                {site.name} fixes all four.
              </h2>
              <p className={lead}>
                Your reps use the app on their phones. You see it all on your computer, or on your own phone.
              </p>
            </div>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {benefits.map(({ icon: Icon, title, body }) => (
                <li key={title} className="tk-reveal grid content-start gap-3 rounded-2xl bg-mint p-5 ring-1 ring-teal-100 sm:p-6">
                  <span className="tk-icon-hover grid size-11 place-items-center rounded-xl bg-teal-900 text-amber-500">
                    <Icon className="size-5" strokeWidth={2.25} aria-hidden="true" />
                  </span>
                  <h3 className="font-display text-xl font-bold leading-snug text-teal-900">{title}</h3>
                  <p className="text-base leading-relaxed text-ink sm:text-lg">{body}</p>
                </li>
              ))}
            </ul>
            <p className={verdict}>If it isn&apos;t in {site.name}, it didn&apos;t happen.</p>
          </div>
        </section>

        {/* 4b. "What do I do about it?" The AI Manager (owner, 19 Oct 2026): Ask
            and the report summaries are live (#183, #186, /api/insights). The
            shelf-photo check panel came off the page (owner, 20 Oct 2026). */}
        <section id="ai" className="scroll-mt-28 border-t border-line">
          <div className={`${wrap} max-w-6xl lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-12`}>
            <div className="grid content-start gap-6 sm:gap-8">
              <div className="grid gap-3">
                <p className="tk-reveal text-sm font-bold uppercase tracking-wide text-teal-700">The {site.name} AI Manager</p>
                <h2 className={h2}>What do I do about it?</h2>
                <p className={lead}>
                  Ask any question about your company, and get an instant answer from your real data, so you can make decisions.
                </p>
              </div>
              <Points items={ai} badge="bg-teal-900 text-amber-500" />
              <p className={verdict}>Like a sales manager who has read every report.</p>
            </div>
            {/* One real Ask answer (example data), the owner's pick (20 Oct
                2026): how to improve sales in an area. */}
            <Shot
              src="/demo/dash/site-ask-sales.webp"
              alt="The AI Manager answering “How can we improve sales in Riverside?”: sales are down to R18,400 from R24,100, a store that hasn't ordered and is due, a store that ordered less, two stores without a visit in three weeks, and putting Riverside on one day for the rep."
              width={800}
              height={1280}
              className="mx-auto w-full max-w-sm"
            />
          </div>
        </section>

        {/* 6. The doubts: the Founding 10 package (the value first, then the
            price and the promise), the normal prices, and the questions. */}
        <section id="offer" className="scroll-mt-28 border-t border-line">
          <div className={`${wrap} max-w-6xl`}>
            <div className="grid gap-3">
              <h2 className={h2}>Want to grow your business?</h2>
              <p className={lead}>
                Become one of our Founding {founding.spots} distributors. We set {site.name} up for you and train your reps, your
                first {founding.pilotDays} days are free, and then you get {founding.percentOff}% off your plan for{" "}
                {founding.priceMonths} months, from {rand(foundingFrom)} a month.
              </p>
              <p className={lead}>Only {founding.spots} spots, because our team onboards each one personally.</p>
              <SpotsText className="tk-reveal w-fit rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-teal-900" />
            </div>
            <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr] lg:items-start lg:gap-6">
              <div className="tk-reveal">
                <FoundingStack applyHref="#apply" />
              </div>
              <div className="tk-reveal grid content-start gap-4">
                <FoundingGuarantee />
              </div>
            </div>
          </div>
        </section>

        <section id="pricing" className="border-t border-line bg-white">
          <div className={`${wrap} max-w-6xl`}>
            <div className="grid gap-3">
              <h2 className={h2}>Our prices after the Founding {founding.spots}.</h2>
              <p className={lead}>One simple price, with everything included.</p>
            </div>
            <div className="tk-reveal">
              <PricingSection />
            </div>
          </div>
        </section>

        <section id="faq" className="scroll-mt-28 border-t border-line">
          <div className={`${wrap} max-w-3xl`}>
            <Objections more={faqs} />
          </div>
        </section>

        {/* 7. The close: what they get, in three lines, and the form. */}
        <section id="apply" className="scroll-mt-28 px-4 pb-14 sm:px-6 sm:pb-16">
          <div className="tk-reveal mx-auto grid max-w-3xl gap-6 rounded-2xl bg-teal-900 p-6 text-sand sm:p-10">
            <div className="grid gap-3">
              <h2 className="font-display text-4xl font-extrabold leading-[1.08] tracking-tight text-balance sm:text-5xl">
                Start your free {founding.pilotDays}-day pilot.
              </h2>
              <ul className="grid gap-2">
                {youGet.map((g) => (
                  <li key={g} className="flex items-start gap-2.5 text-lg font-semibold leading-snug">
                    <span aria-hidden="true" className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-amber-500 text-teal-950">
                      <Check className="size-4" strokeWidth={3.5} />
                    </span>
                    {g}
                  </li>
                ))}
              </ul>
              <p className="leading-relaxed text-teal-100 sm:text-lg">
                It takes a minute. We WhatsApp you within {founding.replyMinutes} minutes during work hours. No card, no contract.
              </p>
              <SpotsText className="text-sm font-semibold text-amber-500" />
            </div>
            <FoundingForm />
          </div>
        </section>
      </main>

      <footer className="bg-teal-950 text-teal-100">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
          <Logo inverted />
          <div className="grid gap-2 text-sm md:justify-items-end">
            <p>
              {site.tagline} ·{" "}
              <a href={`mailto:${site.email}`} className="py-1 hover:text-sand">
                {site.email}
              </a>
            </p>
            <p>
              Already using {site.name}?{" "}
              <a href={`${site.appUrl}/login`} className="py-1 font-semibold underline underline-offset-4 hover:text-sand">
                Sign in
              </a>
            </p>
            <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-1">
              <a href="/terms" className="py-1 hover:text-sand">Terms</a>
              <a href="/privacy" className="py-1 hover:text-sand">Privacy</a>
              <a href="/refunds" className="py-1 hover:text-sand">Cancellations and refunds</a>
            </nav>
            <p className="text-xs text-teal-100/70">
              © {new Date().getFullYear()} {site.legalName}
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}
