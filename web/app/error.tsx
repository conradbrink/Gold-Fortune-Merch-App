"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { ServiceMessage } from "@/components/service-message";

/**
 * Route-level error boundary. Catches a failure in any page or layout below
 * the root, so the rest of the shell survives and Try again re-renders only
 * the segment that broke.
 *
 * Note `unstable_retry`, not `reset` — this Next version renamed it.
 */
export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    // The digest ties this render to the server-side stack trace, which is the
    // only place the real message lives — production withholds it from the
    // browser on purpose. Sent as a tag so an issue can be matched to a
    // support call where someone read the reference off the screen.
    Sentry.captureException(error, {
      tags: { boundary: "route", digest: error.digest ?? "none" },
    });
    console.error("Unhandled error boundary", { digest: error.digest }, error);
  }, [error]);

  return (
    <ServiceMessage
      title="Something went wrong"
      detail="The system hit an unexpected problem. Your saved work has not been lost."
      digest={error.digest}
    >
      <button
        type="button"
        onClick={() => unstable_retry()}
        className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Try again
      </button>
    </ServiceMessage>
  );
}
