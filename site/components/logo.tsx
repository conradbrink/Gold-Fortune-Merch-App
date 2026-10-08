import { site } from "@/lib/site";

// The double tick: "seen and done". Kept in step with public/tickd-mark.svg.
export function LogoMark({ className = "size-8", inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="14" fill={inverted ? "#F7F7F2" : "#165455"} />
      <g transform="translate(4.5 0)" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="5.5">
        <path d="M11 34l8 8 17-19" stroke={inverted ? "#165455" : "#F7F7F2"} />
        <path d="M27 42l17-19M23 36l4 4" stroke="#F5A524" />
      </g>
    </svg>
  );
}

export function Logo({ inverted = false }: { inverted?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark inverted={inverted} />
      <span
        className={`font-display text-2xl font-extrabold tracking-tight ${
          inverted ? "text-sand" : "text-teal-900"
        }`}
      >
        {site.name}
      </span>
    </span>
  );
}
