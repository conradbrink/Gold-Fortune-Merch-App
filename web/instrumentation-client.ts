// Browser-side error monitoring.
//
// Next runs this before the app becomes interactive, so an error during
// hydration is captured rather than being the blank screen a manager would
// otherwise phone about.
//
// Does nothing when NEXT_PUBLIC_SENTRY_DSN is unset — which is the case on a
// developer machine unless it is deliberately configured.

import * as Sentry from "@sentry/nextjs";
import { sharedSentryOptions } from "@/lib/monitoring";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init(sharedSentryOptions);
}

// Lets Sentry tie a client-side navigation to the error that followed it.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
