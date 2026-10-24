#!/usr/bin/env python3
"""Produce faithful separate views from the supplied Shadowbound concept collage.

These are crops of an AI mockup, not photos of physical manufacturing samples.
Run: python scripts/generate-shadowbound-gallery.py
"""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
source_file = root / "public/assets/asryo-shadowbound-005.webp"
output_dir = root / "public/assets"
views = {
    "shadowbound-front.webp": (0, 0, 559, 957),
    "shadowbound-back.webp": (561, 0, 1122, 957),
    "shadowbound-chest-detail.webp": (13, 991, 276, 1300),
    "shadowbound-label-detail.webp": (289, 991, 555, 1300),
    "shadowbound-artwork-detail.webp": (567, 991, 832, 1300),
    "shadowbound-sleeve-detail.webp": (842, 991, 1111, 1300),
}
with Image.open(source_file) as source:
    if source.size != (1122, 1402):
        raise ValueError("Unexpected original mockup dimensions; review cropping coordinates.")
    im = source.convert("RGB")
    for name, bounds in views.items():
        path = output_dir / name
        im.crop(bounds).save(path, "WEBP", quality=91, method=6)
        print(f"Generated: {name} ({path.stat().st_size} bytes)")
