"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Maximize2, Search, ShoppingCart, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useCompanyConfig } from "@/lib/use-company-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/warehouse/stat-tile";
import { TrackingMap, type MapPin } from "@/components/tracking/tracking-map";
import {
  describeAge,
  describeSource,
  fetchLiveReps,
  freshnessExplained,
  freshnessOf,
  minutesSince,
  type LiveReps,
  type RepPosition,
} from "@/lib/live-reps";
import {
  fetchRepDay,
  fetchTodaysOrders,
  formatDuration,
  formatKm,
  formatTime,
  timelineOf,
  todayDate,
  type DayOrder,
  type RepDay,
} from "@/lib/tracking";

const PIN = { fresh: "#10b981", recent: "#f59e0b", stale: "#9ca3af" } as const;
const DOT = { fresh: "bg-emerald-500", recent: "bg-amber-500", stale: "bg-muted-foreground/50" } as const;
const ORDER_PIN = "#2563eb";

/**
 * Live tracking: every rep's last reading on one map.
 *
 * "Live" means a reading inside four of the company's GPS intervals
 * (`freshnessOf`, the same line the dashboard map draws) — not that anybody is being followed in real
 * time. Every rep carries the age of their reading, because a position without
 * one claims a certainty the phones cannot give. Re-read every minute.
 */
export default function TrackingPage() {
  const supabase = createClient();
  // "Live" means within a few of the company's GPS intervals (`freshnessOf`).
  const intervalMinutes = useCompanyConfig()?.settings.gps_ping_interval_minutes ?? null;
  const [data, setData] = useState<LiveReps | null>(null);
  const [orders, setOrders] = useState<DayOrder[]>([]);
  const [showOrders, setShowOrders] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  // Kept with the rep it belongs to, so a new selection never shows the
  // previous rep's day under the new rep's name while it loads.
  const [day, setDay] = useState<{ repId: string; day: RepDay } | null>(null);
  const [tick, setTick] = useState(0);
  const [fitKey, setFitKey] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [live, o] = await Promise.all([fetchLiveReps(supabase), fetchTodaysOrders(supabase)]);
      setData(live);
      setOrders(o);
      setNow(Date.now());
      setTick((t) => t + 1);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    fetchRepDay(supabase, selected, todayDate())
      .then((d) => !cancelled && setDay({ repId: selected, day: d }))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
    // `tick` re-reads the card with the minute poll, like the map.
  }, [supabase, selected, tick]);

  const q = query.trim().toLowerCase();
  const positions = useMemo(
    () => (data?.positions ?? []).filter((p) => !q || p.repName.toLowerCase().includes(q)),
    [data, q]
  );
  const missing = (data?.missing ?? []).filter((m) => !q || m.repName.toLowerCase().includes(q));
  const live = positions.filter((p) => freshnessOf(minutesSince(p.recordedAt, now), intervalMinutes) === "fresh");
  const earlier = positions.filter((p) => freshnessOf(minutesSince(p.recordedAt, now), intervalMinutes) !== "fresh");
  const chosen = positions.find((p) => p.repId === selected) ?? null;

  const pins = useMemo<MapPin[]>(() => {
    const out: MapPin[] = positions.map((p) => ({
      id: `rep-${p.repId}`,
      lat: p.lat,
      lng: p.lng,
      color: PIN[freshnessOf(minutesSince(p.recordedAt, now), intervalMinutes)],
      label: p.repName.split(" ")[0],
      title: `${p.repName} — ${describeAge(minutesSince(p.recordedAt, now))}`,
      onClick: () => setSelected(p.repId),
    }));
    if (showOrders) {
      for (const o of orders) {
        if (o.lat == null || o.lng == null) continue;
        out.push({
          id: `order-${o.id}`,
          lat: o.lat,
          lng: o.lng,
          color: ORDER_PIN,
          shape: "square",
          title: `${o.orderNumber} · ${o.storeName} · ${formatTime(o.createdAt)}`,
        });
      }
    }
    return out;
  }, [positions, orders, showOrders, now, intervalMinutes]);

  const focus = useMemo(() => (chosen ? { lat: chosen.lat, lng: chosen.lng } : null), [chosen]);
  const ordersOnMap = orders.filter((o) => o.lat != null).length;

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-[32rem] flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Tracking</h1>
          <p className="text-sm text-muted-foreground">
            Each rep&apos;s last reading, refreshed every minute.{" "}
            {freshnessExplained(intervalMinutes)}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-card px-2 py-1 text-sm ring-1 ring-foreground/10">
          <span className="flex items-center gap-1.5 px-1">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> {live.length} live
          </span>
          <span className="flex items-center gap-1.5 px-1 text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-muted-foreground/50" /> {earlier.length + missing.length} not live
          </span>
          <Button
            size="sm"
            variant={showOrders ? "secondary" : "ghost"}
            onClick={() => setShowOrders((s) => !s)}
            aria-pressed={showOrders}
            title={showOrders ? "Hide today's orders" : "Show today's orders"}
          >
            <ShoppingCart className="mr-1 h-3.5 w-3.5" /> Orders ({ordersOnMap})
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setSelected(null); setFitKey((k) => k + 1); }}>
            <Maximize2 className="mr-1 h-3.5 w-3.5" /> Fit all
          </Button>
        </div>
      </div>

      <ErrorBanner message={error} />

      <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[18rem_1fr]">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search reps" className="pl-8" aria-label="Search reps" />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!data && <p className="p-3 text-sm text-muted-foreground">Loading…</p>}
            <Group title={`Live (${live.length})`}>
              {live.map((p) => (
                <RepRow key={p.repId} p={p} now={now} selected={selected === p.repId} onSelect={() => setSelected(p.repId)} />
              ))}
            </Group>
            <Group title={`Earlier (${earlier.length})`}>
              {earlier.map((p) => (
                <RepRow key={p.repId} p={p} now={now} selected={selected === p.repId} onSelect={() => setSelected(p.repId)} />
              ))}
            </Group>
            <Group title={`No position in 24 hours (${missing.length})`}>
              {missing.map((m) => (
                <Link
                  key={m.repId}
                  href={`/tracking/${m.repId}`}
                  className="block border-b border-border px-3 py-2 text-sm text-muted-foreground last:border-b-0 hover:bg-muted/60"
                >
                  {m.repName}
                  <span className="block text-xs">{m.dayOpen ? "Day open, no signal" : "No location"}</span>
                </Link>
              ))}
            </Group>
          </div>
        </aside>

        <div className="relative min-h-[24rem]">
          <TrackingMap pins={pins} focus={focus} fitKey={fitKey} className="h-full w-full" />
          {chosen && (
            <RepCard
              rep={chosen}
              day={day?.repId === chosen.repId ? day.day : null}
              now={now}
              onClose={() => { setSelected(null); setDay(null); setFitKey((k) => k + 1); }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="bg-muted/50 px-3 py-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{title}</p>
      {children}
    </div>
  );
}

function RepRow({ p, now, selected, onSelect }: { p: RepPosition; now: number; selected: boolean; onSelect: () => void }) {
  const minutes = minutesSince(p.recordedAt, now);
  const intervalMinutes = useCompanyConfig()?.settings.gps_ping_interval_minutes ?? null;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex w-full items-start gap-2.5 border-b border-border px-3 py-2 text-left last:border-b-0 ${selected ? "bg-muted" : "hover:bg-muted/60"}`}
    >
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[freshnessOf(minutes, intervalMinutes)]}`} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium">{p.repName}</span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{describeAge(minutes)}</span>
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {describeSource(p.source, p.storeName)}
          {!p.dayOpen && " · day ended"}
        </span>
      </span>
    </button>
  );
}

