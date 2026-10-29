"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Who signed for the order in the shop, and the signature they drew on the
 * rep's phone (20261027201700). The picture is private, in
 * `order-signatures`, and readable by whoever can read the order; a signed
 * link is asked for when the row is shown.
 *
 * Also who received a delivery and signed for it on the driver's phone
 * (20261029181700): `bucket` fulfilment-docs, where the drop's proof is filed.
 *
 * Orders keyed here, imported, or taken on a phone before signatures existed
 * have none, and show no row: "Not signed" on every older phone order would
 * read as a step the rep skipped, when there was nothing to sign then.
 */
export function OrderSignature({
  path,
  signedBy,
  signedAt,
  bucket = "order-signatures",
  label = "Signed for by",
}: {
  path: string | null;
  signedBy: string | null;
  signedAt: string | null;
  bucket?: "order-signatures" | "fulfilment-docs";
  label?: string;
}) {
  const supabase = createClient();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!path) return;
    let live = true;
    supabase.storage
      .from(bucket)
      .createSignedUrl(path, 3600)
      .then(({ data, error }) => {
        if (!live) return;
        if (error || !data) setFailed(true);
        else setUrl(data.signedUrl);
      });
    return () => {
      live = false;
    };
    // The client is made per render; the path is what decides the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, bucket]);

  if (!path || !signedBy) return null;

  const when = signedAt ? new Date(signedAt) : null;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-right">
          {signedBy}
          {when && !Number.isNaN(when.getTime()) && (
            <span className="block text-xs text-muted-foreground">
              {when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
            </span>
          )}
        </span>
      </div>
      {url ? (
        // A signed storage link, not something next/image can optimise.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={`Signature of ${signedBy}`}
          className="ml-auto h-20 w-auto max-w-full rounded-md border bg-white p-1"
        />
      ) : failed ? (
        <p className="text-right text-xs text-muted-foreground">The signature picture could not be loaded.</p>
      ) : null}
    </div>
  );
}
