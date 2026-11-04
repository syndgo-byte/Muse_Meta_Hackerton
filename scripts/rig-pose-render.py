# 지정 GLB(히트 비교용)에 decision.json 포즈를 렌더.
#   blender --background --factory-startup --python-exit-code 1 --python scripts/rig-pose-render.py -- \
#     --src scratch/rig-types --ids fire-01,fire-03 --variant heat \
#     --lm scratch/landmarks/landmarks-3d.json --only arm-spread,foot-lift,twist,dance-test
# - 출력: <id>-heat-<pose>-front/side.png. 손끝 로그를 종별 run.log에 추가한다.
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import rig_poses  # noqa: E402

RES = 800


def parse_args():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    o = dict(zip(args[::2], args[1::2]))
    return {
        "src": os.path.abspath(o["--src"]),
        "ids": o["--ids"].split(","),
        "variant": o.get("--variant", "heat"),
        "lm": o["--lm"],
        "only": o.get("--only", "").split(",") if o.get("--only") else None,
    }


def main():
    a = parse_args()
    lm = json.load(open(a["lm"], encoding="utf-8"))["landmarks"]
    for sid in a["ids"]:
        d = os.path.join(a["src"], sid)
        if a["variant"] in ("heat", "mix"):
            glb = os.path.join(d, f"{sid}-{a['variant']}.glb")
        else:
            glb = os.path.join(d, f"{sid}-rigged.glb")
        dec = json.load(open(os.path.join(d, "decision.json"), encoding="utf-8"))
        poses = dec.get("poses", ["rest"])
        if a["only"]:
            poses = [p for p in poses if p in a["only"]]
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=glb)
        arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
        meshes = [o for o in bpy.data.objects if o.type == "MESH"]
        mesh = max(meshes, key=lambda o: len(o.data.vertices))
        bpts = [mesh.matrix_world @ Vector(c) for c in mesh.bound_box]
        lo = Vector([min(p[i] for p in bpts) for i in range(3)])
        hi = Vector([max(p[i] for p in bpts) for i in range(3)])
        ctr = (lo + hi) / 2
        S = max(hi - lo)
        Sz = hi.z - lo.z
        pts = {k: Vector(v["pos"]) for k, v in lm[sid]["points"].items()}
        sc = bpy.context.scene
        sc.render.engine = "BLENDER_WORKBENCH"
        sc.render.resolution_x = sc.render.resolution_y = RES
        sc.display.shading.light = "STUDIO"
        sc.display.shading.color_type = "TEXTURE"
        size = S * 1.25

        def shoot(tag):
            for view, dd in (("front", Vector((0, -1, 0))), ("side", Vector((1, 0, 0)))):
                cam = bpy.data.objects.new(f"{tag}-{view}", bpy.data.cameras.new(f"{tag}-{view}"))
                sc.collection.objects.link(cam)
                cam.data.type = "ORTHO"
                cam.data.ortho_scale = size
                cam.location = ctr + dd * size * 3
                cam.rotation_euler = (ctr - cam.location).to_track_quat("-Z", "Y").to_euler()
                sc.camera = cam
                sc.render.filepath = os.path.join(d, f"{sid}-{a['variant']}-{tag}-{view}.png")
                bpy.ops.render.render(write_still=True)

        with open(os.path.join(d, "run.log"), "a", encoding="utf-8") as fp:
            for tag in poses:
                rig_poses.reset_pose(arm)
                if tag == "arm-spread":
                    info = rig_poses.apply_arm_spread(arm, pts, "new")
                    for an, (rx, rz, px, pz, ang) in info.items():
                        fp.write(f"[pose-spread-{a['variant']}] {an} rest|x|={rx:.4f} rest_z={rz:.4f} -> "
                                 f"posed|x|={px:.4f} posed_z={pz:.4f} angle={ang:.3f}\n")
                else:
                    rig_poses.apply_pose(arm, tag, pts, Sz, "new")
                shoot(tag)
                print(f"[pose-render] {sid} {a['variant']} {tag} DONE", flush=True)
            rig_poses.reset_pose(arm)
    print("[pose-render] DONE", flush=True)


main()
