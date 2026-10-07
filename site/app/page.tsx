import { Check } from "lucide-react";
import { CostCalculator } from "@/components/cost-calculator";
import { Logo } from "@/components/logo";
import { ProductDemo } from "@/components/demo/product-demo";
import { PriceCalculator } from "@/components/price-calculator";
import { TradeTabs } from "@/components/trade-tabs";
import { TrialForm } from "@/components/trial-form";
import { pricing, rand, site } from "@/lib/site";

// Copy: ~/Downloads/landing-page-copy.md (draft v3). Only live features are
// claimed; quotes, tax invoices, recurring orders, targets and commissions
// are the owner's tools on the dashboard, not the staff phone app.

const nav = [
  { href: "#how", label: "How it works" },
  { href: "#trades", label: "Your trade" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

const day = [
  ["07:40", "A client phones. Nobody has arrived at their site. You WhatsApp your staff member. “On my way, boss.” You have no idea if that's true."],
  ["10:15", "A photo comes in on WhatsApp to show the job is done. It looks just like last week's photo. You can't tell."],
  ["13:30", "You try to call two of your team. No answer. Lunch, they say later. A long one."],
  ["15:10", "A van is on the other side of town from any job. You only find out when the fuel card bill arrives."],
  ["16:00", "Half the team is “finishing up”. You're paying them until 17:00."],
  ["Friday", "A client emails: your people skipped them twice this month. They want a discount, or they're going to someone else. You have nothing to show them."],
  ["Payday", "“I worked late on Tuesday.” You can't prove they didn't, so you pay."],
];

const pains = [
  {
    title: "You pay for hours you never get",
    scene: "Late starts. Long lunches. Gone by 15:30. You only see it if you drive out yourself.",
    cost: "Ten people losing two hours a day is about 440 paid hours a month. That's more than two full-time salaries, gone.",
    fix: "Records when each workday starts and ends, and flags short visits.",
  },
  {
    title: "You lose contracts over “I was there”",
    scene: "The client says nobody came. Your staff member swears they did. It's your word against theirs, and the client pays the bills.",
    cost: "One lost contract can wipe out a month of profit.",
    fix: "GPS-verified check-ins, time-stamped photos, and a proof-of-work report per job with the client's signature, ready to send.",
  },
  {
    title: "Your fuel bill keeps climbing",
    scene: "Fuel cards and travel claims, and nobody can tell you which trips were work.",
    cost: "You pay for every private kilometre and never know how many there were.",
    fix: "A recorded route and the kilometres driven per person, per day.",
  },
  {
    title: "You hear about missed jobs last",
    scene: "A site gets skipped on Monday. You find out on Thursday, from an angry client.",
    cost: "By then the damage is done, and you're the one apologising.",
    fix: "A live map of who has been where, and a daily summary in your inbox: late starts, missed jobs, short visits.",
  },
  {
    title: "Your team knows how to fake it",
    scene: "Last week's photo sent again on WhatsApp. A “check-in” made from home.",
    cost: "You're paying for proof that isn't proof.",
    fix: "Gallery uploads are blocked. Check-ins too far from the site are flagged.",
  },
  {
    title: "Your business lives in WhatsApp",
    scene: "Instructions, photos, reports and orders, buried in a dozen chats and voice notes.",
    cost: "No record when you need one. No reports. And you're answering messages at 21:00.",
    fix: "One app for the team: visits, photos, forms and orders. One dashboard for you: invoices, payments and reports.",
  },
  {
    title: "Every other app needs new phones",
    scene: "Your team has cheap Androids and little data. Most sites have weak signal.",
    cost: "So you either buy phones, or you keep guessing.",
    fix: "Built for low-cost Android phones. Works offline and syncs later.",
  },
  {
    title: "Payday turns into an argument",
    scene: "“I worked late that day.” There's nothing to settle it.",
    cost: "So you pay, and everyone learns that it works.",
    fix: "Timesheets per person, ready for payroll, exported to Excel or CSV.",
  },
];

const steps = [
  {
    title: "They start the day with one tap",
    body: "The app on their phone records the route until they end the day. They see today's schedule, including regular repeat visits.",
  },
  {
    title: "They check in at each site",
    body: "The phone's GPS confirms they're really there. They take photos with the in-app camera and fill in your own forms and checklists.",
  },
  {
    title: "You see it live, and get flagged",
    body: "A live map, a replay of anyone's day, and automatic flags when a check-in is too far away, a visit is too short, or a workday is left running.",
  },
];

const allInOne = [
  {
    label: "Track",
    title: "Where they are and where they went",
    body: "Live map, recorded routes, kilometres and hours per person, per day.",
  },
  {
    label: "Prove",
    title: "What they did on site",
    body: "GPS check-ins, camera-only stamped photos, your own forms and checklists, and a proof-of-work report per job with before-and-after photos and the client's signature.",
  },
  {
    label: "Sell",
    title: "What they sold",
    body: "Leads, quotes and orders. Reps take orders on the phone at the store, with per-line discounts. Promotions and in-store checks at every visit.",
  },
  {
    label: "Invoice and collect",
    title: "Who owes you, and how much",
    body: "Tax invoices with VAT and your own numbering, credit notes and recurring orders. Record payments by EFT, cash or card, and see what's outstanding and overdue.",
  },
  {
    label: "Deliver",
    title: "What went out, and that it arrived",
    body: "Stock, picking and dispatch, deliveries assigned to a driver, and proof of delivery on their phone.",
    addOn: "Warehouse add-on",
  },
  {
    label: "Manage",
    title: "Who is performing",
    body: "Flags, a daily summary, scorecards, sales targets and commissions, timesheets for payroll, and a printable performance report per person.",
  },
  {
    label: "People",
    title: "Your team's records in one place",
    body: "Job roles with exactly the access each person needs, so a foreman can work in the field and run the team. Plus employee records, attendance, leave, documents and performance.",
    addOn: "HR add-on",
  },
];

const moneyFlow = [
  ["Quote", "Send a quote from the dashboard"],
  ["Order or job", "Taken at the store, or booked on the schedule"],
  ["Done", "The client signs off the job, or signs for the delivery"],
  ["Tax invoice", "Numbered, with VAT, as a PDF"],
  ["Payment", "EFT, cash or card, recorded against the invoice"],
  ["Paid", "See what's outstanding and overdue"],
];

const levers = [
  {
    label: "What you get",
    title: "Every paid hour, accounted for",
    body: "Proof for every client who asks, and every staff member who argues.",
  },
  {
    label: "Why you can trust it",
    title: "It can't be faked",
    body: "GPS check-ins. Camera-only photos stamped with time and place. Gallery uploads blocked.",
  },
  {
    label: "How fast",
    title: "From the first workday",
    body: "The live map and day replay work as soon as your team taps start.",
  },
  {
    label: "How easy",
    title: "No new phones. No signal needed.",
    body: "Runs on the low-cost Androids your team already has, with or without signal.",
  },
];

const stack: { head: string; items: [string, string?][] }[] = [
  {
    head: "For your team, on their phones",
    items: [
      ["One-tap start and end of day, with the route recorded"],
      ["GPS-confirmed check-in and check-out at each site"],
      ["Camera-only photos, stamped with time and GPS position"],
      ["Your own forms and checklists, filled in on site"],
      ["Today's schedule, including repeat visits"],
      ["Client signature on the phone when the job is done"],
      ["Works with no signal, syncs later"],
    ],
  },
  {
    head: "For you, on the web dashboard",
    items: [
      ["Live map of where everyone is right now"],
      ["Replay of anyone's day: stops, route and time at each site"],
      ["Kilometres driven and hours worked, per person, per day"],
      ["Automatic flags: far check-ins, short visits, days left running"],
      ["Scorecards: who keeps to schedule, who misses visits, who's trending down"],
      ["Proof-of-work PDF per job: times, before-and-after photos, checklist, client signature"],
      ["A daily summary for you: late starts, missed jobs, short visits, far check-ins"],
      ["Timesheets per person for payroll, and exports to CSV and Excel"],
      ["Foremen and team leaders: give anyone field and dashboard access in one login"],
    ],
  },
  {
    head: "For your sales reps and merchandisers",
    items: [
      ["Leads, quotes and orders"],
      ["Orders taken on the phone at the store, with per-line discounts"],
      ["Promotions and in-store compliance checks"],
      ["Sales targets and commissions"],
    ],
  },
  {
    head: "For your office: invoicing and collections",
    items: [
      ["Tax invoices with VAT and your own numbering, as PDFs"],
      ["Credit notes and recurring orders"],
      ["Payments recorded against each invoice: EFT, cash, card or cheque"],
      ["What's outstanding and overdue, at a glance"],
    ],
  },
  {
    head: "Add when you need them",
    items: [
      ["Warehouse: stock, picking, dispatch, deliveries and proof of delivery", "Add-on"],
      ["HR: employee records, attendance, leave, documents and performance", "Add-on"],
    ],
  },
];

const bonuses = [
  {
    title: "We set it up for you.",
    body: "Send us your sites and your checklist. We load them before your team's first day.",
  },
  {
    title: "Staff welcome message.",
    body: "A ready-to-send WhatsApp message that tells your team what Tickd is and how to start.",
  },
];

const faqs = [
  { q: "Do my staff need new phones?", a: "No. Tickd runs on low-cost Android phones." },
  {
    q: "What if there's no signal at the site?",
    a: "They keep working. Everything saves on the phone and syncs when they're back in signal.",
  },
  {
    q: "Can they fake a check-in or send an old photo?",
    a: "The camera is the only way to add a photo. Gallery uploads are blocked, and every photo carries the time and GPS position. A check-in made too far from the site is flagged on your dashboard.",
  },
  {
    q: "What if someone forgets to end their day?",
    a: "You get flagged, and the workday ends automatically in the evening.",
  },
  {
    q: "Do I need a separate app for orders and invoices?",
    a: "No. Your reps take orders on the phone at the store, in the same app they use to check in. You turn them into tax invoices, send quotes and set up recurring orders on the same dashboard where you see their visits.",
  },
  {
    q: "Can I see who still owes me money?",
    a: "Yes. Record each payment against its invoice, by EFT, cash, card or cheque, and the dashboard shows which invoices are paid, part-paid or unpaid. Mistakes are fixed with a credit note, the way the law expects, never by editing the invoice.",
  },
  {
    q: "Can a foreman or team leader use it too?",
    a: "Yes. Give each person a job role with exactly the access they need. A foreman can use the app in the field like the rest of the team, and also see the team's live map, schedule and visits on the dashboard, with one login.",
  },
  {
    q: "Can I send the client proof the job was done?",
    a: "Yes. Every job gets a proof-of-work PDF: who did it, check-in and check-out times, time on site, the checklist, before-and-after photos and the client's signature. Send it by email or WhatsApp.",
  },
  {
    q: "Can I get the data out?",
    a: "Yes. Timesheets for payroll, plus hours worked and kilometres per person per day, export to CSV or Excel.",
  },
  {
    q: "Is it legal to track my staff?",
    a: "Tracking only runs between the moment a staff member starts their workday and the moment it ends, never in their private time. You should still tell your staff how it works; the welcome message helps with that.",
  },
  {
    q: "What does it cost after the trial?",
    a: `${rand(pricing.base)} a month for your first ${pricing.includedUsers} people, then ${rand(pricing.perExtraUser)} for each extra person. Month to month, no contract. Prices include VAT.`,
  },
];

const eyebrow = "text-xs font-semibold uppercase tracking-widest text-muted";
const h2 = "font-display text-4xl font-bold tracking-tight text-teal-900 sm:text-5xl";

function TrialButton({ className = "" }: { className?: string }) {
  return (
    <a
      href="#start"
      className={`inline-flex items-center justify-center rounded-full bg-amber-500 px-6 py-3.5 font-semibold text-teal-950 shadow-sm transition hover:bg-amber-400 ${className}`}
    >
      Try it free on your team for {site.trialDays} days
    </a>
  );
}

function CheckList({ items, tone = "teal" }: { items: string[]; tone?: "teal" | "amber" }) {
  return (
    <ul className="grid gap-2.5">
      {items.map((it) => (
        <li key={it} className="flex gap-2.5 leading-relaxed">
          <Check
            className={`mt-1 size-4 shrink-0 ${tone === "amber" ? "text-amber-500" : "text-teal-700"}`}
            strokeWidth={3}
          />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

export default function Home() {
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line/70 bg-sand/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
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
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-12 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:pt-16">
          <div className="grid gap-6">
            <p className={eyebrow}>For owners of cleaning, security, maintenance, garden, pest, pool and distribution businesses</p>
            <h1 className="font-display text-5xl font-extrabold leading-[1.02] tracking-tight text-teal-900 sm:text-6xl">
              See what your field team{" "}
              <span className="underline decoration-amber-500 decoration-[0.12em] underline-offset-[0.12em]">actually did</span>{" "}
              today. <span className="text-teal-700">And what they sold.</span>
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-muted">
              One app for your people in the field. One dashboard for you. Start times, routes, site visits, photos,
              orders, invoices, payments and deliveries, with GPS check-ins and camera-only photos they can&apos;t fake.
            </p>
            <div>
              <TrialButton />
            </div>
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
              {["Runs on low-cost Android phones", "Works with no signal", `Built for ${site.countries}`].map((a) => (
                <li key={a} className="flex items-center gap-1.5">
                  <Check className="size-4 text-teal-700" strokeWidth={3} /> {a}
                </li>
              ))}
            </ul>
          </div>
          <ProductDemo />
        </section>

        {/* Does this sound like your day? */}
        <section className="border-t border-line bg-white">
          <div className="mx-auto grid max-w-4xl gap-6 px-4 py-20 sm:px-6">
            <p className={eyebrow}>Does this sound like your day?</p>
            <h2 className={h2}>You&apos;re paying for a team you can&apos;t see.</h2>
            <ol className="mt-2">
              {day.map(([t, text]) => (
                <li key={t} className="grid grid-cols-[4.5rem_1fr] gap-4 border-b border-line py-4">
                  <span className="pt-0.5 text-sm font-semibold tabular-nums text-flag">{t}</span>
                  <p className="text-lg leading-relaxed">{text}</p>
                </li>
              ))}
            </ol>
            <p className="max-w-2xl text-lg font-medium leading-relaxed text-teal-900">
              You didn&apos;t start a business to babysit grown adults over WhatsApp. But without proof, that&apos;s the job.
            </p>
          </div>
        </section>

        {/* The cost you can't see */}
        <section className="border-t border-line">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-20 sm:px-6">
            <p className={eyebrow}>The cost you can&apos;t see</p>
            <h2 className={`${h2} max-w-4xl`}>
              If your staff work away from the office, you&apos;re paying for hours you can&apos;t see.
            </h2>
            <p className="max-w-2xl text-lg text-muted">
              Late starts, long lunches and early finishes don&apos;t show up anywhere. Put in your own numbers.
            </p>
            <CostCalculator />
          </div>
        </section>

        {/* Pains */}
        <section className="bg-teal-900 text-sand">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-20 sm:px-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-teal-100">Sound familiar?</p>
            <h2 className="max-w-3xl font-display text-4xl font-bold tracking-tight sm:text-5xl">
              Eight ways your field team costs you money <span className="text-amber-500">while you&apos;re not looking.</span>
            </h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {pains.map((p) => (
                <div key={p.title} className="grid content-start gap-3 rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
                  <h3 className="font-display text-2xl font-bold">{p.title}</h3>
                  <p className="border-l-[3px] border-amber-500 pl-3 italic leading-relaxed text-teal-100">{p.scene}</p>
                  <p className="font-semibold leading-relaxed text-amber-400">{p.cost}</p>
                  <p className="text-sm leading-relaxed">
                    <span className="font-semibold text-amber-500">{site.name}: </span>
                    {p.fix}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto grid max-w-6xl gap-6 px-4 py-20 sm:px-6">
          <p className={eyebrow}>How it works</p>
          <h2 className={h2}>Your team taps start. You see everything.</h2>
          <ol className="mt-4 grid gap-8 md:grid-cols-3">
            {steps.map((s, i) => (
              <li key={s.title} className="grid content-start gap-2">
                <span className="text-xs font-semibold uppercase tracking-widest text-teal-700">Step {i + 1}</span>
                <h3 className="font-display text-2xl font-bold text-teal-900">{s.title}</h3>
                <p className="leading-relaxed text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* All in one */}
        <section className="border-t border-line bg-white">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-20 sm:px-6">
            <p className={eyebrow}>All in one</p>
            <h2 className={`${h2} max-w-4xl`}>One app instead of WhatsApp groups, paper forms and order books.</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {allInOne.map((l) => (
                <div key={l.label} className="grid content-start gap-2 rounded-2xl bg-teal-950 p-5 text-sand">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-widest text-amber-500">{l.label}</span>
                    {"addOn" in l && (
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-teal-100">
                        {l.addOn}
                      </span>
                    )}
                  </span>
                  <h3 className="font-display text-xl font-bold">{l.title}</h3>
                  <p className="text-sm leading-relaxed text-teal-100">{l.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Quote to paid */}
        <section className="mx-auto grid max-w-6xl gap-6 px-4 py-20 sm:px-6">
          <p className={eyebrow}>Invoicing and collections</p>
          <h2 className={`${h2} max-w-4xl`}>From quote to paid, without a second system.</h2>
          <p className="max-w-2xl text-lg text-muted">
            The order or job becomes the client&apos;s sign-off, the tax invoice and the payment you record. No retyping
            into another program, and you always know who still owes you.
          </p>
          <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            {moneyFlow.map(([step, detail], i) => (
              <li key={step} className="relative grid content-start gap-1.5 rounded-2xl bg-white p-4 ring-1 ring-line">
                <span className="text-xs font-semibold tabular-nums text-teal-700">{String(i + 1).padStart(2, "0")}</span>
                <span className={`font-display text-lg font-bold ${i === moneyFlow.length - 1 ? "text-teal-700" : "text-teal-900"}`}>
                  {step}
                </span>
                <span className="text-sm leading-relaxed text-muted">{detail}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* Value */}
        <section className="mx-auto grid max-w-6xl gap-6 px-4 py-20 sm:px-6">
          <p className={eyebrow}>Why owners switch</p>
          <h2 className={h2}>{site.tagline}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {levers.map((l) => (
              <div key={l.title} className="grid content-start gap-2 rounded-2xl bg-white p-5 ring-1 ring-line">
                <span className="text-xs font-semibold uppercase tracking-widest text-teal-700">{l.label}</span>
                <h3 className="font-display text-xl font-bold text-teal-900">{l.title}</h3>
                <p className="text-sm leading-relaxed text-muted">{l.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Trades */}
        <section id="trades" className="border-t border-line bg-white">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-20 sm:px-6">
            <p className={eyebrow}>Built for your trade</p>
            <h2 className={h2}>What do you need to prove?</h2>
            <TradeTabs />
          </div>
        </section>

        {/* What you get */}
        <section className="mx-auto grid max-w-4xl gap-6 px-4 py-20 sm:px-6">
          <p className={eyebrow}>Everything in your trial</p>
          <h2 className={h2}>What you get</h2>
          <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-line">
            {stack.map((g) => (
              <div key={g.head}>
                <p className="bg-teal-50 px-5 py-3.5 font-semibold text-teal-900">{g.head}</p>
                <ul>
                  {g.items.map(([it, tag]) => (
                    <li key={it} className="flex items-start justify-between gap-4 border-t border-line px-5 py-3.5">
                      <span>{it}</span>
                      {tag ? (
                        <span className="shrink-0 rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-semibold text-teal-800 ring-1 ring-teal-100">
                          {tag}
                        </span>
                      ) : (
                        <Check className="mt-0.5 size-5 shrink-0 text-teal-700" strokeWidth={3} />
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <p className="bg-amber-100 px-5 py-3.5 font-semibold text-teal-950">Bonuses when you start</p>
            <ul>
              {bonuses.map((b) => (
                <li key={b.title} className="flex items-start justify-between gap-4 border-t border-line bg-sand px-5 py-3.5">
                  <span>
                    <strong>{b.title}</strong> {b.body}
                  </span>
                  <span className="shrink-0 rounded-full bg-amber-500 px-2.5 py-0.5 text-xs font-bold text-teal-950">
                    Bonus
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="border-t border-line bg-white">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2">
            <div className="grid content-start gap-4">
              <p className={eyebrow}>Pricing</p>
              <h2 className={h2}>Simple pricing. Everything included.</h2>
              <p className="text-lg text-muted">
                Tracking, proof and sales tools in one app. Add the warehouse when you need it.
              </p>
              <p className="text-lg text-muted">
                <strong className="text-ink">{rand(pricing.base)} a month</strong> for your first {pricing.includedUsers}{" "}
                people, then {rand(pricing.perExtraUser)} for each extra person. Month to month, no contract. Prices
                include VAT.
              </p>
              <ul className="grid gap-3">
                {pricing.addOns.map((a) => (
                  <li key={a.name} className="rounded-2xl bg-sand p-5 ring-1 ring-line">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-semibold">{a.name} add-on</span>
                      <span className="font-display font-bold text-teal-800">{a.price}</span>
                    </div>
                    <p className="mt-1 text-sm text-muted">{a.detail}</p>
                  </li>
                ))}
              </ul>
            </div>
            <div className="grid content-start gap-4 lg:pt-14">
              <PriceCalculator />
              <TrialButton className="w-full" />
            </div>
          </div>
        </section>

        {/* Who it's for */}
        <section className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 md:grid-cols-2">
          <div className="grid content-start gap-3">
            <p className={eyebrow}>Who it&apos;s for</p>
            <h2 className="font-display text-4xl font-bold tracking-tight text-teal-900">
              Owners with 1 to 20+ people in the field
            </h2>
            <p className="text-lg leading-relaxed text-muted">
              You pay for their time. You can&apos;t see what they do. You run the team on WhatsApp, phone calls and
              trust, and your margins are tight. Got a foreman or team leader? They can run the team from the same app.
            </p>
          </div>
          <div className="grid content-start gap-3">
            <p className={eyebrow}>Who it&apos;s not for</p>
            <h3 className="font-display text-2xl font-bold text-teal-900">The one-person tradesperson</h3>
            <p className="text-lg leading-relaxed text-muted">
              If you mostly need quotes and invoices, a cheap job-card app will suit you better.
            </p>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="border-t border-line bg-white">
          <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
            <p className={eyebrow}>Questions owners ask</p>
            <h2 className="mt-3 font-display text-4xl font-bold tracking-tight text-teal-900">Before you start</h2>
            <div className="mt-8 divide-y divide-line">
              {faqs.map((f) => (
                <details key={f.q} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                    {f.q}
                    <span className="text-2xl leading-none text-teal-700 transition group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-3 leading-relaxed text-muted">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* The cost of waiting */}
        <section className="mx-auto grid max-w-6xl gap-6 px-4 py-20 sm:px-6">
          <p className={eyebrow}>The cost of waiting</p>
          <h2 className={h2}>If nothing changes, next month looks like this month.</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="grid content-start gap-4 rounded-2xl bg-white p-6 ring-1 ring-line">
              <h3 className="font-display text-2xl font-bold text-flag">Keep doing what you&apos;re doing</h3>
              <ul className="grid gap-2.5 text-muted">
                {[
                  "Pay for about 440 hours you never get, for every ten staff",
                  "Find out about missed sites from angry clients",
                  "Argue about hours every payday",
                  "Run the business from WhatsApp, at night",
                ].map((t) => (
                  <li key={t} className="flex gap-2.5 leading-relaxed">
                    <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-flag" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div className="grid content-start gap-4 rounded-2xl bg-teal-950 p-6 text-sand">
              <h3 className="font-display text-2xl font-bold">
                Try {site.name} for {site.trialDays} days
              </h3>
              <CheckList
                tone="amber"
                items={[
                  "See when every person starts and stops",
                  "Get flagged the same day a visit is short or skipped",
                  "Answer every client with a signed proof-of-work report",
                  "Pay nothing to find out",
                ]}
              />
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section id="start" className="px-4 pb-16 sm:px-6">
          <div className="mx-auto grid max-w-6xl gap-6 rounded-3xl bg-teal-900 p-7 text-sand sm:p-10">
            <p className="text-xs font-semibold uppercase tracking-widest text-amber-500">Start free</p>
            <h2 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
              Try it free on your own team for two weeks.
            </h2>
            <p className="max-w-2xl text-lg leading-relaxed text-teal-100">
              You have two choices. Keep guessing what happened today. Or know. Only one of them gets you the answer, and
              the trial costs you nothing to find out.
            </p>
            <TrialForm />
          </div>
        </section>
      </main>

      <footer className="bg-teal-950 text-teal-100">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div className="grid gap-2">
            <Logo inverted />
            <p className="text-sm">{site.tagline}</p>
          </div>
          <div className="flex flex-col gap-1 text-sm md:items-end">
            <a href={`mailto:${site.email}`} className="hover:text-sand">
              {site.email}
            </a>
            <p>
              © {new Date().getFullYear()} {site.legalName}. Built for {site.countries}.
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}
