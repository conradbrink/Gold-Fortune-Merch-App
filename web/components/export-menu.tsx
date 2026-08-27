"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, FileText, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { exportSheet, type ExportFormat, type ExportSheet } from "@/lib/export";

/**
 * Export this page's table as CSV, Excel or PDF.
 *
 * `build` is a function rather than a value because the sheet is whatever the
 * page is showing *now* — the filters, the date range, the rows after
 * filtering. Passing the sheet itself would rebuild it on every keystroke in a
 * filter box, and export whatever it happened to hold when the menu opened.
 *
 * Returning `null` from `build` means there is nothing to export; the menu says
 * so rather than handing over an empty file that looks like an answer.
 */
export function ExportMenu({
  build,
  disabled = false,
  label = "Export",
}: {
  build: () => ExportSheet | null;
  disabled?: boolean;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(format: ExportFormat) {
    setError(null);
    const sheet = build();
    if (!sheet || sheet.rows.length === 0) {
      setError("There is nothing to export.");
      return;
    }
    setBusy(true);
    try {
      await exportSheet(sheet, format);
    } catch (e) {
      // The PDF and Excel writers are dynamic imports, so a failure here is
      // usually the chunk not loading rather than the data being wrong. Either
      // way, silence would look like a browser that ignored the click.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-destructive">{error}</span>}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button className="gap-1.5" disabled={disabled || busy}>
              <Download className="h-4 w-4" />
              {busy ? "Preparing…" : label}
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => void run("xlsx")}>
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Excel (.xlsx)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void run("pdf")}>
            <FileText className="mr-2 h-4 w-4" />
            PDF — for printing
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void run("csv")}>
            <Table2 className="mr-2 h-4 w-4" />
            CSV
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
