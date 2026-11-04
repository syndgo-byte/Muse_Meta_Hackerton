# 4차 3번: compare-mix.png 합성 (PIL, Blender 불필요)
#   행=종 7, 열=heat-arm-spread | mix-arm-spread | mix-foot-lift | mix-dance-test (정면)
#   4차 보완: 팔이 없는 종(type C)의 arm-spread 칸은 같은 variant의 twist로
#   대체하고 셀에 "(twist 대체)"를 표시한다.
import json
import os

from PIL import Image, ImageDraw

SRC = "scratch/rig-types"
IDS = ["wind-05", "fire-03", "rock-03", "fire-05", "water-04", "water-02", "fire-01"]
COLS = ["heat-arm-spread", "mix-arm-spread", "mix-foot-lift", "mix-dance-test"]
CW, CH = 400, 400


def cell_src(sid, tag):
    p = os.path.join(SRC, sid, f"{sid}-{tag}-front.png")
    if os.path.exists(p):
        return p, None
    if tag.endswith("arm-spread"):
        dec = json.load(open(os.path.join(SRC, sid, "decision.json"), encoding="utf-8"))
        if not any(b.startswith("arm") for b in dec.get("bones", [])):
            fb = os.path.join(SRC, sid, f"{sid}-{tag.split('-')[0]}-twist-front.png")
            if os.path.exists(fb):
                return fb, "(twist instead)"
    return None, None


canvas = Image.new("RGB", (len(COLS) * CW, len(IDS) * CH), (12, 12, 16))
dr = ImageDraw.Draw(canvas)
for r, sid in enumerate(IDS):
    for c, tag in enumerate(COLS):
        p, note = cell_src(sid, tag)
        x0, y0 = c * CW, r * CH
        if p is not None:
            im = Image.open(p).convert("RGB").resize((CW, CH))
            canvas.paste(im, (x0, y0))
            if note is not None:
                dr.text((c * CW + 8, r * CH + 40), note, fill=(255, 200, 0))
                print(f"[compare] FALLBACK {sid} {tag} -> twist")
        else:
            dr.rectangle([x0, y0, x0 + CW - 1, y0 + CH - 1], fill=(30, 30, 34))
            print(f"[compare] MISSING {sid} {tag}")
    dr.text((8, r * CH + 8), sid, fill=(255, 255, 0))
    for c, tag in enumerate(COLS):
        dr.text((c * CW + 8, r * CH + 24), tag, fill=(200, 200, 200))
canvas.save(os.path.join(SRC, "compare-mix.png"))
print(f"[compare] DONE {len(IDS)}x{len(COLS)}")
