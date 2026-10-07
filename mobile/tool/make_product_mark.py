"""Draws the Tickd product mark — the double tick, "seen and done":

* assets/product_mark.png — a rounded teal (#0F3D3E) tile with a sand
  (#F7F7F2) tick and an amber (#F5A524) tick. The login screen of a phone that
  has never signed in, the legacy launcher icon, and (copied) the web's
  public/product-mark.png.
* assets/product_mark_adaptive_foreground.png — the two ticks alone on a
  transparent canvas, shrunk to 62% about the centre, for Android 8+'s
  adaptive icon. The launcher crops the foreground to roughly its middle
  two-thirds; the teal comes from `adaptive_icon_background` in pubspec.yaml.

The geometry is the logo's own (`tickd-mark.svg`, a 64-unit square), drawn
here with the standard library only, so regenerating needs nothing installed:

    python3 tool/make_product_mark.py
"""

import math
import os
import shutil
import struct
import zlib

SIZE = 256
UNIT = SIZE / 64  # the SVG's viewBox is 64 x 64
RADIUS = 14 * UNIT  # rx of the tile
SS = 4  # supersampling per axis, for smooth edges
TEAL = (0x0F, 0x3D, 0x3E)
SAND = (0xF7, 0xF7, 0xF2)
AMBER = (0xF5, 0xA5, 0x24)
STROKE = 5.5 * UNIT
SHIFT = 4.5  # the SVG's translate(4.5 0)


def pts(*xy):
    return [((x + SHIFT) * UNIT, y * UNIT) for x, y in xy]


# Drawn in order, the amber tick over the sand one, as in the SVG.
STROKES = [
    (SAND, [pts((11, 34), (19, 42), (36, 23))]),
    (AMBER, [pts((27, 42), (44, 23)), pts((23, 36), (27, 40))]),
]


def in_rounded_square(x, y):
    cx = min(max(x, RADIUS), SIZE - RADIUS)
    cy = min(max(y, RADIUS), SIZE - RADIUS)
    return 0 <= x <= SIZE and 0 <= y <= SIZE and (x - cx) ** 2 + (y - cy) ** 2 <= RADIUS ** 2


def dist_to_segment(px, py, a, b):
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def on_polyline(x, y, line):
    # Distance to each segment covers round caps and round joins alike.
    return any(dist_to_segment(x, y, line[i], line[i + 1]) <= STROKE / 2 for i in range(len(line) - 1))


def colour_at(x, y, tile):
    """The topmost colour at a point, or None where nothing is drawn."""
    for colour, lines in reversed(STROKES):
        if any(on_polyline(x, y, line) for line in lines):
            return colour
    if tile and in_rounded_square(x, y):
        return TEAL
    return None


def pixel(x, y, tile=True, scale=1.0):
    acc = [0, 0, 0]
    hits = 0
    c = SIZE / 2
    for sy in range(SS):
        for sx in range(SS):
            # Sampled in the mark's own coordinates, so the foreground is the
            # same ticks, only smaller.
            px = c + (x + (sx + 0.5) / SS - c) / scale
            py = c + (y + (sy + 0.5) / SS - c) / scale
            colour = colour_at(px, py, tile)
            if colour is not None:
                hits += 1
                for i in range(3):
                    acc[i] += colour[i]
    if hits == 0:
        return (0, 0, 0, 0)
    return tuple(round(v / hits) for v in acc) + (round(255 * hits / (SS * SS)),)


def png(width, height, rows):
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + bytes(v for px in row for v in px) for row in rows)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def write(name, **kw):
    rows = [[pixel(x, y, **kw) for x in range(SIZE)] for y in range(SIZE)]
    out = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "assets", name))
    with open(out, "wb") as f:
        f.write(png(SIZE, SIZE, rows))
    print("wrote", out)
    return out


if __name__ == "__main__":
    mark = write("product_mark.png")
    write("product_mark_adaptive_foreground.png", tile=False, scale=0.62)
    # The web shows the same mark before sign-in.
    web = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "web", "public", "product-mark.png"))
    shutil.copyfile(mark, web)
    print("copied to", web)
