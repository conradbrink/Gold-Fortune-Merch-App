"use client";

/** Print, or save as PDF from the print window. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-10 items-center rounded-md px-3 text-sm font-medium text-foreground ring-1 ring-foreground/15 hover:bg-muted print:hidden"
    >
      Print or save as PDF
    </button>
  );
}
