#!/usr/bin/env python3
"""
remove_background.py — Remove dark gray backgrounds from images in a folder.

Saves results as PNGs with transparency.

Usage:
    # Process a folder (auto method)
    python remove_background.py ./my_photos

    # Use ML method (rembg) — best for complex/semi-transparent edges
    python remove_background.py ./my_photos --method ml

    # Use color masking — fast, best for solid uniform backgrounds
    python remove_background.py ./my_photos --method color

    # Tune color masking threshold (0–255, default 60)
    python remove_background.py ./my_photos --method color --threshold 80

    # Custom output folder
    python remove_background.py ./my_photos -o ./output

Requirements:
    pip install rembg pillow numpy
"""

import argparse
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image

SUPPORTED = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp", ".bmp"}


# ─── Method 1: ML-based (rembg) ──────────────────────────────────────────────

def remove_bg_ml(img: Image.Image) -> Image.Image:
    """Use rembg (U2Net) to remove background. Best for complex edges."""
    try:
        from rembg import remove
    except ImportError:
        print("  rembg not installed. Run: pip install rembg", file=sys.stderr)
        sys.exit(1)
    return remove(img)


# ─── Method 2: Color-range masking ───────────────────────────────────────────

def remove_bg_color(img: Image.Image, threshold: int = 60) -> Image.Image:
    """
    Mask out dark gray/black background using flood-fill from image corners
    combined with a luminance threshold.

    Works well when background is a uniform dark color.
    threshold: pixels with brightness below this AND connected to corners
               are treated as background. Higher = removes more.
    """
    rgba = img.convert("RGBA")
    arr = np.array(rgba, dtype=np.uint8)

    rgb = arr[:, :, :3].astype(np.float32)
    luminance = 0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]

    # Dark pixel mask
    dark_mask = luminance < threshold

    # Flood-fill from all four corners to find connected dark background
    from PIL import ImageFilter
    h, w = dark_mask.shape
    visited = np.zeros((h, w), dtype=bool)
    bg_mask = np.zeros((h, w), dtype=bool)

    # BFS from corners
    from collections import deque
    queue = deque()
    seeds = [(0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1)]
    for r, c in seeds:
        if dark_mask[r, c] and not visited[r, c]:
            queue.append((r, c))
            visited[r, c] = True

    while queue:
        r, c = queue.popleft()
        bg_mask[r, c] = True
        for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < h and 0 <= nc < w and not visited[nr, nc] and dark_mask[nr, nc]:
                visited[nr, nc] = True
                queue.append((nr, dc if False else nc))

    # Soft edge: feather the mask slightly
    bg_mask_img = Image.fromarray(bg_mask.astype(np.uint8) * 255, mode="L")
    bg_mask_feathered = bg_mask_img.filter(ImageFilter.GaussianBlur(radius=2))
    bg_arr = np.array(bg_mask_feathered)

    # Apply: where background mask is set, make transparent
    alpha = arr[:, :, 3].copy()
    alpha = np.where(bg_arr > 128, 0, alpha)

    arr[:, :, 3] = alpha
    return Image.fromarray(arr, mode="RGBA")


# ─── Method 3: Combined (color mask + ML fallback) ───────────────────────────

def remove_bg_auto(img: Image.Image, threshold: int = 60) -> Image.Image:
    """Try color masking first; if result looks poor, fall back to ML."""
    result = remove_bg_color(img, threshold)
    arr = np.array(result)
    transparent_ratio = (arr[:, :, 3] == 0).mean()

    # Heuristic: if <5% or >80% of pixels were removed, color mask failed
    if transparent_ratio < 0.05 or transparent_ratio > 0.80:
        print("    color mask result looks off, falling back to ML...")
        result = remove_bg_ml(img)

    return result


# ─── Main ─────────────────────────────────────────────────────────────────────

def process_folder(input_dir: str, output_dir: str, method: str, threshold: int):
    input_path = Path(input_dir)
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    files = [f for f in sorted(input_path.iterdir()) if f.suffix.lower() in SUPPORTED]
    if not files:
        print(f"No supported image files found in {input_dir}")
        print(f"Supported: {', '.join(SUPPORTED)}")
        return

    print(f"\nFound {len(files)} image(s) in {input_dir}")
    print(f"Method:    {method}")
    print(f"Output:    {output_dir}\n")

    for i, f in enumerate(files, 1):
        out_file = output_path / (f.stem + ".png")
        print(f"[{i}/{len(files)}] {f.name} → {out_file.name}")

        try:
            img = Image.open(f).convert("RGBA")

            if method == "ml":
                result = remove_bg_ml(img)
            elif method == "color":
                result = remove_bg_color(img, threshold)
            else:  # auto
                result = remove_bg_auto(img, threshold)

            result.save(out_file, format="PNG")
            size_kb = out_file.stat().st_size / 1024
            print(f"    saved ({size_kb:.0f} KB)")

        except Exception as e:
            print(f"    ERROR: {e}")

    print(f"\nDone. {len(files)} file(s) processed → {output_dir}")


def main():
    parser = argparse.ArgumentParser(
        description="Remove dark gray backgrounds from images, output as PNG with transparency.",
    )
    parser.add_argument("input", help="Folder containing images")
    parser.add_argument("-o", "--output", help="Output folder (default: input/bg_removed)")
    parser.add_argument(
        "--method", choices=["auto", "ml", "color"], default="auto",
        help="auto: tries color first, falls back to ML | ml: rembg U2Net | color: flood-fill mask"
    )
    parser.add_argument(
        "--threshold", type=int, default=60,
        help="Brightness threshold for color method (0-255, default 60). Higher removes more."
    )
    args = parser.parse_args()

    if not os.path.isdir(args.input):
        print(f"Error: not a directory: {args.input}", file=sys.stderr)
        sys.exit(1)

    output_dir = args.output or os.path.join(args.input, "bg_removed")
    process_folder(args.input, output_dir, args.method, args.threshold)


if __name__ == "__main__":
    main()
