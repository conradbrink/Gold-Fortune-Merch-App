import AppKit
// Centres the logo at `scale` of a square transparent canvas, so Android's
// adaptive-icon crop (which keeps roughly the middle 66%) cannot clip the
// wordmark. Uses AppKit, which is already on every Mac — no new dependency.
let args = CommandLine.arguments
let src = args[1], dst = args[2]
let size = CGFloat(Int(args[3])!)
let scale = CGFloat(Double(args[4])!)

guard let img = NSImage(contentsOfFile: src) else { fatalError("cannot read \(src)") }
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
      let png = rep.representation(using: .png, properties: [:]) else { fatalError("encode failed") }
try! png.write(to: URL(fileURLWithPath: dst))
print("wrote \(dst) — logo at \(Int(scale*100))% of \(Int(size))px")
