import {
  Check,
  ChevronDown,
  ClipboardCheck,
  CloudOff,
  FileText,
  LayoutDashboard,
  MapPin,
  MapPinned,
  Navigation,
  Receipt,
  Route,
  Smartphone,
  Wallet,
} from "lucide-react";
import Image from "next/image";
import { CostCalculator } from "@/components/cost-calculator";
import { ProductDemo } from "@/components/demo/product-demo";
import { Logo } from "@/components/logo";
import { TradeTabs } from "@/components/trade-tabs";
import { StartTrial } from "@/components/start-trial";
import { PricingSection } from "@/components/pricing-section";
import { confirmed, pricing, rand, site, weeklyCeiling } from "@/lib/site";

// Copy: ~/Downloads/site-copy-final-v7.md, reworked on 8 Oct 2026 with the
// Hormozi offer skills (audit in the site-offer worktree's OFFER-AUDIT.md),
// then rewritten on 9 Oct 2026 to read the way you'd say it to an owner:
// say what Tickd does in the hero, one idea per sentence, no bold title that
// only repeats its sentence, no puns, body text in ink (grey is for small
// print), and as few words as will do. Still no dashes, and only live features.
// Lines v7 marks [CONFIRM] sit behind `confirmed` in lib/site.ts.
// Mobile first: every style below is the phone's; sm:/md:/lg: only add room.
// Light only, on purpose: owners read this on a phone outdoors, between jobs,
// and the brand is built on the sand ground.

