import AppKit
// Centres the logo at `scale` of a square transparent canvas, so Android's
// adaptive-icon crop (which keeps roughly the middle 66%) cannot clip the
// wordmark. Uses AppKit, which is already on every Mac — no new dependency.
func die(_ msg: String) -> Never {
    FileHandle.standardError.write(("pad_icon: " + msg + "\n").data(using: .utf8)!)
    exit(1)
}

let args = CommandLine.arguments
guard args.count == 5 else {
    die("usage: pad_icon <src.png> <dst.png> <canvasPx> <scale, 0 exclusive to 1 inclusive>\n" +
        "  e.g. pad_icon assets/logo.png assets/logo_adaptive_foreground.png 1024 0.62")
}
let src = args[1], dst = args[2]
guard let px = Int(args[3]), px > 0 else { die("canvas size must be a positive integer, got \(args[3])") }
guard let sc = Double(args[4]), sc > 0, sc <= 1 else { die("scale must be in (0,1], got \(args[4])") }
let size = CGFloat(px)
let scale = CGFloat(sc)

guard let img = NSImage(contentsOfFile: src) else { die("cannot read \(src)") }
let out = NSImage(size: NSSize(width: size, height: size))
out.lockFocus()
NSColor.clear.setFill()
NSRect(x: 0, y: 0, width: size, height: size).fill()
let inner = size * scale
let off = (size - inner) / 2
img.draw(in: NSRect(x: off, y: off, width: inner, height: inner),
         from: .zero, operation: .sourceOver, fraction: 1.0)
out.unlockFocus()

guard let tiff = out.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let png = rep.representation(using: .png, properties: [:]) else { die("could not encode PNG") }
do {
    try png.write(to: URL(fileURLWithPath: dst))
} catch {
    // A `try!` here would trap with a stack trace on something as ordinary as
    // a read-only directory. Say what failed instead.
    die("could not write \(dst): \(error.localizedDescription)")
}
print("wrote \(dst) — logo at \(Int(scale*100))% of \(Int(size))px")
