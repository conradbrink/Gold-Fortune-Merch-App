"use client";

import {
  BatteryMedium,
  Camera,
  Check,
  MapPin,
  Pause,
  Play,
  Receipt,
  Route,
  ShoppingCart,
  Timer,
  Signal,
  SignalZero,
  TriangleAlert,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LogoMark } from "@/components/logo";
import { AndroidNav, at } from "@/components/demo/phone-screens";
import { ShotScreen } from "@/components/demo/shot-screen";
import { site } from "@/lib/site";

// The hero demo. Storyboard: ~/Downloads/phone-animation-brief.md, extended
// with invoicing and collections. The phone plays real screenshots of the
// staff app (rendered from its Flutter widgets with example data, re-coloured
// to Tickd); browser beats are the owner's dashboard, where quotes, tax
// invoices and payments live.

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

type Chapter = "In the field" | "What you see" | "Getting paid";
type Beat = {
  chapter: Chapter;
  caption: string;
  ms?: number;
  phone?: () => ReactNode;
  offline?: boolean;
  browser?: { url: string; src: string; focus: string; zoom?: number };
  callouts?: { side: "left" | "right"; node: ReactNode; delay: number; top: string }[];
  burst?: boolean;
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

function CountUp({ to, decimals = 0, prefix = "", suffix = "", ms = 1200 }: { to: number; decimals?: number; prefix?: string; suffix?: string; ms?: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setV(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return (
    <span className="tabular-nums">
      {prefix}
      {v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  );
}

const beats: Beat[] = [
  {
    chapter: "In the field",
    caption: "Start the day with one tap.",
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
    callouts: [{ side: "right", top: "30%", delay: 3200, node: <Pill icon={<Route className="size-4 text-amber-500" />}>Route recording</Pill> }],
  },
  {
    chapter: "In the field",
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
      { side: "left", top: "40%", delay: 1700, node: <Pill tone="green" icon={<MapPin className="size-4" />}>Checked in · 18 m from site</Pill> },
    ],
  },
  {
    chapter: "In the field",
    caption: "Photos come from the camera only. Gallery uploads are blocked.",
    ms: 3600,
    phone: CameraThenForm,
    callouts: [
      {
        side: "right",
        top: "16%",
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
    chapter: "In the field",
    caption: "Orders taken on the spot, at the store.",
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
    chapter: "What you see",
    caption: "See your whole team live, wherever they are.",
    browser: { url: "app.tickd.co.za/tracking", src: dash("d1b-live-map-card"), focus: "85% 55%" },
    callouts: [
      { side: "right", top: "57%", delay: 1300, node: <Pill icon={<Route className="size-4 text-amber-500" />}>Thabo · 19.8 km today</Pill> },
    ],
  },
  {
    chapter: "What you see",
    caption: "Kilometres and hours for every person, every day.",
    browser: { url: "app.tickd.co.za/tracking/thabo", src: dash("d2-day-history"), focus: "58% 16%", zoom: 1.35 },
    callouts: [
      { side: "left", top: "57%", delay: 1300, node: <Pill icon={<Route className="size-4 text-amber-500" />}>38 km · 8 h 22 m today</Pill> },
    ],
  },
  {
    chapter: "What you see",
    caption: "Get flagged when someone checks in off site.",
    browser: { url: "app.tickd.co.za/activities", src: dash("d2c-visit-flags"), focus: "60% 40%" },
    callouts: [
      { side: "left", top: "57%", delay: 1300, node: <Pill tone="flag" icon={<TriangleAlert className="size-4" />}>Off site · 1.4 km</Pill> },
    ],
  },
  {
    chapter: "What you see",
    caption: "And when a visit is too short to be real.",
    browser: { url: "app.tickd.co.za/visits/short", src: dash("d9-short-visits"), focus: "75% 45%", zoom: 1.35 },
    callouts: [
      { side: "right", top: "57%", delay: 1300, node: <Pill tone="flag" icon={<Timer className="size-4" />}>3 min at Clinic</Pill> },
    ],
  },
  {
    chapter: "Getting paid",
    caption: "Every order becomes a tax invoice. See what's outstanding and overdue.",
    browser: { url: "app.tickd.co.za/invoices", src: dash("d6-invoices-list"), focus: "70% 22%" },
    callouts: [
      { side: "left", top: "57%", delay: 1300, node: <Pill tone="flag" icon={<Receipt className="size-4" />}>Overdue, in red</Pill> },
    ],
  },
  {
    chapter: "Getting paid",
    caption: "Record payments. Always know who still owes you.",
    browser: { url: "app.tickd.co.za/invoices/INV-0142", src: dash("d5-invoice"), focus: "92% 28%" },
    callouts: [
      { side: "left", top: "57%", delay: 1200, node: <Pill tone="green" icon={<Check className="size-4" strokeWidth={3} />}>Payment recorded · EFT</Pill> },
    ],
    burst: true,
  },
  {
    chapter: "Getting paid",
    caption: "Revenue, money owed and who's performing, on one screen.",
    browser: { url: "app.tickd.co.za", src: dash("d4-dashboard"), focus: "45% 25%", zoom: 1.3 },
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
const beatImages: string[][] = [
  [shot("01-day-before"), shot("02b-day-plan"), shot("02-day-started")],
  [shot("03-site-before-checkin"), shot("04-site-checked-in")],
  ["/demo/washroom.jpg", shot("05b-photo-taken")],
  [shot("09-order"), shot("10-order-sent")],
  [dash("d1b-live-map-card")],
  [dash("d2-day-history")],
  [dash("d2c-visit-flags")],
  [dash("d9-short-visits")],
  [dash("d6-invoices-list")],
  [dash("d5-invoice")],
  [dash("d4-dashboard")],
];

const chapters: Chapter[] = ["In the field", "What you see", "Getting paid"];
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

  const beat = beats[reduced ? 0 : Math.min(step, beats.length - 1)];
  const office = !!beat.browser || step === CTA;
  // The phone keeps its last field screen while the office beats play.
  const lastPhone = [...beats.slice(0, Math.min(step, beats.length - 1) + 1)].reverse().find((b) => b.phone)!;
  const Phone = (beat.phone ?? lastPhone.phone)!;
  const chapterIndex = step === CTA ? chapters.length : chapters.indexOf(beat.chapter);

  return (
    <figure ref={ref} className="mx-auto grid w-full max-w-[30rem] gap-4">
      <div className="relative h-[38rem] overflow-hidden rounded-[2rem] bg-teal-950 ring-1 ring-white/10">
        {/* backdrop */}
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.15]"
          style={{ backgroundImage: "radial-gradient(#dcebea 1px, transparent 1px)", backgroundSize: "18px 18px" }}
        />
        <div aria-hidden="true" className="absolute -right-16 -top-16 size-64 rounded-full bg-amber-500/25 blur-3xl" />
        <div aria-hidden="true" className="absolute -bottom-20 -left-10 size-72 rounded-full bg-teal-700/50 blur-3xl" />
        <span className="absolute left-4 top-4 z-30 rounded-full bg-amber-500 px-2.5 py-0.5 text-[11px] font-bold text-teal-950">
          Example
        </span>

        {/* browser (office beats) */}
        <div
          className={`absolute inset-x-4 top-14 z-10 transition-all duration-700 ease-out ${
            office && step !== CTA ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-8 opacity-0"
          }`}
          aria-hidden="true"
        >
          {beat.browser && <BrowserShot key={step} {...beat.browser} />}
        </div>

        {/* phone */}
        <div
          className={`absolute left-1/2 top-1/2 z-20 w-[15.5rem] transition-all duration-700 ease-[cubic-bezier(.2,.9,.3,1)] ${
            step === CTA
              ? "-translate-x-1/2 -translate-y-[60%] scale-[0.62] opacity-0"
              : office
                ? "translate-x-[2%] translate-y-[2%] scale-[0.52]"
                : "-translate-x-1/2 -translate-y-1/2"
          }`}
        >
          <div className={office ? "" : "tk-float"}>
            <div className="rounded-[2.2rem] bg-[#1b1d1f] p-2 shadow-2xl shadow-black/50 ring-1 ring-white/10">
              <div className="relative overflow-hidden rounded-[1.8rem] bg-[#f5f6f7]" aria-hidden="true">
                <div className="relative aspect-[360/760] overflow-hidden" key={office ? "held" : step}>
                  <Phone />
                  <PhoneStatus offline={!office && !!beat.offline} key={`bar-${step}`} />
                </div>
                <AndroidNav />
              </div>
            </div>
          </div>
        </div>

        {/* callouts */}
        {!reduced &&
          step !== CTA &&
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

        {/* paid burst */}
        {beat.burst && !reduced && step !== CTA && (
          <div className="pointer-events-none absolute right-[22%] top-[22%] z-30" aria-hidden="true" key={`burst-${step}`}>
            {Array.from({ length: 10 }).map((_, i) => (
              <span
                key={i}
                className="tk-burst absolute grid size-5 place-items-center rounded-full bg-amber-500 text-teal-950"
                style={{ ["--a" as string]: `${i * 36}deg`, ...at(550) }}
              >
                <Check className="size-3" strokeWidth={4} />
              </span>
            ))}
          </div>
        )}

        {/* totals strip */}
        {!reduced && office && step !== CTA && (
          <div className="absolute bottom-4 left-4 right-[37%] z-10 grid grid-cols-3 gap-1.5" aria-hidden="true">
            {[
              { label: "check-ins", node: <CountUp to={4} /> },
              { label: "driven", node: <CountUp to={38} suffix=" km" /> },
              { label: "outstanding", node: <CountUp to={10833} /> },
            ].map((s) => (
              <span key={s.label} className="min-w-0 rounded-xl bg-white/10 px-2.5 py-2 text-teal-100 ring-1 ring-white/10 backdrop-blur">
                <b className="block truncate font-display text-base text-sand">{s.node}</b>
                <span className="block truncate text-[10px]">{s.label}</span>
              </span>
            ))}
          </div>
        )}

        {/* end card */}
        {step === CTA && (
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
          <ol className="grid gap-1.5 text-sm text-muted">
            {beats.map((b) => (
              <li key={b.caption} className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-teal-700" strokeWidth={3} />
                {b.caption}
              </li>
            ))}
          </ol>
        </figcaption>
      ) : (
        <figcaption className="grid gap-3">
          <p key={step} className="tk-in min-h-[3.25rem] text-center font-display text-lg font-bold leading-snug text-teal-900" aria-live="polite">
            {step === CTA ? "Proof, not promises." : beat.caption}
          </p>
          <div className="flex items-center gap-3">
            <div className="grid flex-1 grid-cols-3 gap-2">
              {chapters.map((c, i) => {
                const inChapter = beats.map((b, j) => [b, j] as const).filter(([b]) => b.chapter === c);
                const first = inChapter[0][1];
                const done = i < chapterIndex;
                const fill = done ? 1 : i === chapterIndex ? (step - first + 1) / inChapter.length : 0;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setStep(first)}
                    className="grid gap-1 text-left"
                    aria-label={`Jump to: ${c}`}
                  >
                    <span className="h-1 overflow-hidden rounded-full bg-teal-900/15">
                      <span className="block h-full rounded-full bg-amber-500 transition-all duration-500" style={{ width: `${fill * 100}%` }} />
                    </span>
                    <span className={`text-xs font-semibold ${i === chapterIndex ? "text-teal-900" : "text-muted"}`}>{c}</span>
                  </button>
                );
              })}
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
