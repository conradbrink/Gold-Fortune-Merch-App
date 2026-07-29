"use client";

import { useState } from "react";
import { Check, Copy, Eye, EyeOff, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createRep, generatePassword } from "@/lib/representatives";

/**
 * Add a rep with a starting password.
 *
 * Deliberately not an email invite: reps here often have no work email, and
 * Supabase rejects the org's own @goldfortune.dev addresses outright. The
 * manager sets a password and hands it over directly, so the account works
 * immediately with no inbox involved.
 *
 * The password is shown once, on the success screen, and is never stored
 * client-side — if the manager loses it they reset it rather than look it up.
 */

export function InviteRepDialog({
  open,
  onOpenChange,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvited: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(
    null
  );
  const [copied, setCopied] = useState(false);

  function reset() {
    setFullName("");
    setEmail("");
    setPassword("");
    setReveal(false);
    setError(null);
    setCreated(null);
    setCopied(false);
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await createRep(email, fullName, password);
      setCreated({ email: email.trim().toLowerCase(), password });
      onInvited();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a rep</DialogTitle>
          <DialogDescription>
            They can sign in to the mobile app straight away with the password
            you set.
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="space-y-3">
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3">
              <p className="text-sm font-medium text-foreground">
                Account created. Give these to the rep now.
              </p>
              <dl className="mt-2 space-y-1 text-sm">
                <div className="flex gap-2">
                  <dt className="w-20 text-muted-foreground">Email</dt>
                  <dd className="font-mono text-foreground">{created.email}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-20 text-muted-foreground">Password</dt>
                  <dd className="font-mono text-foreground">{created.password}</dd>
                </div>
              </dl>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={async () => {
                  await navigator.clipboard.writeText(
                    `Email: ${created.email}\nPassword: ${created.password}`
                  );
                  setCopied(true);
                }}
              >
                {copied ? (
                  <>
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="mr-1.5 h-3.5 w-3.5" />
                    Copy details
                  </>
                )}
              </Button>
            </div>
            {/* Shown once: nothing stores it, so closing without copying means
                resetting the password rather than looking it up. */}
            <p className="text-xs text-muted-foreground">
              This password is shown once and is not saved anywhere. If it is
              lost, set a new one rather than trying to recover it.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {error && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="rep-name">Full name</Label>
              <Input
                id="rep-name"
                value={fullName}
                placeholder="Kagiso Motlhabane"
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rep-email">Email</Label>
              <Input
                id="rep-email"
                type="email"
                value={email}
                placeholder="kagiso@example.com"
                onChange={(e) => setEmail(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Used as their username. No email is sent.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rep-password">Password</Label>
              <div className="flex gap-2">
                <Input
                  id="rep-password"
                  type={reveal ? "text" : "password"}
                  value={password}
                  autoComplete="new-password"
                  onChange={(e) => setPassword(e.target.value)}
                />
                <Button
                  variant="outline"
                  size="icon"
                  title={reveal ? "Hide" : "Show"}
                  onClick={() => setReveal((v) => !v)}
                >
                  {reveal ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  title="Generate a password"
                  onClick={() => {
                    setPassword(generatePassword());
                    setReveal(true);
                  }}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                At least 8 characters.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          {created ? (
            <>
              <Button variant="outline" onClick={reset}>
                Add another
              </Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </>
          ) : (
            <Button
              onClick={submit}
              disabled={
                saving ||
                !email.trim() ||
                !fullName.trim() ||
                password.length < 8
              }
            >
              {saving ? "Creating…" : "Create rep"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
