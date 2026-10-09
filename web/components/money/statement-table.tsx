"use client";

import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { STATEMENT_KIND_LABELS, statementDetail, type StatementRow } from "@/lib/owed";
import { formatMoney } from "@/lib/money";
import { useCompanyConfig } from "@/lib/use-company-config";

/**
 * A client's account over a period: the balance brought forward, then each
 * invoice, credit note and payment with the running balance. Used by Who owes
 * you and by Statements, so a statement reads the same on both.
 *
 * An invoice's number opens the invoice. A credit note's does not: it has no
 * page of its own, and the row's id is the credit note's, not the invoice's.
 */
export function StatementTable({ rows }: { rows: StatementRow[] }) {
  const currency = useCompanyConfig()?.settings.currency_code ?? "";
  const m = (n: number) => formatMoney(n, currency);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Number</TableHead>
          <TableHead>Detail</TableHead>
          <TableHead className="text-right">Debit</TableHead>
          <TableHead className="text-right">Credit</TableHead>
          <TableHead className="text-right">Balance</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={`${r.document_id ?? "open"}-${i}`}>
            <TableCell className="whitespace-nowrap text-muted-foreground">{r.entry_date}</TableCell>
            <TableCell>{STATEMENT_KIND_LABELS[r.entry_kind] ?? r.entry_kind}</TableCell>
            <TableCell>
              {r.entry_kind === "invoice" && r.document_id ? (
                <Link href={`/invoices/${r.document_id}`} className="text-primary hover:underline">
                  {r.document_number}
                </Link>
              ) : (
                (r.document_number ?? "")
              )}
            </TableCell>
            <TableCell className="text-muted-foreground">{statementDetail(r)}</TableCell>
            <TableCell className="text-right tabular-nums">{r.debit === null ? "" : m(r.debit)}</TableCell>
            <TableCell className="text-right tabular-nums">{r.credit === null ? "" : m(r.credit)}</TableCell>
            <TableCell className="text-right tabular-nums">{m(r.balance)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
