"use client";

import {
  BatteryMedium,
  Camera,
  Check,
  MapPin,
  Pause,
  Play,
  ShoppingCart,
  Clock,
  CloudOff,
  Signal,
  SignalZero,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LogoMark } from "@/components/logo";
import { AndroidNav, at } from "@/components/demo/phone-screens";
import { ShotScreen } from "@/components/demo/shot-screen";
import { site } from "@/lib/site";

// The hero demo. Part one answers the page's eight pain points, in the page's
// order, each with the outcome as its headline. Part two is the office: quotes,
// invoices, money owed, targets, reports and insights. The phone plays real
// screenshots of the staff app (rendered from its Flutter widgets with example
// data, re-coloured to Tickd); browser scenes are real dashboard screenshots.

const shot = (name: string) => `/demo/app/${name}.webp`;
const dash = (name: string) => `/demo/dash/${name}.webp`;

// A real dashboard screenshot in a browser window, zooming into the part of
// the page the caption is about. `focus` is "x% y%". The image is laid out at
// the zoomed size and starts scaled down to fit, so it is never enlarged.
function BrowserShot({ url, src, focus, zoom = 1.45 }: { url: string; src: string; focus: string; zoom?: number }) {
  const [fx, fy] = focus.split(" ").map((v) => parseFloat(v) / 100);
  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-2xl shadow-black/40 ring-1 ring-black/10">
      <div className="flex items-center gap-2 border-b border-line bg-[#eef0ee] px-3 py-2">
        <span className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
        </span>
        <span className="ml-2 flex-1 truncate rounded-md bg-white px-2 py-0.5 text-[10px] text-muted ring-1 ring-line">{url}</span>
      </div>
      <div className="relative aspect-[1280/800] overflow-hidden bg-white">
        <div
          className="tk-zoom-sharp absolute"
          style={{
            width: `${zoom * 100}%`,
            height: `${zoom * 100}%`,
            left: `${-fx * (zoom - 1) * 100}%`,
            top: `${-fy * (zoom - 1) * 100}%`,
            transformOrigin: focus,
            ["--from" as string]: 1 / zoom,
          }}
        >
          <Image src={src} alt="" fill unoptimized className="object-cover object-top" />
        </div>
      </div>
    </div>
  );
}

// The Android camera the app opens, then the form with the photo in it.
function CameraThenForm() {
  return (
    <div className="relative h-full w-full bg-black">
      <div className="absolute inset-x-0 top-[6%] bottom-[18%] overflow-hidden">
        <Image src="/demo/washroom.jpg" alt="" fill unoptimized className="object-cover" priority />
        <span className="tk-flash absolute inset-0 bg-white" style={at(1000)} />
      </div>
      <div className="absolute inset-x-0 bottom-[4%] flex items-center justify-center">
        <span className="relative grid size-14 place-items-center rounded-full border-4 border-white">
          <span className="size-10 rounded-full bg-white" />
          <span className="tk-ring absolute left-1/2 top-1/2 size-12 rounded-full border-[3px] border-amber-500 bg-amber-500/25" style={at(750)} />
        </span>
      </div>
      <div className="tk-fade absolute inset-0" style={at(1500)}>
        <ShotScreen frames={[{ src: shot("05b-photo-taken"), at: 0 }]} />
      </div>
    </div>
  );
}

const STEP_MS = 3200;

/** The progress bar's groups: the eight pain points, then the office. */
const groups = [
  "Every paid hour, accounted for",
  "Proof they were there, for every client",
  "No more mystery kilometres on the bakkie",
  "Know about a missed job the same day",
  "Your team can't fake it anymore",
  "Your business, out of WhatsApp",
  "Your team doesn't need new phones",
  "No more payday arguments",
  "Run the office from one screen",
];
const OFFICE = groups.length - 1;

type Beat = {
  /** Index into `groups`. */
  group: number;
  /** Shown on the video. Defaults to the group's headline. */
  headline?: string;
  /** Shown under the video. */
  caption: string;
  ms?: number;
  phone?: () => ReactNode;
  offline?: boolean;
  /** A dashboard screen; the phone steps aside and `points` fill the space under it. */
  browser?: { url: string; src: string; focus: string; zoom?: number };
  points?: string[];
  callouts?: { side: "left" | "right"; node: ReactNode; delay: number; top: string }[];
};

