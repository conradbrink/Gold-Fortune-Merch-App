"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { createClient } from "@/lib/supabase/client";
import { ACCEPTED_EXTENSIONS, parseSpreadsheet, type ParsedSheet } from "@/lib/import/parse";
import { fetchOrgId } from "@/lib/representatives";
import {
  actionable,
  buildDrafts,
  detectColumns,
  hasAmbiguousBarcode,
  importProducts,
  type ColumnMap,
  type ImportResult,
  type ProductDraft,
  type ProductRow,
} from "@/lib/import/products";

type Step = "file" | "review" | "done";
type Filter = "attention" | "new" | "updating" | "excluded" | "all";

const FIELDS: [keyof ColumnMap, string][] = [
  ["name", "Product name"],
  ["brand", "Brand"],
  ["category", "Category"],
  ["unit_barcode", "Unit barcode (on the item)"],
  ["shrink_barcode", "Shrink barcode (on the outer)"],
  ["units_per_shrink", "Units per shrink"],
  ["shrink_price_excl_vat", "Shrink price excl. VAT"],
  ["shrink_price_incl_vat", "Shrink price incl. VAT"],
  ["sku_code", "SKU code"],
];

/**
 * Import a price card.
 *
 * Same three steps as the stores importer — `file | review | done`, with
 * "importing" as a busy flag rather than a fourth step so the preview stays on
 * screen while it writes. The filters differ: the question here is not "will
 * this row be skipped" but "will this row overwrite something", so New and
 * Updating are the chips that matter.
 */
