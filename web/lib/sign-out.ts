"use client";

import { forgetAssistant } from "@/components/assistant/assistant-provider";
import { forgetSitesView } from "@/lib/map-centre";
import { createClient } from "@/lib/supabase/client";
import { forgetCompanyConfig } from "@/lib/use-company-config";

/**
 * Signs this browser out, forgets what this tab kept for the person leaving,
 * and goes to the sign-in page. Every sign-out button calls this, so none of
 * them can drift from the others.
 *
 * This browser only. Supabase's default ends the person's sessions on every
 * device, so signing out of the office computer also signed them out of their
 * phone, whose next visit then failed its refresh (Sentry
 * JAVASCRIPT-NEXTJS-5: a shared login signed out on a Mac on 30 October, its
 * iPhone turned away the next morning), and a rep signing out of
 * /rep-notice lost their session in the app mid-day. "local" still ends this
 * session on the server, not only in the browser.
 *
 * The caches belong to the person leaving: whoever signs in next at this tab
 * must not be shown their company's configuration, map view or Ask AI
 * conversation.
 */
export async function signOutHere(router: { push(href: string): void; refresh(): void }) {
  await createClient().auth.signOut({ scope: "local" });
  forgetCompanyConfig();
  forgetSitesView();
  forgetAssistant();
  router.push("/login");
  router.refresh();
}
