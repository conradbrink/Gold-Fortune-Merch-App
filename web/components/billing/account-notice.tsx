import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { accountNotice, type Account } from "@/lib/billing";

/**
 * The line across the top of every page when the company cannot save (read-only)
 * or soon may not (a failed payment, a plan ending), for everyone signed in to
 * it (Stage 6). Whoever manages the company settings gets the way to fix it;
 * everyone else learns why saving is refused.
 */
export function AccountNotice({ account }: { account: Account }) {
  const notice = accountNotice(account);
  if (!notice) return null;
  const cls =
    notice.tone === "red"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300";
  return (
    <div className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${cls}`} role="status">
      <span className="flex items-center gap-2 font-medium">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        {notice.text}
      </span>
      {account.canManage ? (
        <Link href="/billing" className="rounded-md border border-current px-3 py-1 text-xs font-medium hover:bg-background/40">
          Open Billing
        </Link>
      ) : (
        !account.writable && <span className="text-xs">Ask your administrator to choose a plan.</span>
      )}
    </div>
  );
}
