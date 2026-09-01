"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, FileSpreadsheet, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { fetchOrgId } from "@/lib/representatives";
import {
  DEFAULT_ORG_SETTINGS,
  fetchOrgSettings,
  type OrgSettings,
} from "@/lib/org-settings";
import { ACCEPTED_EXTENSIONS, parseSpreadsheet, type ParsedSheet } from "@/lib/import/parse";
import { knownTowns } from "@/lib/import/towns";
import {
  buildDrafts,
  detectColumns,
  importStores,
  type ColumnMap,
  type ImportResult,
  type StoreDraft,
} from "@/lib/import/stores";

type Step = "file" | "review" | "done";
type Filter = "attention" | "included" | "excluded" | "all";

const SOURCE_LABEL: Record<string, string> = {
  name: "from name",
  address: "from address",
  city: "from city column",
};

/**
 * Bulk store import.
 *
 * The preview is the point of this dialog, not the file picker. The source
 * data is an accounting export: names are legal entities, the City column is
 * frequently a postal address, and a handful of rows are ledger accounts
 * rather than shops. Every one of those judgements is shown with its reason
 * and can be overridden before anything is written, because a store that
 * lands in the wrong town quietly routes a rep 200 km the wrong way.
 */
export function ImportStoresDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const supabase = createClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("file");
  const [fileName, setFileName] = useState("");
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [map, setMap] = useState<ColumnMap | null>(null);
  const [drafts, setDrafts] = useState<StoreDraft[]>([]);
  const [filter, setFilter] = useState<Filter>("attention");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [settings, setSettings] = useState<OrgSettings>(DEFAULT_ORG_SETTINGS);

  const towns = useMemo(() => knownTowns(), []);

  useEffect(() => {
    if (!open) return;
    // Reopening the dialog must clear the previous run. The alternative is a
    // `key` at every call site.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStep("file");
    setSheet(null);
    setMap(null);
    setDrafts([]);
    setError(null);
    setResult(null);
    setProgress(0);
    setFileName("");
    fetchOrgId(supabase).then(setOrgId).catch(() => setOrgId(null));
    fetchOrgSettings(supabase).then(setSettings).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Re-derive whenever the mapping changes: pointing `name` at a different
  // column changes the store name, the group and the town all at once.
  useEffect(() => {
    if (!sheet || !map) return;
    // `drafts` is editable after it is derived, so it has to be state rather
    // than a useMemo.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrafts(buildDrafts(sheet.rows, map));
  }, [sheet, map]);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    setFileName(file.name);
    try {
      const parsed = await parseSpreadsheet(file);
      setSheet(parsed);
      setMap(detectColumns(parsed.headers));
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function patch(row: number, change: Partial<StoreDraft>) {
    setDrafts((prev) =>
      prev.map((d) => (d.row === row ? { ...d, ...change } : d))
    );
  }

  const included = drafts.filter((d) => d.include);
  const attention = drafts.filter((d) => d.issues.length > 0);
  const noTown = included.filter((d) => !d.city);
  const newGroups = useMemo(() => {
    return [...new Set(included.map((d) => d.groupName).filter(Boolean))] as string[];
  }, [included]);

  const visible = drafts.filter((d) => {
    if (filter === "attention") return d.issues.length > 0;
    if (filter === "included") return d.include;
    if (filter === "excluded") return !d.include;
    return true;
  });

  async function runImport() {
    if (!orgId) {
      setError("Could not determine your organisation.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await importStores(
        supabase,
        orgId,
        drafts,
        settings.defaultVisitFrequency,
        (done) => setProgress(done)
      );
      setResult(r);
      setStep("done");
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Import stores</DialogTitle>
          <DialogDescription>
            {step === "file"
              ? "Excel or CSV. The file is read in your browser and never uploaded."
              : step === "review"
                ? "Check what will be created. Nothing is written until you confirm."
                : "Done."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {step === "file" && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={busy}
              className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center hover:bg-muted/40"
            >
              <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">
                {busy ? "Reading…" : "Choose a spreadsheet"}
              </span>
              <span className="text-xs text-muted-foreground">
                .xls, .xlsx or .csv — the first sheet is used
              </span>
            </button>
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPTED_EXTENSIONS}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                // Reset so re-picking the same file fires change again.
                e.target.value = "";
              }}
            />
            <p className="text-xs text-muted-foreground">
              Store names are read from a{" "}
              <span className="font-medium text-foreground">Parent:Child</span>{" "}
              column if there is one, so retail chains become store groups
              automatically. Towns are worked out from the store name and
              address, not just the city column.
            </p>
          </div>
        )}

        {step === "review" && sheet && map && (
          <div className="space-y-4">
            <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-3">
              {(
                [
                  ["name", "Store name"],
                  ["address", "Address"],
                  ["city", "City"],
                  ["phone", "Phone"],
                  ["state", "State / district"],
                  ["country", "Country"],
                  ["rep", "Rep (optional)"],
                ] as [keyof ColumnMap, string][]
              ).map(([field, label]) => (
                <div key={field} className="space-y-1">
                  <Label
                    htmlFor={`map-${field}`}
                    className="text-xs text-muted-foreground"
                  >
                    {label}
                  </Label>
                  <NativeSelect
                    id={`map-${field}`}
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

            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-foreground">
                {included.length} of {drafts.length} rows will be imported
              </span>
              {newGroups.length > 0 && (
                <Badge variant="secondary">
                  {newGroups.length} store group
                  {newGroups.length === 1 ? "" : "s"}: {newGroups.join(", ")}
                </Badge>
              )}
              {noTown.length > 0 && (
                <Badge variant="secondary">{noTown.length} with no town</Badge>
              )}
            </div>

            <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Coordinates are not set — this file has none. These stores will
              not geofence, and check-in distance will read as unknown rather
              than as zero, until locations are added. Visit frequency is set to{" "}
              {settings.defaultVisitFrequency}, which you can change per store
              or in bulk afterwards.
            </p>

            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["attention", `Needs attention (${attention.length})`],
                  ["included", `Will import (${included.length})`],
                  ["excluded", `Excluded (${drafts.length - included.length})`],
                  ["all", `All (${drafts.length})`],
                ] as [Filter, string][]
              ).map(([key, label]) => (
                <Button
                  key={key}
                  size="sm"
                  variant={filter === key ? "default" : "outline"}
                  onClick={() => setFilter(key)}
                >
                  {label}
                </Button>
              ))}
            </div>

            <div className="max-h-[38vh] overflow-y-auto rounded-lg border border-border">
              {visible.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Nothing here — which is good news.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {visible.map((d) => (
                    <li key={d.row} className="flex flex-wrap items-start gap-3 px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={d.include}
                        aria-label={`Import ${d.name}`}
                        className="mt-1 h-4 w-4 shrink-0 accent-primary"
                        onChange={(e) => patch(d.row, { include: e.target.checked })}
                      />
                      <div className="min-w-[200px] flex-1">
                        <p className="text-sm font-medium text-foreground">
                          {d.name || <span className="text-destructive">No name</span>}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {d.groupName ? `${d.groupName} · ` : ""}
                          {d.address ?? "no address"}
                        </p>
                        {d.issues.length > 0 && (
                          <p className="mt-0.5 flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400">
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                            {d.issues.join(" · ")}
                          </p>
                        )}
                      </div>

                      {/* Editable only where it is in doubt. A clean row's town
                          came from the store's own name and is not worth 215
                          dropdowns in the DOM to second-guess. */}
                      {d.issues.length > 0 ? (
                        <div className="w-40 shrink-0">
                          <NativeSelect
                            aria-label={`Town for ${d.name}`}
                            value={d.city ?? ""}
                            onChange={(e) =>
                              patch(d.row, {
                                city: e.target.value || null,
                                issues: d.issues.filter(
                                  (i) => !i.startsWith("No town")
                                ),
                              })
                            }
                          >
                            <option value="">— no town —</option>
                            {towns.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </NativeSelect>
                        </div>
                      ) : (
                        <div className="w-40 shrink-0 text-right">
                          <p className="text-sm text-foreground">{d.city}</p>
                          <p className="text-xs text-muted-foreground">
                            {SOURCE_LABEL[d.townSource ?? ""] ?? ""}
                          </p>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {step === "done" && result && (
          <div className="space-y-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-3">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Check className="h-4 w-4" />
              Imported {result.storesCreated} store
              {result.storesCreated === 1 ? "" : "s"}
              {result.groupsCreated > 0 &&
                ` and created ${result.groupsCreated} store group${result.groupsCreated === 1 ? "" : "s"}`}
              .
            </p>
            {result.assignmentsCreated > 0 && (
              <p className="text-xs text-muted-foreground">
                {result.assignmentsCreated} store
                {result.assignmentsCreated === 1 ? "" : "s"} assigned to a rep
                from the sheet.
              </p>
            )}
            {result.unmatchedReps.length > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                No rep matched these names, so those stores were left
                unassigned: {result.unmatchedReps.join(", ")}.
              </p>
            )}
            {result.skipped > 0 && (
              <p className="text-xs text-muted-foreground">
                {result.skipped} row{result.skipped === 1 ? "" : "s"} skipped.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {step === "review" && (
            <Button onClick={runImport} disabled={busy || included.length === 0 || !orgId}>
              {busy
                ? `Importing ${progress}/${included.length}…`
                : `Import ${included.length} store${included.length === 1 ? "" : "s"}`}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {step === "done" ? "Close" : "Cancel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The trigger, so the stores page only has to render one thing. */
export function ImportStoresButton({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* Visible at every width. The dead button this replaced was
          `hidden lg:inline-flex`, which cost nothing while it did nothing —
          but a control that actually works should not disappear on a laptop. */}
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => setOpen(true)}
      >
        <Upload className="h-4 w-4" />
        Import
      </Button>
      <ImportStoresDialog open={open} onOpenChange={setOpen} onImported={onImported} />
    </>
  );
}
