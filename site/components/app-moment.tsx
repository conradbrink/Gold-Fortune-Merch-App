import type { LucideIcon } from "lucide-react";

// A moment from the staff app laid over a photo of someone at work, like the
// hero demo's notification cards: who it is, then the app's own words.
export function AppMoment({ icon: Icon, who, title, body }: { icon: LucideIcon; who: string; title: string; body: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-white p-3 text-ink shadow-xl shadow-teal-950/25 ring-1 ring-black/5">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-teal-900 text-amber-500">
        <Icon className="size-[18px]" strokeWidth={2.25} aria-hidden="true" />
      </span>
      <span className="grid min-w-0 gap-0.5 leading-snug">
        <span className="text-xs font-medium text-muted">{who}</span>
        <span className="text-[15px] font-semibold text-teal-900">{title}</span>
        <span className="text-sm">{body}</span>
      </span>
    </div>
  );
}
