import type { LucideIcon } from "lucide-react";

// A moment from the staff app laid over a photo of someone at work, like the
// hero demo's notification cards: who it is, then the app's own words.
// "night" is the end-of-day screen, which is dark in the app too.
export function AppMoment({
  icon: Icon,
  who,
  title,
  body,
  night = false,
  className = "",
}: {
  icon: LucideIcon;
  who: string;
  title: string;
  body: string;
  night?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`flex items-start gap-3 rounded-xl p-3 shadow-xl shadow-teal-950/25 ring-1 ${
        night ? "bg-teal-950 text-sand ring-white/10" : "bg-white text-ink ring-black/5"
      } ${className}`}
    >
      <span
        className={`grid size-9 shrink-0 place-items-center rounded-lg ${
          night ? "bg-white/10 text-amber-500" : "bg-teal-900 text-amber-500"
        }`}
      >
        <Icon className="size-[18px]" strokeWidth={2.25} aria-hidden="true" />
      </span>
      <span className="grid min-w-0 gap-0.5 leading-snug">
        <span className={`text-xs font-medium ${night ? "text-teal-100/80" : "text-muted"}`}>{who}</span>
        <span className={`text-[15px] font-semibold ${night ? "text-sand" : "text-teal-900"}`}>{title}</span>
        <span className={`text-sm ${night ? "text-teal-100" : "text-ink"}`}>{body}</span>
      </span>
    </div>
  );
}