export function ImportProductsDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const supabase = createClient();

  const [step, setStep] = useState<Step>("file");
  const [fileName, setFileName] = useState("");
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [map, setMap] = useState<ColumnMap | null>(null);
  const [existing, setExisting] = useState<ProductRow[]>([]);
  const [drafts, setDrafts] = useState<ProductDraft[]>([]);
  const [filter, setFilter] = useState<Filter>("attention");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // Reopening the dialog must clear the previous run. The alternative is a
    // `key` at every call site.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStep("file");
    setFileName("");
    setSheet(null);
    setMap(null);
    setDrafts([]);
    setFilter("attention");
    setBusy(false);
    setProgress(0);
    setError(null);
    setResult(null);
    // The products already here are what every row is matched against, so they
    // are fetched fresh on open rather than passed in and possibly stale.
    (async () => {
      setOrgId(await fetchOrgId(supabase));
      const { data } = await supabase.from("products").select("*");
      setExisting((data ?? []) as ProductRow[]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Re-derive whenever the sheet or the mapping changes, so re-pointing a
  // column updates every row's action live.
  useEffect(() => {
    if (!sheet || !map) return;
    // `drafts` is editable after it is derived, so it has to be state rather
    // than a useMemo.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrafts(buildDrafts(sheet.rows, map, existing));
  }, [sheet, map, existing]);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    try {
      const parsed = await parseSpreadsheet(file);
      setFileName(file.name);
      setSheet(parsed);
      setMap(detectColumns(parsed.headers));
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  function patch(row: number, change: Partial<ProductDraft>) {
    setDrafts((prev) => prev.map((d) => (d.row === row ? { ...d, ...change } : d)));
  }

  const willWrite = actionable(drafts);
  const creating = willWrite.filter((d) => d.action === "create").length;
  const updating = willWrite.filter((d) => d.action === "update").length;
  const counts = {
    attention: drafts.filter((d) => d.issues.length > 0).length,
    new: drafts.filter((d) => d.include && d.action === "create").length,
    updating: drafts.filter((d) => d.include && d.action === "update").length,
    excluded: drafts.filter((d) => !d.include).length,
    all: drafts.length,
  };

  const shown = drafts.filter((d) => {
    if (filter === "attention") return d.issues.length > 0;
    if (filter === "new") return d.include && d.action === "create";
    if (filter === "updating") return d.include && d.action === "update";
    if (filter === "excluded") return !d.include;
    return true;
  });

  async function run() {
    if (!orgId) return;
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      const res = await importProducts(supabase, orgId, drafts, existing, (done) =>
        setProgress(done)
      );
      setResult(res);
      setStep("done");
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const ambiguous = sheet && map ? hasAmbiguousBarcode(sheet.headers, map) : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {step === "done" ? "Price card imported" : "Import a price card"}
          </DialogTitle>
        </DialogHeader>

        {error && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-sm text-destructive">
            {error}
          </p>
        )}

        {step === "file" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              A spreadsheet with one row per line. Nothing is written until you
              have seen what it will do.
            </p>
            <Input
              type="file"
              accept={ACCEPTED_EXTENSIONS}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </div>
        )}

        {step === "review" && sheet && map && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {fileName} · {drafts.length} row{drafts.length === 1 ? "" : "s"}
            </p>

            {ambiguous && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
                <p className="font-semibold">Which barcode is this?</p>
                <p className="mt-1 text-xs">
                  This sheet has a column called “Barcode” and neither barcode
                  field is mapped. Say which it is below — a rep scanning a shelf
                  reads the barcode on the single item, not the one on the outer
                  shrink, and guessing wrong means a scan that never matches.
                </p>
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              {FIELDS.map(([field, label]) => (
                <div key={field} className="space-y-1">
                  <Label className="text-xs">{label}</Label>
                  <NativeSelect
                    value={map[field] ?? ""}
                    onChange={(e) =>
                      setMap({ ...map, [field]: e.target.value || null })
                    }
                  >
                    <option value="">— not imported —</option>
                    {sheet.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">
                  Blank cells are left alone.
                </span>{" "}
                A column this sheet does not have keeps whatever is already
                stored, so a partial price card cannot wipe your brands.
              </p>
              <p className="mt-1">
                <span className="font-medium text-foreground">
                  Importing never reactivates a line.
                </span>{" "}
                Anything you switched off by hand stays off, even if it is still
                printed on the card.
              </p>
              <p className="mt-1">
                <span className="font-medium text-foreground">
                  Importing the same file twice changes nothing.
                </span>
              </p>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["attention", `Needs attention (${counts.attention})`],
                  ["new", `New (${counts.new})`],
                  ["updating", `Updating (${counts.updating})`],
                  ["excluded", `Excluded (${counts.excluded})`],
                  ["all", `All (${counts.all})`],
                ] as [Filter, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    filter === key
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-muted-foreground hover:bg-secondary/80"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <ul className="divide-y divide-border rounded-lg border border-border">
              {shown.length === 0 && (
                <li className="p-4 text-center text-sm text-muted-foreground">
                  Nothing in this group.
                </li>
              )}
              {shown.map((d) => (
                <li key={d.row} className="flex gap-3 p-3">
                  <input
                    type="checkbox"
                    className="mt-1 accent-primary"
                    checked={d.include}
                    // A conflict has no defined write, so "include it anyway"
                    // would be a button with nothing behind it.
                    disabled={d.action === "conflict"}
                    onChange={(e) => patch(d.row, { include: e.target.checked })}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {d.name ?? <em className="text-muted-foreground">no name</em>}
                      </span>
                      <ActionBadge action={d.action} changes={d.changes.length} />
                    </div>

                    {d.action === "update" && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        → updating “{d.matchedName}”, matched on {d.matchedOn}
                      </p>
                    )}

                    {d.changes.length > 0 && (
                      <p className="mt-1 text-xs text-foreground">
                        {d.changes.map((c, i) => (
                          <span key={c.field}>
                            {i > 0 && " · "}
                            {c.label}{" "}
                            <span className="text-muted-foreground">
                              {c.from ?? "—"}
                            </span>{" "}
                            → <span className="font-medium">{c.to}</span>
                          </span>
                        ))}
                      </p>
                    )}

                    {d.issues.length > 0 && (
                      <p className="mt-1 flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>{d.issues.join(" · ")}</span>
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {step === "done" && result && (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
            <p className="font-semibold text-emerald-800 dark:text-emerald-300">
              {result.created} created, {result.updated} updated.
            </p>
            <ul className="mt-2 space-y-0.5 text-xs text-emerald-800/90 dark:text-emerald-300/90">
              {result.unchanged > 0 && (
                <li>{result.unchanged} already matched what the sheet says.</li>
              )}
              {result.skipped > 0 && <li>{result.skipped} skipped.</li>}
            </ul>
          </div>
        )}

        <DialogFooter>
          {step === "review" && (
            <Button
              onClick={run}
              disabled={busy || willWrite.length === 0}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Upload className="h-4 w-4" />
              {busy
                ? `Importing ${progress}/${willWrite.length}…`
                : willWrite.length === 0
                  ? "Nothing to write"
                  : `Create ${creating} and update ${updating}`}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {step === "done" ? "Close" : "Cancel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActionBadge({ action, changes }: { action: string; changes: number }) {
  if (action === "create") {
    return <Badge className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">New</Badge>;
  }
  if (action === "conflict") {
    return <Badge className="bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300">Conflict</Badge>;
  }
  if (action === "no_key") {
    return <Badge className="bg-secondary text-muted-foreground">No barcode</Badge>;
  }
  if (changes === 0) {
    return <Badge className="bg-secondary text-muted-foreground">No change</Badge>;
  }
  return <Badge className="bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300">Updating</Badge>;
}

function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${className ?? ""}`}>
      {children}
    </span>
  );
}

export function ImportProductsButton({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4" />
        Import
      </Button>
      <ImportProductsDialog open={open} onOpenChange={setOpen} onImported={onImported} />
    </>
  );
}
