"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      // Built from the browser's own origin rather than a configured constant,
      // so this works on localhost, on a Vercel preview and on the production
      // domain without a per-environment setting to forget. The origin must
      // still be listed under Supabase → Authentication → URL Configuration,
      // or the link in the email is rejected on arrival.
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // Shown whether or not the address exists. Saying "no such account" here
    // turns this form into a way to find out who has one.
    setSent(true);
    setLoading(false);
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

        {sent ? (
          <div className="space-y-4 rounded-lg border border-border bg-card p-6 text-center shadow-sm">
            <h2 className="text-base font-semibold text-foreground">
              Check your email
            </h2>
            <p className="text-sm text-muted-foreground">
              If an account exists for <strong>{email.trim()}</strong>, a link
              to set a new password is on its way. The link expires after one
              hour.
            </p>
            <Link
              href="/login"
              className="inline-block text-sm font-medium text-primary hover:underline"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm"
          >
            <div className="space-y-1.5">
              <h2 className="text-base font-semibold text-foreground">
                Reset your password
              </h2>
              <p className="text-sm text-muted-foreground">
                Enter the email address for your account and we will send you a
                link to set a new password.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
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
              {loading ? "Sending…" : "Send reset link"}
            </Button>

            <Link
              href="/login"
              className="block text-center text-sm text-muted-foreground hover:underline"
            >
              Back to sign in
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
