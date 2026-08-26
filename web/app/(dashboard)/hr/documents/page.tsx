"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DocumentDialog } from "@/components/hr/document-dialog";
import { createClient } from "@/lib/supabase/client";
import { useHrLoad } from "@/lib/hr/use-load";
import { usePermissions } from "@/lib/use-permissions";
import { can } from "@/lib/permissions";
import { formatDateOnly } from "@/lib/format-date";
import { fetchEmployees, fetchOrgId, type EmployeeRow } from "@/lib/hr/employees";
import { fetchHrReference, type HrReference } from "@/lib/hr/settings";
import {
  contractExpiry,
  deleteDocument,
  fetchDocuments,
  signedDocumentUrl,
  summariseExpiry,
  type DocumentRow,
} from "@/lib/hr/documents";
import {
  EXPIRY_LABELS,
  expiryBucket,
  formatBytes,
  lookupLabel,
  lookupsOfKind,
  type ExpiryBucket,
} from "@/lib/hr/types";

/**
 * Every HR document, filtered by the thing people actually come here for:
 * what has expired and what is about to.
 *
 * Contracts are listed alongside documents rather than under them. A contract's
 * end date is an employment fact that exists whether or not anybody uploaded
 * the PDF, so hanging its expiry off an attachment would mean an unfiled
 * contract silently never expires — which is precisely the contract you would
 * want to be warned about.
 */
