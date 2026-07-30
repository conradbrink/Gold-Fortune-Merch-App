"use client";

import { useEffect } from "react";
import { ServiceMessage } from "@/components/service-message";
import "./globals.css";

/**
 * The last resort: the root layout itself failed, so this replaces it
 * entirely and must supply its own <html> and <body>.
 *
 * It also has to import globals.css itself — the root layout that normally
 * pulls the stylesheet in is precisely what is not rendering here, and an
 * unstyled error page reads as a broken site rather than a handled fault.
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("Root layout failed", { digest: error.digest }, error);
  }, [error]);

  return (
    <html lang="en" className="h-full antialiased">
      <body className="h-full bg-background">
        <ServiceMessage
          title="The system is temporarily unavailable"
          detail="Gold Fortune Merchandising could not start. This is usually brief — try again in a moment."
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
      </body>
    </html>
  );
}
