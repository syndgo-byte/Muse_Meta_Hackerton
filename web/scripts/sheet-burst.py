# Contact sheet for 8-G bursts: center-crop (stage) + index labels.
import glob
import os
import sys

from PIL import Image, ImageDraw

TAG = sys.argv[1] if len(sys.argv) > 1 else "a"
D = f"D:/Meta_hackerton/scratch/dance-v2/burst-{TAG}"
files = sorted(glob.glob(f"{D}/s-*.png"))
thumbs = []
for f in files:
    im = Image.open(f).convert("RGB")
    w, h = im.size
    s = min(w, h)
    x0 = (w - s) // 2
    crop = im.crop((x0, 0, x0 + s, s)).resize((144, 144))
    thumbs.append(crop)
cols = 10
rows = (len(thumbs) + cols - 1) // cols
sheet = Image.new("RGB", (cols * 144, rows * (144 + 14)), "white")
dr = ImageDraw.Draw(sheet)
for i, t in enumerate(thumbs):
    x, y = (i % cols) * 144, (i // cols) * (144 + 14)
    sheet.paste(t, (x, y + 14))
    dr.text((x + 4, y + 1), f"{i}", fill="black")
out = f"{D}-sheet.jpg"
sheet.save(out, quality=82)
print(f"wrote {out} ({len(thumbs)} shots)")
