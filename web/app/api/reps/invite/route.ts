import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Create a field rep with a starting password.
 *
 * Deliberately not an email invite. Reps here often have no work email, and
 * Supabase rejects the org's own @goldfortune.dev addresses outright, so an
 * email-dependent flow cannot onboard the people it needs to. The manager sets
 * a password and hands it over directly; `email_confirm` is set so the account
 * is usable immediately with no email round trip.
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

    const body = (await request.json()) as {
      email?: string;
      full_name?: string;
      password?: string;
    };
    const email = body.email?.trim().toLowerCase() ?? "";
    const fullName = body.full_name?.trim() ?? "";
    const password = body.password ?? "";

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: "Enter a valid email address." }, { status: 400 });
    }
    if (!fullName) {
      return Response.json({ error: "Name is required." }, { status: 400 });
    }
    if (password.length < 8) {
      return Response.json(
        { error: "Password must be at least 8 characters." },
        { status: 400 }
      );
    }

    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      // No session handling on a server client — it is per-request and must not
      // try to persist or refresh anything.
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // email_confirm skips the confirmation mail — the rep is handed their
    // password in person, so there is nothing to confirm and no inbox to rely on.
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (createError || !created?.user) {
      const message = createError?.message ?? "Could not create the account.";
      const already = /already|registered|exists/i.test(message);
      return Response.json(
        { error: already ? "That email already has an account." : message },
        { status: already ? 409 : 502 }
      );
    }
    const invited = created;

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
        { error: `Account creation rolled back: ${profileError.message}` },
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
