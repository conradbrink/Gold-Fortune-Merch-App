"use client";

import { useRef, useState } from "react";
import { FileUp, Globe, Store, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import {
  AUDIENCE_LABELS,
  MAX_FILE_BYTES,
  formatBytes,
  uploadFile,
  type Audience,
} from "@/lib/files";
import type { RepSummary } from "@/lib/representatives";

/**
 * Upload one document and say who it is for.
 *
 * Audience is chosen here rather than afterwards, because a file that lands
 * with no audience is either invisible or visible to everyone, and both are the
 * wrong default for something like a price list.
 */
export function UploadFileDialog({
  open,
  onOpenChange,
  orgId,
  userId,
  reps,
  groups,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string | null;
  userId: string | null;
  reps: RepSummary[];
  groups: { id: string; name: string }[];
  onUploaded: () => void;
}) {
  const supabase = createClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [audience, setAudience] = useState<Audience>("everyone");
  const [repIds, setRepIds] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setFile(null);
    setName("");
    setDescription("");
    setAudience("everyone");
    setRepIds([]);
    setGroupIds([]);
    setError(null);
  }

  const tooBig = file !== null && file.size > MAX_FILE_BYTES;
  const needsPick =
    (audience === "reps" && repIds.length === 0) ||
    (audience === "groups" && groupIds.length === 0);

  async function handleUpload() {
    if (!file || !orgId || !userId) return;
    setBusy(true);
    setError(null);
    try {
      await uploadFile(supabase, orgId, userId, {
        file,
        name,
        description,
        audience,
        repIds,
        groupIds,
      });
      reset();
      onOpenChange(false);
      onUploaded();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload a file</DialogTitle>
          <DialogDescription>
            Reps open these on their phone, so keep them small where you can.
            Up to {formatBytes(MAX_FILE_BYTES)}.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="space-y-3">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed border-border px-6 py-8 text-center hover:bg-muted/40"
          >
            <FileUp className="h-7 w-7 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">
              {file ? file.name : "Choose a file"}
            </span>
            <span className="text-xs text-muted-foreground">
              {file
                ? formatBytes(file.size)
                : "PDF, image, spreadsheet or document"}
            </span>
          </button>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !name) setName(f.name.replace(/\.[^.]+$/, ""));
              e.target.value = "";
            }}
          />

          {tooBig && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              That file is {formatBytes(file.size)} — the limit is{" "}
              {formatBytes(MAX_FILE_BYTES)}.
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="file-name">Name</Label>
            <Input
              id="file-name"
              value={name}
              placeholder="Choppies planogram — August"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="file-description">Description (optional)</Label>
            <Input
              id="file-description"
              value={description}
              placeholder="What this is for"
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Who can see it</Label>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["everyone", Globe],
                  ["reps", Users],
                  ["groups", Store],
                ] as [Audience, typeof Globe][]
              ).map(([value, Icon]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setAudience(value)}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                    audience === value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {AUDIENCE_LABELS[value]}
                </button>
              ))}
            </div>
          </div>

          {audience === "reps" && (
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {reps.length === 0 && (
                <p className="p-2 text-sm text-muted-foreground">No active reps.</p>
              )}
              {reps.map((r) => (
                <label
                  key={r.rep_id}
                  className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={repIds.includes(r.rep_id)}
                    onChange={() =>
                      setRepIds((prev) =>
                        prev.includes(r.rep_id)
                          ? prev.filter((x) => x !== r.rep_id)
                          : [...prev, r.rep_id]
                      )
                    }
                  />
                  {r.rep_name ?? "Unnamed"}
                </label>
              ))}
            </div>
          )}

          {audience === "groups" && (
            <>
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                {groups.length === 0 && (
                  <p className="p-2 text-sm text-muted-foreground">No chains yet.</p>
                )}
                {groups.map((g) => (
                  <label
                    key={g.id}
                    className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={groupIds.includes(g.id)}
                      onChange={() =>
                        setGroupIds((prev) =>
                          prev.includes(g.id)
                            ? prev.filter((x) => x !== g.id)
                            : [...prev, g.id]
                        )
                      }
                    />
                    {g.name}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Whoever covers a store in these chains sees the file — including
                after you move stores between reps.
              </p>
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            onClick={handleUpload}
            disabled={busy || !file || tooBig || needsPick || !orgId}
          >
            {busy ? "Uploading…" : "Upload"}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