function Pill({ icon, children, tone = "teal" }: { icon: ReactNode; children: ReactNode; tone?: "teal" | "green" | "flag" | "amber" }) {
  const tones = {
    teal: "bg-white text-teal-900",
    green: "bg-[#e3f4e8] text-[#14633a]",
    flag: "bg-amber-100 text-flag",
    amber: "bg-amber-500 text-teal-950",
  };
  return (
    <span className={`flex items-center gap-2 whitespace-nowrap rounded-2xl px-3 py-2 text-sm font-semibold shadow-xl shadow-black/25 ${tones[tone]}`}>
      {icon}
      {children}
    </span>
  );
}

const beats: Beat[] = [
  {
    group: 0,
    caption: "Every workday starts and ends on the clock, with one tap.",
    ms: 4400,
    phone: () => (
      <ShotScreen
        frames={[
          { src: shot("01-day-before"), at: 0 },
          { src: shot("02b-day-plan"), at: 1250 },
          { src: shot("02-day-started"), at: 2900 },
        ]}
        taps={[
          { x: 33, y: 266, w: 294, h: 48, at: 900 },
          { x: 24, y: 690, w: 312, h: 50, at: 2550 },
        ]}
      />
    ),
    callouts: [{ side: "right", top: "34%", delay: 3200, node: <Pill icon={<Clock className="size-4 text-amber-500" />}>Started 06:58</Pill> }],
  },
  {
    group: 1,
    caption: "Every check-in records how far they were from the site.",
    phone: () => (
      <ShotScreen
        frames={[
          { src: shot("03-site-before-checkin"), at: 0 },
          { src: shot("04-site-checked-in"), at: 1250 },
        ]}
        taps={[{ x: 16, y: 309, w: 328, h: 52, at: 900 }]}
      />
    ),
    callouts: [
      { side: "left", top: "42%", delay: 1700, node: <Pill tone="green" icon={<MapPin className="size-4" />}>Checked in · 18 m from site</Pill> },
    ],
  },
  {
    group: 2,
    caption: "Every route and every kilometre, for every person and every bakkie.",
    browser: { url: "app.tickd.co.za/tracking/thabo", src: dash("d2-day-history"), focus: "26% 20%", zoom: 1.6 },
    points: ["The whole route, recorded all day", "38 km today, per person, per day", "Settle petrol and fuel-card claims"],
  },
  {
    group: 3,
    caption: "See where everyone is right now, and where they have been.",
    browser: { url: "app.tickd.co.za/tracking", src: dash("d1b-live-map-card"), focus: "85% 55%" },
    points: ["Everyone's position, live", "Arrivals and departures as they happen", "Replay anyone's day"],
  },
  {
    group: 4,
    caption: "Photos come from the camera only. Gallery uploads are blocked.",
    ms: 3600,
    phone: CameraThenForm,
    callouts: [
      {
        side: "right",
        top: "18%",
        delay: 1900,
        node: (
          <span className="grid gap-0.5 rounded-xl bg-teal-950 px-3 py-2 text-xs text-sand shadow-xl shadow-black/30 ring-1 ring-amber-500/60">
            <span className="flex items-center gap-1.5 font-semibold">
              <MapPin className="size-3.5 text-amber-500" /> Office block
            </span>
            <span className="text-teal-100">1 Main Road, Central · 07:44</span>
          </span>
        ),
      },
      { side: "left", top: "70%", delay: 2200, node: <Pill tone="flag" icon={<Camera className="size-4" />}>Gallery blocked</Pill> },
    ],
  },
  {
    group: 4,
    caption: "A check-in made away from the site is flagged.",
    browser: { url: "app.tickd.co.za/activities", src: dash("d2c-visit-flags"), focus: "60% 40%" },
    points: ["Off site · 1.4 km, flagged in red", "The exact distance, for every check-in"],
  },
  {
    group: 4,
    caption: "So is a visit too short to be real.",
    browser: { url: "app.tickd.co.za/visits/short", src: dash("d9-short-visits"), focus: "75% 45%", zoom: 1.35 },
    points: ["Visits under 5 minutes, flagged", "By person and by site, ready to export"],
  },
  {
    group: 5,
    caption: "Jobs, photos and orders live in the app, not in a dozen chats.",
    phone: () => (
      <ShotScreen
        frames={[
          { src: shot("09-order"), at: 0 },
          { src: shot("10-order-sent"), at: 1450 },
        ]}
        taps={[{ x: 232, y: 664, w: 116, h: 48, at: 1100 }]}
      />
    ),
    callouts: [
      { side: "left", top: "34%", delay: 1700, node: <Pill tone="amber" icon={<ShoppingCart className="size-4" />}>Order saved · 3 lines</Pill> },
    ],
  },
  {
    group: 6,
    caption: "Runs on cheap Androids. No signal, or load shedding took the tower down? They keep working, and it syncs later.",
    ms: 3600,
    offline: true,
    phone: () => (
      <ShotScreen
        frames={[
          { src: shot("07-offline"), at: 0 },
          { src: shot("07b-syncing"), at: 1800 },
          { src: shot("08-synced"), at: 2700 },
        ]}
      />
    ),
    callouts: [
      { side: "left", top: "30%", delay: 300, node: <Pill tone="flag" icon={<CloudOff className="size-4" />}>Offline · 3 changes saved</Pill> },
      { side: "right", top: "50%", delay: 2800, node: <Pill tone="green" icon={<Check className="size-4" strokeWidth={3} />}>Synced</Pill> },
    ],
  },
  {
    group: 7,
    caption: "Hours worked for every person, every day, ready for payroll.",
    browser: { url: "app.tickd.co.za/tracking/thabo", src: dash("d2-day-history"), focus: "90% 20%", zoom: 1.6 },
    points: ["When every workday started and ended", "8 h 22 m worked, per person, per day", "Timesheets for payroll"],
  },
  {
    group: OFFICE,
    headline: "Quotes in a minute",
    caption: "Lines, discounts, VAT and totals worked out. When the client says yes, it becomes a job or an order.",
    browser: { url: "app.tickd.co.za/quotes/QT-317", src: dash("o1-quote"), focus: "72% 22%", zoom: 1.3 },
    points: ["Discounts, VAT and totals worked out", "Track it: sent, accepted or declined", "Convert to an order in one click"],
  },
  {
    group: OFFICE,
    headline: "Invoice it, and get paid",
    caption: "Numbered tax invoices, payments recorded, credit notes when something's wrong.",
    browser: { url: "app.tickd.co.za/invoices/INV-0142", src: dash("o2-invoice"), focus: "92% 26%" },
    points: ["Tax invoices with VAT, numbered for you", "Record EFT, cash or card payments", "Credit notes, never edits"],
  },
  {
    group: OFFICE,
    headline: "Know who still owes you",
    caption: "Outstanding and overdue, at a glance.",
    browser: { url: "app.tickd.co.za/invoices", src: dash("d6-invoices-list"), focus: "70% 22%" },
    points: ["Outstanding and overdue totals", "Overdue invoices in red", "Export to Excel or CSV"],
  },
  {
    group: OFFICE,
    headline: "Set goals for everyone on your team",
    caption: "A monthly target for each person, and progress against it as the work comes in.",
    browser: { url: "app.tickd.co.za/targets", src: dash("o3-targets-set"), focus: "62% 24%", zoom: 1.35 },
    points: ["A target per person, per month", "Revenue or units, your choice", "Progress updates as the work is delivered"],
  },
  {
    group: OFFICE,
    headline: "Commissions, worked out for you",
    caption: "Worked out from your own rules on what was delivered. Approve, then pay.",
    browser: { url: "app.tickd.co.za/commissions", src: dash("o6-commissions"), focus: "55% 28%", zoom: 1.3 },
    points: ["Calculated from your own rules", "Pending, approved and paid", "Export for payroll"],
  },
  {
    group: OFFICE,
    headline: "Performance reports, ready for reviews",
    caption: "Start times, jobs, sites missed and sales for each person, ready to print.",
    browser: { url: "app.tickd.co.za/reports/rep-performance", src: dash("o4-rep-performance"), focus: "58% 22%", zoom: 1.3 },
    points: ["Start times, job length and days worked", "Sites missed, and the reason why", "A printable report per person"],
  },
  {
    group: OFFICE,
    headline: "See where the money comes from",
    caption: "Sales this week, this month and all time, per person, with the work behind every number.",
    browser: { url: "app.tickd.co.za/sales", src: dash("o5-sales-insights"), focus: "55% 30%", zoom: 1.3 },
    points: ["Sales this week, this month, all time", "Per person, compared with last period", "The work behind every number"],
  },
  {
    group: OFFICE,
    headline: "The whole business on one screen",
    caption: "Revenue, money owed, work in progress and your team, every morning.",
    browser: { url: "app.tickd.co.za", src: dash("o7-dashboard"), focus: "45% 25%", zoom: 1.3 },
    points: ["Revenue and money owed", "Work that needs your attention", "Your team against target"],
  },
];

