"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { ServiceMessage } from "@/components/service-message";

/**
 * Route-level error boundary. Catches a failure in any page or layout below
 * the root, so the rest of the shell survives and Try again re-renders only
 * the segment that broke.
 *
 * Note `retry`, not `reset`: `reset` only clears the error and renders the same
 * failed content again, while `retry` fetches it again first. Next 16.2 called
 * it `unstable_retry` and 16.3 renamed it, so from then on the button called
 * `undefined` and threw (Sentry JAVASCRIPT-NEXTJS-4, 8 October 2026).
 */
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
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
        onClick={() => retry()}
        className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Try again
      </button>
    </ServiceMessage>
  );
}
