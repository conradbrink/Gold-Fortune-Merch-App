"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Opens the browser's print dialog, where the invoice can also be saved as PDF. */
export function PrintButton() {
  return (
    <Button size="sm" variant="outline" onClick={() => window.print()}>
      <Printer className="size-4" aria-hidden /> Print or save as PDF
    </Button>
  );
}
