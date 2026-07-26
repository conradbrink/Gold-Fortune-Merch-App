"use client";

import { useEffect, useState } from "react";
import { Plus, Search, ChevronLeft, ChevronRight, ListFilter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  ScheduleTimeline,
  type TimelineRep,
  type TimelineVisit,
} from "@/components/dashboard/schedule-timeline";
import { createClient } from "@/lib/supabase/client";
import type { VisitStatus } from "@/lib/mock-data";

const legend = [
  { label: "Done", color: "bg-emerald-500" },
  { label: "Upcoming", color: "bg-amber-500" },
  { label: "Missed", color: "bg-red-500" },
  { label: "Unplanned", color: "bg-blue-500" },
] as const;

function statusToVisitStatus(status: string): VisitStatus {
  switch (status) {
    case "checked_out":
      return "done";
    case "checked_in":
      return "upcoming";
    case "missed":
      return "missed";
    default:
      return "unplanned";
  }
}

function toDateInput(d: Date) {
  return d.toISOString().slice(0, 10);
}

function formatDisplayDate(d: Date) {
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function SchedulePage() {
  const supabase = createClient();
  const [date, setDate] = useState(() => new Date());
  const [reps, setReps] = useState<TimelineRep[]>([]);
  const [visits, setVisits] = useState<TimelineVisit[]>([]);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    repId: "",
    storeId: "",
    startHour: "9",
    endHour: "10",
  });

  async function loadData() {
    setLoading(true);
    const dateStr = toDateInput(date);

    const { data: repRows } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("role", "rep")
      .order("full_name");
    setReps((repRows ?? []).map((r) => ({ id: r.id, name: r.full_name ?? "Unnamed" })));

    const { data: storeRows } = await supabase.from("stores").select("id, name").order("name");
    setStores(storeRows ?? []);

    const { data: routeRows } = await supabase
      .from("routes")
      .select("id, rep_id, scheduled_start_at, scheduled_end_at, stores(name), visits(status)")
      .eq("scheduled_date", dateStr);

    const timelineVisits: TimelineVisit[] = (routeRows ?? []).map((r) => {
      const store = r.stores as unknown as { name: string } | null;
      const visitRows = r.visits as unknown as { status: string }[] | null;
      const status = visitRows?.[0]?.status ?? "not_started";
      const start = r.scheduled_start_at ? new Date(r.scheduled_start_at) : null;
      const end = r.scheduled_end_at ? new Date(r.scheduled_end_at) : null;
      return {
        id: r.id,
        repId: r.rep_id,
        place: store?.name ?? "Unknown place",
        startHour: start ? start.getHours() + start.getMinutes() / 60 : 9,
        endHour: end ? end.getHours() + end.getMinutes() / 60 : 10,
        status: statusToVisitStatus(status),
      };
    });
    setVisits(timelineVisits);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  async function handleCreateVisit() {
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const { data: profileRow } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", userData.user!.id)
      .single();

    const dateStr = toDateInput(date);
    const start = new Date(date);
    start.setHours(Math.floor(Number(form.startHour)), (Number(form.startHour) % 1) * 60, 0, 0);
    const end = new Date(date);
    end.setHours(Math.floor(Number(form.endHour)), (Number(form.endHour) % 1) * 60, 0, 0);

    const { data: route } = await supabase
      .from("routes")
      .insert({
        org_id: profileRow!.org_id,
        rep_id: form.repId,
        store_id: form.storeId,
        scheduled_date: dateStr,
        scheduled_start_at: start.toISOString(),
        scheduled_end_at: end.toISOString(),
        created_by: userData.user!.id,
      })
      .select("id")
      .single();

    if (route) {
      await supabase.from("visits").insert({
        org_id: profileRow!.org_id,
        route_id: route.id,
        rep_id: form.repId,
        store_id: form.storeId,
        status: "not_started",
        client_generated_id: crypto.randomUUID(),
      });
    }

    setSaving(false);
    setDialogOpen(false);
    loadData();
  }

  const filteredReps = reps.filter((r) =>
    r.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Schedule
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage lists of your schedules.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger
            render={
              <Button className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="h-4 w-4" />
                New Visit
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New visit — {formatDisplayDate(date)}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="visit-rep">Representative</Label>
                <NativeSelect
                  id="visit-rep"
                  value={form.repId}
                  onChange={(e) => setForm({ ...form, repId: e.target.value })}
                >
                  <option value="" disabled>
                    Select a rep
                  </option>
                  {reps.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="visit-store">Store</Label>
                <NativeSelect
                  id="visit-store"
                  value={form.storeId}
                  onChange={(e) => setForm({ ...form, storeId: e.target.value })}
                >
                  <option value="" disabled>
                    Select a store
                  </option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="start-hour">Start hour (24h)</Label>
                  <Input
                    id="start-hour"
                    type="number"
                    min={0}
                    max={23}
                    value={form.startHour}
                    onChange={(e) => setForm({ ...form, startHour: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="end-hour">End hour (24h)</Label>
                  <Input
                    id="end-hour"
                    type="number"
                    min={0}
                    max={23}
                    value={form.endHour}
                    onChange={(e) => setForm({ ...form, endHour: e.target.value })}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={handleCreateVisit}
                disabled={saving || !form.repId || !form.storeId}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? "Saving…" : "Create visit"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-primary p-3 text-primary-foreground">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary-foreground/70" />
          <Input
            placeholder="Search reps"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border-0 bg-primary-foreground/10 pl-9 text-primary-foreground placeholder:text-primary-foreground/70"
          />
        </div>
        <Button
          variant="ghost"
          className="gap-1.5 border border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
        >
          <ListFilter className="h-4 w-4" />
          Filter
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {legend.map((item) => (
            <span
              key={item.label}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-semibold text-foreground"
            >
              <span className={`h-2 w-2 rounded-full ${item.color}`} />
              {item.label.toUpperCase()}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setDate(new Date())}>
            Today
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setDate((d) => new Date(d.getTime() - 86400000))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold text-foreground">
            {formatDisplayDate(date)}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setDate((d) => new Date(d.getTime() + 86400000))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-lg border border-border bg-card py-16 text-center text-sm text-muted-foreground">
          Loading schedule…
        </div>
      ) : (
        <ScheduleTimeline reps={filteredReps} visits={visits} />
      )}
    </div>
  );
}
