"use client";

import { useState } from "react";
import { Check, Copy, Eye, EyeOff, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GetTheApp } from "@/components/team/get-the-app";
import { displayLogin, whatsappLink } from "@/lib/phone-login";
import { welcomeMessage } from "@/lib/welcome-message";
import { useBranding, useTerms } from "@/lib/use-company-config";

/**
 * A new login, ready to hand over in person: what they sign in with, the
 * starting password (shown once) and the code that installs the app, scanned
 * from the owner's screen. The same in a message, to copy or to send on
 * WhatsApp, for anyone not there.
 */
export function WelcomeCard({
  fullName,
  login,
  phone,
  password,
}: {
  fullName: string;
  login: string;
  /** International form, when they have a mobile number. */
  phone: string | null;
  password: string;
}) {
  const t = useTerms();
  const branding = useBranding();
  const [reveal, setReveal] = useState(false);
  const [copied, setCopied] = useState<"password" | "message" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const message = welcomeMessage({
    fullName,
    company: branding?.name ?? "",
    login,
    password,
    downloadUrl: typeof window === "undefined" ? "/download" : `${window.location.origin}/download`,
    terms: t,
  });

  async function copy(what: "password" | "message") {
    try {
      await navigator.clipboard.writeText(what === "password" ? password : message);
      setCopied(what);
      setError(null);
    } catch {
      // Refused outside a secure context or by permission. The password is
      // shown once, so say so rather than leave it looking copied.
      setReveal(true);
      setError("That could not be copied. Copy it by hand before you close this.");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 p-3 text-sm">
        <span className="font-medium">{displayLogin(login)}</span>
        <span aria-hidden>·</span>
        <span className="font-mono">{reveal ? password : "••••••••••••"}</span>
        <Button
          size="sm"
          variant="ghost"
          aria-label={reveal ? "Hide the password" : "Show the password"}
          onClick={() => setReveal((v) => !v)}
        >
          {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
        <Button size="sm" variant="ghost" aria-label="Copy the password" onClick={() => copy("password")}>
          {copied === "password" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
      <GetTheApp
        title="Install the app"
        note="They scan this code with their phone's camera, or open the link. For Android phones."
        size={112}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => copy("message")}>
          {copied === "message" ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
          Copy message
        </Button>
        <Button
          variant="outline"
          nativeButton={false}
          render={<a href={whatsappLink(phone, message)} target="_blank" rel="noopener noreferrer" />}
        >
          <MessageCircle className="mr-1.5 h-4 w-4" aria-hidden /> Send on WhatsApp
        </Button>
      </div>
      <pre className="whitespace-pre-wrap rounded-md border border-border p-3 font-sans text-xs text-muted-foreground">
        {reveal ? message : message.split(password).join("••••••••")}
      </pre>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
