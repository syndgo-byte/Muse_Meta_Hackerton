# 평가 갱신 방식 비교 (임시): deps.update vs view_layer.update
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import rig_poses  # noqa: E402

sid = "fire-03"
d = f"scratch/rig-types/{sid}"
spec = json.load(open("scratch/landmarks/landmarks-3d.json", encoding="utf-8"))["landmarks"][sid]
pts = {k: Vector(v["pos"]) for k, v in spec["points"].items()}
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(d, f"{sid}-rigged.glb"))
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
mesh = max([o for o in bpy.data.objects if o.type == "MESH"],
           key=lambda o: len(o.data.vertices))
bb = [mesh.matrix_world @ Vector(c) for c in mesh.bound_box]
Sz = max(p.z for p in bb) - min(p.z for p in bb)
H = pts["handL"]
vi = min(range(len(mesh.data.vertices)),
         key=lambda i: (mesh.data.vertices[i].co - H).length)
print(f"[cmp] fingertip-vert {vi} rest={tuple(round(x, 4) for x in mesh.data.vertices[vi].co)}", flush=True)
for tag in ("rest", "twist", "bend", "arm-raise", "arm-spread", "foot-lift"):
    rig_poses.reset_pose(arm)
    rig_poses.apply_pose(arm, tag, pts, Sz, "new")
    arm.update_tag(refresh={"OBJECT", "DATA"})
    mesh.update_tag(refresh={"OBJECT", "DATA"})
    deps = bpy.context.evaluated_depsgraph_get()
    deps.update()
    bpy.context.view_layer.update()
    p1 = Vector(mesh.evaluated_get(deps).data.vertices[vi].co)
    print(f"[cmp] {tag} forced={tuple(round(x, 4) for x in p1)}", flush=True)
