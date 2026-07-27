import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Invite a field rep.
 *
 * Creating an auth user requires the service-role key, which bypasses RLS
 * entirely — it must never reach a browser bundle, which is why this is a Route
 * Handler and why the env var has no NEXT_PUBLIC_ prefix.
 *
 * `proxy.ts` excludes /api from its matcher, so this handler authenticates the
 * caller itself rather than relying on a redirect.
 */

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    // The caller's own org is taken from their profile, never from the request
    // body — otherwise a manager could invite a rep into someone else's org.
    const { data: profile } = await supabase
      .from("profiles")
      .select("org_id, role")
      .eq("id", user.id)
      .single();

    const caller = profile as { org_id: string; role: string } | null;
    if (caller?.role !== "manager") {
      return Response.json(
        { error: "Only managers can invite reps." },
        { status: 403 }
      );
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return Response.json(
        { error: "SUPABASE_SERVICE_ROLE_KEY is not configured on the server." },
        { status: 503 }
      );
    }

    const body = (await request.json()) as { email?: string; full_name?: string };
    const email = body.email?.trim().toLowerCase() ?? "";
    const fullName = body.full_name?.trim() ?? "";

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: "Enter a valid email address." }, { status: 400 });
    }
    if (!fullName) {
      return Response.json({ error: "Name is required." }, { status: 400 });
    }

    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      // No session handling on a server client — it is per-request and must not
      // try to persist or refresh anything.
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const origin = new URL(request.url).origin;
    const { data: invited, error: inviteError } =
      await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${origin}/login`,
        data: { full_name: fullName },
      });

    if (inviteError || !invited?.user) {
      const message = inviteError?.message ?? "Could not send the invite.";
      // Supabase reports an existing address as a 422.
      const already = /already|registered|exists/i.test(message);
      return Response.json(
        { error: already ? "That email already has an account." : message },
        { status: already ? 409 : 502 }
      );
    }

    // No trigger creates profiles on this project, so the row is ours to write.
    const { error: profileError } = await admin.from("profiles").insert({
      id: invited.user.id,
      org_id: caller.org_id,
      role: "rep",
      full_name: fullName,
      email,
    });

    if (profileError) {
      // Without a profile the account can sign in but current_org_id() returns
      // null, so RLS denies everything — a dead account nobody can fix from the
      // UI. Roll the auth user back rather than leaving that behind.
      await admin.auth.admin.deleteUser(invited.user.id);
      return Response.json(
        { error: `Invite rolled back: ${profileError.message}` },
        { status: 500 }
      );
    }

    return Response.json({ id: invited.user.id, email, full_name: fullName });
  } catch (reason) {
    const message =
      reason instanceof Error ? reason.message : "Unexpected error sending invite.";
    return Response.json({ error: message }, { status: 500 });
  }
}