// Android status bar drawn over the screenshot's header inset.
function PhoneStatus({ offline }: { offline: boolean }) {
  return (
    <div className="absolute inset-x-0 top-0 flex h-[3.2%] items-center justify-between px-4 text-[9px] font-semibold text-white">
      <span className="tabular-nums">07:31</span>
      <span className="absolute left-1/2 top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#1b1d1f]" />
      <span className="flex items-center gap-1">
        {offline ? (
          <span className="relative flex items-center">
            <span className="tk-out flex items-center gap-0.5 text-amber-400" style={at(1700)}>
              <SignalZero className="size-3" /> No signal
            </span>
            <span className="tk-in absolute right-0 flex" style={at(1800)}>
              <Signal className="size-3" />
            </span>
          </span>
        ) : (
          <Signal className="size-3" />
        )}
        <BatteryMedium className="size-3.5" />
      </span>
    </div>
  );
}

// Each beat's images, in order, so the next beat's can load while this one plays.
const beatImages: string[][] = beats.map((b) =>
  b.browser
    ? [b.browser.src]
    : b.phone === CameraThenForm
      ? ["/demo/washroom.jpg", shot("05b-photo-taken")]
      : [],
);

const CTA = beats.length;

export function ProductDemo() {
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [visible, setVisible] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Only play while on screen.
  useEffect(() => {
    if (!ref.current) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.25 });
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    for (const src of beatImages[(step + 1) % beatImages.length] ?? []) {
      const img = new window.Image();
      img.src = src;
    }
  }, [step, visible]);

  useEffect(() => {
    if (paused || reduced || !visible) return;
    const t = setTimeout(() => setStep((s) => (s + 1) % (beats.length + 1)), step === CTA ? 4200 : beats[step].ms ?? STEP_MS);
    return () => clearTimeout(t);
  }, [step, paused, reduced, visible]);

  const end = step === CTA;
  const beat = beats[reduced ? 0 : Math.min(step, beats.length - 1)];
  const desk = !!beat.browser && !end;
  // The phone keeps its last screen while a dashboard scene plays.
  const lastPhone = [...beats.slice(0, Math.min(step, beats.length - 1) + 1)].reverse().find((b) => b.phone)!;
  const Phone = (beat.phone ?? lastPhone.phone)!;
  const groupIndex = end ? groups.length : beat.group;
  const headline = beat.headline ?? groups[beat.group];

  return (
    <figure ref={ref} className="mx-auto grid w-full max-w-[30rem] gap-4">
      <div className="relative h-[39rem] overflow-hidden rounded-[2rem] bg-teal-950 ring-1 ring-white/10">
        {/* backdrop */}
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.15]"
          style={{ backgroundImage: "radial-gradient(#dcebea 1px, transparent 1px)", backgroundSize: "18px 18px" }}
        />
        <div aria-hidden="true" className="absolute -right-16 -top-16 size-64 rounded-full bg-amber-500/25 blur-3xl" />
        <div aria-hidden="true" className="absolute -bottom-20 -left-10 size-72 rounded-full bg-teal-700/50 blur-3xl" />

        {/* headline */}
        {!end && (
          <p
            key={`h-${headline}`}
            className="tk-in absolute inset-x-5 top-4 z-30 text-center font-display text-lg font-extrabold leading-tight text-sand"
            aria-hidden="true"
          >
            {headline}
          </p>
        )}

        {/* dashboard scenes: browser, with the points in the space under it */}
        <div
          className={`absolute inset-x-4 top-16 z-10 transition-all duration-700 ease-out ${
            desk ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-8 opacity-0"
          }`}
          aria-hidden="true"
        >
          {beat.browser && <BrowserShot key={step} {...beat.browser} />}
          {desk && beat.points && (
            <ul key={`p-${step}`} className="mt-5 grid gap-2.5 px-1">
              {beat.points.map((pt, i) => (
                <li
                  key={pt}
                  className="tk-from-left flex items-center gap-3 rounded-2xl bg-white/10 px-4 py-3 text-[15px] font-semibold text-sand ring-1 ring-white/10"
                  style={at(500 + i * 280)}
                >
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-amber-500 text-teal-950">
                    <Check className="size-3.5" strokeWidth={3.5} />
                  </span>
                  {pt}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* phone (steps aside for dashboard scenes and the end card) */}
        <div
          className={`absolute left-1/2 top-[calc(50%+1.25rem)] z-20 w-[15.5rem] -translate-x-1/2 transition-all duration-700 ease-[cubic-bezier(.2,.9,.3,1)] ${
            desk || end ? "pointer-events-none -translate-y-[20%] scale-90 opacity-0" : "-translate-y-1/2"
          }`}
        >
          <div className="tk-float">
            <div className="rounded-[2.2rem] bg-[#1b1d1f] p-2 shadow-2xl shadow-black/50 ring-1 ring-white/10">
              <div className="relative overflow-hidden rounded-[1.8rem] bg-[#f5f6f7]" aria-hidden="true">
                <div className="relative aspect-[360/760] overflow-hidden" key={desk ? "held" : step}>
                  <Phone />
                  <PhoneStatus offline={!desk && !!beat.offline} key={`bar-${step}`} />
                </div>
                <AndroidNav />
              </div>
            </div>
          </div>
        </div>

        {/* callouts (phone scenes) */}
        {!reduced &&
          !end &&
          !desk &&
          beat.callouts?.map((c, i) => (
            <div
              key={`${step}-${i}`}
              className={`absolute z-30 ${c.side === "left" ? "left-3 tk-from-left" : "right-3 tk-from-right"}`}
              style={{ top: c.top, ...at(c.delay) }}
              aria-hidden="true"
            >
              {c.node}
            </div>
          ))}

        {/* end card */}
        {end && (
          <div className="absolute inset-0 z-40 grid place-items-center p-8 text-center">
            <div className="grid justify-items-center gap-4">
              <span className="tk-pop">
                <LogoMark className="size-20" inverted />
              </span>
              <p className="tk-in font-display text-3xl font-extrabold leading-tight text-sand" style={at(200)}>
                Every hour. Every visit. <span className="text-amber-500">Every rand.</span>
              </p>
              <a
                href="#start"
                className="tk-in rounded-full bg-amber-500 px-5 py-3 font-semibold text-teal-950 hover:bg-amber-400"
                style={at(450)}
              >
                Try it free on your team for {site.trialDays} days
              </a>
            </div>
          </div>
        )}
      </div>

      {reduced ? (
        <figcaption>
          <ol className="grid gap-2 text-sm">
            {beats.map((b) => (
              <li key={b.caption} className="grid gap-0.5">
                <span className="font-semibold text-teal-900">{b.headline ?? groups[b.group]}</span>
                <span className="text-muted">{b.caption}</span>
              </li>
            ))}
          </ol>
        </figcaption>
      ) : (
        <figcaption className="grid gap-2">
          {/* For screen readers: the video's headline and what it shows. */}
          <p className="sr-only" aria-live="polite">
            {end ? "Every hour. Every visit. Every rand." : `${headline}. ${beat.caption}`}
          </p>
          <div className="flex items-center gap-3">
            <div className="grid flex-1 grid-cols-[repeat(8,minmax(0,1fr))_minmax(0,2.5fr)] gap-1.5">
              {groups.map((g, i) => {
                const own = beats.map((b, j) => [b, j] as const).filter(([b]) => b.group === i);
                const first = own[0][1];
                const fill = i < groupIndex ? 1 : i === groupIndex ? (step - first + 1) / own.length : 0;
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setStep(first)}
                    className="py-1.5"
                    aria-label={`Jump to: ${g}`}
                    title={g}
                  >
                    <span className="block h-1 overflow-hidden rounded-full bg-teal-900/15">
                      <span className="block h-full rounded-full bg-amber-500 transition-all duration-500" style={{ width: `${fill * 100}%` }} />
                    </span>
                  </button>
                );
              })}
              <span className="col-span-8 text-xs font-semibold text-muted">Your team</span>
              <span className="text-xs font-semibold text-muted">Your office</span>
            </div>
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              aria-label={paused ? "Play demo" : "Pause demo"}
              className="grid size-8 shrink-0 place-items-center rounded-full text-teal-800 ring-1 ring-line hover:bg-white"
            >
              {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            </button>
          </div>
        </figcaption>
      )}
    </figure>
  );
}
