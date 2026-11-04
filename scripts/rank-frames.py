# Rank burst shots by dancer silhouette width (X-hold = narrow/compact).
import glob
import sys

import numpy as np
from PIL import Image

TAG = sys.argv[1] if len(sys.argv) > 1 else "b"
D = f"D:/Meta_hackerton/scratch/dance-v2/burst-{TAG}"
rows = []
for f in sorted(glob.glob(f"{D}/s-*.png")):
    im = np.asarray(Image.open(f).convert("RGB")).astype(int)
    crop = im[40:230, 600:880]  # dancer torso zone (above the ring)
    R, G, B = crop[:, :, 0], crop[:, :, 1], crop[:, :, 2]
    mask = (R > 140) & (R - G > 30)
    ys, xs = np.where(mask)
    if len(xs) < 200:
        rows.append((f, 9999, 0))
        continue
    rows.append((f, int(xs.max() - xs.min()), int(mask.sum())))
rows.sort(key=lambda r: r[1])
print("narrowest 12 (X-hold candidates):")
for f, w, n in rows[:12]:
    print(f"  {f.split('/')[-1]} width={w} px={n}")
print("widest 6 (jump/kick candidates):")
for f, w, n in rows[-6:][::-1]:
    print(f"  {f.split('/')[-1]} width={w} px={n}")
