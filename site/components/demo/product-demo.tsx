"use client";

import {
  AlertTriangle,
  BatteryMedium,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Pause,
  Play,
  Signal,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { LogoMark } from "@/components/logo";
import { AndroidNav, at } from "@/components/demo/phone-screens";
import { ShotScreen } from "@/components/demo/shot-screen";
import { site } from "@/lib/site";

// The hero demo: one working day, team and office, in about 45 seconds.
// A clock moves through the day; each scene is one plain sentence. Team
// scenes show the worker's phone and what shows up on the owner's dashboard
// because of it. Office scenes show the whole dashboard window, then move in
// on the number the sentence is about.
// The phone plays real screenshots of the staff app (rendered from its
// Flutter widgets with example data). They were made for a merchandising
// company, so `Patch` covers the few retail words ("stores", "Store visit",
// "Take an order") in the screenshot's own colours. Dashboard windows are
// real screenshots, never cropped. The demo company priced in pula, so in
// o7-dashboard and o4-rep-performance each "P" was made an "R" (9 Oct 2026)
// by drawing R's leg in that letter's own colour and stroke. Owner cards say "Your dashboard", not a
// phone notification: that is where flags, photos and hours really appear.

const shot = (name: string) => `/demo/app/${name}.webp`;
const dash = (name: string) => `/demo/dash/${name}.webp`;

// Boxes on a dashboard screenshot, in its 2000×1250 layout (the files are
// 2560×1600): [x, y, width, height].
type Box = [x: number, y: number, w: number, h: number];

// A whole dashboard screenshot in a browser window. It holds still for a
// moment so the reader sees it is the real app, then moves in on `focus` (an
// on-screen move, so ease-in-out) and outlines `mark` in amber. `focus`
// defaults to `mark`.
function DashWindow({ url, src, mark, zoom, focus = mark }: { url: string; src: string; mark: Box; zoom: number; focus?: Box }) {
  const [x, y, w, h] = mark;
  const [fx, fy, fw, fh] = focus;
  // Where the window ends up: the mark centred, but never past the
  // screenshot's own edges (so no empty band shows at a side).
  const clamp = (v: number) => Math.min(0, Math.max(100 - 100 * zoom, v));
  const tx = clamp(50 - ((fx + fw / 2) / 2000) * 100 * zoom);
  const ty = clamp(50 - ((fy + fh / 2) / 1250) * 100 * zoom);
  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-2xl shadow-black/40 ring-1 ring-black/10">
      <div className="flex items-center gap-2 border-b border-line bg-[#eef0ee] px-3 py-2">
        <span className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
        </span>
        <span className="ml-1 flex-1 truncate rounded-md bg-white px-2 py-0.5 text-[10px] text-muted ring-1 ring-line">{url}</span>
      </div>
      <div className="relative aspect-[2000/1250] overflow-hidden bg-[#fafafa]">
        <div
          className="tk-push absolute inset-0 origin-top-left"
          style={{ ["--z" as string]: zoom, ["--tx" as string]: `${tx}%`, ["--ty" as string]: `${ty}%` }}
        >
          <Image src={src} alt="" fill unoptimized className="object-cover" />
          <span
            className="tk-drop absolute rounded-md ring-2 ring-amber-500"
            style={{
              left: `${(x / 2000) * 100}%`,
              top: `${(y / 1250) * 100}%`,
              width: `${(w / 2000) * 100}%`,
              height: `${(h / 1250) * 100}%`,
              ...at(2300),
            }}
          />
        </div>
      </div>
    </div>
  );
}

