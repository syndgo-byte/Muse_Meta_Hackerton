# 포즈 행렬 read-back (임시)
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

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


def show(tag):
    sp = arm.pose.bones["spine"]
    m1 = [x for row in sp.matrix for x in row]
    m0 = [x for row in sp.bone.matrix_local for x in row]
    same = all(abs(a - b) < 1e-6 for a, b in zip(m1, m0))
    print(f"[mx] {tag} spine==rest:{same} loc={tuple(round(x, 4) for x in sp.location)} "
          f"quat={tuple(round(x, 4) for x in sp.rotation_quaternion)}", flush=True)


for tag in ("rest", "twist", "bend"):
    rig_poses.reset_pose(arm)
    show(f"{tag}-after-reset")
    rig_poses.apply_pose(arm, tag, pts, Sz, "new")
    show(f"{tag}-after-apply")
print("[mx] DONE", flush=True)
