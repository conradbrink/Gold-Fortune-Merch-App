"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

/** Matches the eight-character floor the rep invite route enforces. */
const MIN_PASSWORD_LENGTH = 8;

export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState<boolean | null>(null);

  // Arriving from the emailed link puts a recovery session in place; the
  // Supabase client picks it up from the URL fragment as it initialises.
  //
  // `ready === null` means "still finding out" and must render as neither
  // state: showing the form before this resolves lets someone who opened the
  // page directly type a new password into a form that cannot possibly save it.
  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setReady(data.session !== null);
    });

    // The SDK emits PASSWORD_RECOVERY once it has parsed the fragment, which
    // can land after the getSession above on a slow first paint.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled && session) setReady(true);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    // Checked before the request, not after: a typo confirmed by the server
    // would already have changed the password.
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary/40 px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <Image
            src="/logo.png"
            alt="Gold Fortune"
            width={56}
            height={56}
            className="rounded-lg"
          />
          <div>
            <h1 className="text-xl font-bold text-foreground">Gold Fortune</h1>
            <p className="text-sm text-muted-foreground">Merchandising</p>
          </div>
        </div>

        {ready === null ? (
          <div className="rounded-lg border border-border bg-card p-6 text-center shadow-sm">
            <p className="text-sm text-muted-foreground">Checking your link…</p>
          </div>
        ) : ready === false ? (
          <div className="space-y-4 rounded-lg border border-border bg-card p-6 text-center shadow-sm">
            <h2 className="text-base font-semibold text-foreground">
              This link is no longer valid
            </h2>
            <p className="text-sm text-muted-foreground">
              Password reset links expire after one hour and can only be used
              once. Request a new one to carry on.
            </p>
            <Link
              href="/forgot-password"
              className="inline-block text-sm font-medium text-primary hover:underline"
            >
              Request a new link
            </Link>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm"
          >
            <h2 className="text-base font-semibold text-foreground">
              Set a new password
            </h2>

            <div className="space-y-1.5">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
              <p className="text-xs text-muted-foreground">
                At least {MIN_PASSWORD_LENGTH} characters.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirm">Confirm new password</Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {loading ? "Saving…" : "Save new password"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
