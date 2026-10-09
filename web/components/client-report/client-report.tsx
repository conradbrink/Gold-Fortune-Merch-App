import { companyTime } from "@/lib/company-time";
import { SignOffForm } from "@/components/client-report/sign-off-form";
import { PrintButton } from "@/components/client-report/print-button";
import { PAD_HEIGHT, PAD_WIDTH } from "@/components/client-report/signature-pad";

/**
 * The client's view of one finished job (Stage 8.3), from what
 * `job_report_view()` returns: the facts, every checklist answer, the photos
 * (through `signed`, short-lived links by storage path) and the sign-off.
 * Rendered by /c/report/[token]; presentational, so it can be checked with
 * example data.
 */

export type Answer = { label: string; type: string; text: string | null; number: number | null; yes: boolean | null; photo_path: string | null };
export type View = {
  report_id: string;
  timezone: string;
  company: { name: string; logo_path: string | null; email: string | null; phone: string | null } | null;
  job_word: string;
  staff_word: string;
  site: { name: string; address: string | null; lat: number | null; lng: number | null } | null;
  staff_name: string | null;
  day: string;
  checkin_at: string;
  checkout_at: string | null;
  minutes: number | null;
  on_site: boolean | null;
  checklists: { name: string; answers: Answer[] }[];
  photos: { path: string; taken_at: string | null }[];
  signed: { name: string; at: string; path: string } | null;
};

function longDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function answerText(a: Answer): string | null {
  if (a.yes !== null) return a.yes ? "Yes" : "No";
  if (a.number !== null) return String(a.number);
  return a.text?.trim() || null;
}

export function ClientReport({
  v,
  signed,
  logo,
  token,
}: {
  v: View;
  signed: Map<string, string>;
  logo: string | null;
  token: string;
}) {
  const company = v.company?.name ?? "";
  const timeIn = companyTime(v.checkin_at, v.timezone);
  const timeOut = companyTime(v.checkout_at, v.timezone);
  const map = v.site?.lat != null && v.site?.lng != null ? `https://www.google.com/maps?q=${v.site.lat},${v.site.lng}` : null;

  return (
    <main className="min-h-dvh bg-secondary/40 px-4 py-8 print:bg-white print:py-0">
      <article className="mx-auto w-full max-w-2xl space-y-6">
        <header className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            {logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="" className="h-10 w-auto max-w-32 object-contain" />
            )}
            <p className="truncate text-base font-semibold text-foreground">{company}</p>
          </div>
          <PrintButton />
        </header>

        <section className="space-y-4 rounded-xl bg-card p-6 ring-1 ring-foreground/10">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold text-balance text-foreground">
              {v.job_word} at {v.site?.name}
            </h1>
            <p className="text-sm text-muted-foreground">
              {longDay(v.day)}
              {v.site?.address ? `, ${v.site.address}` : ""}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">{v.staff_word}</dt>
              <dd className="font-medium text-foreground">{v.staff_name ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Time</dt>
              <dd className="font-medium tabular-nums text-foreground">
                {timeIn} to {timeOut || "-"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">On site</dt>
              <dd className="font-medium tabular-nums text-foreground">{v.minutes === null ? "-" : `${v.minutes} min`}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Location</dt>
              <dd className="font-medium text-foreground">
                {v.on_site === null ? "No GPS at check-in" : v.on_site ? "Checked in on site" : "Checked in away from the site"}
              </dd>
            </div>
          </dl>
          {map && (
            <a href={map} target="_blank" rel="noopener noreferrer" className="inline-block text-sm font-medium text-primary underline-offset-4 hover:underline print:hidden">
              See the site on a map
            </a>
          )}
        </section>

        {v.checklists.map((c, i) => (
          <section key={i} className="space-y-3 rounded-xl bg-card p-6 ring-1 ring-foreground/10">
            <h2 className="text-base font-semibold text-foreground">{c.name}</h2>
            <ul className="divide-y divide-border">
              {c.answers.map((a, j) => {
                const text = answerText(a);
                const photo = a.photo_path ? signed.get(a.photo_path) : null;
                return (
                  <li key={j} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm">
                    <span className="text-muted-foreground">{a.label}</span>
                    {photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photo} alt={a.label} className="h-24 w-auto rounded-md object-cover" loading="lazy" />
                    ) : (
                      <span className="font-medium text-foreground">{text ?? "-"}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {v.photos.length > 0 && (
          <section className="space-y-3 rounded-xl bg-card p-6 ring-1 ring-foreground/10">
            <h2 className="text-base font-semibold text-foreground">Photos</h2>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {v.photos.map((p, i) => {
                const url = signed.get(p.path);
                return url ? (
                  <li key={i} className="space-y-1">
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt={`Photo ${i + 1}`} className="aspect-square w-full rounded-lg object-cover" loading="lazy" />
                    </a>
                    {p.taken_at && <p className="text-xs tabular-nums text-muted-foreground">{companyTime(p.taken_at, v.timezone)}</p>}
                  </li>
                ) : null;
              })}
            </ul>
          </section>
        )}

        <section className="space-y-3 rounded-xl bg-card p-6 ring-1 ring-foreground/10">
          <h2 className="text-base font-semibold text-foreground">Sign-off</h2>
          {v.signed ? (
            <div className="space-y-2">
              <svg viewBox={`0 0 ${PAD_WIDTH} ${PAD_HEIGHT}`} className="h-28 w-full max-w-md" role="img" aria-label={`Signature of ${v.signed.name}`}>
                <path d={v.signed.path} fill="none" stroke="#14211e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <p className="text-sm text-foreground">
                Signed by <span className="font-medium">{v.signed.name}</span> on{" "}
                {new Date(v.signed.at).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: v.timezone })}.
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm text-pretty text-muted-foreground">
                If you are happy with this {v.job_word.toLowerCase()}, type your name, sign in the box and press the button.
              </p>
              <SignOffForm token={token} jobWord={v.job_word} />
            </>
          )}
        </section>

        <footer className="pb-6 text-center text-xs text-muted-foreground">
          {company}
          {v.company?.email ? `, ${v.company.email}` : ""}
          {v.company?.phone ? `, ${v.company.phone}` : ""}. Sent with Tickd.
        </footer>
      </article>
    </main>
  );
}
