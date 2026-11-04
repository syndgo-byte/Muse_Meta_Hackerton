# 프로브: 팔/다리 영역 정점의 S->H 선분까지 거리 분포 (렌더 없음)
import json
import sys

import bpy
from mathutils import Vector


def main():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    o = dict(zip(args[::2], args[1::2]))
    sid = o["--id"]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=f"public/models/{sid}.glb")
    mesh = next(x for x in bpy.data.objects if x.type == "MESH")
    spec = json.load(open("scratch/landmarks/landmarks-3d.json", encoding="utf-8"))["landmarks"][sid]
    pts = {k: Vector(v["pos"]) for k, v in spec["points"].items()}
    spans = {k: float(v.get("span", 0.0)) for k, v in spec["points"].items()}
    mw = mesh.matrix_world
    verts = [mw @ v.co for v in mesh.data.vertices]

    def dist_line(p, a, b):
        ab = b - a
        t = max(0.0, min(1.0, (p - a).dot(ab) / ab.dot(ab)))
        return (p - (a + ab * t)).length, t

    # 팔: shoulder x 바깥쪽 정점들
    for side, sx in (("L", 1.0), ("R", -1.0)):
        S = pts[f"shoulder{side}"]
        H = pts[f"hand{side}"]
        R = 0.6 * spans[f"hand{side}"]
        reg = [p for p in verts if (p.x - S.x) * sx > 0 and H.z - 0.1 < p.z < S.z + 0.1]
        ds = sorted(dist_line(p, S, H)[0] for p in reg)
        n = len(ds)
        print(f"[probe] {sid} arm{side}: S={tuple(round(v,3) for v in S)} "
              f"H={tuple(round(v,3) for v in H)} span={spans[f'hand{side}']:.4f} R={R:.4f}", flush=True)
        print(f"[probe] arm{side} region n={n}", flush=True)
        if n:
            import math
            for q in (0.1, 0.25, 0.5, 0.75, 0.9, 1.0):
                print(f"[probe] arm{side} d{q*100:.0f}%={ds[min(n-1,int(q*n))]:.4f}", flush=True)
            inside = sum(1 for d in ds if d <= R)
            print(f"[probe] arm{side} within R: {inside}/{n} = {inside/max(n,1)*100:.1f}%", flush=True)
            xs = [p.x for p in reg]; ys = [p.y for p in reg]; zs = [p.z for p in reg]
            print(f"[probe] arm{side} bbox x[{min(xs):.3f},{max(xs):.3f}] "
                  f"y[{min(ys):.3f},{max(ys):.3f}] z[{min(zs):.3f},{max(zs):.3f}]", flush=True)
    # 다리: b_waist 아래 정점
    W = pts["waist"]
    for side in ("L", "R"):
        f = pts[f"foot{side}"]
        a = Vector((f.x, f.y, W.z))
        R = 0.6 * spans[f"foot{side}"]
        reg = [p for p in verts if p.z < W.z + 0.02 and abs(p.x - f.x) < 0.2 and abs(p.y - f.y) < 0.25]
        ds = sorted(dist_line(p, a, f)[0] for p in reg)
        n = len(ds)
        inside = sum(1 for d in ds if d <= R)
        print(f"[probe] leg{side} span={spans[f'foot{side}']:.4f} R={R:.4f} "
              f"within R: {inside}/{n} = {inside/max(n,1)*100:.1f}%", flush=True)


main()
