"use client";

import { useState, useTransition } from "react";
import { SignaturePad } from "@/components/client-report/signature-pad";
import { signReport } from "@/app/c/report/[token]/actions";

/** Name, signature and "Sign off": the client accepts the job. */
export function SignOffForm({ token, jobWord }: { token: string; jobWord: string }) {
  const [name, setName] = useState("");
  const [strokes, setStrokes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await signReport(token, name, strokes);
          if (!r.ok) setError(r.error);
        });
      }}
    >
      <div className="space-y-1.5">
        <label htmlFor="signer-name" className="text-sm font-medium text-foreground">
          Your name
        </label>
        <input
          id="signer-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          maxLength={120}
          className="h-11 w-full rounded-md bg-background px-3 text-base ring-1 ring-foreground/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
      </div>
      <SignaturePad onChange={setStrokes} />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending || !name.trim() || strokes.length < 5}
        className="inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-transform hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.98] disabled:opacity-50"
      >
        {pending ? "Signing…" : `Sign off this ${jobWord.toLowerCase()}`}
      </button>
    </form>
  );
}
