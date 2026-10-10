import Image from "next/image";

// A real screen from the staff app (public/demo/phone/*.webp: the 1080×2280
// renders in public/demo/app, cut down to 480 wide so a page of them stays
// light), in a plain phone frame like the hero demo's.
export function PhoneShot({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  return (
    <div className={`rounded-[1.9rem] bg-[#1b1d1f] p-1.5 shadow-xl shadow-teal-950/20 ring-1 ring-black/10 ${className}`}>
      <Image
        src={src}
        alt={alt}
        width={480}
        height={1013}
        unoptimized
        className="h-auto w-full rounded-[1.5rem] bg-[#f5f6f7]"
      />
    </div>
  );
}

// A tinted panel that a screen rises out of, cut off at its bottom edge:
// enough of the screen to see what it is, without its full height.
export function Peek({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <div className={`relative h-60 overflow-hidden rounded-xl sm:h-64 ${className}`}>{children}</div>;
}

export function PhonePeek({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  return (
    <Peek className={className}>
      <PhoneShot src={src} alt={alt} className="absolute left-1/2 top-6 w-48 -translate-x-1/2 sm:w-52" />
    </Peek>
  );
}
