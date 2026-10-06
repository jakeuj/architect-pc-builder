#!/usr/bin/env python3
"""Regenerate checked-in site artwork: python3 scripts/generate_site_assets.py.

Requires Pillow (only for this manual artwork step, never the price-update job).
Use --font /path/to/traditional-chinese-font.ttf on non-macOS systems.
"""

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
BG, CARD, ACCENT, TEXT, MUTED, LINE = (
    "#0b0f14", "#121820", "#66dded", "#edf3fa", "#9caec0", "#253140"
)
# The same six component tiles are used in the SVG and every raster size.
TILES = [(x, y, x + 19, y + 12) for y in (23, 42, 61) for x in (25, 52)]


def icon(size):
    scale = 8
    canvas = Image.new("RGB", (96 * scale, 96 * scale), BG)
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle(
        (5 * scale, 5 * scale, 91 * scale, 91 * scale),
        radius=20 * scale, fill="#102d35", outline=ACCENT, width=2 * scale,
    )
    for tile in TILES:
        draw.rounded_rectangle(tuple(v * scale for v in tile), radius=2 * scale, fill=ACCENT)
    return canvas.resize((size, size), Image.Resampling.LANCZOS)


def share_card(font_path):
    scale = 2
    canvas = Image.new("RGB", (1200 * scale, 630 * scale), BG)
    draw = ImageDraw.Draw(canvas)

    def box(coords, radius=0, fill=CARD, outline=None, width=1):
        draw.rounded_rectangle(tuple(v * scale for v in coords), radius=radius * scale,
                               fill=fill, outline=outline, width=width * scale)

    def label(x, y, text, size, color=TEXT):
        draw.text((x * scale, y * scale), text,
                  font=ImageFont.truetype(str(font_path), size * scale), fill=color)

    # A dedicated cover: large title plus a build-list illustration, no live prices.
    for x in range(760, 1200, 40):
        draw.line((x * scale, 0, x * scale, 630 * scale), fill="#111b24", width=scale)
    for y in range(0, 630, 40):
        draw.line((760 * scale, y * scale, 1200 * scale, y * scale), fill="#111b24", width=scale)
    canvas.paste(icon(64 * scale), (68 * scale, 66 * scale))
    label(150, 83, "PC / BUILDER", 25, ACCENT)
    label(68, 216, "原價屋估價單分享", 58)
    label(72, 314, "自由選件，組出你的電腦", 31, MUTED)
    label(72, 365, "一條連結，保存報價與完整配置", 26, MUTED)
    box((72, 465, 350, 517), 26, "#102d35")
    label(96, 478, "含稅報價 · 免登入分享", 21, ACCENT)
    label(72, 553, "pc.jakeuj.com", 23, MUTED)

    box((806, 126, 1132, 514), 22, CARD, LINE, 2)
    label(832, 154, "BUILD SUMMARY", 21, ACCENT)
    label(832, 198, "你的組裝清單", 29)
    for y, name, bars in ((264, "CPU", 2), (332, "GPU", 3), (400, "RAM", 2)):
        box((832, y, 1106, y + 52), 10, "#18212c")
        label(846, y + 13, name, 20)
        for i in range(bars):
            box((918 + i * 52, y + 21, 958 + i * 52, y + 31), 4, ACCENT)
    label(832, 471, "選件 / 計價 / 分享", 19, MUTED)
    return canvas.resize((1200, 630), Image.Resampling.LANCZOS)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--font", type=Path, help="Font with Traditional Chinese glyphs")
    args = parser.parse_args()
    font_path = args.font or Path("/System/Library/Fonts/STHeiti Medium.ttc")
    if not font_path.is_file():
        parser.error("Provide a Traditional Chinese font with --font")

    tiles = "\n".join(
        f'  <rect x="{x}" y="{y}" width="19" height="12" rx="2" fill="{ACCENT}"/>'
        for x, y, _, _ in TILES
    )
    (DOCS / "favicon.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">\n'
        f'  <rect width="96" height="96" fill="{BG}"/>\n'
        f'  <rect x="5" y="5" width="86" height="86" rx="20" fill="#102d35" stroke="{ACCENT}" stroke-width="2"/>\n'
        f'{tiles}\n</svg>\n', encoding="utf-8"
    )
    for filename, size in (("favicon-96x96.png", 96), ("apple-touch-icon.png", 180),
                           ("icon-192.png", 192), ("icon-512.png", 512)):
        icon(size).save(DOCS / filename, optimize=True)
    icon(96).save(DOCS / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (96, 96)])
    share_card(font_path).save(DOCS / "social-preview-v1.png", optimize=True)
    print("Generated favicon, touch/app icons and 1200 × 630 social preview in docs/")


if __name__ == "__main__":
    main()
