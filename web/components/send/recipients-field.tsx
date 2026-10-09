"use client";

import { useCallback, useState } from "react";
import { X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addAddresses, MAX_ADDRESSES } from "@/lib/document-sends";

/**
 * The "To" box's state, kept by the dialog so Send can take what is still
 * typed in the box: the person who types an address and presses Send has
 * not forgotten to press Enter.
 */
export function useRecipients() {
  const [addresses, setAddresses] = useState<string[]>([]);
  const [typed, setTyped] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  /** Adds what is typed (or the text given); the full list, or null when it cannot be added. */
  const commit = useCallback(
    (text: string = typed): string[] | null => {
      if (!text.trim()) return addresses;
      const next = addAddresses(addresses, text);
      if (next.error) {
        // Keep what was typed, without the comma or space that set this off, for the person to fix.
        setTyped(text.replace(/[,;\s]+$/, ""));
        setProblem(next.error);
        return null;
      }
      setAddresses(next.addresses);
      setTyped("");
      setProblem(null);
      return next.addresses;
    },
    [addresses, typed]
  );

  /** The addresses found for the document: used unless the person has already chosen their own. */
  const setDefaults = useCallback((found: string[]) => {
    setAddresses((now) => (now.length ? now : found));
  }, []);

  return {
    addresses,
    typed,
    problem,
    commit,
    setDefaults,
    setTyped: (v: string) => {
      setTyped(v);
      setProblem(null);
    },
    remove: (address: string) => setAddresses((now) => now.filter((a) => a !== address)),
  };
}

export type Recipients = ReturnType<typeof useRecipients>;

/** Who the email goes to: the addresses found, each one removable, and a box to add another. */
export function RecipientsField({ recipients, disabled, loading }: { recipients: Recipients; disabled?: boolean; loading?: boolean }) {
  const full = recipients.addresses.length >= MAX_ADDRESSES;
  return (
    <div className="space-y-1.5">
      <Label htmlFor="send-to">To</Label>
      {recipients.addresses.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Sending to">
          {recipients.addresses.map((a) => (
            <li
              key={a}
              className="flex min-h-7 max-w-full items-center gap-1 rounded-full bg-muted py-0.5 pr-1 pl-2.5 text-sm text-foreground"
            >
              <span className="min-w-0 truncate">{a}</span>
              <button
                type="button"
                aria-label={`Remove ${a}`}
                disabled={disabled}
                onClick={() => recipients.remove(a)}
                className="grid size-6 shrink-0 place-content-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Input
        id="send-to"
        type="text"
        inputMode="email"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        value={recipients.typed}
        disabled={disabled || full}
        aria-invalid={!!recipients.problem}
        aria-describedby={recipients.problem ? "send-to-problem" : undefined}
        placeholder={
          loading ? "Looking for their address…" : recipients.addresses.length ? "Add another address" : "name@example.com"
        }
        onChange={(e) => {
          // A comma, semicolon or space ends an address: typed, or at the end of what was pasted.
          // (A phone's keyboard sends no key to catch, only the text.)
          const v = e.target.value;
          if (/[,;\s]$/.test(v) && v.replace(/[,;\s]/g, "")) recipients.commit(v);
          else recipients.setTyped(v);
        }}
        onKeyDown={(e) => {
          // Enter on an empty box sends the form; with something typed it adds the address.
          if (e.key === "," || (e.key === "Enter" && recipients.typed.trim())) {
            e.preventDefault();
            if (recipients.typed.trim()) recipients.commit();
          }
        }}
        onBlur={() => {
          // A finished address is kept when the person moves on; half of one is left for them to finish.
          if (recipients.typed.trim() && /@.+\..+/.test(recipients.typed)) recipients.commit();
        }}
      />
      {recipients.problem && (
        <p id="send-to-problem" role="alert" className="text-xs text-destructive">
          {recipients.problem}
        </p>
      )}
      {full && !recipients.problem && (
        <p className="text-xs text-muted-foreground">That is the most we can send to at once ({MAX_ADDRESSES}).</p>
      )}
    </div>
  );
}

/** A tick box with its words beside it. */
export function TickField({
  checked,
  onChange,
  disabled,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-h-8 items-center gap-2 text-sm text-foreground">
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={(v) => onChange(v === true)} />
      <span className="min-w-0 text-pretty">{children}</span>
    </label>
  );
}
