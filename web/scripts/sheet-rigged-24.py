# R-A 확인용: sheet-rigged-24.png 합성 (PIL, Blender 불필요).
# 24종 격자 6x4, 종마다 리그 GLB 레스트 정면.
import os

from PIL import Image, ImageDraw

SRC = "scratch/rig-types"
IDS = [f"fire-0{i}" for i in range(1, 6)] + [f"grass-0{i}" for i in range(1, 6)] + \
    [f"rock-0{i}" for i in range(1, 5)] + [f"water-0{i}" for i in range(1, 6)] + \
    [f"wind-0{i}" for i in range(1, 6)]
COLS = 6
CW, CH = 400, 400

rows = (len(IDS) + COLS - 1) // COLS
canvas = Image.new("RGB", (COLS * CW, rows * CH), (12, 12, 16))
dr = ImageDraw.Draw(canvas)
missing = 0
for k, sid in enumerate(IDS):
    r, c = divmod(k, COLS)
    p = os.path.join(SRC, sid, f"{sid}-rigged-rest-front.png")
    x0, y0 = c * CW, r * CH
    if os.path.exists(p):
        im = Image.open(p).convert("RGB").resize((CW, CH))
        canvas.paste(im, (x0, y0))
    else:
        dr.rectangle([x0, y0, x0 + CW - 1, y0 + CH - 1], fill=(30, 30, 34))
        print(f"[sheet] MISSING {sid}")
        missing += 1
    dr.text((x0 + 8, y0 + 8), sid, fill=(255, 255, 0))
canvas.save(os.path.join(SRC, "sheet-rigged-24.png"))
print(f"[sheet] DONE {len(IDS)} missing={missing}")
