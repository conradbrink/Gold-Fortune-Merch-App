"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Detail, Field } from "@/components/hr/field";
import { createClient } from "@/lib/supabase/client";
import { useHrLoad } from "@/lib/hr/use-load";
import { formatDateOnly } from "@/lib/format-date";
import { fetchHrReference, type HrReference } from "@/lib/hr/settings";
import {
  acknowledgeReview,
  activeCategories,
  completeReview,
  fetchRatings,
  fetchReview,
  previewOverall,
  saveEmployeeComments,
  saveRating,
  saveReviewNarrative,
  type ReviewRow,
} from "@/lib/hr/performance";
import {
  formatScore,
  periodLabel,
  RATING_LABELS,
  ratingBand,
  REVIEW_STATUS_LABELS,
  type ReviewRating,
} from "@/lib/hr/types";

/**
 * One review, in whichever of its three states it is in.
 *
 * The page has two audiences and shows each of them a different half. The
 * manager owns the draft — ratings, comments, strengths, goals — and loses it
 * the moment they complete it. The employee sees nothing until then, adds their
 * own comments, and acknowledges. After acknowledgement only HR can change
 * anything, and every such edit is written to the audit trail with the score
 * before and after.
 *
 * None of that is enforced here. The database refuses the writes this page does
 * not offer; hiding the buttons is a courtesy so nobody types four paragraphs
 * into a form that will bounce.
 */
