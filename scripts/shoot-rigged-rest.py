# R-A 확인용: 리그 GLB 레스트 정면 렌더 (WORKBENCH TEXTURE, ortho).
#   blender --background --factory-startup --python-exit-code 1 --python scripts/shoot-rigged-rest.py -- \
#     --src public/models-rigged --out scratch/rig-types
import os
import sys

import bpy
from mathutils import Vector

IDS = ([f"fire-0{i}" for i in range(1, 6)] + [f"grass-0{i}" for i in range(1, 6)]
       + [f"rock-0{i}" for i in range(1, 5)] + [f"water-0{i}" for i in range(1, 6)]
       + [f"wind-0{i}" for i in range(1, 6)])
RES = 800


def main():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    o = dict(zip(args[::2], args[1::2]))
    src, out = os.path.abspath(o["--src"]), os.path.abspath(o["--out"])
    for sid in IDS:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(
            filepath=os.path.join(src, f"{sid}.glb"))
        meshes = [x for x in bpy.data.objects if x.type == "MESH"]
        mesh = max(meshes, key=lambda x: len(x.data.vertices))
        bpts = [mesh.matrix_world @ Vector(c) for c in mesh.bound_box]
        lo = Vector([min(p[i] for p in bpts) for i in range(3)])
        hi = Vector([max(p[i] for p in bpts) for i in range(3)])
        ctr = (lo + hi) / 2
        S = max(hi - lo)
        sc = bpy.context.scene
        sc.render.engine = "BLENDER_WORKBENCH"
        sc.render.resolution_x = sc.render.resolution_y = RES
        sc.display.shading.light = "STUDIO"
        sc.display.shading.color_type = "TEXTURE"
        size = S * 1.25
        cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
        sc.collection.objects.link(cam)
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = size
        cam.location = ctr + Vector((0, -1, 0)) * size * 3
        cam.rotation_euler = (ctr - cam.location).to_track_quat("-Z", "Y").to_euler()
        sc.camera = cam
        sc.render.filepath = os.path.join(out, sid, f"{sid}-rigged-rest-front.png")
        bpy.ops.render.render(write_still=True)
        print(f"[shoot-rigged] {sid} DONE", flush=True)
    print("[shoot-rigged] DONE", flush=True)


main()
