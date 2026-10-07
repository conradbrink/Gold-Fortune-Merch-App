"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import { refreshCompanyConfig } from "@/lib/use-company-config";
import { TERM_KEYS, type TermKey } from "@/lib/terms";
import {
  TERM_WORD_MAX,
  planTermChanges,
  type TermDefinition,
  type TermDraft,
  type TermOverride,
} from "@/lib/branding-settings";

type Definition = TermDefinition & { description: string };

function isTermKey(key: string): key is TermKey {
  return (TERM_KEYS as readonly string[]).includes(key);
}

function toArticle(v: string | null): "a" | "an" | null {
  return v === "a" || v === "an" ? v : null;
}

/**
 * The company's words for the things the product is about (`company_terminology`).
 *
 * One row per entry in `term_definitions`, in its order, with the catalogue's
 * description as the help text and its default as the placeholder. A field
 * left blank means the default. Saving writes only the rows that changed; a
 * row edited back to the default, or reset, has its override deleted.
 *
 * The words reach every screen through `my_company_config()`, so after a save
 * the cached configuration is dropped and the server layout re-rendered.
 */
export function TerminologyCard({ orgId, canEdit }: { orgId: string; canEdit: boolean }) {
  const supabase = createClient();
  const router = useRouter();
  const [definitions, setDefinitions] = useState<Definition[] | null>(null);
  const [overrides, setOverrides] = useState<TermOverride[]>([]);
  const [drafts, setDrafts] = useState<Partial<Record<TermKey, TermDraft>>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<TermKey, string>>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function apply(defs: Definition[], rows: TermOverride[]) {
    const byKey = new Map(rows.map((r) => [r.key, r]));
    setOverrides(rows);
    setDrafts(
      Object.fromEntries(
        defs.map((d) => {
          const o = byKey.get(d.key);
          return [
            d.key,
            o
              ? { one: o.one, many: o.many, article: o.article }
              : { one: d.singular, many: d.plural, article: d.article },
          ];
        })
      )
    );
  }

  async function fetchOverrides(): Promise<TermOverride[] | string> {
    const { data, error } = await supabase
      .from("company_terminology")
      .select("key, singular, plural, article")
      .eq("org_id", orgId);
    if (error) return error.message;
    return data
      .filter((r) => isTermKey(r.key))
      .map((r) => ({
        key: r.key as TermKey,
        one: r.singular,
        many: r.plural,
        article: toArticle(r.article),
      }));
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [defs, rows] = await Promise.all([
        supabase
          .from("term_definitions")
          .select("key, singular, plural, article, description")
          .order("sort_order"),
        fetchOverrides(),
      ]);
      if (cancelled) return;
      if (defs.error || typeof rows === "string") {
        setLoadError(defs.error?.message ?? (rows as string));
        return;
      }
      // Only keys this build knows how to show; a term added by a later
      // migration appears once the app has a place that uses it.
      const known: Definition[] = defs.data
        .filter((d) => isTermKey(d.key))
        .map((d) => ({
          key: d.key as TermKey,
          singular: d.singular,
          plural: d.plural,
          article: toArticle(d.article),
          description: d.description,
        }));
      setDefinitions(known);
      apply(known, rows);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  function edit(key: TermKey, patch: Partial<TermDraft>) {
    setSaved(false);
    setFieldErrors((e) => ({ ...e, [key]: undefined }));
    setDrafts((cur) => ({ ...cur, [key]: { ...cur[key]!, ...patch } }));
  }

  /**
   * After a write: re-read the rows (the database trims them) and tell the
   * app. The drafts are replaced only after a clean save; after a refused one
   * they stay as typed, so the user can correct them.
   */
  async function afterWrite(resetDrafts: boolean): Promise<void> {
    const rows = await fetchOverrides();
    if (typeof rows === "string") {
      setSaveError(rows);
    } else if (resetDrafts && definitions) {
      apply(definitions, rows);
    } else {
      setOverrides(rows);
    }
    refreshCompanyConfig();
    router.refresh();
  }

  async function handleSave() {
    if (!definitions) return;
    setSaved(false);
    setSaveError(null);
    const plan = planTermChanges(definitions, overrides, drafts);
    setFieldErrors(plan.errors);
    if (Object.keys(plan.errors).length > 0) return;
    if (plan.upserts.length === 0 && plan.deletes.length === 0) {
      setSaved(true);
      return;
    }
    setSaving(true);
    if (plan.deletes.length > 0) {
      const { error } = await supabase
        .from("company_terminology")
        .delete()
        .eq("org_id", orgId)
        .in("key", plan.deletes);
      if (error) {
        setSaving(false);
        setSaveError(error.message);
        return;
      }
    }
    if (plan.upserts.length > 0) {
      // The database trims each word and refuses the batch with a readable
      // message if one is out of bounds; that message is shown as it is.
      const { error } = await supabase
        .from("company_terminology")
        .upsert(
          plan.upserts.map((u) => ({ org_id: orgId, ...u })),
          { onConflict: "org_id,key" }
        );
      if (error) {
        // The deletes above may already have gone through.
        if (plan.deletes.length > 0) await afterWrite(false);
        setSaving(false);
        setSaveError(error.message);
        return;
      }
    }
    await afterWrite(true);
    setSaving(false);
    setSaved(true);
  }

  async function handleReset(key: TermKey) {
    setSaved(false);
    setSaveError(null);
    setFieldErrors((e) => ({ ...e, [key]: undefined }));
    setSaving(true);
    const { error } = await supabase
      .from("company_terminology")
      .delete()
      .eq("org_id", orgId)
      .eq("key", key);
    if (error) {
      setSaving(false);
      setSaveError(error.message);
      return;
    }
    // Keep any unsaved edits in the other rows: only this row goes back.
    const def = definitions?.find((d) => d.key === key);
    setOverrides((cur) => cur.filter((o) => o.key !== key));
    if (def) {
      setDrafts((cur) => ({
        ...cur,
        [key]: { one: def.singular, many: def.plural, article: def.article },
      }));
    }
    refreshCompanyConfig();
    router.refresh();
    setSaving(false);
  }

  const overridden = new Set(overrides.map((o) => o.key));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Terminology</CardTitle>
        <CardDescription>
          Your company&apos;s words for the things the app is about. They are used for
          every label, report title and PDF, on the web and on the phone. Leave a field
          blank to use the default shown in it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadError && <p className="text-sm text-destructive">{loadError}</p>}
        {!definitions && !loadError && (
          <p className="text-sm text-muted-foreground">Loading terminology…</p>
        )}
        {definitions && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="min-w-48">Term</TableHead>
                  <TableHead className="min-w-36">Singular</TableHead>
                  <TableHead className="min-w-36">Plural</TableHead>
                  <TableHead className="w-28">Article</TableHead>
                  {canEdit && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {definitions.map((d) => {
                  const draft = drafts[d.key];
                  if (!draft) return null;
                  const error = fieldErrors[d.key];
                  return (
                    <TableRow key={d.key} className="align-top">
                      <TableCell className="whitespace-normal">
                        <div className="font-medium text-foreground">{d.singular}</div>
                        <p className="text-xs text-muted-foreground">{d.description}</p>
                        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label={`${d.singular}, singular`}
                          value={draft.one}
                          placeholder={d.singular}
                          maxLength={TERM_WORD_MAX}
                          disabled={!canEdit}
                          aria-invalid={error ? true : undefined}
                          onChange={(e) => edit(d.key, { one: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label={`${d.singular}, plural`}
                          value={draft.many}
                          placeholder={d.plural}
                          maxLength={TERM_WORD_MAX}
                          disabled={!canEdit}
                          aria-invalid={error ? true : undefined}
                          onChange={(e) => edit(d.key, { many: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        {/* "a" or "an" when the first letter does not tell:
                            an hour, a unit. */}
                        <NativeSelect
                          aria-label={`${d.singular}, article`}
                          value={draft.article ?? ""}
                          disabled={!canEdit}
                          onChange={(e) => edit(d.key, { article: toArticle(e.target.value) })}
                        >
                          <option value="">Auto</option>
                          <option value="a">a</option>
                          <option value="an">an</option>
                        </NativeSelect>
                      </TableCell>
                      {canEdit && (
                        <TableCell>
                          {overridden.has(d.key) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title="Reset to default"
                              aria-label={`Reset ${d.singular} to default`}
                              disabled={saving}
                              onClick={() => void handleReset(d.key)}
                            >
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {saveError && <p className="text-sm text-destructive">{saveError}</p>}
        {canEdit ? (
          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={!definitions || saving}>
              {saving ? "Saving…" : "Save terminology"}
            </Button>
            {saved && <span className="text-sm text-muted-foreground">Saved.</span>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Changing these needs the company settings permission.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
