"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { ProductBrand } from "@/components/product-brand";
import { browserCountries, loginCandidates } from "@/lib/phone-login";
import { returnPath } from "@/lib/return-path";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Staff without email sign in with their phone number. The browser does
    // not know the company yet, so a number without its country code is read
    // in each country the browser's languages name, until one signs in.
    const languages = typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language];
    const logins = loginCandidates(email, browserCountries(languages));
    if (logins.length === 0) {
      setError("Type your email address, or your phone number with its country code (it starts with +).");
      setLoading(false);
      return;
    }
    let failure: string | null = null;
    for (const login of logins) {
      const { error } = await supabase.auth.signInWithPassword({ email: login, password });
      if (!error) {
        failure = null;
        break;
      }
      failure = error.message;
      if (!/invalid login credentials/i.test(error.message)) break;
    }

    if (failure) {
      setError(failure);
      setLoading(false);
      return;
    }

    // Back to the page that sent them here (the proxy passes it as `?next=`).
    // Read at submit time rather than with useSearchParams, which would need
    // a Suspense boundary around the whole form.
    router.push(returnPath(new URLSearchParams(window.location.search).get("next")));
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary/40 px-4">
      <div className="w-full max-w-sm space-y-6">
        <ProductBrand />

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm"
        >
          <div className="space-y-1.5">
            <Label htmlFor="email">Email or phone number</Label>
            <Input
              id="email"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
            {loading ? "Signing in…" : "Sign in"}
          </Button>

          <Link
            href="/forgot-password"
            className="block text-center text-sm text-muted-foreground hover:underline"
          >
            Forgot your password?
          </Link>
        </form>

        {/* No company is known before sign-in, so this cannot name its words
            for staff or the screens it has: the warehouse is a module some
            companies do not have. */}
        <p className="text-center text-xs text-muted-foreground">
          Accounts are created by your company&apos;s managers, who hand you a
          starting password — there is no public sign-up.
        </p>
      </div>
    </div>
  );
}
