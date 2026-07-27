import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Permanently delete a rep.
 *
 * This is genuinely destructive. Every rep-owned table cascades from `profiles`
 * — visits, photos, form_submissions (and their responses), workday_sessions,
 * routes, location_pings, store_assignments — and `profiles` itself cascades
 * from `auth.users`. Deleting a rep therefore erases their entire history and
 * retroactively changes every report that covered it.
 *
 * Deactivating (`profiles.is_active = false`) is the right answer in almost
 * every real case; this exists for genuine mistakes, like an invite sent to the
 * wrong address.
 *
 * Needs the service-role key to remove the auth user, which is why it is a
 * Route Handler rather than a browser call.
 */

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    // Next 15+ made route params a Promise; awaiting is required.
    const { id } = await ctx.params;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("org_id, role")
      .eq("id", user.id)
      .single();
    const caller = profile as { org_id: string; role: string } | null;

    if (caller?.role !== "manager") {
      return Response.json(
        { error: "Only managers can delete reps." },
        { status: 403 }
      );
    }
    if (id === user.id) {
      return Response.json(
        { error: "You cannot delete your own account." },
        { status: 400 }
      );
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return Response.json(
        { error: "SUPABASE_SERVICE_ROLE_KEY is not configured on the server." },
        { status: 503 }
      );
    }

    // Confirm the target is a rep in the CALLER'S org before handing the
    // service-role key a user id. Without this check a manager could delete
    // any account in any organisation by guessing an id — the admin client
    // bypasses RLS entirely.
    const { data: target } = await supabase
      .from("profiles")
      .select("id, org_id, role")
      .eq("id", id)
      .single();
    const victim = target as { id: string; org_id: string; role: string } | null;

    if (!victim || victim.org_id !== caller.org_id) {
      return Response.json({ error: "Rep not found." }, { status: 404 });
    }
    if (victim.role !== "rep") {
      return Response.json(
        { error: "Only field reps can be deleted here." },
        { status: 400 }
      );
    }

    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // profiles.id references auth.users(id) on delete cascade, so removing the
    // auth user takes the profile and everything hanging off it.
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) {
      return Response.json({ error: error.message }, { status: 502 });
    }

    return Response.json({ deleted: id });
  } catch (reason) {
    const message =
      reason instanceof Error ? reason.message : "Unexpected error deleting rep.";
    return Response.json({ error: message }, { status: 500 });
  }
}
