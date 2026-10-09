import { createClient } from "@/lib/supabase/server";
import { appUrl, signLink } from "@/lib/email/links";

/**
 * The client link to a finished job's report (Stage 8.3), for "Open report"
 * and "Copy link" in the app. The database checks the person may read
 * reports or invoices and that the job is their company's and finished
 * (`job_report_for_visit`); only then is the id signed into a link.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ visitId: string }> }) {
  const { visitId } = await params;
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { data, error } = await supabase.rpc("job_report_for_visit", { p_visit_id: visitId });
  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 400;
    return Response.json({ error: error.message }, { status });
  }
  return Response.json({ url: `${appUrl()}/c/report/${signLink("report", String(data))}` });
}
