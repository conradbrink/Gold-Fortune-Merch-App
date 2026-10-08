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
import { confirmed, pricing, rand, site } from "@/lib/site";

// Copy: ~/Downloads/site-copy-final-v7.md, reworked on 8 Oct 2026 with the
// Hormozi offer skills (audit in the site-offer worktree's OFFER-AUDIT.md):
// the outcome leads, the owner's day is shown before and after, and the pun
// closes the page. Still plain words, no dashes, and only live features.
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
const easy = [
  { icon: Smartphone, title: "The phones they already have", body: "Tickd runs on Android, so there's nothing new to buy." },
  { icon: CloudOff, title: "Works with no signal", body: "Everything syncs when the phone is back online." },
  { icon: ClipboardCheck, title: "Ready on day one", body: "Pick your trade, and its checklists come set up." },
];

// The owner's day: what happens now, and what happens with Tickd.
const day = [
  ["07:40", "A client asks if your team is on the way. You phone around.", "You check the live map and tell them."],
  ["10:15", "A client wants proof the job was done. You dig through old chats.", "You send the signed report, photos and all."],
  ["15:10", "The bakkie has been out all day. You don't know where.", "You see each person's route and the kilometres they drove."],
  ["Friday", "A client says a visit was missed. Nobody can show it wasn't.", "The check-ins show who was there, and when."],
  ["Payday", "Someone says they worked late. Nobody wrote it down.", "Their hours are already on the timesheet."],
  ["Month end", "You type invoices from paper job cards.", "You tick the finished jobs, and the invoice is made."],
];

// Who does what: the team works on their phones, the owner runs it from anywhere.
const teamSteps = [
  ["Start the day.", "One tap on their phone starts the workday, and today's jobs are right there, in order."],
  ["Do the job.", "They check in when they arrive on site, take photos with the app's camera and fill in the checklist for the job."],
  ["Finish the job.", "When the work is done, your client gets a signed report for the job."],
  ["End the day.", "One more tap ends the day, and their hours go straight onto the timesheet for payroll."],
];
const ownerSteps = [
  ["Set it up.", "We help you add your team, your clients and their sites, so you're ready from day one."],
  ["Plan the work.", "Give each person their jobs for the day, and change the plan when something comes up."],
  ["See the day.", "A live map shows where everyone is, with photos coming in and alerts when something's off."],
  ["Get paid.", "Send quotes and invoices from the same app, and see at a glance who still owes you."],
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
  { icon: Route, title: "Kilometres, per person, per day", body: "Worked out along the roads from the day's trail. No more guessing where the petrol went." },
  { icon: MapPin, title: "Check-ins pinned to the site", body: "Check in away from the site and it's flagged, with how far away they were." },
  { icon: Navigation, title: "A live map of your team", body: "See where everyone was last seen, and how long ago." },
  { icon: MapPinned, title: "Each person's day, stop by stop", body: "Their route on a map, in the order they went, with their hours for the day." },
];

// The money side, for every trade once PR #93 (Stage 7 Part 1a) is merged:
// quotes from a price list or typed lines, invoices from a quote (whole,
// deposit, final), from finished jobs or typed in, payments and who owes you.
// Not yet: emailing documents or pay-now links, so the copy says "download".
const money = [
  { icon: FileText, title: "Quotes from your price list", body: "Use your prices or type the lines. Download the PDF and send it to your client." },
  { icon: Receipt, title: "Invoice the way you work", body: "Bill the whole quote, take a deposit first, or tick the jobs you finished this month." },
  { icon: Wallet, title: "Know who owes you", body: "Record payments as they come in. See who is 30, 60 or 90 days late, and print their statement." },
];

const team = [
  ["No more “he said, she said”.", "Photos and times speak up for your team, so good work gets the credit it deserves."],
  ["Hours logged accurately.", "Every hour they work lands on the timesheet, so nobody has to argue about overtime."],
  ["Less admin.", "No more voice notes, paper forms and end of day phone calls to report back."],
  ["Work time only.", "Tickd only runs from the start to the end of the workday, and never after hours."],
];

