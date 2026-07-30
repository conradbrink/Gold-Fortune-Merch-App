import {
  APP_RELEASES_BUCKET,
  createReleaseStorageClient,
  getCurrentAndroidRelease,
} from "@/lib/releases";

/**
 * Serves the current signed release APK.
 *
 * The bucket is private and has no read policy for anon or authenticated, so
 * this route is the only way to the bytes. That is the point: the client never
 * learns a storage path, cannot list the bucket, and cannot fetch a superseded
 * or half-uploaded APK by guessing at one. Which file is current is decided
 * here, from the manifest, not by whatever the caller asks for.
 *
 * Deliberately unauthenticated, for the same reason the download page is —
 * a rep cannot sign in until the app is installed. See proxy.ts.
 */
export async function GET() {
  const release = await getCurrentAndroidRelease();

  if (!release) {
    return Response.json(
      { error: "No Android release has been published yet." },
      { status: 404 }
    );
  }

  const storage = createReleaseStorageClient();
  if (!storage) {
    return Response.json(
      { error: "Downloads are not configured on this server." },
      { status: 503 }
    );
  }

  const { data, error } = await storage.storage
    .from(APP_RELEASES_BUCKET)
    .download(release.storagePath);

  if (error || !data) {
    // The manifest names a file the bucket does not have — a broken release,
    // not a missing page. Say so without echoing the storage path back.
    console.error("APK download failed", {
      versionCode: release.versionCode,
      error: error?.message,
    });
    return Response.json(
      { error: "The release file could not be read. Please contact support." },
      { status: 502 }
    );
  }

  const filename = `gold-fortune-merchandising-${release.versionName}.apk`;

  return new Response(data, {
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
      // `attachment` so the browser saves it rather than trying to render it.
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(release.fileSizeBytes),
      // A given version_code is immutable once published — publishing changes
      // are new rows, never edits — so the file itself can be cached hard.
      // The manifest that decides *which* version this is stays uncached.
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
