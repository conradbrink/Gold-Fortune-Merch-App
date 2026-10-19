import { contactHref, founding, site } from "@/lib/site";

// The way in at the foot of the home page: the Founding pilot form, higher up
// the same page (#apply). The site is only for distributors, so there is no picker.
export function FoundingStart() {
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:flex sm:items-center sm:gap-6">
        <a
          href="#apply"
          className="flex min-h-12 items-center justify-center rounded-full bg-amber-500 px-7 py-3 text-base font-semibold text-teal-950 transition-[background-color,transform] duration-150 ease-out hover:bg-amber-400 active:scale-[0.97] sm:text-lg"
        >
          Start my free {founding.pilotDays}-day pilot
        </a>
        <a
          href={contactHref(`Hi, I'd like to know more about ${site.name}.`)}
          className="py-2 text-center text-sm font-semibold text-teal-100 underline-offset-4 hover:text-sand hover:underline sm:text-left"
        >
          Talk to us first
        </a>
      </div>
      <p className="text-sm text-teal-100">
        Only {founding.spots} founding spots. No card needed for the pilot.
      </p>
    </div>
  );
}
