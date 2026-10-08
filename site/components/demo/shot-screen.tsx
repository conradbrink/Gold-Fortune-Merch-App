import Image from "next/image";
import { at } from "@/components/demo/phone-screens";

// Plays real app screenshots (rendered from the Flutter widgets with example
// data, 360×760 logical px) like the app: a tap ring on the real button, then
// the next screen fades in. Tap rects come from the renderer's manifest.

export type ShotTap = { x: number; y: number; w: number; h: number; at: number };
export type ShotFrame = { src: string; at: number };

const W = 360;
const H = 760;

export function ShotScreen({ frames, taps = [] }: { frames: ShotFrame[]; taps?: ShotTap[] }) {
  return (
    <div className="relative h-full w-full bg-[#0f3d3e]">
      {frames.map((f, i) => (
        <div key={f.src} className={`absolute inset-0 ${i ? "tk-fade" : ""}`} style={i ? at(f.at) : undefined}>
          <Image src={f.src} alt="" fill unoptimized className="object-cover object-top" priority={i === 0} />
        </div>
      ))}
      {taps.map((t) => (
        <span
          key={t.at}
          className="tk-ring pointer-events-none absolute size-12 rounded-full border-[3px] border-amber-500 bg-amber-500/25"
          style={{ left: `${((t.x + t.w / 2) / W) * 100}%`, top: `${((t.y + t.h / 2) / H) * 100}%`, ...at(t.at) }}
        />
      ))}
    </div>
  );
}
