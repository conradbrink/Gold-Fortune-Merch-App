"use client";

import { useEffect, useState } from "react";
import { Check, X, ImageOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { signPhotos } from "@/lib/photos";
import { cn } from "@/lib/utils";

type FieldMeta = {
  label: string;
  field_type: string;
  sort_order: number;
};

type PhotoMeta = {
  storage_path: string;
  taken_at: string | null;
};

type ResponseRow = {
  id: string;
  value_text: string | null;
  value_number: number | null;
  value_boolean: boolean | null;
  photo_id: string | null;
  field: FieldMeta | null;
  photo: PhotoMeta | null;
};

/**
 * Every answer on one form submission, in the order the rep saw them.
 *
 * Shared by the Visits drill-down and the Reports submissions tab, so it takes
 * only a submission id and does its own fetching.
 */
export function SubmissionDetail({ submissionId }: { submissionId: string }) {
  const supabase = createClient();
  const [rows, setRows] = useState<ResponseRow[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      const { data, error: err } = await supabase
        .from("form_responses")
        // Must be a single string literal — postgrest-js parses this at the
        // type level, and a concatenated string degrades to GenericStringError.
        .select("id, value_text, value_number, value_boolean, photo_id, form_fields(label, field_type, sort_order), photos(storage_path, taken_at)")
        .eq("form_submission_id", submissionId);

      if (cancelled) return;

      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }

      const mapped: ResponseRow[] = (data ?? []).map((r) => ({
        id: r.id,
        value_text: r.value_text,
        value_number: r.value_number,
        value_boolean: r.value_boolean,
        photo_id: r.photo_id,
        field: r.form_fields as unknown as FieldMeta | null,
        photo: r.photos as unknown as PhotoMeta | null,
      }));

      mapped.sort(
        (a, b) => (a.field?.sort_order ?? 0) - (b.field?.sort_order ?? 0)
      );
      setRows(mapped);
      setLoading(false);

      // Bucket is private — sign every path in one request.
      const urls = await signPhotos(
        supabase,
        mapped.map((r) => r.photo?.storage_path)
      );
      if (!cancelled) setPhotoUrls(urls);
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissionId]);

  if (loading) {
    return (
      <div className="space-y-2 py-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded bg-secondary" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className="py-6 text-center text-sm text-destructive">
        Could not load this submission: {error}
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        This submission has no recorded answers.
      </p>
    );
  }

  return (
    <dl className="divide-y divide-border">
      {rows.map((row) => (
        <div
          key={row.id}
          className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-[1fr_minmax(0,220px)] sm:items-start sm:gap-4"
        >
          <dt className="text-sm text-muted-foreground">
            {row.field?.label ?? "Unknown question"}
          </dt>
          <dd className="text-sm font-medium text-foreground sm:text-right">
            <AnswerValue row={row} photoUrls={photoUrls} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function AnswerValue({
  row,
  photoUrls,
}: {
  row: ResponseRow;
  photoUrls: Record<string, string>;
}) {
  const type = row.field?.field_type;

  if (type === "photo") {
    const path = row.photo?.storage_path;
    const url = path ? photoUrls[path] : undefined;
    if (!url) {
      return (
        <span className="flex items-center gap-1.5 text-muted-foreground sm:justify-end">
          <ImageOff className="h-4 w-4" />
          No photo
        </span>
      );
    }
    return (
      <a href={url} target="_blank" rel="noreferrer" className="inline-block">
        {/* Plain <img>: signed URLs carry query strings and expire, which
            next/image's optimizer cannot cache usefully. */}
        <img
          src={url}
          alt={row.field?.label ?? "Visit photo"}
          loading="lazy"
          className="ml-auto h-28 w-auto rounded-md border border-border object-cover transition-opacity hover:opacity-85"
        />
      </a>
    );
  }

  if (type === "boolean") {
    if (row.value_boolean === null) {
      return <span className="text-muted-foreground">Not answered</span>;
    }
    const yes = row.value_boolean;
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
          yes
            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
            : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
        )}
      >
        {yes ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
        {yes ? "Yes" : "No"}
      </span>
    );
  }

  if (type === "number") {
    if (row.value_number === null) {
      return <span className="text-muted-foreground">—</span>;
    }
    return <span>{row.value_number}</span>;
  }

  if (type === "multiple_choice") {
    if (!row.value_text) {
      return <span className="text-muted-foreground">—</span>;
    }
    return (
      <span className="inline-flex rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground">
        {row.value_text}
      </span>
    );
  }

  if (type === "date" && row.value_text) {
    const d = new Date(row.value_text);
    return (
      <span>
        {Number.isNaN(d.getTime())
          ? row.value_text
          : d.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
      </span>
    );
  }

  if (!row.value_text) {
    return <span className="text-muted-foreground">—</span>;
  }
  return <span className="whitespace-pre-wrap">{row.value_text}</span>;
}
