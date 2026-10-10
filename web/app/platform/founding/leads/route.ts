import { notFound } from "next/navigation";
import { leadsCsv } from "@/lib/leads-csv";
import { operatorCheck } from "@/lib/operator";
import { listTemplates, platformAdminClient } from "@/lib/platform";

/**
 * Platform operator: every Founding application as a CSV file (name, email,
 * WhatsApp, business and where they came from). Same gate as the page: an
 * operator session, and a 404 for anyone else.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const { user, isOperator, error } = await operatorCheck();
  if (error) throw error;
  if (!user || !isOperator) notFound();

  const [{ data, error: listError }, templates] = await Promise.all([
    platformAdminClient()
      .from("founding_applications")
      .select("created_at, name, email, whatsapp, business_name, trade, town, status, source")
      .order("created_at", { ascending: false }),
    listTemplates().catch(() => []),
  ]);
  if (listError) throw listError;

  const body = leadsCsv(data ?? [], (code) => templates.find((t) => t.code === code)?.name ?? code);
  const day = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tickd-founding-leads-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
