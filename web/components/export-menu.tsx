"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, FileText, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { exportSheet, type ExportFormat, type ExportSheet } from "@/lib/export";

/**
 * One thing this page can export, in three formats.
 *
 * `build` may be async because not every export is already on screen. The Form
 * tab's per-response export is thousands of rows that the page deliberately
 * does not load until somebody asks for them, so building its sheet means
 * going to the database — and the menu has to be able to wait for that without
 * every other call site growing a promise it does not need.
 */
export type ExportVariant = {
  /**
   * Section heading, when there is more than one thing to export. Omitted for
   * a single variant: a lone "Export" heading above three formats is furniture.
   */
  label?: string;
  build: () => ExportSheet | null | Promise<ExportSheet | null>;
};

type ExportMenuProps = {
  disabled?: boolean;
  label?: string;
} & (
  | { build: ExportVariant["build"]; variants?: undefined }
  | { variants: ExportVariant[]; build?: undefined }
);

const FORMATS: { format: ExportFormat; label: string; Icon: typeof Table2 }[] = [
  { format: "xlsx", label: "Excel (.xlsx)", Icon: FileSpreadsheet },
  { format: "pdf", label: "PDF — for printing", Icon: FileText },
  { format: "csv", label: "CSV", Icon: Table2 },
];

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
 *
 * Pass `variants` instead of `build` when a page has two honest answers to
 * "export this" — the Form tab has every response and a summary of them — and
 * each gets its own labelled group of the same three formats.
 */
export function ExportMenu({
  build,
  variants,
  disabled = false,
  label = "Export",
}: ExportMenuProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A single `build` is a one-variant menu, so there is one code path below
  // rather than a branch that renders the items twice. The union above makes
  // "neither" unrepresentable to the compiler; the `undefined` check is for
  // the caller who spreads props through an `any` and defeats it.
  const groups: ExportVariant[] =
    variants ?? (build === undefined ? [] : [{ build }]);

  async function run(variant: ExportVariant, format: ExportFormat) {
    setError(null);
    // Set before building, not after: an async `build` is a database read, and
    // the button has to say so while it is out or the click looks ignored.
    setBusy(true);
    try {
      const sheet = await variant.build();
      if (!sheet || sheet.rows.length === 0) {
        setError("There is nothing to export.");
        return;
      }
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
          {groups.map((variant, i) => (
            <DropdownMenuGroup key={variant.label ?? i}>
              {i > 0 && <DropdownMenuSeparator />}
              {variant.label && (
                <DropdownMenuLabel>{variant.label}</DropdownMenuLabel>
              )}
              {FORMATS.map(({ format, label: formatLabel, Icon }) => (
                <DropdownMenuItem
                  key={format}
                  onClick={() => void run(variant, format)}
                >
                  <Icon className="mr-2 h-4 w-4" />
                  {formatLabel}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
