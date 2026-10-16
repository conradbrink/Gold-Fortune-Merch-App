"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExportMenu } from "@/components/export-menu";
import { Button } from "@/components/ui/button";
import { DetailHeader, ListTools, TilePicker, TopCard, type Tile } from "@/components/dashboard/detail-page";
import { storeHref } from "@/lib/dashboard-links";
import { localDay } from "@/lib/dashboard-numbers";
import type { ExportSheet } from "@/lib/export";
import {
  SORTED_DAYS,
  damagedWhat,
  fetchDamages,
  setDamageStatus,
  type DamageGroup,
  type DamageReport,
} from "@/lib/damages";
import { can } from "@/lib/permissions";
import { dayLabel } from "@/lib/store-reorder";
import { createClient } from "@/lib/supabase/client";
import { count, lower } from "@/lib/terms";
import { useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { usePermissions } from "@/lib/use-permissions";
import { useStoreGroupFilter } from "@/lib/use-store-group-filter";
import { StoreGroupChip, StoreGroupPicker } from "@/components/dashboard/store-group-picker";

/**
 * "2026-10-15T09:12:00Z" as "15 Oct" in the company's time, with the year when
 * it is not this year: an open report can be any age, and one from last year
 * must not read as this week's.
 */
function dayOf(at: string, zone: string): string {
  return dayLabel(localDay(zone, new Date(at)), localDay(zone));
}

/**
 * Damaged stock the reps found at stores, with photos (owner, 15 Oct 2026:
 * "A list for you, mark sorted"). Open ones first; mark each sorted once it is
 * replaced or credited.
 */
export default function DamagedStockPage() {
  const t = useTerms();
  const config = useCompanyConfig();
  const permissions = usePermissions();
  // The same three as `damage_reports_update` (20261015300000).
  const canSort =
    permissions !== null &&
    (can(permissions, "sales_coverage") || can(permissions, "insights") || can(permissions, "warehouse"));
  const zone = config?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [rows, setRows] = useState<DamageReport[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  /** The reports themselves; `loading` below also waits for a store group a link asked for. */
  const [loadingRows, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<DamageGroup>("open");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  /** Marking one report failed: said above the list, which stays. */
  const [markError, setMarkError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let stale = false;
    const supabase = createClient();
    fetchDamages(supabase)
      .then(async (damages) => {
        const ids = [
          ...new Set(damages.flatMap((d) => [d.rep_id, d.sorted_by]).filter((id): id is string => id !== null)),
        ];
        const { data } = ids.length === 0 ? { data: [] } : await supabase.from("profiles").select("id, full_name").in("id", ids);
        if (stale) return;
        setRows(damages);
        setNames(Object.fromEntries(((data ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name ?? ""])));
        setError(null);
      })
      .catch((e: unknown) => {
        if (!stale) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [attempt]);

  const nameOf = (id: string | null) => (id ? names[id] || `Unnamed ${lower(t.staff.one)}` : "");
  /** One store group's reports, or every report: what the tiles and the list count. */
  const storeGroup = useStoreGroupFilter(rows, t, { key: "store_id" });
  const inStoreGroup = storeGroup.rows;
  const loading = loadingRows || storeGroup.loading;
  const counts = useMemo(
    () => ({
      open: inStoreGroup.filter((r) => r.status === "open").length,
      sorted: inStoreGroup.filter((r) => r.status === "sorted").length,
    }),
    [inStoreGroup]
  );
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return inStoreGroup.filter(
      (r) =>
        r.status === group &&
        (!q ||
          r.store_name.toLowerCase().includes(q) ||
          damagedWhat(r).toLowerCase().includes(q) ||
          (r.city ?? "").toLowerCase().includes(q))
    );
  }, [inStoreGroup, group, search]);

  async function mark(r: DamageReport, status: DamageGroup) {
    setBusy(r.id);
    setMarkError(null);
    try {
      const stamped = await setDamageStatus(createClient(), r.id, status);
      // That one row changes; the rest of the list, and its photo links, stay.
      setRows((all) => all.map((x) => (x.id === r.id ? { ...x, ...stamped } : x)));
      const who = stamped.sorted_by;
      if (who && !(who in names)) {
        const { data } = await createClient().from("profiles").select("id, full_name").eq("id", who).maybeSingle();
        if (data) setNames((n) => ({ ...n, [who]: (data as { full_name: string | null }).full_name ?? "" }));
      }
    } catch (e) {
      setMarkError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function buildSheet(): ExportSheet {
    return {
      title: group === "open" ? "Damaged stock to sort" : "Damaged stock sorted",
      context: [
        group === "open" ? "Reported and not sorted yet." : `Sorted in the last ${SORTED_DAYS} days.`,
        ...storeGroup.context,
        ...(search.trim() ? [`Matching "${search.trim()}"`] : []),
      ],
      filename: "damaged-stock",
      columns: [
        { header: "Reported", key: "day" },
        { header: t.site.one, key: "site" },
        { header: "Town", key: "town" },
        { header: "What", key: "what" },
        { header: "How many", key: "qty", numeric: true },
        { header: "What's wrong", key: "problem" },
        { header: "Reported by", key: "by" },
        { header: "Photo", key: "photo" },
        ...(group === "sorted" ? [{ header: "Sorted", key: "sorted" }] : []),
      ],
      rows: shown.map((r) => ({
        day: dayOf(r.created_at, zone),
        site: r.store_name,
        town: r.city ?? "",
        what: damagedWhat(r),
        qty: r.qty,
        problem: r.problem ?? "",
        by: nameOf(r.rep_id),
        photo: r.photo_url ? "Yes" : "No",
        sorted: r.sorted_at ? `${dayOf(r.sorted_at, zone)}, ${nameOf(r.sorted_by)}` : "",
      })),
    };
  }

  const tiles: Tile[] = [
    { id: "open", label: "To sort", value: counts.open, tone: counts.open > 0 ? "warn" : "good" },
    { id: "sorted", label: `Sorted, last ${SORTED_DAYS} days`, value: counts.sorted },
  ];

  return (
    <div className="space-y-4">
      <DetailHeader
        title="Damaged stock"
        subtitle={`Damaged stock your ${lower(t.staff.many)} found at ${lower(t.site.many)}, with their photos. Mark each one sorted once it has been replaced or credited.`}
        action={<ExportMenu build={buildSheet} disabled={loading || shown.length === 0} />}
      />

      <StoreGroupPicker filter={storeGroup} t={t} ready={!loading && !error} />

      <TopCard>
        <TilePicker
          tiles={tiles}
          active={group}
          onChoose={(id) => id && setGroup(id as DamageGroup)}
          label="Which reports"
          loading={loading}
        />
      </TopCard>

      <ListTools search={search} onSearch={setSearch} placeholder={`Find a ${lower(t.site.one)} or product`}>
        <StoreGroupChip filter={storeGroup} />
      </ListTools>

      {markError && (
        <p role="alert" className="text-sm text-destructive">
          Could not change that report: {markError}
        </p>
      )}

      {loading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <div className="py-10 text-center text-sm">
          <p className="font-medium text-destructive">Could not load damaged stock</p>
          <p className="mt-1 text-muted-foreground">{error}</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </div>
      ) : shown.length === 0 ? (
        <p className="rounded-lg border border-border bg-card py-10 text-center text-sm text-muted-foreground">
          {storeGroup.within(
            group === "open"
              ? `Nothing to sort. When a ${lower(t.staff.one)} reports damaged stock on the phone, it shows here with the photo.`
              : `Nothing sorted in the last ${SORTED_DAYS} days.`
          )}
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {shown.map((r) => (
            <li key={r.id} className="flex gap-4 p-4">
              {r.photo_url ? (
                <a href={r.photo_url} target="_blank" rel="noreferrer" className="shrink-0" title="Open the photo">
                  {/* A signed, short-lived URL from a private bucket: next/image cannot cache it. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.photo_url} alt={`Photo of the damaged ${damagedWhat(r)}`} className="h-20 w-20 rounded-md object-cover" />
                </a>
              ) : (
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md bg-muted text-center text-xs text-muted-foreground">
                  No photo
                </div>
              )}
              <div className="min-w-0 flex-1 space-y-0.5 text-sm">
                <p className="font-medium text-foreground">
                  {r.qty} × {damagedWhat(r)}
                </p>
                {r.problem && <p className="text-muted-foreground">{r.problem}</p>}
                <p className="text-xs text-muted-foreground">
                  <Link href={storeHref(r.store_id)} className="text-primary hover:underline">
                    {r.store_name}
                  </Link>
                  {r.city ? ` · ${r.city}` : ""} · {dayOf(r.created_at, zone)}
                  {r.rep_id ? ` · ${nameOf(r.rep_id)}` : ""}
                </p>
                {r.status === "sorted" && r.sorted_at && (
                  <p className="text-xs text-emerald-700 dark:text-emerald-400">
                    Sorted {dayOf(r.sorted_at, zone)}
                    {r.sorted_by ? ` by ${nameOf(r.sorted_by)}` : ""}
                  </p>
                )}
              </div>
              {canSort && (
                <div className="shrink-0">
                  <Button
                    size="sm"
                    variant={r.status === "open" ? "default" : "outline"}
                    disabled={busy === r.id}
                    onClick={() => mark(r, r.status === "open" ? "sorted" : "open")}
                  >
                    {busy === r.id ? "Saving…" : r.status === "open" ? "Mark sorted" : "Open again"}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {!loading && !error && shown.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {count(t, "site", new Set(shown.map((r) => r.store_id)).size)}, {shown.length.toLocaleString()}{" "}
          {shown.length === 1 ? "report" : "reports"}. How many is single items.
        </p>
      )}
    </div>
  );
}
