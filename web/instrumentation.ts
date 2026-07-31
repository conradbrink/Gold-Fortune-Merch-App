// Server-side error monitoring.
//
// `register` runs once as the server starts; `onRequestError` is Next's hook
// for errors thrown while rendering or in a route handler — which is where the
// failures that matter live: a failed rep invite, a broken APK download, a
// query that errors under load.

import * as Sentry from "@sentry/nextjs";
import { sharedSentryOptions } from "@/lib/monitoring";

export async function register() {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  Sentry.init(sharedSentryOptions);
}

export const onRequestError = Sentry.captureRequestError;
