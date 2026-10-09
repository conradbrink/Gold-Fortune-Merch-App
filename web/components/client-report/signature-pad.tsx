"use client";

import { useRef, useState } from "react";

/**
 * A box to sign in with a finger, a pen or a mouse. The strokes become SVG
 * path data in a 600 x 200 box ("M12 40L13 41…"), which is all the database
 * accepts: plain numbers, never markup.
 */
export const PAD_WIDTH = 600;
export const PAD_HEIGHT = 200;

export function SignaturePad({ onChange }: { onChange: (path: string) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const drawing = useRef(false);
  const [path, setPath] = useState("");

  function point(e: React.PointerEvent): string {
    const box = svg.current!.getBoundingClientRect();
    const x = Math.round(((e.clientX - box.left) / box.width) * PAD_WIDTH);
    const y = Math.round(((e.clientY - box.top) / box.height) * PAD_HEIGHT);
    return `${Math.max(0, Math.min(PAD_WIDTH, x))} ${Math.max(0, Math.min(PAD_HEIGHT, y))}`;
  }

  function update(next: string) {
    setPath(next);
    onChange(next);
  }

  return (
    <div className="space-y-2">
      <svg
        ref={svg}
        viewBox={`0 0 ${PAD_WIDTH} ${PAD_HEIGHT}`}
        role="img"
        aria-label="Signature box: sign with your finger or mouse"
        className="h-40 w-full touch-none rounded-lg bg-white ring-1 ring-foreground/15"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          update(`${path}M${point(e)}`);
        }}
        onPointerMove={(e) => {
          if (drawing.current) update(`${path}L${point(e)}`);
        }}
        onPointerUp={() => {
          drawing.current = false;
        }}
        onPointerCancel={() => {
          drawing.current = false;
        }}
      >
        <line x1="24" x2={PAD_WIDTH - 24} y1={PAD_HEIGHT - 40} y2={PAD_HEIGHT - 40} stroke="#c9d3d0" strokeWidth="2" />
        <path d={path} fill="none" stroke="#14211e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <button
        type="button"
        onClick={() => update("")}
        disabled={!path}
        className="text-sm text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50"
      >
        Clear and sign again
      </button>
    </div>
  );
}
