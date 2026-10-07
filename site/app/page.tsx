import { CalendarCheck, Camera, Check, LayoutDashboard, Receipt, ShoppingCart, Smartphone, Truck, Users, Wallet } from "lucide-react";
import { CostCalculator } from "@/components/cost-calculator";
import { ProductDemo } from "@/components/demo/product-demo";
import { Logo } from "@/components/logo";
import { TradeTabs } from "@/components/trade-tabs";
import { TrialForm } from "@/components/trial-form";
import { PricingSection } from "@/components/pricing-section";
import { confirmed, site } from "@/lib/site";

// Copy: ~/Downloads/site-copy-final-v7.md, 9 sections, then loosened into
// fuller sentences at Conrad's request (still plain words, no dashes). Lines
// v7 marks [CONFIRM] sit behind `confirmed` in lib/site.ts.
// Mobile first: every style below is the phone's; sm:/md:/lg: only add room.

const nav = [
  { href: "#how", label: "How it works" },
  { href: "#trades", label: "Your trade" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

const day = [
  ["07:40", "A client phones to ask if your team is on the way, and you spend the next half hour calling around to find out."],
  ["10:15", "A client wants proof that the job was done properly, so you scroll back through old chats looking for a photo."],
  ["13:00", "You plan tomorrow's jobs from memory, scribbled notes and a pile of voice notes."],
  ["15:10", "The bakkie is on the other side of town, and there's no job booked anywhere near it."],
  ["16:00", "You still don't know which of today's jobs are done, and which ones will spill into tomorrow."],
  ["Friday", "A client says your team missed a visit, and nobody can show them that it didn't happen."],
  ["Payday", "Someone says they worked late on Tuesday, but nobody wrote it down, so it's their word against yours."],
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

// "All in one app: Plan · Prove · Sell · Invoice · Get paid · Deliver (add-on) · HR (add-on)"
const allInOne = [
  { label: "Plan", icon: CalendarCheck },
  { label: "Prove", icon: Camera },
  { label: "Sell", icon: ShoppingCart },
  { label: "Invoice", icon: Receipt },
  { label: "Get paid", icon: Wallet },
];
const addOns = [
  { label: "Deliver", icon: Truck },
  { label: "HR", icon: Users },
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
    a: "From R1,499 a month for 3 users, with everything included. Pay yearly and you get 2 months free.",
  },
  { q: "Do they need new phones?", a: "No. Tickd runs on the cheap Android phones your team already has." },
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

const wrap = "mx-auto grid gap-5 px-4 py-14 sm:gap-6 sm:px-6 sm:py-20";
const eyebrow = "text-xs font-semibold uppercase tracking-widest text-muted";
const h2 = "font-display text-3xl font-bold leading-tight tracking-tight text-teal-900 sm:text-5xl";

function TrialButton({ className = "" }: { className?: string }) {
  return (
    <a
      href="#start"
      className={`flex w-full items-center justify-center rounded-full bg-amber-500 px-6 py-4 text-lg font-semibold text-teal-950 shadow-sm transition hover:bg-amber-400 sm:inline-flex sm:w-auto sm:py-3.5 sm:text-base ${className}`}
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
    <div className={`grid content-start gap-5 rounded-3xl p-5 ring-1 sm:p-7 ${className}`}>
      <div className="flex items-center gap-3">
        <span className={`grid size-11 shrink-0 place-items-center rounded-2xl ${badge}`}>
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

export default function Home() {
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line/70 bg-sand/90 backdrop-blur">
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
            <a href={site.appUrl} className="hidden text-sm font-semibold text-teal-900 hover:underline sm:inline">
              Sign in
            </a>
            <a href="#start" className="rounded-full bg-teal-900 px-4 py-2 text-sm font-semibold text-sand hover:bg-teal-800">
              Free trial
            </a>
          </div>
        </div>
      </header>

      <main id="top">
        {/* 1. Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-14 pt-8 sm:px-6 sm:pb-20 sm:pt-12 lg:grid-cols-[1.15fr_0.85fr] lg:gap-12 lg:pt-16">
          <div className="grid gap-5 sm:gap-6">
            <p className={eyebrow}>For cleaning, security, garden, pest, pool, maintenance and sales teams</p>
            <h1 className="font-display text-[2.6rem] font-extrabold leading-[1.02] tracking-tight text-teal-900 sm:text-6xl">
              Every job{" "}
              <span className="whitespace-nowrap underline decoration-amber-500 decoration-[0.12em] underline-offset-[0.12em]">Tickd off</span>.{" "}
              <span className="text-teal-700">Except you.</span>
            </h1>
            <div className="grid max-w-xl gap-3">
              <p className="font-display text-xl font-bold leading-snug text-ink sm:text-2xl">
                {site.name} is {site.whatItIs.charAt(0).toLowerCase() + site.whatItIs.slice(1)}
              </p>
              <p className="text-lg leading-relaxed text-muted">
                Your team checks in at every job and takes photos. You see where they are, how long they stay and what
                got done. Then you invoice and get paid, all in one app.
              </p>
            </div>
            <div className="grid gap-2">
              <TrialButton />
              <p className="text-center text-sm font-medium text-muted sm:text-left">
                Free for {site.trialDays} days. Then from R1,499 a month.
              </p>
            </div>
            <ul className="grid gap-2.5 text-lg font-medium text-ink sm:flex sm:flex-wrap sm:gap-x-6">
              {["Cheap Android phones", "Works with no signal", "Made for Southern Africa"].map((a) => (
                <li key={a} className="flex items-center gap-2">
                  <Check className="size-5 text-teal-700" strokeWidth={3} /> {a}
                </li>
              ))}
            </ul>
          </div>
          <ProductDemo />
        </section>

        {/* 2. Sound familiar? */}
        <section className="border-t border-line bg-white">
          <div className={`${wrap} max-w-4xl`}>
            <p className={eyebrow}>Sound familiar?</p>
            <h2 className={h2}>Getting ticked off by the chasing?</h2>
            <ol>
              {day.map(([t, text]) => (
                <li key={t} className="grid grid-cols-[3.75rem_1fr] gap-3 border-b border-line py-3.5 sm:grid-cols-[4.5rem_1fr] sm:gap-4 sm:py-4">
                  <span className="pt-0.5 text-sm font-semibold tabular-nums text-flag">{t}</span>
                  <p className="leading-relaxed sm:text-lg">{text}</p>
                </li>
              ))}
            </ol>
            <p className="text-lg font-semibold leading-relaxed text-teal-900">
              You didn&apos;t start a business to spend your day chasing people for updates.
            </p>
          </div>
        </section>

        {/* 3. What could you save? */}
        <section className="border-t border-line">
          <div className={`${wrap} max-w-6xl`}>
            <p className={eyebrow}>Tick-tock.</p>
            <h2 className={h2}>What is lost time costing you?</h2>
            <CostCalculator />
          </div>
        </section>

        {/* 4. How it works */}
        <section id="how" className="border-t border-line bg-white">
          <div className={`${wrap} max-w-6xl`}>
            <p className={eyebrow}>How it works</p>
            <h2 className={h2}>Tap. Tickd. Done.</h2>
            <p className="max-w-2xl text-lg leading-relaxed text-muted">
              Your team does the work on their phones, and you see everything as it happens, wherever you are.
            </p>
            <div className="grid gap-4 sm:mt-2 md:grid-cols-2 md:gap-6">
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
                className="bg-teal-50 ring-teal-100"
                badge="bg-teal-900 text-sand"
              />
            </div>
            <div className="mt-2 grid gap-4 rounded-3xl bg-teal-950 p-5 text-sand sm:p-7">
              <p className="font-display text-xl font-bold text-amber-500">All in one app:</p>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {allInOne.map(({ label, icon: Icon }, i) => (
                  <li
                    key={label}
                    className={`flex items-center gap-3 rounded-2xl bg-white/[0.07] p-3.5 ring-1 ring-white/10 sm:flex-col sm:items-start sm:gap-3 sm:p-4 ${
                      i === allInOne.length - 1 ? "col-span-2 sm:col-span-1" : ""
                    }`}
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-500 text-teal-950">
                      <Icon className="size-5" strokeWidth={2.25} />
                    </span>
                    <span className="font-display text-lg font-bold">{label}</span>
                  </li>
                ))}
              </ul>
              <ul className="grid grid-cols-2 gap-3 sm:flex sm:gap-3">
                {addOns.map(({ label, icon: Icon }) => (
                  <li
                    key={label}
                    className="flex items-center gap-3 rounded-2xl border border-dashed border-white/25 p-3.5 sm:px-4"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/10 text-amber-500">
                      <Icon className="size-[1.1rem]" strokeWidth={2.25} />
                    </span>
                    <span className="grid leading-tight">
                      <span className="font-display font-bold">{label}</span>
                      <span className="text-xs font-semibold uppercase tracking-wider text-teal-100/70">Add-on</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* 5. Your trade */}
        <section id="trades" className={`${wrap} max-w-6xl`}>
          <p className={eyebrow}>Your trade</p>
          <h2 className={h2}>What do your clients want to see?</h2>
          <TradeTabs />
          <p className="text-lg leading-relaxed text-muted">
            Whatever your trade, every job ends with a signed report you can send straight to your client.
          </p>
        </section>

        {/* 6. Good for your team too */}
        <section id="team" className="border-t border-line">
          <div className={`${wrap} max-w-6xl`}>
            <p className={eyebrow}>Good for your team too</p>
            <h2 className={h2}>Good work, Tickd and proven.</h2>
            <ul className="grid gap-3 sm:mt-2 sm:grid-cols-2 sm:gap-4">
              {team.map(([title, body]) => (
                <li key={title} className="flex gap-3 rounded-2xl bg-white p-4 ring-1 ring-line sm:p-5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-amber-500 text-teal-950">
                    <Check className="size-4" strokeWidth={3} />
                  </span>
                  <span className="grid gap-0.5">
                    <span className="font-display text-lg font-bold text-teal-900">{title}</span>
                    <span className="leading-relaxed text-muted">{body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 7. Pricing */}
        <section id="pricing" className="border-t border-line bg-white">
          <div className={`${wrap} max-w-6xl`}>
            <p className={eyebrow}>Pricing</p>
            <h2 className={h2}>One price. Every box Tickd.</h2>
            <PricingSection />
          </div>
        </section>

        {/* 8. Questions */}
        <section id="faq" className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
          <p className={eyebrow}>Questions</p>
          <div className="mt-4 divide-y divide-line">
            {faqs.map((f) => (
              <div key={f.q} className="grid gap-1 py-4 sm:grid-cols-[16rem_1fr] sm:gap-6 sm:py-5">
                <p className="font-semibold text-teal-900">{f.q}</p>
                <p className="leading-relaxed text-muted">{f.a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 9. Sign up */}
        <section id="start" className="px-4 pb-14 sm:px-6 sm:pb-16">
          <div className="mx-auto grid max-w-6xl gap-5 rounded-3xl bg-teal-900 p-5 text-sand sm:gap-6 sm:p-10">
            <h2 className="font-display text-3xl font-extrabold leading-tight tracking-tight sm:text-5xl">
              Get your team {site.name}.
            </h2>
            <p className="max-w-2xl text-lg leading-relaxed text-teal-100">
              See your team&apos;s whole day, show your clients the proof, and find out what it saves you. It costs nothing to try.
            </p>
            <TrialForm />
          </div>
        </section>
      </main>

      <footer className="bg-teal-950 text-teal-100">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
          <Logo inverted />
          <p className="text-sm">
            {site.tagline} ·{" "}
            <a href={`mailto:${site.email}`} className="py-1 hover:text-sand">
              {site.email}
            </a>
          </p>
        </div>
      </footer>
    </>
  );
}
