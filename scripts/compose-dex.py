# Compose dex capture + original frame side by side (8-G-5).
# Usage: python scripts/compose-dex.py <cid> <dexshot> <video> <t> <out>
#   [x0 y0 x1 y1]  (dex crop, default 620 80 860 300)
import subprocess
import sys

from PIL import Image, ImageDraw

FF = ("D:/Meta_hackerton/scratch/dance-venv/Lib/site-packages"
      "/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe")

cid, dexshot, video, t, out = sys.argv[1:6]
box = tuple(int(v) for v in sys.argv[6:10]) if len(sys.argv) > 9 else (620, 80, 860, 300)
orig = f"D:/tmp/orig-{cid}.jpg"
subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-y",
                "-i", video, "-ss", t, "-frames:v", "1", "-q:v", "3", orig],
               check=True)
dex = Image.open(dexshot).convert("RGB").crop(box)
dex = dex.resize((dex.width * 2, dex.height * 2), Image.LANCZOS)
o = Image.open(orig).convert("RGB")
o = o.resize((int(o.width * dex.height / o.height), dex.height))
W = dex.width + o.width + 30
fig = Image.new("RGB", (W, dex.height + 60), "white")
dr = ImageDraw.Draw(fig)
fig.paste(dex, (10, 50))
fig.paste(o, (20 + dex.width, 50))
dr.text((10, 8), f"/dex {cid} (timed burst, pose-matched; exact beat unverified)",
        fill="black")
dr.text((10, 28), dexshot.split("/")[-1], fill="black")
dr.text((20 + dex.width, 28), f"orig @{t}s", fill="black")
fig.save(out)
print(f"wrote {out} {fig.size}")
