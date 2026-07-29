import {
  createClient as createAdminClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";

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

/**
 * Shared guard: the caller must be a manager, and the target must be a rep in
 * that same org.
 *
 * The org check is load-bearing. The admin client below bypasses RLS entirely,
 * so without it a manager could act on any account in any organisation by
 * guessing a uuid.
 */
async function authorise(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: Response.json({ error: "Not authenticated." }, { status: 401 }) };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id, role")
    .eq("id", user.id)
    .single();
  const caller = profile as { org_id: string; role: string } | null;

  if (caller?.role !== "manager") {
    return {
      error: Response.json({ error: "Managers only." }, { status: 403 }),
    };
  }
  if (id === user.id) {
    return {
      error: Response.json(
        { error: "You cannot change your own account here." },
        { status: 400 }
      ),
    };
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      error: Response.json(
        { error: "SUPABASE_SERVICE_ROLE_KEY is not configured on the server." },
        { status: 503 }
      ),
    };
  }

  const { data: target } = await supabase
    .from("profiles")
    .select("id, org_id, role")
    .eq("id", id)
    .single();
  const victim = target as { id: string; org_id: string; role: string } | null;

  if (!victim || victim.org_id !== caller.org_id) {
    return { error: Response.json({ error: "Rep not found." }, { status: 404 }) };
  }
  if (victim.role !== "rep") {
    return {
      error: Response.json(
        { error: "Only field reps can be changed here." },
        { status: 400 }
      ),
    };
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  return { admin, supabase };
}

/**
 * Move a rep's sign-in address.
 *
 * Three copies have to agree: `auth.users.email` is the credential,
 * `auth.identities` holds the email identity GoTrue actually authenticates
 * against, and `profiles.email` is the mirror the dashboard reads. Only the
 * admin API moves the first two together — writing `profiles.email` alone
 * would change what the manager sees while the rep still signs in with the old
 * address, which is worse than not offering this at all.
 */
async function changeEmail(admin: SupabaseClient, id: string, raw: string) {
  const email = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const { data: before } = await admin.auth.admin.getUserById(id);
  const previous = before?.user?.email ?? null;

  const { error: authError } = await admin.auth.admin.updateUserById(id, {
    email,
    // The rep is handed their details in person; there is no inbox to confirm.
    email_confirm: true,
  });
  if (authError) {
    const taken = /already|registered|exists/i.test(authError.message);
    return Response.json(
      { error: taken ? "That email already has an account." : authError.message },
      { status: taken ? 409 : 502 }
    );
  }

  const { error: profileError } = await admin
    .from("profiles")
    .update({ email })
    .eq("id", id);
  if (profileError && previous) {
    // Put the credential back rather than leave the login and the dashboard
    // disagreeing about who this person is.
    await admin.auth.admin.updateUserById(id, {
      email: previous,
      email_confirm: true,
    });
    return Response.json(
      { error: `Email change rolled back: ${profileError.message}` },
      { status: 500 }
    );
  }

  return Response.json({ id, email });
}

/** Sets a new password. The value is never echoed back. */
async function setPassword(admin: SupabaseClient, id: string, password: string) {
  if (password.length < 8) {
    return Response.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 }
    );
  }

  const { error } = await admin.auth.admin.updateUserById(id, { password });
  if (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }

  return Response.json({ id, password_set: true });
}

/**
 * Change one thing about a rep: whether they are active, their sign-in email,
 * or their password.
 *
 * Deactivation is two things that have to happen together. `profiles.is_active`
 * gates RLS, so a deactivated rep sees no data — but Supabase auth knows
 * nothing about that column, so they could still sign in and sit in an empty
 * app. Banning the auth user refuses the sign-in itself.
 */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const guard = await authorise(id);
    if ("error" in guard) return guard.error;

    // Cheap per call, but creating auth churn on someone else's account is
    // worth a ceiling. The bucket was defined when the limiter was built and
    // had never been wired to a route.
    const gate = await enforceRateLimit(guard.supabase, LIMITS.repAdmin);
    if (!gate.ok) return gate.response;

    const body = (await request.json()) as {
      is_active?: boolean;
      email?: string;
      password?: string;
    };

    // One operation per call, so a partial failure is never ambiguous about
    // which half of the request took effect.
    const asked = [body.is_active, body.email, body.password].filter(
      (v) => v !== undefined
    ).length;
    if (asked !== 1) {
      return Response.json(
        { error: "Send exactly one of is_active, email or password." },
        { status: 400 }
      );
    }

    if (typeof body.email === "string") {
      return changeEmail(guard.admin, id, body.email);
    }
    if (typeof body.password === "string") {
      return setPassword(guard.admin, id, body.password);
    }
    if (typeof body.is_active !== "boolean") {
      return Response.json(
        { error: "is_active must be true or false." },
        { status: 400 }
      );
    }

    const { error: profileError } = await guard.admin
      .from("profiles")
      .update({ is_active: body.is_active })
      .eq("id", id);
    if (profileError) {
      return Response.json({ error: profileError.message }, { status: 500 });
    }

    // ~100 years stands in for "indefinitely"; 'none' lifts it.
    const { error: banError } = await guard.admin.auth.admin.updateUserById(id, {
      ban_duration: body.is_active ? "none" : "876000h",
    });
    if (banError) {
      // Roll the flag back rather than leaving the two halves disagreeing —
      // is_active saying "off" while the account can still sign in is exactly
      // the confusion this endpoint exists to remove.
      await guard.admin
        .from("profiles")
        .update({ is_active: !body.is_active })
        .eq("id", id);
      return Response.json({ error: banError.message }, { status: 502 });
    }

    return Response.json({ id, is_active: body.is_active });
  } catch (reason) {
    const message =
      reason instanceof Error ? reason.message : "Unexpected error updating rep.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    // Next 15+ made route params a Promise; awaiting is required.
    const { id } = await ctx.params;
    const guard = await authorise(id);
    if ("error" in guard) return guard.error;

    // profiles.id references auth.users(id) on delete cascade, so removing the
    // auth user takes the profile and everything hanging off it.
    const { error } = await guard.admin.auth.admin.deleteUser(id);
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
