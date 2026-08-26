import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";

/**
 * Create a field rep or a warehouse clerk, with a starting password.
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
 *
 * ---------------------------------------------------------------- the role
 *
 * `role` was added when the warehouse module arrived. The path still says
 * "reps" because that is what it was; renaming it would break the one caller
 * for no gain, and having a second copy of account creation is a far worse
 * trade than an inaccurate URL. Account creation with the service key is the
 * last code in this project that should exist twice.
 *
 * **'manager' is not accepted, on purpose.** Everything else here is a manager
 * granting somebody less access than they have. Creating another manager is a
 * manager granting their own level of access, which is the one action worth
 * making somebody go to the Supabase dashboard for — where it is deliberate,
 * attributable, and outside anything an XSS on this app could reach.
 *
 * `hr_manager` is accepted under that same rule and not as an exception to it:
 * it reaches `/hr` and nothing else, which is strictly less than a manager. It
 * is worth saying plainly that this grant is not small — an HR manager reads
 * salaries, dates of birth and disciplinary files. The test that lets it
 * through is "less access than the person granting it", not "harmless".
 */

export const runtime = "nodejs";

/**
 * Roles a caller may create by naming one directly.
 *
 * Kept for the two callers that predate job roles — the rep dialog, which sends
 * nothing and gets `rep`, and warehouse setup, which sends `warehouse`. New
 * callers send `job_role_id` instead and the base role comes off the template.
 *
 * `manager` is still absent, on purpose. See the note above.
 */
const INVITABLE = new Set(["rep", "warehouse", "hr_manager"]);

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return Response.json({ error: "Not authenticated." }, { status: 401 });
    }

    // Creates an auth user, so abuse pollutes the org and the auth tenant.
    // Charged before anything is created.
    const gate = await enforceRateLimit(supabase, LIMITS.repInvite);
    if (!gate.ok) return gate.response;

    // The caller's own org is taken from their profile, never from the request
    // body — otherwise a manager could invite a rep into someone else's org.
    const { data: profile } = await supabase
      .from("profiles")
      .select("org_id, role")
      .eq("id", user.id)
      .single();

    const caller = profile as { org_id: string; role: string } | null;
    if (!caller) {
      return Response.json({ error: "Your account is incomplete." }, { status: 403 });
    }

    // Asked of the database rather than compared against a role string here.
    // `has_permission` is the same function every policy uses, so this route
    // and RLS cannot drift into disagreeing about who is an administrator.
    const { data: isAdmin, error: adminError } = await supabase.rpc(
      "has_permission",
      { p_code: "admin" }
    );
    if (adminError) {
      return Response.json({ error: adminError.message }, { status: 502 });
    }
    if (isAdmin !== true) {
      return Response.json(
        { error: "Only an administrator can create accounts." },
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
      role?: string;
      job_role_id?: string;
    };
    // The cast above is a claim about this body, not a check on it. A caller
    // sending {"role": 123} makes `.trim()` throw a TypeError, which the outer
    // catch reports as a 500 with the raw message — the caller's own bad input
    // presented as a server fault.
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    const email = str(body.email).trim().toLowerCase();
    const fullName = str(body.full_name).trim();
    const password = str(body.password);
    // Two ways in. `job_role_id` is the one that matters now: the caller names
    // a template and the base role comes off it, so the browser never chooses a
    // role and cannot choose a role it should not have. `role` is the older
    // path, kept because the rep dialog and warehouse setup still use it.
    const jobRoleId = str(body.job_role_id).trim();
    let role: string;

    if (jobRoleId) {
      const { data: jobRole, error: jobRoleError } = await supabase
        .from("job_roles")
        .select("id, base_role, org_id")
        .eq("id", jobRoleId)
        .maybeSingle();

      // Read through the caller's own client, so RLS has already confined it to
      // their organisation — there is no version of this that can point at
      // somebody else's template.
      if (jobRoleError) {
        return Response.json({ error: jobRoleError.message }, { status: 502 });
      }
      const template = jobRole as { base_role: string; org_id: string } | null;
      if (!template || template.org_id !== caller.org_id) {
        return Response.json({ error: "Unknown job role." }, { status: 400 });
      }

      // A template that grants `admin` cannot be used to mint an account, for
      // the same reason `manager` was never invitable: that is an administrator
      // handing out their own level of access, and it belongs somewhere
      // deliberate and attributable.
      const { data: grants } = await supabase
        .from("job_role_permissions")
        .select("permission_code")
        .eq("job_role_id", jobRoleId);
      const grantsAdmin = ((grants ?? []) as { permission_code: string }[]).some(
        (g) => g.permission_code === "admin"
      );
      if (grantsAdmin) {
        return Response.json(
          {
            error:
              "Accounts on an administrator template must be created in the Supabase dashboard.",
          },
          { status: 400 }
        );
      }

      role = template.base_role;
    } else {
      // Defaults to 'rep' so the existing caller, which sends no role, keeps
      // working unchanged.
      role = str(body.role).trim() || "rep";
      if (!INVITABLE.has(role)) {
        return Response.json(
          {
            error:
              role === "manager"
                ? "Managers cannot be created here. Add them in the Supabase dashboard."
                : "Unknown role.",
          },
          { status: 400 }
        );
      }
    }

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
    // `job_role_id` is written with the profile so the trigger that copies the
    // template's permissions sees it on INSERT. Setting it afterwards would
    // leave a window where the account exists with no grants at all.
    const { error: profileError } = await admin.from("profiles").insert({
      id: invited.user.id,
      org_id: caller.org_id,
      role,
      job_role_id: jobRoleId || null,
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

    return Response.json({
      id: invited.user.id,
      email,
      full_name: fullName,
      role,
      job_role_id: jobRoleId || null,
    });
  } catch (reason) {
    const message =
      reason instanceof Error ? reason.message : "Unexpected error sending invite.";
    return Response.json({ error: message }, { status: 500 });
  }
}