// A rectangle painted over a phone screenshot, in the screenshot's own
// colours, to change a word. Box and font size are percentages of the
// 360×760 screen, so it scales with the phone (an inline-size container).
function Patch({
  box,
  bg,
  children,
  className = "",
  style,
}: {
  box: [left: number, top: number, width: number, height: number];
  bg: string;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const [l, t, w, h] = box;
  return (
    <div
      className={`absolute flex items-center ${className}`}
      style={{ left: `${l}%`, top: `${t}%`, width: `${w}%`, height: `${h}%`, background: bg, ...style }}
    >
      {children}
    </div>
  );
}

const HEADER = "#103d3e";

// "3 stores scheduled" under the date, on the day screens.
const JobsToday = () => (
  <Patch box={[5, 17.9, 60, 3.3]} bg={HEADER} className="text-[3.7cqw] text-[#9eb4b6]">
    3 jobs today
  </Patch>
);
// "Store visit" in the title bar, on the job screens.
const JobTitle = () => (
  <Patch box={[19, 3.6, 70, 5.4]} bg={HEADER} className="text-[5.3cqw] font-medium text-white">
    Today&apos;s job
  </Patch>
);

// The Android camera the app opens, then the checklist with the photo in it.
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

type Tone = "teal" | "green" | "flag";

type Beat = {
  /** The clock: a time, or words for later on. */
  when: string;
  /** The scene in one plain sentence (two lines at most on a phone). */
  say: string;
  /** "team" scenes are on a worker's phone; "office" scenes are the dashboard. */
  part: "team" | "office";
  ms: number;
  /** Whose phone it is, when it is not Thabo's. */
  who?: string;
  phone?: () => ReactNode;
  /** The phone scene's images, loaded ahead so a scene change never waits on one. */
  images?: string[];
  window?: { url: string; src: string; mark: Box; zoom: number; focus?: Box };
  /** Office scenes: what the screen tells you, under the window. */
  points?: string[];
  /** What shows up on the owner's dashboard because of this scene. */
  card?: { icon: ReactNode; tone: Tone; title: string; body: string; photo?: string; delay: number };
};

const beats: Beat[] = [
  {
    when: "06:58",
    say: "Thabo starts his day with one tap.",
    part: "team",
    ms: 4600,
    images: [shot("01-day-before"), shot("02-day-started")],
    phone: () => (
      <>
        <ShotScreen
          frames={[
            { src: shot("01-day-before"), at: 0 },
            { src: shot("02-day-started"), at: 1300 },
          ]}
          taps={[{ x: 33, y: 266, w: 294, h: 48, at: 900 }]}
        />
        <JobsToday />
        {/* Time worked: just started, not the screenshot's 33 minutes. */}
        <Patch box={[16, 37.4, 27, 3.6]} bg="#ffffff" className="tk-fade justify-center text-[4.6cqw] font-bold text-ink" style={at(1300)}>
          0m
        </Patch>
      </>
    ),
    card: { icon: <Clock className="size-4" />, tone: "teal", title: "Thabo started work", body: "06:58 · 3 jobs today", delay: 1900 },
  },
  {
    when: "07:31",
    say: "He checks in when he gets to the first job.",
    part: "team",
    ms: 4600,
    images: [shot("03-site-before-checkin"), shot("04-site-checked-in")],
    phone: () => (
      <>
        <ShotScreen
          frames={[
            { src: shot("03-site-before-checkin"), at: 0 },
            { src: shot("04-site-checked-in"), at: 1300 },
          ]}
          taps={[{ x: 16, y: 309, w: 328, h: 52, at: 900 }]}
        />
        <JobTitle />
        {/* "Take an order" is a sales feature; this is a cleaning job. */}
        <Patch box={[3, 56, 94, 7.4]} bg="#f6f8fa" className="tk-fade" style={at(1300)} />
        <Patch box={[0, 93.4, 100, 6.6]} bg="#10b982" className="tk-fade pl-[6.8%] text-[3.9cqw] text-white" style={at(1300)}>
          Checked in (18m from site).
        </Patch>
      </>
    ),
    card: { icon: <MapPin className="size-4" />, tone: "green", title: "Thabo is at Office block", body: "Checked in 18 m from the site", delay: 1900 },
  },
  {
    when: "07:44",
    say: "He takes the photos the checklist asks for.",
    part: "team",
    ms: 4600,
    phone: CameraThenForm,
    images: ["/demo/washroom.jpg", shot("05b-photo-taken")],
    card: { icon: <Camera className="size-4" />, tone: "teal", title: "New photos from Office block", body: "Bathrooms · 07:44", photo: "/demo/washroom.jpg", delay: 2100 },
  },
  {
    when: "09:15",
    say: "Sipho checks in 1.4 km from the job. Tickd flags it.",
    part: "team",
    who: "Sipho",
    ms: 4600,
    images: [shot("03-site-before-checkin")],
    phone: () => (
      <>
        <ShotScreen frames={[{ src: shot("03-site-before-checkin"), at: 0 }]} taps={[{ x: 16, y: 309, w: 328, h: 52, at: 900 }]} />
        <JobTitle />
      </>
    ),
    card: { icon: <AlertTriangle className="size-4" />, tone: "flag", title: "Off-site check-in", body: "Sipho · 1.4 km from Office block", delay: 1500 },
  },
  {
    when: "13:10",
    say: "A client asks for a price. You send the quote in a minute.",
    part: "office",
    ms: 4800,
    window: { url: "app.tickd.co.za/quotes/QT-317", src: dash("o1-quote"), mark: [1000, 622, 375, 112], focus: [475, 140, 1400, 620], zoom: 1.4 },
    points: ["Lines from your own price list", "VAT and totals worked out", "A yes turns it into the job"],
  },
  {
    when: "16:30",
    say: "Thabo clocks out. His hours are already counted.",
    part: "office",
    ms: 4800,
    window: { url: "app.tickd.co.za/tracking/thabo", src: dash("d2-day-history"), mark: [1184, 250, 766, 138], zoom: 2 },
    card: { icon: <Check className="size-4" strokeWidth={3} />, tone: "green", title: "Thabo finished work", body: "8 h 22 m today · 38 km driven", delay: 300 },
    points: ["Hours from clock-in to clock-out", "Kilometres driven, along the roads"],
  },
  {
    when: "Next morning",
    say: "Every morning, the whole business on one screen.",
    part: "office",
    ms: 4800,
    window: { url: "app.tickd.co.za", src: dash("o7-dashboard"), mark: [400, 306, 923, 194], zoom: 1.85 },
    points: ["Money in, and money owed to you", "Jobs that need you today", "Each person against their target"],
  },
  {
    when: "Month end",
    say: "A report on every person, ready for their review.",
    part: "office",
    ms: 4800,
    window: { url: "app.tickd.co.za/reports/staff", src: dash("o4-rep-performance"), mark: [632, 344, 1086, 510], zoom: 1.6 },
    points: ["Jobs done against jobs planned", "Sites visited, and sites missed", "A score out of 100, ready to print"],
  },
  {
    when: "Month end",
    say: "See who has paid, and who still owes you.",
    part: "office",
    ms: 4800,
    window: { url: "app.tickd.co.za/invoices", src: dash("d6-invoices-list"), mark: [922, 243, 1028, 114], zoom: 1.75 },
    points: ["Paid, part paid and overdue", "What each client still owes", "Export it for your bookkeeper"],
  },
];

const tones: Record<Tone, string> = {
  teal: "bg-teal-50 text-teal-800",
  green: "bg-[#e3f4e8] text-[#14633a]",
  flag: "bg-amber-100 text-flag",
};

// What the owner sees on their dashboard, as it happens.
function DashCard({ card }: { card: NonNullable<Beat["card"]> }) {
  return (
    <div
      className={`tk-drop flex items-center gap-3 rounded-2xl bg-white p-3 shadow-xl shadow-black/30 ${
        card.tone === "flag" ? "ring-2 ring-flag/60" : "ring-1 ring-black/5"
      }`}
      style={at(card.delay)}
    >
      <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${tones[card.tone]}`}>{card.icon}</span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-muted">
          <span className="size-1.5 rounded-full bg-[#10b982]" />
          Your dashboard · just now
        </span>
        <span className="truncate text-[15px] font-bold leading-tight text-ink">{card.title}</span>
        <span className="truncate text-[13px] leading-tight text-muted">{card.body}</span>
      </span>
      {card.photo && (
        <span className="relative size-11 shrink-0 overflow-hidden rounded-lg">
          <Image src={card.photo} alt="" fill unoptimized className="object-cover" />
        </span>
      )}
    </div>
  );
}

// Android status bar drawn over the screenshot's header inset.
function PhoneStatus({ time }: { time: string }) {
  return (
    <div className="absolute inset-x-0 top-0 flex h-[3.2%] items-center justify-between px-4 text-[9px] font-semibold text-white">
      <span className="tabular-nums">{time}</span>
      <span className="absolute left-1/2 top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#1b1d1f]" />
      <span className="flex items-center gap-1">
        <Signal className="size-3" />
        <BatteryMedium className="size-3.5" />
      </span>
    </div>
  );
}

// Each beat's images, so the next beat's can load while this one plays.
const beatImages: string[][] = beats.map((b) => (b.window ? [b.window.src] : (b.images ?? [])));

// The scene whose phone screen is on show at scene `i`: its own, or the last
// one before it (the phone holds its screen through dashboard scenes).
const phoneAt = (i: number) => {
  for (let j = Math.min(i, beats.length - 1); j >= 0; j--) if (beats[j].phone) return j;
  return 0;
};

const phoneScenes = beats.flatMap((b, i) => (b.phone ? [i] : []));

const CTA = beats.length;
const END_MS = 4500;
const END_LINE = "Your whole team and your whole business, in one place.";
const teamCount = beats.filter((b) => b.part === "team").length;

export function ProductDemo() {
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [visible, setVisible] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);

  // Swipe (or drag with a mouse) left for the next scene, right for the one before.
  const go = (d: number) => setStep((s) => (s + d + beats.length + 1) % (beats.length + 1));
  const onSwipeEnd = (x: number, y: number) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = x - start.x;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(y - start.y) * 1.5) go(dx < 0 ? 1 : -1);
  };

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
      // Decode now, not when the scene mounts: an undecoded image paints blank.
      img.decode?.().catch(() => {});
    }
  }, [step, visible]);

  const playing = !paused && !reduced && visible;
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setStep((s) => (s + 1) % (beats.length + 1)), step === CTA ? END_MS : beats[step].ms);
    return () => clearTimeout(t);
  }, [step, playing]);

  // What is on screen: the first scene when motion is reduced, whatever `step`
  // says. Everything below reads this, never `step`.
  const shown = reduced ? 0 : step;
  const end = shown === CTA;
  const beat = beats[Math.min(shown, beats.length - 1)];
  const office = !!beat.window && !end;
  // The phone keeps its last screen while a dashboard scene plays.
  const phoneIdx = phoneAt(shown);
  const who = beats[phoneIdx].who ?? "Thabo";
  // Every phone screen is mounted once and stays mounted, stacked: the one on
  // show on top, the one before it just under. A scene change never mounts an
  // image, so the phone can never show an empty screen. The new screen goes
  // to "reset" (its animations off, itself hidden) for one frame, then to
  // "play", which fades it in over the old one and replays its taps from the
  // start. (Stored with the set-state-while-rendering pattern, so the order is
  // right on the first paint.)
  const [screens, setScreens] = useState({ now: phoneIdx, before: phoneIdx, state: "first" });
  if (screens.now !== phoneIdx) setScreens({ now: phoneIdx, before: screens.now, state: "reset" });
  useEffect(() => {
    if (screens.state !== "reset") return;
    // Two frames, so the browser paints the reset before the replay starts.
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => setScreens((v) => (v.state === "reset" ? { ...v, state: "play" } : v)));
    });
    return () => cancelAnimationFrame(id);
  }, [screens]);

  return (
    <figure ref={ref} className="mx-auto grid w-full max-w-[30rem] gap-4">
      <div
        className="relative h-[39rem] touch-pan-y select-none overflow-hidden rounded-[2rem] bg-teal-950 ring-1 ring-inset ring-white/10 [clip-path:inset(0_round_2rem)]"
        onPointerDown={(e) => (swipe.current = { x: e.clientX, y: e.clientY })}
        onPointerUp={(e) => onSwipeEnd(e.clientX, e.clientY)}
        onPointerCancel={() => (swipe.current = null)}
        onDragStart={(e) => e.preventDefault()}
      >
        {/* backdrop (the frame's clip-path keeps the blurred glows inside the
            rounded corners; Safari lets blurred and moving layers escape a
            plain overflow-hidden + border-radius) */}
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.15]"
          style={{ backgroundImage: "radial-gradient(#dcebea 1px, transparent 1px)", backgroundSize: "18px 18px" }}
        />
        <div aria-hidden="true" className="absolute -right-16 -top-16 size-64 rounded-full bg-amber-500/25 blur-3xl" />
        <div aria-hidden="true" className="absolute -bottom-20 -left-10 size-72 rounded-full bg-teal-700/50 blur-3xl" />

        {/* One column, top to bottom: the sentence, the dashboard card, then
            the phone or the dashboard window. Even gaps; nothing overlaps. */}
        {!end && (
          <div className="relative z-10 flex h-full flex-col gap-4 px-5 pt-5" aria-hidden="true">
            <div key={`say-${shown}`} className="grid min-h-[5.25rem] content-start gap-1.5">
              <span className="tk-in flex items-center gap-2 text-sm font-semibold">
                <Clock className="size-4 text-amber-500" />
                <span className="tabular-nums text-amber-500">{beat.when}</span>
                <span className="text-teal-100/70">· {beat.part === "team" ? "Your team" : "Your office"}</span>
              </span>
              <p className="tk-in font-display text-xl font-bold leading-snug text-balance text-sand sm:text-2xl" style={at(80)}>
                {beat.say}
              </p>
            </div>

            {beat.card && (
              <div key={`card-${shown}`}>
                <DashCard card={beat.card} />
              </div>
            )}

            <div className="relative min-h-0 flex-1">
              {/* the dashboard window */}
              <div
                className={`absolute inset-x-0 top-0 transition-[opacity,translate] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] ${
                  office ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0"
                }`}
              >
                {beat.window && <DashWindow key={shown} {...beat.window} />}
                {office && beat.points && (
                  <ul key={`points-${shown}`} className="mt-4 grid gap-2">
                    {beat.points.map((pt, i) => (
                      <li
                        key={pt}
                        className="tk-from-left flex items-center gap-3 rounded-2xl bg-white/10 px-3.5 py-2.5 text-sm font-semibold leading-snug text-sand ring-1 ring-white/10 sm:px-4 sm:py-3 sm:text-[15px]"
                        style={at(600 + i * 220)}
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

              {/* the worker's phone, running off the bottom edge */}
              <div
                className={`absolute left-1/2 top-0 w-[14rem] -translate-x-1/2 transition-[opacity,translate] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] ${
                  office ? "pointer-events-none translate-y-24 opacity-0" : "translate-y-0"
                }`}
              >
                <p className="mb-2 text-center text-xs font-semibold text-teal-100/80">{who}&apos;s phone</p>
                <div className="rounded-[2.2rem] bg-[#1b1d1f] p-2 shadow-2xl shadow-black/50 ring-1 ring-white/10">
                  <div className="relative overflow-hidden rounded-[1.8rem] bg-[#f5f6f7]">
                    <div className="relative aspect-[360/760] overflow-hidden [container-type:inline-size]">
                      {phoneScenes.map((i) => {
                        const Screen = beats[i].phone!;
                        return (
                          <div
                            key={i}
                            className="tk-screen absolute inset-0"
                            data-state={i === screens.now ? screens.state : "keep"}
                            style={{ zIndex: i === screens.now ? 3 : i === screens.before ? 2 : 1 }}
                          >
                            <Screen />
                          </div>
                        );
                      })}
                      <PhoneStatus time={beat.when.includes(":") && !office ? beat.when : "09:15"} />
                    </div>
                    <AndroidNav />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* end card */}
        {end && (
          <div className="absolute inset-0 z-40 grid place-items-center p-8 text-center">
            <div className="grid justify-items-center gap-4">
              <span className="tk-pop">
                <LogoMark className="size-20" inverted />
              </span>
              <p className="tk-in font-display text-3xl font-extrabold leading-tight text-balance text-sand" style={at(200)}>
                {END_LINE}
              </p>
              <a
                href={site.signupUrl}
                className="tk-in rounded-full bg-amber-500 px-5 py-3 font-semibold text-teal-950 transition-[background-color,transform] duration-150 ease-out hover:bg-amber-400 active:scale-[0.97]"
                style={at(450)}
              >
                Try it free for {site.trialDays} days
              </a>
            </div>
          </div>
        )}
      </div>

      {reduced ? (
        <figcaption>
          <ol className="grid gap-2 text-sm">
            {beats.map((b) => (
              <li key={b.say} className="grid grid-cols-[6.5rem_1fr] gap-2">
                <span className="font-semibold tabular-nums text-teal-700">{b.when}</span>
                <span className="text-ink">{b.say}</span>
              </li>
            ))}
          </ol>
        </figcaption>
      ) : (
        <figcaption className="grid gap-2">
          {/* For screen readers: the scene in words. */}
          <p className="sr-only" aria-live="polite">
            {end ? END_LINE : `${beat.when}. ${beat.say}${beat.card ? ` On your dashboard: ${beat.card.title}, ${beat.card.body}.` : ""}`}
          </p>
          <div className="flex items-center gap-3">
            <div className="grid flex-1 gap-1.5" style={{ gridTemplateColumns: `repeat(${beats.length}, minmax(0, 1fr))` }}>
              {beats.map((b, i) => (
                <button key={b.say} type="button" onClick={() => setStep(i)} className="py-1.5" aria-label={`Play from ${b.when}: ${b.say}`} title={b.say}>
                  <span className="block h-1 overflow-hidden rounded-full bg-teal-900/15">
                    {/* The scene playing fills over its own length (constant, so linear). */}
                    <span
                      key={i === shown ? `run-${shown}` : "still"}
                      className={`block h-full w-full origin-left rounded-full bg-amber-500 ${i === shown && !end ? "tk-grow" : ""}`}
                      style={
                        i === shown && !end
                          ? { animationDuration: `${b.ms}ms`, animationTimingFunction: "linear", animationPlayState: playing ? "running" : "paused" }
                          : { transform: `scaleX(${i < shown || end ? 1 : 0})` }
                      }
                    />
                  </span>
                </button>
              ))}
              <span className="text-xs font-semibold text-muted" style={{ gridColumn: `span ${teamCount}` }}>
                Your team
              </span>
              <span className="text-xs font-semibold text-muted" style={{ gridColumn: `span ${beats.length - teamCount}` }}>
                Your office
              </span>
            </div>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous scene"
              className="grid size-8 shrink-0 place-items-center rounded-full text-teal-800 ring-1 ring-line hover:bg-white"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Next scene"
              className="grid size-8 shrink-0 place-items-center rounded-full text-teal-800 ring-1 ring-line hover:bg-white"
            >
              <ChevronRight className="size-4" />
            </button>
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