const nav = [
  { href: "#how", label: "How it works" },
  { href: "#trades", label: "Your trade" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

// The three things that make it easy to say yes, straight under the hero.
// Each item answers the strip's question, "What do you need to start?"
const easy = [
  { icon: Smartphone, title: "Just their own phones", body: "Tickd runs on the Android phones your team already has." },
  { icon: CloudOff, title: "No signal needed on site", body: "The app works without signal, and sends everything once they have signal again." },
  { icon: ClipboardCheck, title: "No checklists to write", body: "Pick your type of work, and they're already there." },
];

// The calls that eat an owner's day, in the words people actually say,
// and what the owner does instead with Tickd.
const day = [
  ["“Is your team on the way?”", "Open the map and tell them."],
  ["“Can you prove the job was done?”", "Send them the job report, with photos."],
  ["“Nobody came on Friday.”", "Show them who was there, and when."],
  ["“I worked two hours overtime.”", "Check the timesheet. The hours are already there."],
  ["“Where has the bakkie been all day?”", "See the driver's route and how far they went."],
  ["“When will I get the invoice?”", "Tick the finished jobs, and the invoice is made."],
];

// Who does what: the team works on their phones, the owner runs it from anywhere.
const teamSteps = [
  ["Clock in.", "One tap starts their day and shows today's jobs."],
  ["Do the job.", "They check in, take photos and tick the checklist."],
  ["Finish.", "Your client gets a signed report."],
  ["Clock out.", "Their hours go straight onto the timesheet."],
];
const ownerSteps = [
  ["Set it up.", "We help you add your team and your clients."],
  ["Plan the day.", "Give each person their jobs."],
  ["Watch it happen.", "See everyone on a map, and photos as they come in."],
  ["Get paid.", "Send quotes and invoices, and see who still owes you."],
];

// What the one app takes the place of: the value is the mess it removes.
const replaces = [
  "WhatsApp groups for updates and photos",
  "Paper job cards and checklists",
  "The timesheet book",
  "A paper logbook for kilometres",
  "A separate app for quotes and invoices",
];

// Where the day went. Live on main: the workday trail and its kilometres
// along the roads (settled after the day), off-site check-ins with the
// distance, the live map and each person's day (/tracking).
const whereItWent = [
  { icon: Navigation, text: "A live map of where everyone is." },
  { icon: MapPinned, text: "Each person's day on a map, stop by stop." },
  { icon: Route, text: "How far each person drove, for your petrol claims." },
  { icon: MapPin, text: "A warning when someone checks in away from the job." },
];

// The money side, for every trade once PR #93 (Stage 7 Part 1a) is merged:
// quotes from a price list or typed lines, invoices from a quote (whole,
// deposit, final), from finished jobs or typed in, payments and who owes you.
// Not yet: emailing documents or pay-now links, so the copy says "download".
const money = [
  { icon: FileText, text: "Make a quote from your price list, and download it to send." },
  { icon: Receipt, text: "Invoice the whole job, a deposit, or everything you finished this month." },
  { icon: Wallet, text: "See who has paid, and who is 30, 60 or 90 days late." },
];

const team = [
  ["No more “he said, she said”.", "The photos and times speak for them."],
  ["Overtime is on record.", "There's nothing to argue about on payday."],
  ["Less reporting back.", "No more voice notes or calls at the end of the day."],
  ["Their evenings are their own.", "Tickd only works during work hours."],
];

const faqs = [
  {
    q: "What does it cost?",
    a: `From ${rand(pricing.monthly.base)} a month for ${pricing.includedUsers} users, with everything included. Pay yearly and you get 2 months free.`,
  },
  {
    q: "How fast can we start?",
    a: "Today. Sign up, and your team can put the app on their phones and clock in.",
  },
  {
    q: `What happens after ${site.trialDays} days?`,
    a: "If you want to keep going, you choose a plan. We don't take your card for the trial, so you're never charged by surprise.",
  },
  { q: "Do they need new phones?", a: "No. Tickd runs on the Android phones your team already has." },
  {
    q: "What if there's no signal, or load-shedding?",
    a: "It keeps working, and catches up when the signal comes back.",
  },
  {
    q: "Can clients trust the photos?",
    a: "Yes. They can only be taken inside the app, and each one shows the time and place.",
  },
  {
    q: "Can someone check in from home?",
    a: "Tickd flags it. Every check-in records how far the person was from the job, so one made from home stands out.",
  },
  {
    q: "Will my team mind?",
    a: "It only works during work hours, and it proves the good work they do. That protects them too.",
  },
  ...(confirmed.legalFaq
    ? [{ q: "Is it legal?", a: "Yes, when you tell your team how it works. We cover that on the training day." }]
    : []),
  { q: "Who is it not for?", a: "One-person businesses that only need to send quotes and invoices." },
];

// One spacing rhythm for every section: 80px between sections on a phone, 128px
// from sm up, and 24px (32px) between a heading block and what follows it.
const wrap = "mx-auto grid gap-6 px-4 py-10 sm:gap-8 sm:px-6 sm:py-16";
const h2 = "tk-reveal font-display text-3xl font-bold leading-[1.1] tracking-tight text-balance text-teal-900 sm:text-[2.75rem]";
const lead = "max-w-2xl text-lg leading-relaxed text-pretty text-ink";

/**
 * Everything the app does for the owner, in the hero's checklist: each tick
 * names the problem it ends (unpaid disputes, padded hours, lost renewals,
 * unbilled work, being needed on every site), not only the feature.
 */
const OWNER_GETS = [
  "You know who came to work, and what time they started and finished.",
  "You can see where your staff are right now, and how far they've driven.",
  "Every task gets ticked off with photos, so you know it was really done.",
  "Your client gets a signed report after every task, so there's no arguing.",
  "You never forget to invoice for work that's been done.",
  "You get paid faster, and you can see who still owes you money.",
  "You get a message when something goes wrong, like a task that was missed.",
  "You get a performance report for each employee.",
];

function TrialButton({ className = "" }: { className?: string }) {
  return (
    <a
      href={site.signupUrl}
      className={`flex w-full items-center justify-center rounded-full bg-amber-500 px-6 py-4 text-lg font-semibold text-teal-950 transition-[background-color,transform] duration-150 ease-out hover:bg-amber-400 active:scale-[0.97] sm:inline-flex sm:w-auto sm:py-3.5 sm:text-base ${className}`}
    >
      Get {site.name} free for {site.trialDays} days
    </a>
  );
}

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
function Shot({ src, alt, width, height }: { src: string; alt: string; width: number; height: number }) {
  return (
    <figure className="tk-reveal grid gap-2">
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        unoptimized
        sizes="(min-width: 1024px) 560px, 100vw"
        className="h-auto w-full rounded-2xl bg-white ring-1 ring-line"
      />
      <figcaption className="text-sm text-muted">Real screen from the {site.name} dashboard, with example data.</figcaption>
    </figure>
  );
}

export default function Home() {
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line/70 bg-mint/90 backdrop-blur">
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
              href={site.signupUrl}
              className="rounded-full bg-teal-900 px-4 py-2 text-sm font-semibold text-sand transition-[background-color,transform] duration-150 ease-out hover:bg-teal-800 active:scale-[0.97]"
            >
              Free trial
            </a>
          </div>
        </div>
      </header>

      <main id="top">
        {/* 1. Hero: the outcome, the risk taken away, and the real app. */}
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-10 pt-8 sm:px-6 sm:pb-16 sm:pt-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14 lg:pt-16">
          <div className="tk-hero grid gap-5 sm:gap-6">
            <p className="max-w-md text-sm font-semibold leading-snug text-teal-700 sm:text-base">
              For cleaning, security, electrical, garden, pest, pool, maintenance and sales teams
            </p>
            <h1 className="font-display text-[2.6rem] font-extrabold leading-[1.02] tracking-tight text-balance text-teal-900 sm:text-6xl lg:text-[4.25rem]">
              Know every task got{" "}
              <span className="relative whitespace-nowrap">
                done
                <span aria-hidden="true" className="tk-underline absolute inset-x-0 bottom-[-0.02em] h-[0.12em] rounded-full bg-amber-500" />
              </span>,{" "}
              <span className="mt-3 block text-[0.6em] leading-[1.1] text-teal-700">without phoning around.</span>
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-pretty text-ink sm:text-xl">
              {site.name} is an app for business owners whose staff work on site. They use it on their phones, and you see
              everything on yours. With {site.name}:
            </p>
            <ul className="grid max-w-xl gap-y-2.5" aria-label={`What ${site.name} does for you`}>
              {OWNER_GETS.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-base leading-snug text-ink">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-teal-700 text-white"
                  >
                    <Check className="tk-draw size-3.5" strokeWidth={3.5} />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
            <div className="grid max-w-xl gap-3 rounded-2xl bg-white p-5 ring-1 ring-teal-900/10 sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <p className="font-display text-2xl font-bold leading-tight text-teal-900">
                  {rand(weeklyCeiling())}
                  <span className="text-base font-semibold text-muted"> a week</span>
                </p>
                <p className="text-sm text-muted">
                  Team of {pricing.includedUsers} users. {site.trialDays} days free, no card needed.
                </p>
              </div>
              <TrialButton />
            </div>
          </div>
          <figure className="tk-hero-demo grid gap-3">
            <ProductDemo />
            <figcaption className="text-center text-sm text-muted">
              Real screens from the {site.name} app, with example data.
            </figcaption>
          </figure>
        </section>

        {/* 2. Easy to say yes: the effort it doesn't take. */}
        <section aria-labelledby="start-title" className="border-y border-line bg-white">
          <div className={`${wrap} max-w-6xl`}>
            <h2 id="start-title" className="tk-reveal font-display text-2xl font-bold leading-tight text-teal-900 sm:text-3xl">
              What do you need to start?
            </h2>
            <ul className="grid gap-5 md:grid-cols-3 md:gap-0 md:divide-x md:divide-line">
              {easy.map(({ icon: Icon, title, body }) => (
                <li key={title} className="tk-reveal tk-timeline flex gap-3.5 md:px-8 md:first:pl-0 md:last:pr-0">
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

        {/* 3. The calls that eat the owner's day, and the answer with Tickd. */}
        <section aria-labelledby="day-title">
          <div className={`${wrap} max-w-6xl`}>
            <div className="grid gap-3">
              <h2 id="day-title" className={h2}>Sound familiar?</h2>
              <p className={lead}>These are the calls that eat up your day. With {site.name}, each one takes a few seconds.</p>
            </div>
            <ul className="grid gap-3 md:grid-cols-2 md:gap-4">
              {day.map(([heard, answer]) => (
                <li key={heard} className="tk-reveal tk-timeline grid gap-2 rounded-2xl bg-white p-5 ring-1 ring-line">
                  <p className="font-display text-xl font-bold leading-snug text-teal-900">{heard}</p>
                  <p className="tk-reveal-late flex gap-2 text-lg leading-snug text-ink">
                    <Check className="tk-draw mt-1 size-5 shrink-0 text-teal-700" strokeWidth={3} aria-hidden="true" />
                    <span>
                      <span className="sr-only">With {site.name}: </span>
                      {answer}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
            <p className="font-display text-xl font-bold leading-snug text-balance text-teal-900 sm:text-2xl">
              You didn&apos;t start a business to spend your day chasing people for updates.
            </p>
          </div>
        </section>

        {/* 4. How it works */}
        <section id="how" className="border-t border-line bg-white">
          <div className={`${wrap} max-w-6xl`}>
            <div className="grid gap-3">
              <h2 className={h2}>How {site.name} works</h2>
              <p className={lead}>
                Your team uses the app on their phones. You follow along on your computer, or on your own phone.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 md:gap-6">
              <Lane
                icon={Smartphone}
                who="Your team"
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
                  {site.name} replaces all of these. If you need HR or deliveries later, you can add them.
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

        {/* 5. Where the day went: locations and kilometres. */}
        <section id="tracking" className="border-t border-line">
          <div className={`${wrap} max-w-6xl lg:grid-cols-[1fr_1.05fr] lg:items-center lg:gap-14`}>
            <div className="grid content-start gap-6 sm:gap-8">
              <div className="grid gap-3">
                <h2 className={h2}>See where your team went.</h2>
                <p className={lead}>While they&apos;re clocked in, the app keeps track of where they go. It stops when they clock out.</p>
              </div>
              <Points items={whereItWent} badge="bg-teal-900 text-amber-500" />
            </div>
            <Shot
              src="/demo/dash/site-day-history.webp"
              alt="One person's day: 38 km driven, 4 check-ins, 8 hours 22 minutes, and the route on a map."
              width={2036}
              height={1418}
            />
          </div>
        </section>

        {/* 6. The money: quote, invoice, get paid. */}
        <section id="money" className="border-t border-line bg-white">
          <div className={`${wrap} max-w-6xl lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-14`}>
            <div className="order-2 lg:order-1">
              <Shot
                src="/demo/dash/site-invoices.webp"
                alt="The invoices list: issued, outstanding and overdue totals, and each invoice marked paid, part paid or overdue."
                width={2036}
                height={1069}
              />
            </div>
            <div className="order-1 grid content-start gap-6 sm:gap-8 lg:order-2">
              <div className="grid gap-3">
                <h2 className={h2}>Send quotes and invoices from the same app.</h2>
                <p className={lead}>No more typing invoices from paper job cards.</p>
              </div>
              <Points items={money} badge="bg-amber-500 text-teal-950" />
              <p className="text-sm font-medium text-muted">VAT is up to you, and your bank details go on every invoice.</p>
            </div>
          </div>
        </section>

        {/* 7. Your trade */}
        <section id="trades" className="border-t border-line">
          <div className={`${wrap} max-w-6xl`}>
            <div className="grid gap-3">
              <h2 className={h2}>What you can show your clients</h2>
              <p className={lead}>Tap your type of work.</p>
            </div>
            <div className="tk-reveal">
              <TradeTabs />
            </div>
          </div>
        </section>

        {/* 8. Good for your team too */}
        <section id="team" className="border-t border-line bg-white">
          <div className={`${wrap} max-w-6xl md:grid-cols-[0.8fr_1.2fr] md:gap-12`}>
            <div className="grid content-start gap-3">
              <h2 className={h2}>Your team will like it too.</h2>
              <p className={lead}>It proves the good work they already do.</p>
            </div>
            <ul className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
              {team.map(([title, body]) => (
                <li key={title} className="tk-reveal relative grid gap-1.5 pt-4">
                  <span aria-hidden="true" className="tk-rule absolute inset-x-0 top-0 h-0.5 bg-amber-500" />
                  <span className="font-display text-lg font-bold text-teal-900">{title}</span>
                  <span className="leading-relaxed text-ink">{body}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 9. What lost time costs, next to what Tickd costs: the value, just before the price. */}
        <section className="border-t border-line">
          <div className={`${wrap} max-w-6xl`}>
            <div className="grid gap-3">
              <h2 className={h2}>What is lost time costing you?</h2>
              <p className={lead}>
                Most lost time on site is late starts, long breaks and detours. Put in your numbers to see what it costs you.
              </p>
            </div>
            <div className="tk-reveal">
              <CostCalculator />
            </div>
          </div>
        </section>

        {/* 10. Pricing */}
        <section id="pricing" className="border-t border-line bg-white">
          <div className={`${wrap} max-w-6xl`}>
            <h2 className={h2}>One simple price, with everything included.</h2>
            <div className="tk-reveal">
              <PricingSection />
            </div>
          </div>
        </section>

        {/* 11. Questions */}
        <section id="faq" className="border-t border-line">
          <div className={`${wrap} max-w-3xl`}>
            <h2 className={h2}>Questions</h2>
            <div className="divide-y divide-line border-y border-line">
              {faqs.map((f) => (
                <details key={f.q} className="group">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 font-display text-lg font-bold text-teal-900 [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <ChevronDown
                      className="size-5 shrink-0 text-teal-700 transition-transform duration-200 ease-out group-open:rotate-180 motion-reduce:transition-none"
                      aria-hidden="true"
                    />
                  </summary>
                  <p className="tk-answer max-w-2xl pb-5 leading-relaxed text-ink">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* 12. Sign up: the offer again, in plain words. */}
        <section id="start" className="px-4 pb-14 pt-10 sm:px-6 sm:pb-16 sm:pt-16">
          <div className="tk-reveal mx-auto grid max-w-6xl gap-5 rounded-2xl bg-teal-900 p-6 text-sand sm:gap-6 sm:p-10">
            <h2 className="font-display text-3xl font-extrabold leading-[1.1] tracking-tight text-balance sm:text-5xl">
              Try {site.name} free for {site.trialDays} days.
            </h2>
            <p className="max-w-2xl leading-relaxed text-pretty text-teal-100 sm:text-lg">
              See your team&apos;s whole day, and show clients proof of every job. You don&apos;t need a card.
            </p>
            <StartTrial />
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
