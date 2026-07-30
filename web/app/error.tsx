"use client";

import { useEffect } from "react";
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
    // Vercel captures console.error from the client and the server into the
    // runtime logs, so this is the monitoring hook until something richer is
    // wired up. Logging the digest too is what ties this render to the
    // server-side stack trace, which is the only place the real message lives.
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
