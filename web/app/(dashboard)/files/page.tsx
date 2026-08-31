"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Download,
  ExternalLink,
  FileText,
  MoreHorizontal,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UploadFileDialog } from "@/components/files/upload-dialog";
import { AudienceControl } from "@/components/files/audience-control";
import { createClient } from "@/lib/supabase/client";
import { fetchOrgId, fetchRepDirectory, type RepSummary } from "@/lib/representatives";
import {
  AUDIENCE_LABELS,
  deleteFile,
  fetchFiles,
  formatBytes,
  setAudience,
  signFile,
  type Audience,
  type FileRow,
} from "@/lib/files";

/**
 * Shared documents the manager controls.
 *
 * Reps never see this page — `proxy.ts` sends them to `/rep-notice` — so this
 * is purely the upload-and-share side. What a rep can open is decided by the
 * `files` RLS policy, not by anything here.
 */
export default function FilesPage() {
  const supabase = createClient();

  const [files, setFiles] = useState<FileRow[]>([]);
  const [reps, setReps] = useState<RepSummary[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /**
   * Every file with a write in flight, not just the most recent one.
   *
   * A single id cannot describe two at once: whichever write settled first
   * re-enabled *both* controls while one was still pending.
   */
  const [busyFiles, setBusyFiles] = useState<ReadonlySet<string>>(() => new Set());

  function markBusy(id: string) {
    setBusyFiles((prev) => new Set(prev).add(id));
  }

  /** Only this file's id — another may still be writing, and it clears its own. */
  function clearBusy(id: string) {
    setBusyFiles((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }
  const [uploadOpen, setUploadOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [audienceFilter, setAudienceFilter] = useState("all");
  const [confirmDelete, setConfirmDelete] = useState<FileRow | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [rows, repRows, groupRes] = await Promise.all([
        fetchFiles(supabase),
        fetchRepDirectory(supabase),
        supabase.from("store_groups").select("id, name").order("name"),
      ]);
      setFiles(rows);
      setReps(repRows.filter((r) => r.is_active));
      setGroups((groupRes.data ?? []) as { id: string; name: string }[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    fetchOrgId(supabase).then(setOrgId).catch(() => setOrgId(null));
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    // Seeded from `?q=` so the header search lands here already filtered.
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) setQuery(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return files.filter((f) => {
      if (audienceFilter !== "all" && f.audience !== audienceFilter) return false;
      if (!q) return true;
      return `${f.name} ${f.description ?? ""}`.toLowerCase().includes(q);
    });
  }, [files, query, audienceFilter]);

  /** Audience edits apply locally first — the list must not jump on every tick. */
  async function changeAudience(
    file: FileRow,
    audience: Audience,
    repIds: string[],
    groupIds: string[]
  ) {
    // The previous *values*, not a snapshot of the whole list. Files are
    // written concurrently, so restoring the list as it was before this click
    // would also undo an audience another row successfully changed in the
    // meantime — and who can see a file is exactly the wrong thing to get
    // silently wrong.
    const previous = {
      audience: file.audience,
      rep_ids: file.rep_ids,
      group_ids: file.group_ids,
    };
    markBusy(file.id);
    setError(null);
    setFiles((prev) =>
      prev.map((f) =>
        f.id === file.id
          ? { ...f, audience, rep_ids: repIds, group_ids: groupIds }
          : f
      )
    );
    try {
      await setAudience(supabase, file.id, audience, repIds, groupIds);
    } catch (e) {
      setFiles((prev) =>
        prev.map((f) => (f.id === file.id ? { ...f, ...previous } : f))
      );
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      clearBusy(file.id);
    }
  }

  async function open(file: FileRow, download: boolean) {
    setError(null);
    const url = await signFile(supabase, file.storage_path, download);
    if (!url) {
      setError(`Could not open ${file.name}. The stored file may be missing.`);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function remove(file: FileRow) {
    markBusy(file.id);
    setError(null);
    try {
      await deleteFile(supabase, file);
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
      setConfirmDelete(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      clearBusy(file.id);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Files
          </h1>
          <p className="text-sm text-muted-foreground">
            Planograms, price lists and notices. Reps see these on their phone.
          </p>
        </div>
        <Button className="gap-1.5" onClick={() => setUploadOpen(true)} disabled={!orgId}>
          <Upload className="h-4 w-4" />
          Upload
        </Button>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="w-full min-w-0 sm:w-auto sm:flex-1">
          <Input
            placeholder="Search files"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-52">
          <NativeSelect
            value={audienceFilter}
            onChange={(e) => setAudienceFilter(e.target.value)}
            aria-label="Filter by audience"
          >
            <option value="all">Any audience</option>
            {(Object.keys(AUDIENCE_LABELS) as Audience[]).map((a) => (
              <option key={a} value={a}>
                {AUDIENCE_LABELS[a]}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {loading ? (
        <div className="rounded-lg border border-border bg-card py-16 text-center text-sm text-muted-foreground">
          Loading files…
        </div>
      ) : files.length === 0 ? (
        <div className="space-y-2 rounded-lg border border-border bg-card py-16 text-center">
          <p className="text-sm font-medium text-foreground">No files yet.</p>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            Upload a planogram or price list and choose who it is for. Tagging a
            chain means whoever covers those stores sees it, including after you
            move stores between reps.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>File</TableHead>
                <TableHead>Who can see it</TableHead>
                <TableHead className="hidden md:table-cell">Size</TableHead>
                <TableHead className="hidden lg:table-cell">Updated</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((f) => (
                <TableRow key={f.id} className={busyFiles.has(f.id) ? "opacity-60" : ""}>
                  <TableCell className="min-w-[200px] max-w-[340px]">
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                        <FileText className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => open(f, false)}
                          className="truncate text-left font-medium text-primary hover:underline"
                        >
                          {f.name}
                        </button>
                        <p className="truncate text-xs text-muted-foreground">
                          {f.description ?? f.mime_type ?? "—"}
                        </p>
                        <p className="truncate text-xs text-muted-foreground md:hidden">
                          {formatBytes(f.size_bytes)}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <AudienceControl
                      file={f}
                      reps={reps}
                      groups={groups}
                      disabled={busyFiles.has(f.id)}
                      onChange={(a, r, g) => changeAudience(f, a, r, g)}
                    />
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap text-sm text-muted-foreground md:table-cell">
                    {formatBytes(f.size_bytes)}
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap text-sm text-muted-foreground lg:table-cell">
                    {new Date(f.updated_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem className="gap-2" onClick={() => open(f, false)}>
                          <ExternalLink className="h-4 w-4" />
                          Open
                        </DropdownMenuItem>
                        <DropdownMenuItem className="gap-2" onClick={() => open(f, true)}>
                          <Download className="h-4 w-4" />
                          Download
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="gap-2 text-destructive"
                          onClick={() => setConfirmDelete(f)}
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
              {visible.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                    No files match those filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {confirmDelete && (
        <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
          <p className="text-sm font-medium text-destructive">
            Delete “{confirmDelete.name}”?
          </p>
          <p className="text-xs text-foreground">
            It disappears from every rep&rsquo;s phone. Copies already downloaded
            to a phone stay there until that rep next opens the app.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={busyFiles.has(confirmDelete.id)}
              onClick={() => remove(confirmDelete)}
            >
              {busyFiles.has(confirmDelete.id) ? "Deleting…" : "Delete"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <UploadFileDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        orgId={orgId}
        userId={userId}
        reps={reps}
        groups={groups}
        onUploaded={load}
      />
    </div>
  );
}
