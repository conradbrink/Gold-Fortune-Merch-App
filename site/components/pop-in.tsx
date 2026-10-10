"use client";

import { useEffect, useRef, type ReactNode } from "react";

// A notification arriving: the card is in place without JavaScript (and for
// anyone who asked for less motion); with it, the card waits out of sight and
// rises in once, as soon as a quarter of it is on screen (early, so a
// quick scroll on a slow phone still catches it arriving). The state lives on
// a data attribute (CSS in globals.css), so React never re-renders for it.
export function PopIn({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.dataset.pop = "wait";
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        el.dataset.pop = "in";
        io.disconnect();
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={`tk-pop-note ${className}`}>
      {children}
    </div>
  );
}
