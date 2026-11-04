# 번짐 지표 디버그 (임시): outside 집합·변위·웨이트 내역
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import rig_poses  # noqa: E402
import rig_region  # noqa: E402

sid = "fire-03"
d = f"scratch/rig-types/{sid}"
spec = json.load(open("scratch/landmarks/landmarks-3d.json", encoding="utf-8"))["landmarks"][sid]
t = spec.get("type", "A")
pts = {k: Vector(v["pos"]) for k, v in spec["points"].items()}
spans = {k: float(v.get("span", 0.0)) for k, v in spec["points"].items()}
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(d, f"{sid}-rigged.glb"))
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
mesh = max(meshes, key=lambda o: len(o.data.vertices))
print(f"[dbg] mesh={mesh.name} verts={len(mesh.data.vertices)}", flush=True)
print(f"[dbg] matrix_world={mesh.matrix_world}", flush=True)
bpts = [mesh.matrix_world @ Vector(c) for c in mesh.bound_box]
lo = Vector([min(p[i] for p in bpts) for i in range(3)])
hi = Vector([max(p[i] for p in bpts) for i in range(3)])
ctr = (lo + hi) / 2
S = max(hi - lo)
Sz = hi.z - lo.z
print(f"[dbg] S={S:.4f} Sz={Sz:.4f}", flush=True)
segs, RR, _ = rig_region.build(sid, t, pts, spans, S, Sz, lo, ctr)
print(f"[dbg] arm segs/R: {[(b, tuple(round(x, 3) for x in segs[b][0]), tuple(round(x, 3) for x in segs[b][1]), round(RR[b], 4)) for b in ('armL', 'armR')]}", flush=True)
names = {g.index: g.name for g in mesh.vertex_groups}
aw = {}
for v in mesh.data.vertices:
    s = sum(g.weight for g in v.groups if names[g.group] in ("armL", "armR"))
    if s > 0:
        aw[v.index] = s
print(f"[dbg] arm-weighted verts={len(aw)}", flush=True)
rest_co = [v.co.copy() for v in mesh.data.vertices]
outside, inside = [], []
for i, v in enumerate(mesh.data.vertices):
    p = mesh.matrix_world @ v.co
    m = max(rig_region.mask_limb(p, *segs[b], RR[b]) for b in ("armL", "armR"))
    (outside if m <= 0.0 else inside).append(i)
print(f"[dbg] outside={len(outside)} inside={len(inside)}", flush=True)
out_aw = [i for i in outside if i in aw]
print(f"[dbg] outside verts WITH arm weight: {len(out_aw)} (max w={max((aw[i] for i in out_aw), default=0):.4f})", flush=True)
in_aw = [i for i in inside if i in aw]
print(f"[dbg] inside verts with arm weight: {len(in_aw)}", flush=True)
deps = bpy.context.evaluated_depsgraph_get()
for tag in ("rest", "twist", "bend"):
    rig_poses.reset_pose(arm)
    rig_poses.apply_pose(arm, tag, pts, Sz, "new")
    deps.update()
    _ev = mesh.evaluated_get(deps)
    _n = len(_ev.data.vertices)
rig_poses.reset_pose(arm)
rig_poses.apply_pose(arm, "arm-raise", pts, Sz, "new")
deps.update()
ev = mesh.evaluated_get(deps)
import math

do = sum((ev.data.vertices[i].co - rest_co[i]).length for i in outside) / max(len(outside), 1)
di = sum((ev.data.vertices[i].co - rest_co[i]).length for i in inside) / max(len(inside), 1)
print(f"[dbg] arm-raise mean disp outside={do:.4f} inside={di:.4f} Sz={Sz:.4f}", flush=True)
print(f"[dbg] spread={do / Sz:.4f}", flush=True)
# 손끝 확인: 뼈 tail 위치
for a in ("armL", "armR"):
    pb = arm.pose.bones[a]
    tail = arm.matrix_world @ pb.tail
    print(f"[dbg] posed tail {a}={tuple(round(x, 3) for x in tail)}", flush=True)
