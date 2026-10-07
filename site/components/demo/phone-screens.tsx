import type { CSSProperties } from "react";

// Shared bits for the product demo's phone.
export const at = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

// Android's three-button navigation bar, under the app screen.
export function AndroidNav() {
  return (
    <div className="flex items-center justify-center gap-14 bg-[#f5f6f7] py-2 text-ink/60">
      <span className="size-0 border-y-[5px] border-r-[8px] border-y-transparent border-r-current" />
      <span className="size-3 rounded-full border-2 border-current" />
      <span className="size-2.5 rounded-[2px] border-2 border-current" />
    </div>
  );
}
