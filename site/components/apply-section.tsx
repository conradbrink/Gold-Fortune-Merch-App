import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { SpotsText } from "@/components/founding-spots";
import { founding } from "@/lib/site";

// What the form gets them, in three lines.
const youGet = [
  "Every store visit, proven.",
  "Orders on the phone, straight to your warehouse.",
  "Set up for you, and your reps trained.",
];

/**
 * The form, `#apply`, with what they get in three lines: at the foot of the
 * main page, and straight after the video on /founding. `intro` says what
 * happens once they send it; `children` is the form.
 */
export function ApplySection({ intro, children }: { intro: string; children: ReactNode }) {
  return (
    <section id="apply" className="scroll-mt-28 px-4 pb-14 sm:px-6 sm:pb-16">
      <div className="tk-reveal mx-auto grid max-w-3xl gap-6 rounded-2xl bg-teal-900 p-6 text-sand sm:p-10">
        <div className="grid gap-3">
          <h2 className="font-display text-3xl font-extrabold leading-[1.1] tracking-tight text-balance sm:text-5xl">
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
          <p className="leading-relaxed text-teal-100 sm:text-lg">{intro}</p>
          <SpotsText className="text-sm font-semibold text-amber-500" />
        </div>
        {children}
      </div>
    </section>
  );
}