export default function ReviewPage() {
  const supabase = createClient();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [review, setReview] = useState<ReviewRow | null>(null);
  const [ratings, setRatings] = useState<ReviewRating[]>([]);
  const [reference, setReference] = useState<HrReference | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [narrative, setNarrative] = useState({
    manager_comments: "",
    strengths: "",
    improvements: "",
    goals: "",
  });
  const [employeeComments, setEmployeeComments] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: auth } = await supabase.auth.getUser();
      setUserId(auth.user?.id ?? null);
      const [r, rt, ref] = await Promise.all([
        fetchReview(supabase, id),
        fetchRatings(supabase, id),
        fetchHrReference(supabase),
      ]);
      setReview(r);
      setRatings(rt);
      setReference(ref);
      if (r) {
        setNarrative({
          manager_comments: r.manager_comments ?? "",
          strengths: r.strengths ?? "",
          improvements: r.improvements ?? "",
          goals: r.goals ?? "",
        });
        setEmployeeComments(r.employee_comments ?? "");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useHrLoad(load);

  const categories = useMemo(
    () => activeCategories(reference?.reviewCategories ?? []),
    [reference]
  );
  const scaleMax = reference?.settings?.rating_scale_max ?? 5;
  const ratingMap = useMemo(
    () => new Map(ratings.map((r) => [r.category_id, r.rating])),
    [ratings]
  );
  const preview = previewOverall(categories, ratingMap);

  /**
   * Whether *this* signed-in person is the subject.
   *
   * Compared against `profile_id` rather than the employee id, because the
   * question is "is this my review" and the answer is about the account. An
   * employee with no account has a null `profile_id` and can never match, which
   * is right: they are not the one looking at this page.
   */
  const isSubject = Boolean(
    review && userId && review.employee?.profile_id === userId
  );

  const isDraft = review?.status === "draft";
  const canRate = isDraft && !isSubject;

  async function rate(categoryId: string, value: number) {
    if (!review) return;
    setBusy(true);
    setError(null);
    try {
      await saveRating(supabase, review.id, categoryId, value, null);
      const rt = await fetchRatings(supabase, review.id);
      setRatings(rt);
      // Re-read the review: the overall is recomputed by a trigger, so the
      // number on screen has to come back from the database rather than be
      // guessed at here. `previewOverall` fills the gap until it arrives.
      setReview(await fetchReview(supabase, review.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveNarrative() {
    if (!review) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      await saveReviewNarrative(supabase, review.id, {
        manager_comments: narrative.manager_comments.trim() || null,
        strengths: narrative.strengths.trim() || null,
        improvements: narrative.improvements.trim() || null,
        goals: narrative.goals.trim() || null,
        review_date: review.review_date,
      });
      setSaved("Saved.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function complete() {
    if (!review) return;
    if (
      !window.confirm(
        "Complete this review? It becomes visible to the employee and you will not be able to change it afterwards — only HR can."
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await completeReview(supabase, review.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="h-64 animate-pulse rounded-lg bg-muted/50" />;
  }

  // A failure and an absence are different answers, and the "not found" text
  // below is a claim — that the record does not exist or is not yours. Saying
  // that when the load simply errored would be telling somebody they have no
  // access when what happened was a dropped connection.
  // Guarded on the record being absent as well: `error` is also set by actions
  // on a page that loaded fine — a signed URL that failed, an asset that would
  // not return — and those belong in the banner at the top, not in place of
  // everything.
  if (error && !review) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <p className="font-medium">Could not load this review</p>
          <p className="mt-1">{error}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={load}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!review) {
    return (
      <div className="space-y-4">
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/hr/performance" />}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Performance
        </Button>
        <p className="rounded-md border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          That review could not be found, or you do not have access to it. A
          draft is visible only to its reviewer, the employee&rsquo;s management
          chain and HR.
        </p>
      </div>
    );
  }

  const label = periodLabel(review.period_type, review.period_year, review.period_index);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 h-7 text-muted-foreground" nativeButton={false}
          render={<Link href="/hr/performance" />}
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Performance
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {review.employee?.full_name ?? "Review"} — {label}
          </h1>
          <Badge variant={isDraft ? "outline" : "default"} className="font-normal">
            {REVIEW_STATUS_LABELS[
              review.status as keyof typeof REVIEW_STATUS_LABELS
            ] ?? review.status}
          </Badge>
          {!isDraft && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="h-3 w-3" /> Locked — HR only
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {saved && (
        <div className="rounded-md border border-border bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
          {saved}
        </div>
      )}

      <Card>
        <CardContent className="p-5">
          <dl className="grid gap-3 sm:grid-cols-4">
            <Detail label="Reviewer">{review.reviewer?.full_name ?? "—"}</Detail>
            <Detail label="Review date">{formatDateOnly(review.review_date)}</Detail>
            <Detail label="Period">
              {formatDateOnly(review.period_start)} — {formatDateOnly(review.period_end)}
            </Detail>
            <Detail label="Overall">
              <span className="text-base font-semibold">
                {formatScore(review.overall_rating ?? preview, scaleMax)}
              </span>
              <span className="block text-xs text-muted-foreground">
                {ratingBand(review.overall_rating ?? preview, scaleMax) ??
                  "Not yet rated"}
              </span>
            </Detail>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Categories</h2>
            <p className="text-xs text-muted-foreground">
              1 = {RATING_LABELS[0]} · {scaleMax} = {RATING_LABELS[RATING_LABELS.length - 1]}
            </p>
          </div>
          {categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No review categories are configured.
            </p>
          ) : (
            <ul className="space-y-3">
              {categories.map((c) => {
                const value = ratingMap.get(c.id) ?? null;
                return (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{c.name}</p>
                      {c.description && (
                        <p className="text-xs text-muted-foreground">{c.description}</p>
                      )}
                      {Number(c.weight) !== 1 && (
                        <p className="text-xs text-muted-foreground">
                          Weighted ×{Number(c.weight)}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: scaleMax }, (_, i) => i + 1).map((n) => (
                        <button
                          key={n}
                          type="button"
                          disabled={!canRate || busy}
                          onClick={() => rate(c.id, n)}
                          title={RATING_LABELS[
                            Math.min(
                              RATING_LABELS.length - 1,
                              Math.round(
                                ((n - 1) / (scaleMax - 1)) * (RATING_LABELS.length - 1)
                              )
                            )
                          ]}
                          className={
                            "h-8 w-8 rounded-md border text-sm font-medium transition-colors " +
                            (value === n
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-card text-muted-foreground") +
                            (canRate ? " hover:border-primary" : " cursor-default")
                          }
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-5">
          <h2 className="text-sm font-semibold">Manager</h2>
          {canRate ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Comments" className="sm:col-span-2">
                <Textarea
                  rows={3}
                  value={narrative.manager_comments}
                  onChange={(e) =>
                    setNarrative((n) => ({ ...n, manager_comments: e.target.value }))
                  }
                />
              </Field>
              <Field label="Strengths">
                <Textarea
                  rows={3}
                  value={narrative.strengths}
                  onChange={(e) =>
                    setNarrative((n) => ({ ...n, strengths: e.target.value }))
                  }
                />
              </Field>
              <Field label="Areas for improvement">
                <Textarea
                  rows={3}
                  value={narrative.improvements}
                  onChange={(e) =>
                    setNarrative((n) => ({ ...n, improvements: e.target.value }))
                  }
                />
              </Field>
              <Field label="Goals for next review" className="sm:col-span-2">
                <Textarea
                  rows={3}
                  value={narrative.goals}
                  onChange={(e) => setNarrative((n) => ({ ...n, goals: e.target.value }))}
                />
              </Field>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <Button variant="outline" onClick={saveNarrative} disabled={busy}>
                  Save draft
                </Button>
                <Button onClick={complete} disabled={busy || ratings.length === 0}>
                  Complete review
                </Button>
                {ratings.length === 0 && (
                  <p className="self-center text-xs text-muted-foreground">
                    Rate at least one category first.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <dl className="grid gap-3 sm:grid-cols-2">
              <Detail label="Comments" className="sm:col-span-2">
                {review.manager_comments ?? "—"}
              </Detail>
              <Detail label="Strengths">{review.strengths ?? "—"}</Detail>
              <Detail label="Areas for improvement">{review.improvements ?? "—"}</Detail>
              <Detail label="Goals for next review" className="sm:col-span-2">
                {review.goals ?? "—"}
              </Detail>
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-5">
          <h2 className="text-sm font-semibold">Employee</h2>
          {isDraft ? (
            <p className="text-sm text-muted-foreground">
              The employee sees this review, and can comment on and acknowledge
              it, once it is completed.
            </p>
          ) : isSubject && review.status === "completed" ? (
            <div className="space-y-3">
              <Field label="Your comments">
                <Textarea
                  rows={4}
                  value={employeeComments}
                  onChange={(e) => setEmployeeComments(e.target.value)}
                  placeholder="Optional. Acknowledging does not mean you agree with it."
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await saveEmployeeComments(
                        supabase,
                        review.id,
                        employeeComments.trim() || null
                      );
                      setSaved("Your comments were saved.");
                      await load();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Save comments
                </Button>
                <Button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await acknowledgeReview(
                        supabase,
                        review.id,
                        employeeComments.trim() || null
                      );
                      await load();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Acknowledge
                </Button>
              </div>
            </div>
          ) : (
            <dl className="grid gap-3">
              <Detail label="Comments">{review.employee_comments ?? "—"}</Detail>
              <Detail label="Acknowledged">
                {review.acknowledged_at
                  ? formatDateOnly(review.acknowledged_at.slice(0, 10))
                  : "Not yet"}
              </Detail>
            </dl>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
