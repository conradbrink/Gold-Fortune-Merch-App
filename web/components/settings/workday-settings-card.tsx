"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { createClient } from "@/lib/supabase/client";
import { refreshCompanyConfig, useCompanyConfig, useTerms } from "@/lib/use-company-config";
import { lower, withArticle } from "@/lib/terms";
import { CHECKIN_DISTANCES } from "@/lib/settings-tabs";

type Draft = {
  autoEnd: boolean;
  autoEndTime: string;
  checkinMetres: number;
  shortVisit: string;
};

/**
 * The working day and check-ins, as rules an owner decides: whether a
 * forgotten workday is ended for them, how close to a site a check-in must
 * be, and how short a visit is worth a question. How the phone records
 * locations is Tickd's business and is not here.
 */
export function WorkdaySettingsCard({ orgId, canEdit }: { orgId: string; canEdit: boolean }) {
  const t = useTerms();
  const config = useCompanyConfig();
  const s = config?.settings ?? null;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The saved values until the owner changes one.
  const d: Draft | null =
    draft ??
    (s
      ? {
          autoEnd: s.auto_end_enabled,
          autoEndTime: s.auto_end_time,
          checkinMetres: s.checkin_radius_m,
          shortVisit: String(s.short_visit_minutes),
        }
      : null);

  function change(next: Partial<Draft>) {
    if (!d) return;
    setSaved(false);
    setDraft({ ...d, ...next });
  }

  async function save() {
    if (!d) return;
    const minutes = Number(d.shortVisit);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 120) {
      return setError(`The shortest normal ${lower(t.job.one)} is a whole number of minutes from 0 to 120.`);
    }
    if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(d.autoEndTime)) {
      return setError("Choose a time like 19:30 to end unfinished workdays.");
    }
    setBusy(true);
    setError(null);
    const { error: e } = await createClient()
      .from("company_settings")
      .upsert(
        [
          { org_id: orgId, key: "auto_end_enabled", value: d.autoEnd },
          { org_id: orgId, key: "auto_end_time", value: d.autoEndTime },
          { org_id: orgId, key: "checkin_radius_m", value: d.checkinMetres },
          { org_id: orgId, key: "short_visit_minutes", value: minutes },
        ],
        { onConflict: "org_id,key" }
      );
    setBusy(false);
    if (e) return setError(e.message);
    setDraft(null);
    refreshCompanyConfig();
    setSaved(true);
  }

  const site = lower(t.site.one);
  const distances = d && !CHECKIN_DISTANCES.some((x) => x.metres === d.checkinMetres)
    ? [...CHECKIN_DISTANCES, { metres: d.checkinMetres, label: `${d.checkinMetres} m (your current setting)` }].sort(
        (a, b) => a.metres - b.metres
      )
    : CHECKIN_DISTANCES;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Workdays and check-ins</CardTitle>
        <CardDescription>
          Tickd records where your team is while they are working, and checks each check-in against the{" "}
          {site}&apos;s address. You decide the rules below; the rest is handled for you.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!d && <p className="text-sm text-muted-foreground">Loading…</p>}
        {d && (
          <>
            <section className="space-y-2">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-primary"
                  checked={d.autoEnd}
                  disabled={!canEdit}
                  onChange={(e) => change({ autoEnd: e.target.checked })}
                />
                <span>
                  <span className="block text-sm font-medium text-foreground">End unfinished workdays automatically</span>
                  <span className="block text-xs text-muted-foreground">
                    If someone forgets to end their day, Tickd ends it for them, so their hours are not counted all
                    night. Turn this off if your team works night shifts.
                  </span>
                </span>
              </label>
              {d.autoEnd && (
                <div className="flex items-center gap-2 pl-7">
                  <label htmlFor="auto-end-time" className="text-sm text-muted-foreground">
                    End them at
                  </label>
                  <Input
                    id="auto-end-time"
                    type="time"
                    className="w-32"
                    value={d.autoEndTime}
                    disabled={!canEdit}
                    onChange={(e) => change({ autoEndTime: e.target.value })}
                  />
                </div>
              )}
            </section>

            <section className="space-y-1.5">
              <label htmlFor="checkin-distance" className="block text-sm font-medium text-foreground">
                How close to {withArticle(t, "site")} someone must be to check in
              </label>
              <NativeSelect
                id="checkin-distance"
                value={String(d.checkinMetres)}
                disabled={!canEdit}
                onChange={(e) => change({ checkinMetres: Number(e.target.value) })}
              >
                {distances.map((x) => (
                  <option key={x.metres} value={x.metres}>
                    {x.label}
                  </option>
                ))}
              </NativeSelect>
              <p className="text-xs text-muted-foreground">
                Further away than this, the check-in is still saved but marked as not on site. One {site} can have
                its own distance on its page.
              </p>
            </section>

            <section className="space-y-1.5">
              <label htmlFor="short-visit" className="block text-sm font-medium text-foreground">
                Shortest normal {lower(t.job.one)} (minutes)
              </label>
              <Input
                id="short-visit"
                type="number"
                min={0}
                max={120}
                className="w-28"
                value={d.shortVisit}
                disabled={!canEdit}
                onChange={(e) => change({ shortVisit: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Leaving sooner than this asks the person to confirm, and you can see it on the dashboard. 0 turns
                this off.
              </p>
            </section>

            {error && <p className="text-sm text-destructive">{error}</p>}
            {canEdit && (
              <div className="flex items-center gap-3">
                <Button onClick={save} disabled={busy || draft === null}>
                  {busy ? "Saving…" : "Save"}
                </Button>
                {saved && <span className="text-sm text-muted-foreground">Saved.</span>}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
