"use client";

import { useEffect, useState } from "react";
import { Download, House, Plus, Table2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StepCard } from "@/components/setup/step-card";
import { ImportStoresDialog } from "@/components/stores/import-dialog";
import { createClient } from "@/lib/supabase/client";
import { useTerms } from "@/lib/use-company-config";
import { lower } from "@/lib/terms";
import { applyCandidates, geocodeBatch, GEOCODE_BATCH, isConfident } from "@/lib/geocode";
import type { StepProps } from "./types";

type Row = { key: number; name: string; address: string; town: string };
const blank = (): Row => ({ key: Date.now() + Math.random(), name: "", address: "", town: "" });

/**
 * The company's first places, three ways: its own address as the first one,
 * a few typed in, or a list pasted or uploaded through the existing import.
 * New places are put on the map from their address; one the lookup is not
 * sure of is left for the owner to check on the places page, never guessed.
 */
export function SitesStep({ org, setup, text, icon, onBack, onNext, reload }: StepProps) {
  const t = useTerms();
  const one = lower(t.site.one);
  const many = lower(t.site.many);
  const [existing, setExisting] = useState<{ id: string; name: string; placed: boolean }[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadExisting() {
    const { data } = await createClient()
      .from("stores")
      .select("id, name, lat")
      .order("created_at", { ascending: true })
      .limit(50);
    const list = ((data ?? []) as { id: string; name: string; lat: number | null }[]).map((s) => ({
      id: s.id,
      name: s.name,
      placed: s.lat !== null,
    }));
    setExisting(list);
    return list;
  }

  useEffect(() => {
    void (async () => {
      const list = await loadExisting();
      if (list.length === 0) setRows([blank()]);
    })();
    // Once, on opening the step.
  }, []);

  function fillBusinessAddress() {
    // An address typed on two or more lines usually ends with the town.
    const lines = (org.address ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
    const town = lines.length > 1 ? lines[lines.length - 1] : "";
    const address = (lines.length > 1 ? lines.slice(0, -1) : lines).join(", ");
    setRows((rs) => {
      const empty = rs.findIndex((r) => !r.name.trim() && !r.address.trim());
      const row = { ...(empty >= 0 ? rs[empty] : blank()), name: org.name, address, town };
      return empty >= 0 ? rs.map((r, i) => (i === empty ? row : r)) : [...rs, row];
    });
  }

  function downloadExample() {
    const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const address = (org.address ?? "").split("\n").map((l) => l.trim()).filter(Boolean).join(", ");
    const csv = `Name,Address,Town\n${cell(org.name)},${cell(address)},\n`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${many.replace(/\s+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function save() {
    setError(null);
    setNotice(null);
    const toAdd = rows.filter((r) => r.name.trim());
    if (toAdd.some((r) => !r.address.trim() || !r.town.trim())) {
      return setError(`Each ${one} needs an address and a town, so it can be found on the map.`);
    }
    if (toAdd.length === 0) return onNext();
    setBusy(true);
    const supabase = createClient();
    try {
      const { data, error: e } = await supabase
        .from("stores")
        .insert(
          toAdd.map((r) => ({
            org_id: org.id,
            name: r.name.trim(),
            address: r.address.trim(),
            city: r.town.trim(),
            visit_frequency: org.default_visit_frequency,
          }))
        )
        .select("id");
      if (e) throw new Error(e.message);
      const ids = ((data ?? []) as { id: string }[]).map((d) => d.id);
      let placed = 0;
      try {
        for (let i = 0; i < ids.length; i += GEOCODE_BATCH) {
          const found = await geocodeBatch(ids.slice(i, i + GEOCODE_BATCH));
          placed += await applyCandidates(supabase, found.filter(isConfident));
        }
      } catch {
        // Saved but not on the map yet: the places page offers the lookup.
      }
      setRows([]);
      await loadExisting();
      await reload();
      setBusy(false);
      if (placed === ids.length) return onNext();
      setNotice(
        `${ids.length - placed} of the ${ids.length} could not be placed on the map from the address. ` +
          `Check ${ids.length - placed === 1 ? "it" : "them"} on the ${t.site.many} page later; you can carry on now.`
      );
    } catch (e) {
      setBusy(false);
      setError(`Nothing was saved: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const setRow = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <StepCard
      icon={icon}
      title={text.title}
      subtitle={text.subtitle}
      time={text.time}
      onBack={onBack}
      onContinue={save}
      busy={busy}
      error={error}
    >
      <div className="space-y-5">
        {existing.length > 0 && (
          <div className="rounded-xl bg-secondary/60 p-4 text-sm">
            <p className="font-medium text-foreground">
              {setup.counts.sites} {setup.counts.sites === 1 ? one : many} so far
            </p>
            <p className="text-muted-foreground">
              {existing.slice(0, 6).map((s) => s.name).join(", ")}
              {existing.length > 6 ? "…" : ""}
            </p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <button
            type="button"
            onClick={fillBusinessAddress}
            disabled={!org.address}
            className="flex items-start gap-2 rounded-xl border border-border p-3 text-left text-sm hover:border-primary/40 disabled:opacity-50"
          >
            <House className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span>
              <span className="font-medium text-foreground">Use my business address</span>
              <span className="block text-xs text-muted-foreground">
                {org.address ? `As your first ${one}, to try things out.` : "Add your address in step 2 first."}
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setRows((rs) => [...rs, blank()])}
            className="flex items-start gap-2 rounded-xl border border-border p-3 text-left text-sm hover:border-primary/40"
          >
            <Plus className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span>
              <span className="font-medium text-foreground">Add a few by hand</span>
              <span className="block text-xs text-muted-foreground">A name, an address and a town each.</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setImporting(true)}
            className="flex items-start gap-2 rounded-xl border border-border p-3 text-left text-sm hover:border-primary/40"
          >
            <Table2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span>
              <span className="font-medium text-foreground">Paste or upload a list</span>
              <span className="block text-xs text-muted-foreground">From Excel, Google Sheets or a CSV file.</span>
            </span>
          </button>
        </div>

        {rows.length > 0 && (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.key} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,0.8fr)_auto]">
                <Input aria-label="Name" placeholder="Name" value={r.name} onChange={(e) => setRow(r.key, { name: e.target.value })} />
                <Input
                  aria-label="Address"
                  placeholder="Street address"
                  value={r.address}
                  onChange={(e) => setRow(r.key, { address: e.target.value })}
                />
                <Input aria-label="Town" placeholder="Town" value={r.town} onChange={(e) => setRow(r.key, { town: e.target.value })} />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove this line"
                  onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {notice && <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm">{notice}</p>}

        <button type="button" onClick={downloadExample} className="flex items-center gap-1 text-sm text-primary hover:underline">
          <Download className="size-4" aria-hidden /> Download an example list
        </button>
      </div>

      <ImportStoresDialog
        open={importing}
        onOpenChange={setImporting}
        onImported={() => {
          void loadExisting();
          void reload();
        }}
      />
    </StepCard>
  );
}
