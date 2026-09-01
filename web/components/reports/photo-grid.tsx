"use client";

import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { signPhotos } from "@/lib/photos";

/**
 * Shelf photos for the selected period.
 *
 * The bucket is private, so every path needs signing. `signPhotos` batches via
 * `createSignedUrls`, so a 60-image wall costs one request rather than 60.
 */
export function PhotoGrid({
  groups,
}: {
  groups: { label: string; paths: string[] }[];
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const allPaths = groups.flatMap((g) => g.paths);
  const key = allPaths.join("|");

  useEffect(() => {
    let cancelled = false;
    if (allPaths.length === 0) {
      // Signed URLs are fetched, not derived; the reset clears the previous
      // group's before the request goes out.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUrls({});
      return;
    }
    setLoading(true);
    signPhotos(createClient(), allPaths)
      .then((map) => {
        if (!cancelled) setUrls(map);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (groups.every((g) => g.paths.length === 0)) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No photos captured in this period.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {groups
        .filter((g) => g.paths.length > 0)
        .map((g) => (
          <div key={g.label} className="space-y-2">
            <h4 className="text-sm font-semibold text-foreground">
              {g.label}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {g.paths.length} shown
              </span>
            </h4>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {g.paths.map((p, i) => {
                const url = urls[p];
                return (
                  <div
                    key={`${p}-${i}`}
                    className="relative aspect-square overflow-hidden rounded-md border border-border bg-muted"
                  >
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={url}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        {loading ? (
                          <div className="h-full w-full animate-pulse bg-muted-foreground/10" />
                        ) : (
                          // A path that failed to sign means the object is gone;
                          // show that rather than a permanently blank tile.
                          <ImageOff className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
    </div>
  );
}
