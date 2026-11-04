# Stage-crop contact sheet: tight crop on the dancing pedestal (x 600-880, y 40-320).
import glob
import sys

from PIL import Image, ImageDraw

TAG = sys.argv[1] if len(sys.argv) > 1 else "b"
D = f"D:/Meta_hackerton/scratch/dance-v2/burst-{TAG}"
files = sorted(glob.glob(f"{D}/s-*.png"))
thumbs = []
for f in files:
    im = Image.open(f).convert("RGB")
    crop = im.crop((600, 40, 880, 320)).resize((140, 140))
    thumbs.append(crop)
cols = 10
rows = (len(thumbs) + cols - 1) // cols
sheet = Image.new("RGB", (cols * 140, rows * (140 + 14)), "white")
dr = ImageDraw.Draw(sheet)
for i, t in enumerate(thumbs):
    x, y = (i % cols) * 140, (i // cols) * (140 + 14)
    sheet.paste(t, (x, y + 14))
    dr.text((x + 4, y + 1), f"{i}", fill="black")
out = f"{D}-stage.jpg"
sheet.save(out, quality=82)
print(f"wrote {out} ({len(thumbs)} shots)")