function RepCard({ rep, day, now, onClose }: { rep: RepPosition; day: RepDay | null; now: number; onClose: () => void }) {
  const timeline = day ? timelineOf(day) : [];
  return (
    <div className="absolute top-3 right-3 bottom-3 flex w-80 max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-xl bg-card shadow-lg ring-1 ring-foreground/10">
      <div className="flex items-start justify-between gap-2 border-b border-border p-3">
        <div>
          <p className="font-medium">{rep.repName}</p>
          <p className="text-xs text-muted-foreground">
            {describeSource(rep.source, rep.storeName)} · {describeAge(minutesSince(rep.recordedAt, now))}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-px border-b border-border bg-border text-center">
        <Stat label="Distance today" value={day ? formatKm(day.distanceM) : "…"} />
        <Stat label={day?.dayOpen ? "Active so far" : "Active"} value={day ? formatDuration(day.activeSeconds) : "…"} />
        <Stat label="Check-ins" value={day ? String(day.visits.length) : "…"} />
        <Stat label="Orders" value={day ? String(day.orders.length) : "…"} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <p className="mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Today</p>
        {day && timeline.length === 0 && <p className="text-sm text-muted-foreground">Nothing recorded today.</p>}
        <ol className="space-y-2">
          {timeline.map((t, i) => (
            <li key={i} className="flex gap-2 text-sm">
              <span className="w-12 shrink-0 text-xs text-muted-foreground tabular-nums">{formatTime(t.at)}</span>
              {t.href ? (
                <Link href={t.href} className="text-primary hover:underline">{t.text}</Link>
              ) : (
                <span>{t.text}</span>
              )}
            </li>
          ))}
        </ol>
      </div>
      <div className="border-t border-border p-2">
        <Button className="w-full" variant="outline" nativeButton={false} render={<Link href={`/tracking/${rep.repId}`} />}>
          View full day history
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-2 py-2.5">
      <p className="text-base font-semibold tabular-nums">{value}</p>
      <p className="text-[10px] tracking-wider text-muted-foreground uppercase">{label}</p>
    </div>
  );
}
