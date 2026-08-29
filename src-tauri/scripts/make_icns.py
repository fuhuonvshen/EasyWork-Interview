#!/usr/bin/env python3
"""EasyWork - Generate src-tauri/icons/icon.icns from a square source PNG.

Writes a valid Apple .icns container with PNG payloads for all standard
sizes (ic04/ic05/ic07/ic08/ic09/ic10 + retina ic11/ic12/ic13/ic14).

Usage:
    python scripts/make_icns.py <source.png> <output.icns>
"""
import io
import struct
import sys

from PIL import Image


def _chunk(typ: str, data: bytes) -> bytes:
    return typ.encode("ascii") + struct.pack(">I", len(data) + 8) + data


def _png(img: Image.Image, size: int) -> bytes:
    buf = io.BytesIO()
    img.convert("RGBA").resize((size, size), Image.LANCZOS).save(buf, format="PNG")
    return buf.getvalue()


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 1
    src, out = sys.argv[1], sys.argv[2]
    img = Image.open(src).convert("RGBA")
    w, h = img.size
    if w != h:
        print(f"error: source must be square, got {w}x{h}", file=sys.stderr)
        return 1
    # (chunk type, pixel size): ic10/ic14 are 1024px, ic09/ic13 are 512px
    entries = [
        ("ic04", 16), ("ic05", 32), ("ic07", 128), ("ic08", 256),
        ("ic09", 512), ("ic10", 1024),
        ("ic11", 64), ("ic12", 128), ("ic13", 512), ("ic14", 1024),
    ]
    body = b"".join(_chunk(t, _png(img, s)) for t, s in entries)
    with open(out, "wb") as f:
        f.write(b"icns" + struct.pack(">I", len(body) + 8) + body)
    print(f"wrote {out} ({len(body) + 8} bytes, source {w}x{h})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
