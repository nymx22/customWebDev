#!/usr/bin/env python3
"""
resize_images.py — Resize all JPG/PNG images in a folder by percentage, save as PNG.

Usage:
    python resize_images.py ./my_folder           # default 50%
    python resize_images.py ./my_folder --scale 75
    python resize_images.py ./my_folder --scale 25 -o ./resized

Requirements:
    pip install pillow
"""

import argparse
import os
import sys
from pathlib import Path

from PIL import Image

SUPPORTED = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp"}


def resize_folder(input_dir: str, output_dir: str, scale: float):
    input_path = Path(input_dir)
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    files = [f for f in sorted(input_path.iterdir()) if f.suffix.lower() in SUPPORTED]
    if not files:
        print(f"No supported image files found in {input_dir}")
        return

    print(f"\nFound {len(files)} image(s) in {input_dir}")
    print(f"Scale:  {scale}%")
    print(f"Output: {output_dir}\n")

    for i, f in enumerate(files, 1):
        out_file = output_path / (f.stem + ".png")
        try:
            img = Image.open(f)
            orig_w, orig_h = img.size
            new_w = max(1, round(orig_w * scale / 100))
            new_h = max(1, round(orig_h * scale / 100))
            resized = img.resize((new_w, new_h), Image.LANCZOS)

            # PNG doesn't support CMYK — convert if needed
            if resized.mode not in ("RGB", "RGBA", "L", "LA", "P"):
                resized = resized.convert("RGBA")

            resized.save(out_file, format="PNG", optimize=True)
            size_kb = out_file.stat().st_size / 1024
            print(f"[{i}/{len(files)}] {f.name}  {orig_w}x{orig_h} → {new_w}x{new_h}  ({size_kb:.0f} KB)  → {out_file.name}")

        except Exception as e:
            print(f"[{i}/{len(files)}] {f.name}  ERROR: {e}")

    print(f"\nDone. {len(files)} file(s) → {output_dir}")


def main():
    parser = argparse.ArgumentParser(
        description="Resize all JPG/PNG images in a folder by percentage, output as PNG."
    )
    parser.add_argument("input", help="Folder containing images")
    parser.add_argument("-o", "--output", help="Output folder (default: input/resized)")
    parser.add_argument(
        "--scale", type=float, default=50,
        help="Scale percentage (default: 50). E.g. 75 = 75%% of original size."
    )
    args = parser.parse_args()

    if not 1 <= args.scale <= 100:
        print("Error: --scale must be between 1 and 100", file=sys.stderr)
        sys.exit(1)

    if not os.path.isdir(args.input):
        print(f"Error: not a directory: {args.input}", file=sys.stderr)
        sys.exit(1)

    output_dir = args.output or os.path.join(args.input, "resized")
    resize_folder(args.input, output_dir, args.scale)


if __name__ == "__main__":
    main()
