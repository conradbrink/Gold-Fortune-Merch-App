import type { Metadata } from "next";
import Image from "next/image";
import {
  formatFileSize,
  formatReleaseDate,
  getCurrentAndroidRelease,
} from "@/lib/releases";

export const metadata: Metadata = {
  title: "Download the app — Gold Fortune Merchandising",
  description:
    "Download the Gold Fortune Merchandising Android app for merchandisers.",
  // A public page with nothing to gain from being indexed, and a direct APK
  // link is not something to hand to a search crawler.
  robots: { index: false, follow: false },
};

// Rendered per request: the version on this page has to change the moment a
// release is published, without a rebuild.
export const dynamic = "force-dynamic";

const INSTALL_STEPS = [
  "Tap the Download Android App button above and wait for the file to finish downloading.",
  "Open the downloaded file — from the notification, or from your Downloads folder.",
  "Android will ask whether to allow installing apps from this source. Choose Allow, then go back.",
  "Tap Install and wait for it to finish.",
  "Open the app and sign in with the account your manager gave you.",
];

export default async function DownloadPage() {
  const release = await getCurrentAndroidRelease();

  return (
    <div className="min-h-screen bg-secondary/40 px-4 py-10">
      <div className="mx-auto w-full max-w-lg space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <Image
            src="/logo.png"
            alt="Gold Fortune"
            width={64}
            height={64}
            className="rounded-xl"
            priority
          />
          <div>
            <h1 className="text-xl font-bold text-foreground">
              Gold Fortune Merchandising
            </h1>
            <p className="text-sm text-muted-foreground">
              Android app for merchandisers
            </p>
          </div>
        </div>

        {release ? (
          <>
            <div className="space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm">
              <a
                href="/api/app/android"
                className="inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Download Android App
              </a>

              <dl className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <dt className="text-xs text-muted-foreground">Version</dt>
                  <dd className="text-sm font-medium text-foreground">
                    {release.versionName}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Released</dt>
                  <dd className="text-sm font-medium text-foreground">
                    {formatReleaseDate(release.releaseDate)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Size</dt>
                  <dd className="text-sm font-medium text-foreground">
                    {formatFileSize(release.fileSizeBytes)}
                  </dd>
                </div>
              </dl>

              <p className="rounded-md border border-border bg-secondary/60 p-3 text-xs text-muted-foreground">
                <strong className="font-semibold text-foreground">
                  Android will warn you.
                </strong>{" "}
                Because this app is installed directly rather than from the Play
                Store, your phone will ask permission to install from your
                browser or from an unknown source. This is expected — allow it
                to continue. You only need to do this once.
              </p>
            </div>

            <section className="space-y-3 rounded-lg border border-border bg-card p-6 shadow-sm">
              <h2 className="text-sm font-semibold text-foreground">
                How to install
              </h2>
              <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
                {INSTALL_STEPS.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p className="text-xs text-muted-foreground">
                Installing a newer version over an older one keeps you signed in
                and keeps any visits saved on your phone. Do not uninstall the
                old version first.
              </p>
            </section>

            {release.notes.length > 0 ? (
              <section className="space-y-3 rounded-lg border border-border bg-card p-6 shadow-sm">
                <h2 className="text-sm font-semibold text-foreground">
                  What&apos;s new in {release.versionName}
                </h2>
                <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
                  {release.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : (
          <div className="rounded-lg border border-border bg-card p-6 text-center shadow-sm">
            <h2 className="text-base font-semibold text-foreground">
              No release available yet
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The Android app has not been published yet. Please check back, or
              ask your manager when it will be ready.
            </p>
          </div>
        )}

        <section className="space-y-2 rounded-lg border border-border bg-card p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-foreground">
            If installation fails
          </h2>
          <p className="text-sm text-muted-foreground">
            Check that you have around 200 MB of free space and a stable
            connection, then download the file again — an interrupted download
            is the most common cause. If it still will not install, contact your
            manager with the make and model of your phone and its Android
            version.
          </p>
        </section>

        <p className="pb-4 text-center text-xs text-muted-foreground">
          For authorised Gold Fortune merchandisers. You will need an account
          from management to sign in.
        </p>
      </div>
    </div>
  );
}
