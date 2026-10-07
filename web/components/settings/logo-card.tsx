"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { refreshCompanyConfig } from "@/lib/use-company-config";
import { logoUrl } from "@/lib/branding";
import {
  LOGO_ACCEPT,
  LOGO_MAX_SIDE,
  LOGO_TYPES,
  fitWithin,
  logoFileError,
  logoObjectPath,
  logoUploadError,
  newLogoSuffix,
} from "@/lib/branding-settings";

/**
 * Shrink a large image to `LOGO_MAX_SIDE` on its longest side, in the same
 * format, so PNG transparency survives. Returns the original when it already
 * fits, when the browser cannot draw it, or when the result is no smaller.
 */
async function prepareLogo(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That file could not be read as an image.");
  }
  const size = fitWithin(bitmap.width, bitmap.height);
  if (!size) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, file.type, 0.9)
  );
  // A browser that cannot encode the type (WebP in older Safari) hands back a
  // PNG; that is still a type the bucket takes.
  if (!blob || !(blob.type in LOGO_TYPES)) return file;
  return blob.size < file.size ? blob : file;
}

/**
 * The company's logo, shown in the sidebar and printed on invoices.
 *
 * Stored in the public `branding` bucket under the company's own folder, with
 * a new file name for every upload: an issued invoice keeps pointing at the
 * file it was issued with, so an old logo is never overwritten or deleted.
 * "Remove logo" only clears `organizations.logo_path` for the same reason.
 */
export function LogoCard({
  orgId,
  initialLogoPath,
  canEdit,
}: {
  orgId: string;
  initialLogoPath: string | null;
  canEdit: boolean;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [logoPath, setLogoPath] = useState<string | null>(initialLogoPath);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const url = logoUrl(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", logoPath);

  async function setPath(path: string | null): Promise<boolean> {
    const { error: updateError } = await supabase
      .from("organizations")
      .update({ logo_path: path })
      .eq("id", orgId);
    if (updateError) {
      setError(updateError.message);
      return false;
    }
    setLogoPath(path);
    refreshCompanyConfig();
    router.refresh();
    return true;
  }

  async function handleFile(file: File) {
    setError(null);
    setSaved(null);
    const fileError = logoFileError(file);
    if (fileError) {
      setError(fileError);
      return;
    }
    setBusy(true);
    try {
      const blob = await prepareLogo(file);
      const sizeError = logoUploadError(blob);
      if (sizeError) {
        setError(sizeError);
        return;
      }
      const type = blob.type in LOGO_TYPES ? blob.type : file.type;
      const path = logoObjectPath(orgId, type, newLogoSuffix());
      const { error: uploadError } = await supabase.storage
        .from("branding")
        .upload(path, blob, {
          contentType: type,
          upsert: false,
          // Every upload has a new name, so the file never changes under it.
          cacheControl: "31536000",
        });
      if (uploadError) {
        setError(uploadError.message);
        return;
      }
      if (await setPath(path)) setSaved("Logo updated.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setError(null);
    setSaved(null);
    setBusy(true);
    try {
      if (await setPath(null)) setSaved("Logo removed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Logo</CardTitle>
        <CardDescription>
          Shown in the sidebar and printed on invoices. PNG, JPEG or WebP; an image
          bigger than {LOGO_MAX_SIDE} px is shrunk before upload, and the file must
          come to 1 MB or less. A square logo on a transparent background works best.
          Invoices already issued keep the logo they were issued with.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/40">
            {url ? (
              // Plain <img>: a public bucket URL, already sized, nothing for
              // next/image's optimizer to add.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt="Company logo" className="h-full w-full object-contain" />
            ) : (
              <ImageOff className="h-6 w-6 text-muted-foreground" aria-label="No logo" />
            )}
          </div>
          {canEdit && (
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="logo-file">{url ? "Replace logo" : "Upload a logo"}</Label>
              <Input
                id="logo-file"
                type="file"
                accept={LOGO_ACCEPT}
                disabled={busy}
                className="max-w-sm"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // Cleared so choosing the same file again still fires.
                  e.target.value = "";
                  if (file) void handleFile(file);
                }}
              />
            </div>
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {canEdit ? (
          <div className="flex items-center gap-3">
            {url && (
              <Button variant="outline" onClick={handleRemove} disabled={busy}>
                Remove logo
              </Button>
            )}
            {busy && <span className="text-sm text-muted-foreground">Saving…</span>}
            {saved && !busy && <span className="text-sm text-muted-foreground">{saved}</span>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Changing the logo needs the company settings permission.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
