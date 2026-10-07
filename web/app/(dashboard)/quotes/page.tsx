"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ErrorBanner, EmptyRow } from "@/components/warehouse/stat-tile";
import {
  fetchQuotes,
  isExpired,
  QUOTE_STATUS_LABELS,
  type QuoteListRow,
} from "@/lib/quotes";

/**
 * Every quote, newest first.
 *
 * Expired is worked out from the valid-until date rather than stored, so a
 * quote does not need anybody to come along and mark it — and extending the
 * date brings it straight back.
 */
export default function QuotesPage() {
  const supabase = createClient();
  const router = useRouter();
  const [quotes, setQuotes] = useState<QuoteListRow[]>([]);
  const [status, setStatus] = useState("open");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchQuotes(supabase);
        if (!cancelled) {
          setQuotes(rows);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return quotes.filter((row) => {
      if (status === "open" && !["draft", "sent", "accepted"].includes(row.status)) return false;
      if (status !== "open" && status !== "all" && row.status !== status) return false;
      if (!q) return true;
      return (
        row.quote_number.toLowerCase().includes(q) ||
        (row.store_name ?? "").toLowerCase().includes(q) ||
        (row.contact_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [quotes, status, search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Quotes</h1>
          <p className="text-sm text-muted-foreground">
            Priced offers. The warehouse sees nothing until one is converted to an order.
          </p>
        </div>
        <Button nativeButton={false} render={<Link href="/quotes/new" />}>
          <Plus className="mr-1.5 h-4 w-4" /> New quote
        </Button>
      </div>

      <ErrorBanner message={error} />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search quote number, store or contact"
            className="pl-8"
            aria-label="Search quotes"
          />
        </div>
        <NativeSelect
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Status"
          className="w-44"
        >
          <option value="open">Open</option>
          <option value="all">All statuses</option>
          {Object.entries(QUOTE_STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Quote</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Store</TableHead>
              <TableHead>Valid until</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <EmptyRow colSpan={6}>Loading…</EmptyRow>}
            {!loading && visible.length === 0 && (
              <EmptyRow colSpan={6}>
                {quotes.length === 0 ? "No quotes yet." : "No quotes match."}
              </EmptyRow>
            )}
            {visible.map((q) => {
              const expired = isExpired(q);
              return (
                <TableRow
                  key={q.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/quotes/${q.id}`)}
                >
                  <TableCell className="font-medium">
                    <Link href={`/quotes/${q.id}`} className="text-primary hover:underline">
                      {q.quote_number}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {new Date(q.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    {q.store_name}
                    {q.contact_name && (
                      <div className="text-xs text-muted-foreground">{q.contact_name}</div>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {q.valid_until ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={expired ? "destructive" : "secondary"}>
                      {expired ? "Expired" : (QUOTE_STATUS_LABELS[q.status] ?? q.status)}
                    </Badge>
                    {q.order_number && (
                      <div className="mt-0.5 text-xs text-muted-foreground">{q.order_number}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {q.total_incl_vat.toFixed(2)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
