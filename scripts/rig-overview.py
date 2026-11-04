# 24종 rest/twist 정면을 한 장에 합성.
#   blender --background --factory-startup --python-exit-code 1 --python scripts/rig-overview.py -- \
#     --src scratch/rig-types --out scratch/rig-types/overview.png
# 배치: 6열 × 4행, 셀당 rest|twist 400px씩 (셀 800×400). 전체 4800×1600.
import os
import sys

import bpy

IDS = [
    "fire-01", "fire-02", "fire-03", "fire-04", "fire-05",
    "grass-01", "grass-02", "grass-03", "grass-04", "grass-05",
    "rock-01", "rock-02", "rock-03", "rock-04",
    "water-01", "water-02", "water-03", "water-04", "water-05",
    "wind-01", "wind-02", "wind-03", "wind-04", "wind-05",
]


def parse_args():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    o = dict(zip(args[::2], args[1::2]))
    return os.path.abspath(o["--src"]), os.path.abspath(o["--out"])


def main():
    import numpy as np

    src, out = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    CW, CHH, CELL_W = 400, 400, 800
    COLS = 6
    ROWS = (len(IDS) + COLS - 1) // COLS
    canvas = np.zeros((ROWS * CHH, COLS * CELL_W, 4), dtype=np.float32)
    for i, sid in enumerate(IDS):
        r, c = divmod(i, COLS)
        for k, tag in enumerate(("rest", "twist")):
            p = os.path.join(src, sid, f"{sid}-{tag}-front.png")
            img = bpy.data.images.load(p)
            w, h = img.size
            buf = np.empty(w * h * 4, dtype=np.float32)
            img.pixels.foreach_get(buf)
            a = buf.reshape(h, w, 4)
            sy = np.linspace(0, h - 1, CHH).astype(int)
            sx = np.linspace(0, w - 1, CW).astype(int)
            small = a[sy[:, None], sx]
            x0 = c * CELL_W + k * CW
            # PNG 상하 뒤집기 (블렌더 픽셀은 아래부터)
            canvas[r * CHH:(r + 1) * CHH, x0:x0 + CW] = small[::-1]
            bpy.data.images.remove(img)
    canvas = canvas[::-1]  # 저장용으로 뒤집기
    img = bpy.data.images.new("overview", COLS * CELL_W, ROWS * CHH, alpha=True)
    img.pixels.foreach_set(canvas.ravel())
    img.file_format = "PNG"
    img.filepath_raw = out
    img.save()
    print(f"[overview] {out} {COLS * CELL_W}x{ROWS * CHH}", flush=True)
    print("[overview] DONE", flush=True)


main()
