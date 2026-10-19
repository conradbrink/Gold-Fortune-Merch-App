import {
  Check,
  CloudOff,
  GraduationCap,
  LayoutDashboard,
  MapPin,
  MapPinned,
  Navigation,
  PackageX,
  Repeat,
  Smartphone,
  Store,
  Tags,
  Target,
  Camera,
} from "lucide-react";
import Image from "next/image";
import { CostCalculator } from "@/components/cost-calculator";
import { ProductDemo } from "@/components/demo/product-demo";
import { FoundingForm } from "@/components/founding-form";
import { FoundingGuarantee, FoundingStack, Objections } from "@/components/founding-package";
import { SpotsText } from "@/components/founding-spots";
import { Logo } from "@/components/logo";
import { TradeTabs } from "@/components/trade-tabs";
import { FoundingStart } from "@/components/founding-start";
import { PricingSection } from "@/components/pricing-section";
import { ProofSection } from "@/components/proof-section";
import { SectionViews } from "@/components/analytics";
import { confirmed, founding, growthPlan, rand, site } from "@/lib/site";

// Copy: ~/Downloads/site-copy-final-v7.md, reworked on 8 Oct 2026 with the
// Hormozi offer skills (audit in the site-offer worktree's OFFER-AUDIT.md),
// then rewritten on 9 Oct 2026 to read the way you'd say it to an owner:
// say what Tickd does in the hero, one idea per sentence, no bold title that
// only repeats its sentence, no puns, body text in ink (grey is for small
// print), and as few words as will do. Still no dashes, and only live features.
// Lines v7 marks [CONFIRM] sit behind `confirmed` in lib/site.ts.
// On 19 Oct 2026 the owner made the site only for distributors whose reps
// visit stores, teams of 3 to 20 reps (worksheet: ~/.claude/plans/site-
// distributors), then laid it out as the questions an owner asks: "Did my reps
// actually go?", "Did they sell?", then the Founding 10 distributors package
// as a value stack, the pilot form, and the doubts answered just under it.
// (The owner's third question, Tickd AI on WhatsApp, waits until it ships.)
// The result shown is Gold Fortune's, a distributor that is the owner's own
// family business, so no line calls it a client.
// Mobile first: every style below is the phone's; sm:/md:/lg: only add room.
// Light only, on purpose: owners read this on a phone outdoors, between jobs,
// and the brand is built on the sand ground.

const nav = [
  { href: "#visits", label: "Did they go?" },
  { href: "#sales", label: "Did they sell?" },
  { href: "#offer", label: "Founding offer" },
  { href: "#faq", label: "Questions" },
];

// The things that make it easy to say yes, straight under the hero. Each item
// answers the strip's question, "What do you need to start?"; the training one
// takes away the "my reps won't use it" doubt early.
const easy = [
  { icon: Smartphone, title: "Just their own phones", body: "Tickd runs on the Android phones your reps already have." },
  { icon: GraduationCap, title: "Reps learn it in 10 minutes", body: "We train them for you, on a video call." },
  { icon: CloudOff, title: "No signal needed in the store", body: "The app works without signal, and sends the visits and orders once there's signal again." },
  { icon: Tags, title: "Your stores and products, loaded for you", body: "Send us your store list and your price lists, and we set it all up." },
];

// "Did my reps actually go?": live on main, the live map and each rep's day
// (/tracking), photos only from the app's camera with the time and place, and
// the alerts for a planned visit missed and a check-in away from the store
// (20261009170000_alerts: missed_planned, off_site_checkin).
const visits = [
  { icon: Navigation, text: "A live map of where every rep is, and each rep's day, store by store." },
  { icon: Camera, text: "Photos can only be taken in the app, and each one shows the time and place." },
  { icon: MapPin, text: "A warning when a store on the route is missed, or a rep checks in away from the store." },
  { icon: MapPinned, text: "How far each rep drove, for your petrol claims." },
];

// "Did they sell?": live on main, the win-back list of stores that stopped
// ordering (/stores/reorder), "Same again" on the rep's phone (the store's
// last order), "Don't stock" on each promotion check, and sales against target.
// No leaderboard and no out-of-stock form yet, so neither is claimed.
const sales = [
  { icon: Store, text: "Stores that have stopped ordering, biggest buyers first, with a number to ring." },
  { icon: Repeat, text: "“Same again”: the store's last order, ready for the rep to repeat and add to." },
  { icon: PackageX, text: "Reps mark the products a store doesn't stock, so you can sell them in." },
  { icon: Target, text: "Each rep's sales against their target, every day." },
];