export default function HrDocumentsPage() {
  const supabase = createClient();
  const permissions = usePermissions();
  const isHr = permissions !== null && can(permissions, "hr");

  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [reference, setReference] = useState<HrReference | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [bucket, setBucket] = useState<string>("");
  const [employeeId, setEmployeeId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<DocumentRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: auth } = await supabase.auth.getUser();
      setUserId(auth.user?.id ?? null);
      const [d, e, r, org] = await Promise.all([
        fetchDocuments(supabase),
        fetchEmployees(supabase),
        fetchHrReference(supabase),
        fetchOrgId(supabase),
      ]);
      setDocuments(d);
      setEmployees(e);
      setReference(r);
      setOrgId(org);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useHrLoad(load);

  const summary = useMemo(() => summariseExpiry(documents), [documents]);

  const expiringContracts = useMemo(
    () =>
      employees
        .map((e) => ({ employee: e, bucket: contractExpiry(e) }))
        .filter(
          (x): x is { employee: EmployeeRow; bucket: ExpiryBucket } =>
            x.bucket !== null && x.bucket !== "valid"
        )
        .sort((a, b) =>
          (a.employee.contract_end_date ?? "").localeCompare(
            b.employee.contract_end_date ?? ""
          )
        ),
    [employees]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return documents.filter((d) => {
      if (category && d.category !== category) return false;
      if (employeeId && d.employee_id !== employeeId) return false;
      if (bucket && expiryBucket(d.expiry_date) !== bucket) return false;
      if (!q) return true;
      return [d.name, d.employee?.full_name, d.notes]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [documents, query, category, employeeId, bucket]);

  async function open(path: string) {
    try {
      const url = await signedDocumentUrl(supabase, path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            HR documents
          </h1>
          <p className="text-sm text-muted-foreground">
            {documents.length} filed · readable only by HR and each
            employee&rsquo;s management chain
          </p>
        </div>
        {isHr && (
          <Button className="gap-1.5" onClick={() => setUploading(true)}>
            <Upload className="h-4 w-4" /> Upload
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <p className="font-medium">Something went wrong</p>
          <p className="mt-1">{error}</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ExpiryTile
          label="Expired"
          value={summary.expired}
          tone="destructive"
          onClick={() => setBucket(bucket === "expired" ? "" : "expired")}
          active={bucket === "expired"}
        />
        <ExpiryTile
          label="Within 7 days"
          value={summary.expiring_7}
          tone="warn"
          onClick={() => setBucket(bucket === "expiring_7" ? "" : "expiring_7")}
          active={bucket === "expiring_7"}
        />
        <ExpiryTile
          label="Within 30 days"
          value={summary.expiring_30}
          onClick={() => setBucket(bucket === "expiring_30" ? "" : "expiring_30")}
          active={bucket === "expiring_30"}
        />
        <ExpiryTile
          label="Valid"
          value={summary.valid}
          note="Includes documents with no expiry date"
          onClick={() => setBucket(bucket === "valid" ? "" : "valid")}
          active={bucket === "valid"}
        />
      </div>

      {expiringContracts.length > 0 && (
        <Card>
          <CardContent className="space-y-3 p-5">
            <h2 className="text-sm font-semibold">Contracts</h2>
            <ul className="space-y-1.5">
              {expiringContracts.map(({ employee, bucket: b }) => (
                <li key={employee.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <Link
                    href={`/hr/employees/${employee.id}`}
                    className="font-medium hover:underline"
                  >
                    {employee.full_name}
                  </Link>
                  <span className="text-muted-foreground">
                    ends {formatDateOnly(employee.contract_end_date)}
                  </span>
                  <Badge
                    variant={b === "expired" ? "destructive" : "outline"}
                    className="font-normal"
                  >
                    {EXPIRY_LABELS[b]}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Search documents…"
          className="max-w-xs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <NativeSelect
          className="w-[13rem]"
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
        >
          <option value="">All employees</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.full_name ?? e.employee_number}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          className="w-[13rem]"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {lookupsOfKind(reference?.lookups ?? [], "document_category").map((c) => (
            <option key={c.id} value={c.code}>
              {c.label}
            </option>
          ))}
        </NativeSelect>
      </div>

      <Card>
        <CardContent className="px-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-9 animate-pulse rounded bg-muted/50" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {documents.length === 0
                ? "Nothing filed yet."
                : "No documents match those filters."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead className="hidden md:table-cell">Category</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead className="hidden lg:table-cell">Uploaded by</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((d) => {
                  const b = expiryBucket(d.expiry_date);
                  return (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">
                        {d.name}
                        <span className="block text-xs font-normal text-muted-foreground">
                          {formatBytes(d.size_bytes)}
                          {d.notes ? ` · ${d.notes}` : ""}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">
                        <Link
                          href={`/hr/employees/${d.employee_id}`}
                          className="hover:underline"
                        >
                          {d.employee?.full_name ?? "—"}
                        </Link>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {lookupLabel(
                          reference?.lookups ?? [],
                          "document_category",
                          d.category
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {d.expiry_date ? (
                          <Badge
                            variant={
                              b === "expired"
                                ? "destructive"
                                : b === "valid"
                                  ? "outline"
                                  : "secondary"
                            }
                            className="font-normal"
                          >
                            {formatDateOnly(d.expiry_date)}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">No expiry</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                        {d.uploader?.full_name ?? "—"}
                        <span className="block text-xs">
                          {formatDateOnly(d.created_at.slice(0, 10))}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => open(d.storage_path)}
                          >
                            Open
                          </Button>
                          {isHr && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setEditing(d)}
                              >
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={async () => {
                                  if (
                                    !window.confirm(
                                      `Delete "${d.name}"? The file is removed and the deletion is recorded in the audit trail.`
                                    )
                                  )
                                    return;
                                  try {
                                    await deleteDocument(supabase, d);
                                    await load();
                                  } catch (e) {
                                    setError(
                                      e instanceof Error ? e.message : String(e)
                                    );
                                  }
                                }}
                              >
                                Delete
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <DocumentDialog
        open={uploading || editing !== null}
        onOpenChange={(o) => {
          if (!o) {
            setUploading(false);
            setEditing(null);
          }
        }}
        orgId={orgId}
        userId={userId}
        employeeId={editing?.employee_id ?? (employeeId || employees[0]?.id) ?? null}
        employeeName={
          editing?.employee?.full_name ??
          employees.find((e) => e.id === employeeId)?.full_name ??
          employees[0]?.full_name ??
          "employee"
        }
        lookups={reference?.lookups ?? []}
        existing={editing}
        onSaved={load}
      />
    </div>
  );
}

function ExpiryTile({
  label,
  value,
  note,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number;
  note?: string;
  tone?: "destructive" | "warn";
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-lg border p-4 text-left transition-colors " +
        (active
          ? "border-primary bg-primary/5"
          : "border-border bg-card hover:bg-muted/40")
      }
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={
          "mt-1 text-2xl font-bold tabular-nums " +
          (tone === "destructive"
            ? "text-destructive"
            : tone === "warn"
              ? "text-amber-600 dark:text-amber-400"
              : "text-foreground")
        }
      >
        {value}
      </p>
      {note && <p className="mt-1 text-[11px] text-muted-foreground">{note}</p>}
    </button>
  );
}
