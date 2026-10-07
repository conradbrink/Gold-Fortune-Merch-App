"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ErrorBanner, EmptyRow } from "@/components/warehouse/stat-tile";
import { TrackingMap, type MapPin } from "@/components/tracking/tracking-map";
import {
  fetchRepDay,
  formatDuration,
  formatKm,
  formatTime,
  timelineOf,
  todayDate,
  type RepDay,
} from "@/lib/tracking";

function shift(date: string, days: number) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * One rep, one day: where they went, where they stopped, what they sold.
 *
 * The line is every usable ping in order. The distance beside it is
 * `workday_trail`'s, which leaves out legs too fast or too inaccurate to be
 * real — so the line can look a little longer than the number, and the number
 * is the one to trust.
 */
export default function RepDayPage() {
  const supabase = createClient();
  const { repId } = useParams<{ repId: string }>();
  const [date, setDate] = useState(todayDate);
  const [name, setName] = useState<string | null>(null);
  const [day, setDay] = useState<RepDay | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("profiles")
      .select("full_name")
      .eq("id", repId)
      .maybeSingle()
      .then(({ data, error: e }) => {
        if (cancelled) return;
        if (e) setError(e.message);
        else setName((data as { full_name: string } | null)?.full_name ?? "Unknown rep");
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, repId]);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDay(null);
    setFocus(null);
    fetchRepDay(supabase, repId, date)
      .then((d) => {
        if (!cancelled) {
          setDay(d);
          setError(null);
        }
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [supabase, repId, date]);

  const path = useMemo(() => (day?.pings ?? []).map((p) => ({ lat: p.lat, lng: p.lng })), [day]);
  const pins = useMemo<MapPin[]>(() => {
    if (!day) return [];
    const out: MapPin[] = [];
    day.visits.forEach((v, i) => {
      if (v.lat == null || v.lng == null) return;
      out.push({
        id: `visit-${v.id}`,
        lat: v.lat,
        lng: v.lng,
        color: "#d97706",
        shape: "square",
        label: String(i + 1),
        title: `${i + 1}. ${v.storeName}${v.checkinAt ? ` · ${formatTime(v.checkinAt)}` : ""}`,
      });
    });
    const first = day.pings[0];
    const last = day.pings.at(-1);
    if (first) out.push({ id: "start", lat: first.lat, lng: first.lng, color: "#10b981", title: `First reading ${formatTime(first.recordedAt)}` });
    if (last && last !== first)
      out.push({ id: "end", lat: last.lat, lng: last.lng, color: "#1e3a8a", title: `Last reading ${formatTime(last.recordedAt)}` });
    return out;
  }, [day]);

  const timeline = day ? timelineOf(day) : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/tracking" className="text-sm text-muted-foreground hover:text-foreground">
            ← Tracking
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground">{name ?? "…"}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setDate((d) => shift(d, -1))}>←</Button>
          <Input type="date" value={date} max={todayDate()} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-40" aria-label="Date" />
          <Button variant="outline" size="sm" disabled={date >= todayDate()} onClick={() => setDate((d) => shift(d, 1))}>→</Button>
        </div>
      </div>

      <ErrorBanner message={error} />

      <div className="grid gap-3 sm:grid-cols-4">
        <Tile label="Distance" value={day ? formatKm(day.distanceM) : "…"} sub="From the workday trail" />
        <Tile label="Location points" value={day ? String(day.pings.length) : "…"} />
        <Tile label="Check-ins" value={day ? String(day.visits.length) : "…"} />
        <Tile
          label="Active time"
          value={day ? formatDuration(day.activeSeconds) : "…"}
          sub={day?.dayOpen ? "Day still open, counting" : "Start to end of workday"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Route</CardTitle>
        </CardHeader>
        <CardContent>
          {day && day.pings.length === 0 && pins.length === 0 ? (
            <div className="flex h-72 items-center justify-center rounded-xl bg-muted text-sm text-muted-foreground">
              No location data for this date.
            </div>
          ) : (
            <TrackingMap pins={pins} path={path} focus={focus} fitKey={date} className="h-[26rem] w-full" />
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Green is the first reading, navy the last; numbered squares are the shops in the order visited.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Check-ins ({day?.visits.length ?? 0})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead>In</TableHead>
                  <TableHead>Out</TableHead>
                  <TableHead className="text-right">Time there</TableHead>
                  <TableHead className="text-right">From store</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {day && day.visits.length === 0 && <EmptyRow colSpan={6}>No check-ins for this date.</EmptyRow>}
                {day?.visits.map((v, i) => (
                  <TableRow
                    key={v.id}
                    className={v.lat != null ? "cursor-pointer" : undefined}
                    onClick={() => v.lat != null && v.lng != null && setFocus({ lat: v.lat, lng: v.lng })}
                  >
                    <TableCell className="tabular-nums">{i + 1}</TableCell>
                    <TableCell>{v.storeName}</TableCell>
                    <TableCell className="tabular-nums">{v.checkinAt ? formatTime(v.checkinAt) : "—"}</TableCell>
                    <TableCell className="tabular-nums">{v.checkoutAt ? formatTime(v.checkoutAt) : "Still there"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {v.durationSeconds != null ? `${Math.round(v.durationSeconds / 60)} min` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {v.distanceFromStoreM != null ? `${Math.round(v.distanceFromStoreM)} m` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {day && timeline.length === 0 && <p className="text-sm text-muted-foreground">No activity for this date.</p>}
            <ol className="space-y-2">
              {timeline.map((t, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span className="w-12 shrink-0 text-xs text-muted-foreground tabular-nums">{formatTime(t.at)}</span>
                  {t.href ? <Link href={t.href} className="text-primary hover:underline">{t.text}</Link> : <span>{t.text}</span>}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card size="sm">
      <CardContent>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}
