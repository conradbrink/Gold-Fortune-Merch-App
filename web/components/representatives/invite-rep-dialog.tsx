"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
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
import { inviteRep } from "@/lib/representatives";

/**
 * Invite a rep by email.
 *
 * The actual account creation happens in `/api/reps/invite`, because it needs
 * the service-role key. The rep receives a Supabase invite email and sets their
 * own password — no password is ever typed, transmitted or stored here.
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
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  function reset() {
    setFullName("");
    setEmail("");
    setError(null);
    setSentTo(null);
  }

  async function submit() {
    setSending(true);
    setError(null);
    try {
      const result = await inviteRep(email, fullName);
      setSentTo(result.email);
      setFullName("");
      setEmail("");
      onInvited();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a rep</DialogTitle>
          <DialogDescription>
            They&rsquo;ll get an email to set their own password, then can sign
            in to the mobile app.
          </DialogDescription>
        </DialogHeader>

        {sentTo ? (
          <div className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5 text-sm">
            <Mail className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <p className="text-foreground">
              Invite sent to <span className="font-medium">{sentTo}</span>. They
              appear in the list now and can be assigned stores straight away.
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
                placeholder="Jane Mokoena"
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rep-email">Email</Label>
              <Input
                id="rep-email"
                type="email"
                value={email}
                placeholder="jane@example.com"
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {sentTo ? (
            <>
              <Button variant="outline" onClick={() => setSentTo(null)}>
                Invite another
              </Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </>
          ) : (
            <Button
              onClick={submit}
              disabled={sending || !email.trim() || !fullName.trim()}
            >
              {sending ? "Sending…" : "Send invite"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
