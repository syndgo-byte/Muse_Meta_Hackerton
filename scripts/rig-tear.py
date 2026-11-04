# 1번+4차 2번: 포즈 전후 메시 변 길이 비율 + 번짐 측정.
#   blender --background --factory-startup --python-exit-code 1 --python scripts/rig-tear.py -- \
#     --src scratch/rig-types --ids all --variant cyl --method base \
#     --lm scratch/landmarks/landmarks-3d.json --out scratch/rig-types/summary-mix.csv \
#     --mode overwrite --spread new
# - variant cyl: <id>-rigged.glb / heat: <id>-heat.glb / mix: <id>-mix.glb
# - 포즈 목록은 각 종 decision.json의 poses.
# - 늘어남: rest 길이 하위 10% 엣지 제외, max / count(>2.5) / p99 / sum(max(0,q-1))/Sz.
# - 번짐(arm-raise/arm-spread/foot-lift만): 움직이는 뼈 마스크 합집합이 0인 정점의
#   평균 이동거리 / Sz. 그 외 포즈는 N/A.
import csv
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import rig_poses  # noqa: E402
import rig_region  # noqa: E402

SPREAD_POSES = ("arm-raise", "arm-spread", "foot-lift")


def parse_args():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    o = dict(zip(args[::2], args[1::2]))
    ids = o.get("--ids", "all")
    return {
        "src": os.path.abspath(o["--src"]),
        "ids": None if ids == "all" else ids.split(","),
        "variant": o.get("--variant", "cyl"),
        "method": o.get("--method", "cyl"),
        "lm": o["--lm"],
        "out": os.path.abspath(o["--out"]),
        "mode": o.get("--mode", "overwrite"),
        "spread": o.get("--spread", "new"),
    }


def main():
    a = parse_args()
    lm = json.load(open(a["lm"], encoding="utf-8"))["landmarks"]
    if a["ids"] is None:
        ids = sorted(d for d in os.listdir(a["src"])
                     if os.path.isdir(os.path.join(a["src"], d))
                     and os.path.exists(os.path.join(a["src"], d, "decision.json")))
    else:
        ids = a["ids"]
    rows = []
    for sid in ids:
        d = os.path.join(a["src"], sid)
        if a["variant"] in ("heat", "mix"):
            glb = os.path.join(d, f"{sid}-{a['variant']}.glb")
        else:
            glb = os.path.join(d, f"{sid}-rigged.glb")
        if not os.path.exists(glb):
            print(f"[tear] {sid} {a['method']} SKIP (없음: {glb})", flush=True)
            continue
        dec = json.load(open(os.path.join(d, "decision.json"), encoding="utf-8"))
        poses = dec.get("poses", ["rest"])
        t = lm[sid].get("type", "A")
        pts = {k: Vector(v["pos"]) for k, v in lm[sid]["points"].items()}
        spans = {k: float(v.get("span", 0.0)) for k, v in lm[sid]["points"].items()}
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=glb)
        arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
        meshes = [o for o in bpy.data.objects if o.type == "MESH"]
        mesh = max(meshes, key=lambda o: len(o.data.vertices))
        if arm is None:
            print(f"[tear] {sid} {a['method']} SKIP (armature 없음)", flush=True)
            continue
        bb = [mesh.matrix_world @ Vector(c) for c in mesh.bound_box]
        lo = Vector([min(p[i] for p in bb) for i in range(3)])
        hi = Vector([max(p[i] for p in bb) for i in range(3)])
        ctr = (lo + hi) / 2
        S = max(hi - lo)
        Sz = hi.z - lo.z
        segs, RR, _fan = rig_region.build(sid, t, pts, spans, S, Sz, lo, ctr)
        bones = set(arm.pose.bones.keys())
        spread_bones = {}
        for tag in poses:
            if tag not in SPREAD_POSES:
                continue
            if tag == "foot-lift":
                bl = ["legL"] if "legL" in bones else []
            else:
                bl = [x for x in ("armL", "armR") if x in bones]
            spread_bones[tag] = [b for b in bl if b in segs]
        edges = mesh.data.edges
        rest_co = [v.co.copy() for v in mesh.data.vertices]
        rest_len = [(rest_co[e.vertices[0]] - rest_co[e.vertices[1]]).length for e in edges]
        order = sorted(range(len(edges)), key=lambda i: rest_len[i])
        keep = order[int(len(order) * 0.10):]
        keep_set = set(keep)
        outside = {}
        for tag, bl in spread_bones.items():
            if not bl:
                outside[tag] = None
                continue
            idx = []
            for i, v in enumerate(mesh.data.vertices):
                p = mesh.matrix_world @ v.co
                m = 0.0
                for b in bl:
                    sa, sb = segs[b]
                    m = max(m, rig_region.mask_limb(p, sa, sb, RR[b]))
                if m <= 0.0:
                    idx.append(i)
            outside[tag] = idx if idx else None
        deps = bpy.context.evaluated_depsgraph_get()
        with open(os.path.join(d, "run.log"), "a", encoding="utf-8") as fp:
            for tag in poses:
                rig_poses.reset_pose(arm)
                rig_poses.apply_pose(arm, tag, pts, Sz, a["spread"])
                deps.update()
                ev = mesh.evaluated_get(deps)
                qs = []
                for i in keep:
                    e = edges[i]
                    r0 = rest_len[i]
                    if r0 < 1e-9:
                        continue
                    r1 = (ev.data.vertices[e.vertices[0]].co
                          - ev.data.vertices[e.vertices[1]].co).length
                    qs.append(r1 / r0)
                qs.sort()
                n = len(qs)
                maxr = qs[-1] if n else 1.0
                n25 = sum(1 for q in qs if q > 2.5)
                p99 = qs[int(0.99 * (n - 1))] if n else 1.0
                sh = sum(q - 1.0 for q in qs if q > 1.0) / Sz if Sz > 0 else 0.0
                sp = None
                if tag in outside and outside[tag] is not None:
                    idx = outside[tag]
                    tot = sum((ev.data.vertices[i].co - rest_co[i]).length for i in idx)
                    sp = tot / len(idx) / Sz if Sz > 0 else 0.0
                sps = f"{sp:.4f}" if sp is not None else "-"
                line = (f"[tear] {sid} {a['method']} {tag} "
                        f"max={maxr:.3f} n25={n25} n={n} p99={p99:.3f} "
                        f"stretch_h={sh:.4f} spread={sps}")
                print(line, flush=True)
                fp.write(line + "\n")
                rows.append([sid, a["method"], tag, f"{maxr:.4f}", n25, n,
                             f"{p99:.4f}", f"{sh:.4f}", sps if sp is not None else ""])
    newfile = a["mode"] == "overwrite" or not os.path.exists(a["out"])
    with open(a["out"], "w" if newfile else "a", encoding="utf-8", newline="") as fp:
        w = csv.writer(fp)
        if newfile:
            w.writerow(["species", "method", "pose", "max_ratio", "n_over25", "n_edges",
                        "p99", "stretch_h", "spread"])
        w.writerows(rows)
    print(f"[tear] DONE ids={len(ids)} rows={len(rows)} out={a['out']}", flush=True)


main()
