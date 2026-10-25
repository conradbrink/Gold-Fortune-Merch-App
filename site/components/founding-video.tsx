"use client";

import { Play, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { track } from "@/components/analytics";
import { site } from "@/lib/site";

// The 3-minute video on /founding and on its thank-you screen: the owner's
// final cut of 25 Oct 2026 (content-engine's ticked-vsl-finalcut), served from
// this site rather than YouTube (owner, 25 Oct 2026). It plays by itself
// (owner, 14 Oct 2026), but only once it scrolls near: it sits under the hero,
// so nothing downloads until then and the first screen stays fast, and it
// pauses again when it scrolls away. Browsers only start a video by itself
// without sound, so it starts muted and loops (the words are on screen), and
// "Tap for sound" plays it from the start with sound and the usual controls.
// When the browser won't start it at all (an iPhone on Low Power Mode, a data
// saver), a play button does the same.
//
// Phones get the 720p copy, which is still sharper than a phone shows it, and
// bigger screens the 1080p one. Both are H.264, which every phone plays in
// hardware. The files are in public/founding: give a new cut a new file name,
// so no browser keeps the old one.
//
// Counted for the Control Centre: video_sound_on and video_ended.

type Mode = "muted" | "sound" | "blocked";

// Only a browser's "not allowed" means it won't start the video; anything else
// (a load that restarted) leaves the autoplay to carry on.
const refusedThen = (block: () => void) => (error: unknown) => {
  if (error instanceof DOMException && error.name === "NotAllowedError") block();
};

export function FoundingVideo() {
  const video = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState<Mode>("muted");

  // Start the muted loop when it comes within 200px of the screen, and pause
  // it when it leaves. Once the sound is on, it's theirs to pause.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.muted = true;
    const near = new IntersectionObserver(
      ([entry]) => {
        if (!v.muted) return;
        if (entry.isIntersecting) v.play().catch(refusedThen(() => setMode("blocked")));
        else v.pause();
      },
      { rootMargin: "200px 0px" },
    );
    near.observe(v);
    return () => near.disconnect();
  }, []);

  function playWithSound() {
    const v = video.current;
    if (!v) return;
    v.muted = false;
    v.loop = false;
    v.currentTime = 0;
    setMode("sound");
    v.play().then(
      () => track("video_sound_on"),
      () => {
        // Sound refused after all: back to muted, with the button still there.
        v.muted = true;
        v.loop = true;
        setMode("muted");
        v.play().catch(refusedThen(() => setMode("blocked")));
      },
    );
  }

  return (
    <div className="relative overflow-hidden rounded-2xl bg-teal-950 ring-1 ring-line">
      <video
        ref={video}
        muted
        loop={mode === "muted"}
        playsInline
        preload="none"
        controls={mode === "sound"}
        poster="/founding/vsl-v2-poster.webp"
        aria-label={`How ${site.name} works, in 3 minutes`}
        onEnded={() => mode === "sound" && track("video_ended")}
        className="block aspect-video w-full"
      >
        <source src="/founding/vsl-v2-720p.mp4" type="video/mp4" media="(max-width: 767px)" />
        <source src="/founding/vsl-v2-1080p.mp4" type="video/mp4" />
      </video>

      {mode !== "sound" && (
        <button
          type="button"
          onClick={playWithSound}
          className="group absolute inset-0 grid place-items-center focus-visible:outline-none"
          aria-label={mode === "blocked" ? "Play the video with sound" : "Turn on the sound and play from the start"}
        >
          {mode === "blocked" ? (
            <span className="grid size-20 place-items-center rounded-full bg-amber-500 text-teal-950 shadow-lg ring-4 ring-white/70 transition-[scale] duration-150 ease-out group-hover:scale-105 group-active:scale-95 group-focus-visible:ring-teal-900">
              <Play className="ml-1 size-9 fill-current" aria-hidden="true" />
            </span>
          ) : (
            // Under his face and above the captions, so neither is covered.
            <span className="absolute left-1/2 top-[66%] flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-amber-500 px-4 py-2 text-sm font-bold text-teal-950 shadow-lg ring-4 ring-white/70 transition-[scale] duration-150 ease-out group-hover:scale-105 group-active:scale-95 group-focus-visible:ring-teal-900 sm:px-5 sm:py-3 sm:text-base">
              <Volume2 className="size-5" strokeWidth={2.5} aria-hidden="true" />
              Tap for sound
            </span>
          )}
        </button>
      )}
    </div>
  );
}
