import { founding, site } from "@/lib/site";

// The 5-minute video on /founding and on its thank-you screen: a YouTube video
// (`founding.videoId` in lib/site.ts). From youtube-nocookie.com, so YouTube
// sets no cookie until the visitor presses play, and loaded only when it
// scrolls near, so it never slows the first screen.
export function FoundingVideo() {
  if (!founding.videoId) return null;
  return (
    <div className="overflow-hidden rounded-2xl bg-teal-950 ring-1 ring-line">
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(founding.videoId)}?rel=0&playsinline=1`}
        title={`How ${site.name} works, in 5 minutes`}
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
        className="block aspect-video w-full"
      />
    </div>
  );
}