const faqs = [
  {
    q: "What does it cost?",
    a: `From ${rand(pricing.monthly.base)} a month for ${pricing.includedUsers} users, with everything included. Pay yearly and you get 2 months free.`,
  },
  {
    q: "How fast can we start?",
    a: "Today. Pick your trade when you sign up, and its checklists and settings are ready. Your team puts the app on their phones and taps start.",
  },
  {
    q: `What happens after ${site.trialDays} days?`,
    a: "Choose a plan to keep going. We never asked for your card, so nothing is charged unless you do.",
  },
  { q: "Do they need new phones?", a: "No. Tickd runs on the Android phones your team already has." },
  {
    q: "No signal or load-shedding?",
    a: "Tickd keeps working with no signal, and everything syncs as soon as the phone is back online.",
  },
  {
    q: "Can clients trust the photos?",
    a: "Yes. Photos can only be taken with the camera in the app, and each one carries the time and place.",
  },
  {
    q: "Can someone check in from home?",
    a: "No. If someone checks in away from the site, it gets flagged so you can see it straight away.",
  },
  {
    q: "Will my team get ticked off?",
    a: "No. It only runs during work hours, and it gives them proof of the good work they do.",
  },
  ...(confirmed.legalFaq
    ? [{ q: "Is it legal?", a: "Yes, when you tell your team how it works. Our welcome message does that." }]
    : []),
  { q: "Who is it not for?", a: "One-person businesses that only need to send quotes and invoices." },
];

