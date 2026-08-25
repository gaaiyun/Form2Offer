from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ICON_SIZES = {
    "icon.png": 512,
    "icon128.png": 128,
    "icon48.png": 48,
    "icon32.png": 32,
    "icon16.png": 16,
}


def build_logo(size: int = 1024) -> Image.Image:
    scale = size / 1024
    image = Image.new("RGB", (size, size), "#071B2C")
    pixels = image.load()

    top = (7, 27, 44)
    bottom = (8, 91, 92)
    for y in range(size):
        ratio = y / max(1, size - 1)
        color = tuple(round(a + (b - a) * ratio) for a, b in zip(top, bottom))
        for x in range(size):
            pixels[x, y] = color

    draw = ImageDraw.Draw(image)
    r = lambda value: round(value * scale)

    draw.rounded_rectangle(
        (r(205), r(120), r(819), r(902)),
        radius=r(92),
        fill="#F7FAFC",
        outline="#B8F4E6",
        width=max(2, r(16)),
    )
    draw.rounded_rectangle((r(300), r(238), r(614), r(282)), radius=r(20), fill="#143C55")
    draw.rounded_rectangle((r(300), r(334), r(704), r(374)), radius=r(18), fill="#B8D8DF")
    draw.rounded_rectangle((r(300), r(419), r(626), r(459)), radius=r(18), fill="#B8D8DF")

    path = [(r(294), r(708)), (r(422), r(588)), (r(535), r(674)), (r(724), r(480))]
    draw.line(path, fill="#10BFA3", width=r(48), joint="curve")
    draw.ellipse((r(269), r(683), r(319), r(733)), fill="#10BFA3")
    draw.ellipse((r(397), r(563), r(447), r(613)), fill="#10BFA3")
    draw.ellipse((r(510), r(649), r(560), r(699)), fill="#10BFA3")
    draw.polygon(
        [(r(707), r(426)), (r(794), r(452)), (r(768), r(539))],
        fill="#34E6B5",
    )

    glow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse((r(620), r(365), r(872), r(617)), fill=(52, 230, 181, 64))
    glow = glow.filter(ImageFilter.GaussianBlur(r(42)))
    image = Image.alpha_composite(image.convert("RGBA"), glow)
    return image.convert("RGB")


def save_resized(source: Image.Image, output: Path, size: int) -> None:
    resized = source.resize((size, size), Image.Resampling.LANCZOS)
    if size <= 48:
        resized = resized.filter(ImageFilter.UnsharpMask(radius=0.45, percent=140, threshold=2))
    output.parent.mkdir(parents=True, exist_ok=True)
    resized.save(output, format="PNG", optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Form2Offer brand assets.")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()

    logo = build_logo()
    asset_path = args.root / "assets" / "form2offer-logo.png"
    save_resized(logo, asset_path, 1024)
    for filename, size in ICON_SIZES.items():
        save_resized(logo, args.root / "icons" / filename, size)

    print(f"Logo asset: {asset_path}")
    print("Icons: " + ", ".join(str(args.root / "icons" / name) for name in ICON_SIZES))


if __name__ == "__main__":
    main()