// Who does what: the reps work on their phones, the owner runs it from anywhere.
const teamSteps = [
  ["Start the day.", "One tap starts their day and shows today's stores."],
  ["Visit the store.", "They check in, check the shelf and your promotions, and take photos."],
  ["Take the order.", "They take the order on the phone. The prices come from the store's price list."],
  ["End the day.", "Their visits, orders and kilometres are all saved."],
];
const ownerSteps = [
  ["Set it up.", "We load your reps, stores and products for you."],
  ["Plan the routes.", "Give each rep their stores for the day."],
  ["Pack and deliver.", "Your warehouse confirms, picks and packs every order."],
  ["Get paid.", "Every order becomes an invoice, and you see who still owes you."],
];

// What the one app takes the place of: the value is the mess it removes.
const replaces = [
  "WhatsApp groups for orders and photos",
  "Paper order books",
  "Spreadsheets of stores and visits",
  "A paper logbook for kilometres",
  "Typing up invoices at night",
];

// The rest of the questions, after the doubts at the form (lib/site.ts `objections`).
const faqs: [q: string, a: string][] = [
  ["Who is it for?", "Distributors with 3 to 20 reps who visit stores, take orders and check the shelves."],
  [
    `What happens after the ${founding.priceMonths} founding months?`,
    `You go onto our normal price, ${rand(growthPlan.monthly)} a month for up to ${growthPlan.reps} reps. The other plans are below.`,
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
const wrap = "mx-auto grid gap-6 px-4 py-10 sm:gap-8 sm:px-6 sm:py-16";
const h2 = "tk-reveal font-display text-3xl font-bold leading-[1.1] tracking-tight text-balance text-teal-900 sm:text-[2.75rem]";
const lead = "max-w-2xl text-lg leading-relaxed text-pretty text-ink";
// The one line each question section ends on.
const verdict = "font-display text-2xl font-extrabold leading-snug text-balance text-teal-900 sm:text-3xl";

const pilotButton =
  "flex w-full items-center justify-center text-balance text-center rounded-full bg-amber-500 px-6 py-4 text-lg font-semibold text-teal-950 transition-[background-color,transform] duration-150 ease-out hover:bg-amber-400 active:scale-[0.97] sm:inline-flex sm:w-auto sm:py-3.5 sm:text-base";

function Lane({
  icon: Icon,
  who,
  where,
  steps,
  className,
  badge,
}: {
  icon: typeof Smartphone;
  who: string;
  where: string;
  steps: string[][];
  className: string;
  badge: string;
}) {
  return (
    <div className={`tk-reveal grid content-start gap-5 rounded-2xl p-5 ring-1 sm:p-7 ${className}`}>
      <div className="flex items-center gap-3">
        <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${badge}`}>
          <Icon className="size-5" strokeWidth={2.25} />
        </span>
        <span className="grid leading-tight">
          <span className="font-display text-2xl font-extrabold text-teal-900">{who}</span>
          <span className="text-sm font-medium text-muted">{where}</span>
        </span>
      </div>
      <ol className="grid gap-4">
        {steps.map(([title, body], i) => (
          <li key={title} className="grid grid-cols-[2rem_1fr] gap-3">
            <span className={`grid size-8 place-items-center rounded-full font-display font-extrabold ${badge}`}>
              {i + 1}
            </span>
            <span className="grid gap-0.5">
              <h3 className="font-display text-lg font-bold text-teal-900 sm:text-xl">{title}</h3>
              <p className="leading-relaxed text-ink">{body}</p>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Points({ items, badge }: { items: { icon: typeof Smartphone; text: string }[]; badge: string }) {
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
  visits: "feature_view",
  sales: "feature_view",
  how: "feature_view",
};

export default function Home() {
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line/70 bg-mint/90 backdrop-blur">
        <div className="bg-teal-900 px-4 py-2 text-center text-sm text-sand">
          Founding 10 distributors: a free {founding.pilotDays}-day pilot, then {founding.percentOff}% off for {founding.priceMonths} months.{" "}
          <a href="#apply" className="whitespace-nowrap font-semibold text-amber-500 underline underline-offset-4 hover:text-amber-400">
            Start my free pilot
          </a>
        </div>
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:h-16 sm:px-6">
          <a href="#top" aria-label={`${site.name} home`}>
            <Logo />
          </a>
          <nav className="hidden items-center gap-7 text-sm font-medium text-muted md:flex">
            {nav.map((n) => (
              <a key={n.href} href={n.href} className="hover:text-teal-900">
                {n.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <a href={`${site.appUrl}/login`} className="hidden text-sm font-semibold text-teal-900 hover:underline sm:inline">
              Sign in
            </a>
            <a
              href="#apply"
              className="rounded-full bg-teal-900 px-4 py-2 text-sm font-semibold text-sand transition-[background-color,transform] duration-150 ease-out hover:bg-teal-800 active:scale-[0.97]"
            >
              Free pilot
            </a>
          </div>
        </div>
      </header>

      <SectionViews sections={SECTION_EVENTS} />
      <main id="top">
        {/* 1. Hero, in the owner's words (19 Oct 2026): who it's for, the
            outcome, the effort it doesn't take, the way in, and the result. */}
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-10 pt-8 sm:px-6 sm:pb-16 sm:pt-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14 lg:pt-12">
          <div className="tk-hero grid gap-5 sm:gap-6">
            <p className="text-sm font-bold uppercase tracking-wide text-teal-700">For distributors with 3 to 20 reps</p>
            <h1 className="font-display text-[2.6rem] font-extrabold leading-[1.02] tracking-tight text-balance text-teal-900 sm:text-6xl lg:text-[4.25rem]">
              Turn every visit into an{" "}
              <span className="relative whitespace-nowrap">
                order.
                <span aria-hidden="true" className="tk-underline absolute inset-x-0 bottom-[-0.02em] h-[0.12em] rounded-full bg-amber-500" />
              </span>
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-pretty text-ink sm:text-xl">
              Every store visited. Every visit proven. Your whole sales team on one screen.
            </p>
            <p className="max-w-xl text-lg font-semibold leading-relaxed text-teal-900">We set everything up. You just add your reps.</p>
            <div className="grid justify-items-start gap-3">
              <a href="#apply" className={pilotButton}>
                See it on your own reps, free for {founding.pilotDays} days
              </a>
              <ul className="flex flex-wrap gap-2" aria-label="The pilot">
                {["No card", "No contract"].map((t) => (
                  <li key={t} className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-sm font-semibold text-teal-900 ring-1 ring-line">
                    <Check className="size-4 text-teal-700" strokeWidth={3} aria-hidden="true" />
                    {t}
                  </li>
                ))}
              </ul>
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
                <span className="text-sm text-muted">Gold Fortune&apos;s own figures</span>
              </p>
            </div>
          </div>
          <figure className="tk-hero-demo grid gap-3">
            <ProductDemo />
          </figure>
        </section>

        {/* 2. Easy to say yes: the effort it doesn't take. */}
        <section aria-labelledby="start-title" className="border-y border-line bg-white">
          {/* The heading, then the four answers: one column on a phone, two
              from sm. No picture (owner, 19 Oct 2026). */}
          <div className={`${wrap} max-w-6xl`}>
            <h2 id="start-title" className="tk-reveal font-display text-2xl font-bold leading-tight text-teal-900 sm:text-3xl">
              What do you need to start?
            </h2>
            <ul className="grid gap-5 sm:grid-cols-2 sm:gap-x-10 sm:gap-y-6">
              {easy.map(({ icon: Icon, title, body }) => (
                <li key={title} className="tk-reveal tk-timeline flex gap-3.5">
                  <Icon className="tk-draw mt-0.5 size-6 shrink-0 text-teal-700" strokeWidth={2} aria-hidden="true" />
                  <span className="grid gap-0.5">
                    <span className="font-display text-lg font-bold text-teal-900">{title}</span>
                    <span className="leading-relaxed text-ink">{body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* The result at a distributor, just under what you need to start. */}
        <ProofSection applyHref="#apply" />

        {/* 3. "Did my reps actually go?" Proof that it works. */}
        <section id="visits" className="scroll-mt-28">
          <div className={`${wrap} max-w-6xl lg:grid-cols-[1fr_1.05fr] lg:items-center lg:gap-14`}>
            <div className="grid content-start gap-6 sm:gap-8">
              <div className="grid gap-3">
                <h2 className={h2}>Did my reps actually go?</h2>
                <p className={lead}>
                  A store says nobody came, and your rep says he did. With {site.name}, every visit is checked in at the store, with the time and
                  the place.
                </p>
              </div>
              <Points items={visits} badge="bg-teal-900 text-amber-500" />
            </div>
            {/* The whole live map is too small to read on a phone, so a phone
                gets the close-up of one rep's day instead. */}
            <Shot
              src="/demo/dash/site-live-map-panel.webp"
              alt="Thabo's day on the live map: 19.8 km driven, 3 check-ins, 2 orders, and every arrival and departure since 06:58."
              width={634}
              height={905}
              className="mx-auto w-full max-w-xs sm:hidden"
            />
            <Shot
              src="/demo/dash/site-live-map.webp"
              alt="The live map: Naledi arrived at Store 22 8 minutes ago, and Thabo's day so far: two stores, two orders, and his arrival at Riverside complex at 11:05."
              width={1984}
              height={1139}
              className="hidden sm:grid"
            />
            <p className={`${verdict} lg:col-span-2`}>If it isn&apos;t in {site.name}, it didn&apos;t happen.</p>
          </div>
        </section>

        {/* 4. "Did they sell?" The dream outcome, in money they can picture. */}
        <section id="sales" className="scroll-mt-28 border-t border-line bg-white">
          <div className={`${wrap} max-w-6xl`}>
            <div className="grid gap-6 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-14">
              <div className="order-2 lg:order-1">
                <Shot
                  src="/demo/dash/site-dashboard.webp"
                  alt="The owner's dashboard: sales by month, each rep's sales against target, and the orders being confirmed, picked, packed and delivered."
                  width={2016}
                  height={1180}
                />
              </div>
              <div className="order-1 grid content-start gap-6 sm:gap-8 lg:order-2">
                <div className="grid gap-3">
                  <h2 className={h2}>Did they sell?</h2>
                  <p className={lead}>
                    Stores go quiet and nobody notices. Reps take whatever order the shop owner gives them. {site.name} shows you where the sales
                    are leaking.
                  </p>
                </div>
                <Points items={sales} badge="bg-amber-500 text-teal-950" />
              </div>
            </div>
            <p className={verdict}>Every visit becomes a bigger order.</p>
            <div className="grid gap-3 border-t border-line pt-8 sm:pt-10">
              <h3 className="tk-reveal font-display text-2xl font-bold leading-tight text-teal-900 sm:text-3xl">The Rep Leak Calculator</h3>
              <p className={lead}>
                One store that stops ordering at R4,000 a month costs you R48,000 a year. Put in your numbers to see what missed visits could be
                costing you.
              </p>
            </div>
            <div className="tk-reveal">
              <CostCalculator />
            </div>
          </div>
        </section>

        {/* 5. At every store (was "Your trade": the other trades are kept in
            components/trade-tabs.tsx, not shown). */}
        <section id="stores" className="border-t border-line">
          <div className={`${wrap} max-w-6xl`}>
            <div className="grid gap-3">
              <h2 className={h2}>What your reps do at every store</h2>
              <p className={lead}>Tap each step to see it on the rep&apos;s phone.</p>
            </div>
            <div className="tk-reveal">
              <TradeTabs />
            </div>
          </div>
        </section>

        {/* 6. How it works */}
        <section id="how" className="border-t border-line bg-white">
          <div className={`${wrap} max-w-6xl`}>
            <div className="grid gap-3">
              <h2 className={h2}>How {site.name} works</h2>
              <p className={lead}>
                Your reps use the app on their phones. You follow along on your computer, or on your own phone.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 md:gap-6">
              <Lane
                icon={Smartphone}
                who="Your reps"
                where="On their phone"
                steps={teamSteps}
                className="bg-amber-100/60 ring-amber-500/40"
                badge="bg-amber-500 text-teal-950"
              />
              <Lane
                icon={LayoutDashboard}
                who="You"
                where="From the office, or your phone"
                steps={ownerSteps}
                className="bg-mint ring-teal-100"
                badge="bg-teal-900 text-sand"
              />
            </div>
            <div className="tk-reveal grid gap-6 rounded-2xl bg-teal-950 p-6 text-sand sm:p-8 md:grid-cols-[0.8fr_1.2fr] md:items-center md:gap-10">
              <div className="grid gap-2">
                <p className="font-display text-2xl font-bold leading-tight text-amber-500 sm:text-3xl">One app instead of five.</p>
                <p className="leading-relaxed text-teal-100">
                  {site.name} replaces all of these. If you need HR later, you can add it.
                </p>
              </div>
              <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
                {replaces.map((r) => (
                  <li key={r} className="tk-reveal-late tk-timeline flex items-start gap-3 border-t border-white/15 pt-3 font-medium leading-snug">
                    <span className="tk-pop mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-amber-500 text-teal-950">
                      <Check className="tk-draw size-3" strokeWidth={3.5} aria-hidden="true" />
                    </span>
                    <span>
                      <span className="sr-only">Replaces </span>
                      {r}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* 7. The Founding 10 distributors package: the value first, then the
            price, the promise and why there are only 10. */}
        <section id="offer" className="scroll-mt-28 border-t border-line">
          <div className={`${wrap} max-w-6xl`}>
            <div className="grid gap-3">
              <h2 className={h2}>The Founding {founding.spots} distributors package.</h2>
              <p className={lead}>Only {founding.spots} founding spots, because our team onboards each one personally.</p>
              <SpotsText className="tk-reveal w-fit rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-teal-900" />
            </div>
            <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr] lg:items-start lg:gap-6">
              <div className="tk-reveal">
                <FoundingStack applyHref="#apply" />
              </div>
              <div className="tk-reveal grid content-start gap-4">
                <FoundingGuarantee />
                <div className="grid gap-2 rounded-2xl bg-white p-5 ring-1 ring-line sm:p-6">
                  <p className="font-display text-xl font-bold text-teal-900">Why each bonus is there</p>
                  <ul className="grid gap-2 leading-relaxed text-ink">
                    <li>
                      <strong className="text-teal-900">Not sure you have a problem?</strong> The Rep Leak Audit shows you the visits your reps miss.
                    </li>
                    <li>
                      <strong className="text-teal-900">Not sure how to set up call cycles?</strong> Start from the templates of the team we built{" "}
                      {site.name} with.
                    </li>
                    <li>
                      <strong className="text-teal-900">What if you get stuck?</strong> WhatsApp our team directly for your first 60 days.
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 8. The pilot form, and the doubts answered just under it. */}
        <section id="apply" className="scroll-mt-28 px-4 pb-4 sm:px-6">
          <div className="tk-reveal mx-auto grid max-w-3xl gap-6 rounded-2xl bg-teal-900 p-6 text-sand sm:p-10">
            <div className="grid gap-2">
              <h2 className="font-display text-3xl font-extrabold leading-[1.1] tracking-tight text-balance sm:text-5xl">
                Start your free {founding.pilotDays}-day pilot.
              </h2>
              <p className="leading-relaxed text-teal-100 sm:text-lg">
                It takes a minute. We WhatsApp you within {founding.replyMinutes} minutes during work hours.
              </p>
              <SpotsText className="text-sm font-semibold text-amber-500" />
            </div>
            <FoundingForm />
          </div>
        </section>

        <section id="faq" className="scroll-mt-28">
          <div className={`${wrap} max-w-3xl`}>
            <Objections more={faqs} />
          </div>
        </section>

        {/* 9. The normal prices, after the Founding 10. */}
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

        {/* 10. The offer again, in plain words. */}
        <section id="start" className="px-4 pb-14 pt-10 sm:px-6 sm:pb-16 sm:pt-16">
          <div className="tk-reveal mx-auto grid max-w-6xl gap-5 rounded-2xl bg-teal-900 p-6 text-sand sm:gap-6 sm:p-10">
            <h2 className="font-display text-3xl font-extrabold leading-[1.1] tracking-tight text-balance sm:text-5xl">
              See every store visit, and every order.
            </h2>
            <p className="max-w-2xl leading-relaxed text-pretty text-teal-100 sm:text-lg">
              We load your stores, products and reps, and train your team. Your pilot is free for {founding.pilotDays} days, then it&apos;s{" "}
              {rand(founding.price)} a month for {founding.priceMonths} months. You don&apos;t need a card.
            </p>
            <FoundingStart />
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
