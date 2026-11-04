# 쿼터니언 포즈 검증 (임시): TRUE 값과 대조
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402


def qreset(arm):
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)


def qrot(pb, axis, angle):
    arm = pb.id_data
    R = Matrix.Rotation(angle, 4, axis).to_quaternion()
    if pb.parent is not None:
        P = (arm.matrix_world @ pb.parent.bone.matrix_local).to_quaternion()
    else:
        P = arm.matrix_world.to_quaternion()
    pb.rotation_mode = "QUATERNION"
    pb.rotation_quaternion = P.inverted() @ R @ P


sid = "fire-03"
d = f"scratch/rig-types/{sid}"
spec = json.load(open("scratch/landmarks/landmarks-3d.json", encoding="utf-8"))["landmarks"][sid]
pts = {k: Vector(v["pos"]) for k, v in spec["points"].items()}
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(d, f"{sid}-rigged.glb"))
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
mesh = max([o for o in bpy.data.objects if o.type == "MESH"],
           key=lambda o: len(o.data.vertices))
H = pts["handL"]
vi = min(range(len(mesh.data.vertices)),
         key=lambda i: (mesh.data.vertices[i].co - H).length)
w = [g.weight for g in mesh.data.vertices[vi].groups]
print(f"[q] vert {vi} ngroups={len(w)} maxw={max(w) if w else 0:.3f}", flush=True)
deps = bpy.context.evaluated_depsgraph_get()
seq = [("rest", None), ("twist", ("spine", "Z", 0.6)), ("bend", ("spine", "X", 0.4)),
       ("arm-raise", ("armL", "X", -0.6)), ("arm-raise2", ("armL", "X", -0.6)),
       ("foot-lift", ("legL", "X", -0.8))]
for tag, op in seq:
    qreset(arm)
    if op:
        qrot(arm.pose.bones[op[0]], op[1], op[2])
    deps.update()
    p = Vector(mesh.evaluated_get(deps).data.vertices[vi].co)
    print(f"[q] {tag} fingertip={tuple(round(x, 4) for x in p)}", flush=True)
print("[q] TRUE bend~ (0.261,-0.139,-0.204) raise~ (0.261,-0.220,-0.076)", flush=True)
