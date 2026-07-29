import { cn } from "@/lib/utils";
import type { VisitStatus } from "@/lib/mock-data";

const statusConfig: Record<
  VisitStatus,
  { label: string; dot: string; text: string; bg: string }
> = {
  done: {
    label: "Done",
    dot: "bg-emerald-500",
    text: "text-emerald-700",
    bg: "bg-emerald-50",
  },
  upcoming: {
    label: "Upcoming",
    dot: "bg-amber-500",
    text: "text-amber-700",
    bg: "bg-amber-50",
  },
  missed: {
    label: "Missed",
    dot: "bg-red-500",
    text: "text-red-700",
    bg: "bg-red-50",
  },
  unplanned: {
    label: "Unplanned",
    dot: "bg-blue-500",
    text: "text-blue-700",
    bg: "bg-blue-50",
  },
};

export function StatusPill({ status }: { status: VisitStatus }) {
  const cfg = statusConfig[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-transparent px-3 py-1 text-xs font-semibold",
        cfg.bg,
        cfg.text
      )}
    >
      <span className={cn("h-2 w-2 rounded-full", cfg.dot)} />
      {cfg.label.toUpperCase()}
    </span>
  );
}

export const visitStatusColor: Record<VisitStatus, string> = {
  done: "bg-emerald-500",
  upcoming: "bg-amber-500",
  missed: "bg-red-500",
  unplanned: "bg-blue-500",
};
