# 4차 보완 2번: 번짐 지표 검증 프로브 (rig-tear.py와 동일 코드 경로).
#   blender --background --factory-startup --python-exit-code 1 --python scripts/probe-spread.py -- \
#     --src scratch/rig-types --id fire-01 --lm scratch/landmarks/landmarks-3d.json --pose arm-spread
# - 마스크 바깥(outside) 정점 집합의 이동량 분포를 전체 자릿수로 출력한다.
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import rig_poses  # noqa: E402
import rig_region  # noqa: E402

FILES = {"base": "{sid}-rigged.glb", "heat": "{sid}-heat.glb", "mix": "{sid}-mix.glb"}


def parse_args():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    o = dict(zip(args[::2], args[1::2]))
    return o["--src"], o["--id"], o["--lm"], o.get("--pose", "arm-spread")


def main():
    src, sid, lm_path, tag = parse_args()
    src = os.path.abspath(src)
    d = os.path.join(src, sid)
    spec = json.load(open(lm_path, encoding="utf-8"))["landmarks"][sid]
    t = spec.get("type", "A")
    pts = {k: Vector(v["pos"]) for k, v in spec["points"].items()}
    spans = {k: float(v.get("span", 0.0)) for k, v in spec["points"].items()}
    for method, fn in FILES.items():
        glb = os.path.join(d, fn.format(sid=sid))
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=glb)
        arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
        mesh = max(
            [o for o in bpy.data.objects if o.type == "MESH"],
            key=lambda o: len(o.data.vertices),
        )
        mw = mesh.matrix_world
        bb = [mw @ Vector(c) for c in mesh.bound_box]
        lo = Vector([min(p[i] for p in bb) for i in range(3)])
        hi = Vector([max(p[i] for p in bb) for i in range(3)])
        ctr = (lo + hi) / 2
        S = max(hi - lo)
        Sz = hi.z - lo.z
        segs, RR, _fan = rig_region.build(sid, t, pts, spans, S, Sz, lo, ctr)
        bones = set(arm.pose.bones.keys())
        bl = [x for x in ("armL", "armR") if x in bones and x in segs]
        nv = len(mesh.data.vertices)
        masks = []
        for v in mesh.data.vertices:
            p = mw @ v.co
            m = 0.0
            for b in bl:
                sa, sb = segs[b]
                m = max(m, rig_region.mask_limb(p, sa, sb, RR[b]))
            masks.append(m)
        out_idx = [i for i, m in enumerate(masks) if m <= 0.0]
        in_idx = [i for i, m in enumerate(masks) if m > 0.0]
        rest_co = [v.co.copy() for v in mesh.data.vertices]
        rig_poses.reset_pose(arm)
        rig_poses.apply_pose(arm, tag, pts, Sz, "new")
        deps = bpy.context.evaluated_depsgraph_get()
        deps.update()
        ev = mesh.evaluated_get(deps)
        disp = [(ev.data.vertices[i].co - rest_co[i]).length for i in range(nv)]

        def stats(idx):
            ds = sorted(disp[i] for i in idx)
            n = len(ds)
            if not n:
                return None
            return (
                sum(ds) / n / Sz,
                ds[-1] / Sz,
                ds[int(0.50 * (n - 1))] / Sz,
                ds[int(0.90 * (n - 1))] / Sz,
                ds[int(0.99 * (n - 1))] / Sz,
            )

        print(
            f"[spread-probe] {sid} {method} {tag} nvert={nv} "
            f"n_out={len(out_idx)} n_in={len(in_idx)} Sz={Sz:.6f}",
            flush=True,
        )
        so = stats(out_idx)
        if so is None:
            print(f"[spread-probe] {sid} {method} OUTSIDE EMPTY", flush=True)
        else:
            print(
                f"[spread-probe] {sid} {method} OUTSIDE mean={so[0]:.6e} "
                f"max={so[1]:.6e} p50={so[2]:.6e} p90={so[3]:.6e} p99={so[4]:.6e}",
                flush=True,
            )
            mx = max(disp[i] for i in out_idx)
            nb = 10
            hist = [0] * nb
            for i in out_idx:
                b = min(nb - 1, int(disp[i] / mx * nb)) if mx > 0 else 0
                hist[b] += 1
            print(
                f"[spread-probe] {sid} {method} OUTSIDE hist10(max={mx:.6e}): {hist}",
                flush=True,
            )
            samp = " ".join(f"{i}:{disp[i] / Sz:.6e}" for i in out_idx[:12])
            print(
                f"[spread-probe] {sid} {method} OUTSIDE samples(idx,disp/Sz): {samp}",
                flush=True,
            )
        si = stats(in_idx)
        if si is not None:
            print(
                f"[spread-probe] {sid} {method} INSIDE mean={si[0]:.6e} "
                f"max={si[1]:.6e} p50={si[2]:.6e} p90={si[3]:.6e} p99={si[4]:.6e}",
                flush=True,
            )
        sp = sum(disp[i] for i in out_idx) / len(out_idx) / Sz if out_idx else None
        csv_fmt = f"{sp:.4f}" if sp is not None else "-"
        print(
            f"[spread-probe] {sid} {method} tear_sp={sp} csv_fmt={csv_fmt}",
            flush=True,
        )
    print("[spread-probe] DONE", flush=True)


main()