const wrap = "mx-auto grid gap-6 px-4 py-16 sm:gap-8 sm:px-6 sm:py-24";
const h2 = "tk-reveal font-display text-3xl font-bold leading-[1.1] tracking-tight text-balance text-teal-900 sm:text-[2.75rem]";
const lead = "max-w-2xl text-lg leading-relaxed text-pretty text-muted";

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
              <p className="leading-relaxed text-muted">{body}</p>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Points({ items }: { items: { icon: typeof Smartphone; title: string; body: string }[] }) {
  return (
    <ul className="grid gap-5 sm:grid-cols-2 sm:gap-x-8 sm:gap-y-6 lg:grid-cols-1">
      {items.map(({ icon: Icon, title, body }) => (
        <li key={title} className="tk-reveal flex gap-3.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-teal-900 text-amber-500">
            <Icon className="size-5" strokeWidth={2.25} aria-hidden="true" />
          </span>
          <span className="grid gap-0.5">
            <span className="font-display text-lg font-bold leading-snug text-teal-900">{title}</span>
            <span className="leading-relaxed text-muted">{body}</span>
          </span>
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
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-14 pt-8 sm:px-6 sm:pb-20 sm:pt-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14 lg:pt-16">
          <div className="tk-hero grid gap-5 sm:gap-6">
            <p className="max-w-md text-sm font-semibold leading-snug text-teal-700 sm:text-base">
              For cleaning, security, electrical, garden, pest, pool, maintenance and sales teams
            </p>
            <h1 className="font-display text-[2.6rem] font-extrabold leading-[1.02] tracking-tight text-balance text-teal-900 sm:text-6xl lg:text-[4.25rem]">
              See every job{" "}
              <span className="relative whitespace-nowrap">
                done
                <span aria-hidden="true" className="tk-underline absolute inset-x-0 bottom-[-0.02em] h-[0.12em] rounded-full bg-amber-500" />
              </span>.{" "}
              <span className="mt-3 block text-[0.6em] leading-[1.1] text-teal-700">Without phoning around.</span>
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-pretty text-ink sm:text-xl">
              Your team&apos;s check-ins, photos and kilometres, live. Then quote, invoice and get paid from the same app.
            </p>
            <div className="grid gap-2.5 sm:justify-items-start">
              <TrialButton />
              <p className="text-center text-sm font-medium text-muted sm:text-left">
                No card needed. Then from {rand(pricing.monthly.base)} a month.
              </p>
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
        <section aria-label="Why it's easy to start" className="border-y border-line bg-white">
          <ul className="mx-auto grid max-w-6xl gap-5 px-4 py-8 sm:px-6 md:grid-cols-3 md:gap-0 md:divide-x md:divide-line md:py-10">
            {easy.map(({ icon: Icon, title, body }) => (
              <li key={title} className="tk-reveal flex gap-3.5 md:px-8 md:first:pl-0 md:last:pr-0">
                <Icon className="mt-0.5 size-6 shrink-0 text-teal-700" strokeWidth={2} />
                <span className="grid gap-0.5">
                  <span className="font-display text-lg font-bold text-teal-900">{title}</span>
                  <span className="leading-relaxed text-muted">{body}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* 3. The owner's day, before and after. */}
        <section aria-labelledby="day-title">
          <div className={`${wrap} max-w-6xl`}>
            <h2 id="day-title" className={h2}>Sound familiar?</h2>
            <div>
              <div aria-hidden="true" className="hidden grid-cols-[4.5rem_1fr_1fr] gap-6 pb-3 text-sm font-semibold text-muted md:grid">
                <span />
                <span>Your day now</span>
                <span className="text-teal-700">Your day with {site.name}</span>
              </div>
              <ol className="divide-y divide-line border-t border-line">
                {day.map(([t, now, fix]) => (
                  <li key={t} className="tk-reveal grid grid-cols-[3.75rem_1fr] gap-x-3 gap-y-2 py-4 md:grid-cols-[4.5rem_1fr_1fr] md:gap-x-6 md:py-5">
                    <span className="row-span-2 pt-0.5 text-sm font-semibold tabular-nums text-flag md:row-span-1">{t}</span>
                    <p className="leading-relaxed text-ink sm:text-lg">{now}</p>
                    <p className="tk-reveal-late flex gap-2 font-semibold leading-relaxed text-teal-900 sm:text-lg">
                      <Check className="mt-1 size-4 shrink-0 text-teal-700 sm:size-5" strokeWidth={3} aria-hidden="true" />
                      <span>
                        <span className="sr-only">With {site.name}: </span>
                        {fix}
                      </span>
                    </p>
                  </li>
                ))}
              </ol>
            </div>
            <p className="font-display text-xl font-bold leading-snug text-balance text-teal-900 sm:text-2xl">
              You didn&apos;t start a business to spend your day chasing people for updates.
            </p>
          </div>
        </section>

        {/* 4. What lost time costs, next to what Tickd costs. */}
        <section className="border-t border-line bg-white">
          <div className={`${wrap} max-w-6xl`}>
            <div className="grid gap-3">
              <h2 className={h2}>What is lost time costing you?</h2>
              <p className={lead}>Put in your team, the time you think goes to waiting and admin each day, and what you pay an hour.</p>
            </div>
            <div className="tk-reveal">
              <CostCalculator />
            </div>
          </div>
        </section>

        {/* 5. How it works */}
        <section id="how" className="border-t border-line">
          <div className={`${wrap} max-w-6xl`}>
            <div className="grid gap-3">
              <h2 className={h2}>Simple for your team. Clear for you.</h2>
              <p className={lead}>
                Your team does the work on their phones, and you see everything as it happens, wherever you are.
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
                className="bg-white ring-teal-100"
                badge="bg-teal-900 text-sand"
              />
            </div>
            <div className="tk-reveal grid gap-6 rounded-2xl bg-teal-950 p-6 text-sand sm:p-8 md:grid-cols-[0.8fr_1.2fr] md:items-center md:gap-10">
              <div className="grid gap-2">
                <p className="font-display text-2xl font-bold leading-tight text-amber-500 sm:text-3xl">One app instead of five.</p>
                <p className="leading-relaxed text-teal-100">
                  Plan, prove, sell, invoice and get paid in one place. HR and deliveries are there as add-ons when you need them.
                </p>
              </div>
              <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
                {replaces.map((r) => (
                  <li key={r} className="tk-reveal-late flex items-start gap-3 border-t border-white/15 pt-3 font-medium leading-snug">
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-amber-500 text-teal-950">
                      <Check className="size-3" strokeWidth={3.5} aria-hidden="true" />
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

        {/* 6. Where the day went: locations and kilometres. */}
        <section id="tracking" className="border-t border-line bg-white">
          <div className={`${wrap} max-w-6xl lg:grid-cols-[1fr_1.05fr] lg:items-center lg:gap-14`}>
            <div className="grid content-start gap-6">
              <div className="grid gap-3">
                <h2 className={h2}>Every stop. Every kilometre.</h2>
                <p className={lead}>
                  From the start to the end of the workday, their phone keeps a trail. You see where your team went, how long they
                  stayed and how far they drove.
                </p>
              </div>
              <Points items={whereItWent} />
              <p className="text-sm font-medium text-muted">Only during work hours. Never after they end the day.</p>
            </div>
            <Shot
              src="/demo/dash/site-day-history.webp"
              alt="One person's day: 38 km driven, 4 check-ins, 8 hours 22 minutes, and the route on a map."
              width={2036}
              height={1418}
            />
          </div>
        </section>

        {/* 7. The money: quote, invoice, get paid. */}
        <section id="money" className="border-t border-line">
          <div className={`${wrap} max-w-6xl lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-14`}>
            <div className="order-2 lg:order-1">
              <Shot
                src="/demo/dash/site-invoices.webp"
                alt="The invoices list: issued, outstanding and overdue totals, and each invoice marked paid, part paid or overdue."
                width={2036}
                height={1069}
              />
            </div>
            <div className="order-1 grid content-start gap-6 lg:order-2">
              <div className="grid gap-3">
                <h2 className={h2}>Quote, invoice and get paid.</h2>
                <p className={lead}>No second app, and no typing invoices from paper job cards. The work and the money live in one place.</p>
              </div>
              <ul className="grid gap-5">
                {money.map(({ icon: Icon, title, body }) => (
                  <li key={title} className="tk-reveal flex gap-3.5">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-500 text-teal-950">
                      <Icon className="size-5" strokeWidth={2.25} aria-hidden="true" />
                    </span>
                    <span className="grid gap-0.5">
                      <span className="font-display text-lg font-bold leading-snug text-teal-900">{title}</span>
                      <span className="leading-relaxed text-muted">{body}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-sm font-medium text-muted">Add VAT or leave it off. Your bank details go on every invoice.</p>
            </div>
          </div>
        </section>

        {/* 8. Your trade */}
        <section id="trades" className="border-t border-line bg-white">
          <div className={`${wrap} max-w-6xl`}>
            <h2 className={h2}>What do your clients want to see?</h2>
            <div className="tk-reveal">
              <TradeTabs />
            </div>
          </div>
        </section>

        {/* 9. Good for your team too */}
        <section id="team" className="border-t border-line">
          <div className={`${wrap} max-w-6xl md:grid-cols-[0.8fr_1.2fr] md:gap-12`}>
            <div className="grid content-start gap-3">
              <h2 className={h2}>Your team will like it too.</h2>
              <p className={lead}>It backs up the good work they already do.</p>
            </div>
            <ul className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
              {team.map(([title, body]) => (
                <li key={title} className="tk-reveal relative grid gap-1.5 pt-4">
                  <span aria-hidden="true" className="tk-rule absolute inset-x-0 top-0 h-0.5 bg-amber-500" />
                  <span className="font-display text-lg font-bold text-teal-900">{title}</span>
                  <span className="leading-relaxed text-muted">{body}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 10. Pricing */}
        <section id="pricing" className="border-t border-line bg-white">
          <div className={`${wrap} max-w-6xl`}>
            <h2 className={h2}>One price. Every box {site.name}.</h2>
            <div className="tk-reveal">
              <PricingSection />
            </div>
          </div>
        </section>

        {/* 11. Questions */}
        <section id="faq" className="border-t border-line">
          <div className="mx-auto grid max-w-3xl gap-6 px-4 py-16 sm:px-6 sm:py-24">
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
                  <p className="tk-answer max-w-2xl pb-5 leading-relaxed text-muted">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* 12. Sign up: the pun lands once the reader knows the product. */}
        <section id="start" className="px-4 pb-14 sm:px-6 sm:pb-16">
          <div className="tk-reveal mx-auto grid max-w-6xl gap-5 rounded-2xl bg-teal-900 p-6 text-sand sm:gap-6 sm:p-10">
            <h2 className="font-display text-3xl font-extrabold leading-[1.1] tracking-tight text-balance sm:text-5xl">
              Every job {site.name} off. <span className="text-amber-500">Except you.</span>
            </h2>
            <p className="max-w-2xl text-lg leading-relaxed text-pretty text-teal-100">
              See your team&apos;s whole day, show your clients the proof, and find out what it saves you. It costs nothing to try.
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
