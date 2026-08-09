"""Regenerate every logo/icon asset from the droplet artwork.

The source PNG has an alpha channel, but the droplet sits in a large
canvas with wide empty margins, plus scattered semi-transparent noise
pixels and junk RGB under fully transparent areas. This script keeps only
the largest connected visible component (droplet + ripple), crops the
margins, then exports:
  - the transparent web logo (apps/web/src/assets/login-logo.png)
  - web favicons (apps/web/public/)
  - the full Tauri icon set (apps/desktop/src-tauri/icons/)
"""

from __future__ import annotations

import io
import struct
from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "scripts" / "logo-source-backup.png"
WEB_LOGO = ROOT / "apps" / "web" / "src" / "assets" / "login-logo.png"
WEB_PUBLIC = ROOT / "apps" / "web" / "public"
TAURI_ICONS = ROOT / "apps" / "desktop" / "src-tauri" / "icons"

ALPHA_THRESHOLD = 16  # alpha at or below this counts as empty background
PADDING_RATIO = 0.06  # transparent breathing room around the droplet
MASTER_SIZE = 1024


def largest_component_mask(img: Image.Image) -> Image.Image:
    """Full-res L-mode mask of the largest connected visible component."""
    w, h = img.size
    small_alpha = img.getchannel("A").resize((w // 4, h // 4), Image.BILINEAR)
    sw, sh = small_alpha.size
    px = small_alpha.load()
    seen = bytearray(sw * sh)
    best_pixels: list[tuple[int, int]] | None = None
    for y in range(sh):
        for x in range(sw):
            i = y * sw + x
            if seen[i] or px[x, y] <= ALPHA_THRESHOLD:
                seen[i] = 1
                continue
            q = deque([(x, y)])
            seen[i] = 1
            component = []
            while q:
                cx, cy = q.popleft()
                component.append((cx, cy))
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if 0 <= nx < sw and 0 <= ny < sh:
                        j = ny * sw + nx
                        if not seen[j]:
                            seen[j] = 1
                            if px[nx, ny] > ALPHA_THRESHOLD:
                                q.append((nx, ny))
            if best_pixels is None or len(component) > len(best_pixels):
                best_pixels = component
    if not best_pixels:
        raise RuntimeError("no visible pixels found in source logo")
    mask = Image.new("L", (sw, sh), 0)
    mpx = mask.load()
    for x, y in best_pixels:
        mpx[x, y] = 255
    return mask.resize((w, h), Image.BILINEAR)


def clean_and_crop(img: Image.Image) -> Image.Image:
    img = img.convert("RGBA")
    mask = largest_component_mask(img)
    r, g, b, a = img.split()
    # Drop noise outside the component and near-invisible pixels inside it.
    from PIL import ImageChops

    a = ImageChops.multiply(a, mask)
    a = a.point(lambda v: 0 if v <= ALPHA_THRESHOLD else v)
    black = Image.new("L", img.size, 0)
    empty = a.point(lambda v: 255 if v == 0 else 0)
    r = Image.composite(black, r, empty)
    g = Image.composite(black, g, empty)
    b = Image.composite(black, b, empty)
    img = Image.merge("RGBA", (r, g, b, a))

    bbox = a.getbbox()
    if bbox is None:
        raise RuntimeError("logo is fully transparent after cleanup")
    img = img.crop(bbox)
    side = max(img.size)
    pad = round(side * PADDING_RATIO)
    side += pad * 2
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - img.width) // 2, (side - img.height) // 2), img)
    return canvas


def resized(master: Image.Image, size: int) -> Image.Image:
    return master.resize((size, size), Image.LANCZOS)


def write_icns(master: Image.Image, target: Path) -> None:
    entries = {b"ic07": 128, b"ic08": 256, b"ic09": 512, b"ic10": 1024}
    chunks = []
    for tag, size in entries.items():
        buf = io.BytesIO()
        resized(master, size).save(buf, format="PNG")
        payload = buf.getvalue()
        chunks.append(tag + struct.pack(">I", len(payload) + 8) + payload)
    body = b"".join(chunks)
    target.write_bytes(b"icns" + struct.pack(">I", len(body) + 8) + body)


def main() -> None:
    master = clean_and_crop(Image.open(SOURCE))
    master = resized(master, MASTER_SIZE)

    # Web app logo + favicons
    resized(master, 512).save(WEB_LOGO)
    WEB_PUBLIC.mkdir(parents=True, exist_ok=True)
    resized(master, 64).save(WEB_PUBLIC / "favicon.png")
    resized(master, 256).save(
        WEB_PUBLIC / "favicon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64)]
    )

    # Tauri icon set
    TAURI_ICONS.mkdir(parents=True, exist_ok=True)
    master.save(TAURI_ICONS / "icon.png")
    for name, size in {
        "32x32.png": 32,
        "64x64.png": 64,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "StoreLogo.png": 50,
        "Square30x30Logo.png": 30,
        "Square44x44Logo.png": 44,
        "Square71x71Logo.png": 71,
        "Square89x89Logo.png": 89,
        "Square107x107Logo.png": 107,
        "Square142x142Logo.png": 142,
        "Square150x150Logo.png": 150,
        "Square284x284Logo.png": 284,
        "Square310x310Logo.png": 310,
    }.items():
        resized(master, size).save(TAURI_ICONS / name)
    resized(master, 256).save(
        TAURI_ICONS / "icon.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    write_icns(master, TAURI_ICONS / "icon.icns")

    # Android launcher icons
    android = {
        "mipmap-mdpi": (48, 108),
        "mipmap-hdpi": (72, 162),
        "mipmap-xhdpi": (96, 216),
        "mipmap-xxhdpi": (144, 324),
        "mipmap-xxxhdpi": (192, 432),
    }
    for folder, (launcher, foreground) in android.items():
        out = TAURI_ICONS / "android" / folder
        if not out.exists():
            continue
        resized(master, launcher).save(out / "ic_launcher.png")
        resized(master, launcher).save(out / "ic_launcher_round.png")
        resized(master, foreground).save(out / "ic_launcher_foreground.png")

    # iOS app icons
    ios = TAURI_ICONS / "ios"
    if ios.exists():
        for icon in ios.glob("AppIcon-*.png"):
            base = icon.stem.split("@")[0].split("-", 1)[1]  # e.g. "20x20"
            points = float(base.split("x")[0])
            scale = int(icon.stem.split("@")[1].replace("x", "").split("-")[0])
            resized(master, round(points * scale)).save(icon)

    print(f"master logo: {master.size[0]}x{master.size[1]}, assets regenerated")


if __name__ == "__main__":
    main()
