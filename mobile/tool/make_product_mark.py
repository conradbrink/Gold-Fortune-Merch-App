"""Draws the product's neutral mark:

* assets/product_mark.png — a rounded square in the product's slate (#1E293B)
  with a teal (#0EA5A4) tick. The login screen of a phone that has never
  signed in, and the legacy launcher icon.
* assets/product_mark_adaptive_foreground.png — the tick alone on a
  transparent canvas, shrunk to 62% about the centre, for Android 8+'s
  adaptive icon. The launcher crops the foreground to roughly its middle
  two-thirds; the slate comes from `adaptive_icon_background` in pubspec.yaml.

Standard library only, so regenerating it needs nothing installed:

    python3 tool/make_product_mark.py
"""

import math
import os
import struct
import zlib

SIZE = 256
RADIUS = 56  # corner radius of the square
SS = 4  # supersampling per axis, for smooth edges
BG = (0x1E, 0x29, 0x3B)
FG = (0x0E, 0xA5, 0xA4)
TICK = [(70, 134), (110, 174), (188, 90)]
STROKE = 28


def in_rounded_square(x, y):
    cx = min(max(x, RADIUS), SIZE - RADIUS)
    cy = min(max(y, RADIUS), SIZE - RADIUS)
    return (x - cx) ** 2 + (y - cy) ** 2 <= RADIUS ** 2


def dist_to_segment(px, py, a, b):
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def in_tick(x, y):
    return any(
        dist_to_segment(x, y, TICK[i], TICK[i + 1]) <= STROKE / 2
        for i in range(len(TICK) - 1)
    )


def pixel(x, y, square=True, scale=1.0):
    bg = fg = 0
    c = SIZE / 2
    for sy in range(SS):
        for sx in range(SS):
            # Sampled in the mark's own coordinates, so the foreground is the
            # same tick, only smaller.
            px = c + (x + (sx + 0.5) / SS - c) / scale
            py = c + (y + (sy + 0.5) / SS - c) / scale
            if not square:
                if in_tick(px, py):
                    fg += 1
            elif in_rounded_square(px, py):
                if in_tick(px, py):
                    fg += 1
                else:
                    bg += 1
    n = SS * SS
    cover = bg + fg
    if cover == 0:
        return (0, 0, 0, 0)
    rgb = tuple(round((BG[i] * bg + FG[i] * fg) / cover) for i in range(3))
    return rgb + (round(255 * cover / n),)


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
    out = os.path.join(os.path.dirname(__file__), "..", "assets", name)
    with open(out, "wb") as f:
        f.write(png(SIZE, SIZE, rows))
    print("wrote", os.path.normpath(out))


if __name__ == "__main__":
    write("product_mark.png")
    write("product_mark_adaptive_foreground.png", square=False, scale=0.62)
