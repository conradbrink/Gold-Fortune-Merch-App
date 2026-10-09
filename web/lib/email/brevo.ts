/**
 * Brevo's transactional email API (the domain tickd.co.za is authenticated
 * there; see the email setup notes). Server only: the key never leaves it.
 */

export type BrevoMessage = {
  to: { email: string; name?: string | null };
  sender: { email: string; name: string };
  replyTo?: { email: string; name?: string } | null;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
};

export type BrevoResult = { ok: true; messageId: string | null } | { ok: false; error: string; permanent: boolean };

export function brevoConfigured(): boolean {
  return !!process.env.BREVO_API_KEY;
}

export async function sendViaBrevo(m: BrevoMessage, fetchImpl: typeof fetch = fetch): Promise<BrevoResult> {
  const key = process.env.BREVO_API_KEY;
  if (!key) return { ok: false, error: "BREVO_API_KEY is not configured.", permanent: false };
  let res: Response;
  try {
    res = await fetchImpl("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: m.sender,
        to: [{ email: m.to.email, ...(m.to.name ? { name: m.to.name } : {}) }],
        ...(m.replyTo ? { replyTo: m.replyTo } : {}),
        subject: m.subject,
        htmlContent: m.html,
        textContent: m.text,
        ...(m.headers ? { headers: m.headers } : {}),
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), permanent: false };
  }
  const body = (await res.json().catch(() => null)) as { messageId?: string; message?: string } | null;
  // Accepted is accepted, even without an id to match delivery news later:
  // sending it again would send it twice.
  if (res.ok) return { ok: true, messageId: body?.messageId ?? null };
  // 4xx other than rate limits will not get better by retrying.
  const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
  return { ok: false, error: `Brevo ${res.status}: ${body?.message ?? "no detail"}`, permanent };
}
