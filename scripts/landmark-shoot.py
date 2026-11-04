# 랜드마크 표시용 정사영 촬영 (24종 정면·옆면 + 픽셀→모델 좌표 메타).
#   blender --background --factory-startup --python scripts/landmark-shoot.py -- \
#     --src public/models --out scratch/landmarks
# - 원본 GLB는 읽기만 한다.
# - 좌표계: 블렌더 임포트 후 월드(Z-up). 정면 카메라는 -Y에서 +Y를 본다.
#   front: px → (X, Z), side(+X에서 -X를 봄): px → (Y, Z). 정면(-Y)이 옆면 화면 왼쪽.
# - meta.json의 view별 center/scale로 marker.html이 클릭을 모델 좌표로 바꾼다.
import glob
import json
import os
import sys

import bpy
from mathutils import Vector

RES = 800


def parse_args():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opts = dict(zip(args[::2], args[1::2]))
    return opts["--src"], opts["--out"]


def main():
    src, out = parse_args()
    out = os.path.abspath(out)  # 렌더 경로는 절대경로여야 저장된다
    img_dir = os.path.join(out, "img")
    os.makedirs(img_dir, exist_ok=True)
    meta = {}
    for f in sorted(glob.glob(os.path.join(src, "*.glb"))):
        name = os.path.splitext(os.path.basename(f))[0]
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=f)
        ms = [o for o in bpy.data.objects if o.type == "MESH"]
        pts = [o.matrix_world @ Vector(c) for o in ms for c in o.bound_box]
        lo = Vector([min(p[i] for p in pts) for i in range(3)])
        hi = Vector([max(p[i] for p in pts) for i in range(3)])
        ctr = (lo + hi) / 2
        scale = max(hi - lo) * 1.15
        sc = bpy.context.scene
        sc.render.engine = "BLENDER_WORKBENCH"
        sc.display.shading.light = "STUDIO"
        sc.display.shading.color_type = "TEXTURE"
        sc.render.resolution_x = sc.render.resolution_y = RES
        meta[name] = {"bboxMin": list(lo), "bboxMax": list(hi), "scale": scale, "views": {}}
        for view, d in (("front", Vector((0, -1, 0))), ("side", Vector((1, 0, 0)))):
            cam = bpy.data.objects.new(view, bpy.data.cameras.new(view))
            sc.collection.objects.link(cam)
            cam.data.type = "ORTHO"
            cam.data.ortho_scale = scale
            cam.location = ctr + d * scale * 3
            cam.rotation_euler = (ctr - cam.location).to_track_quat("-Z", "Y").to_euler()
            sc.camera = cam
            png = f"{name}-{view}.png"
            sc.render.filepath = os.path.join(img_dir, png)
            bpy.ops.render.render(write_still=True)
            # 화면 가로축이 가리키는 월드 축: front=+X, side=+Y
            meta[name]["views"][view] = {
                "png": "img/" + png,
                "center": [ctr.x, ctr.y, ctr.z],
                "right": [1, 0, 0] if view == "front" else [0, 1, 0],
                "dir": [0, 1, 0] if view == "front" else [-1, 0, 0],
            }
        print(f"[landmark-shoot] {name}", flush=True)
    with open(os.path.join(out, "meta.json"), "w", encoding="utf-8") as fp:
        json.dump(meta, fp, indent=1)
    # marker.html은 file://에서 열리므로 JSON 대신 이 스크립트 파일을 읽는다
    with open(os.path.join(out, "meta.js"), "w", encoding="utf-8") as fp:
        fp.write("window.META=" + json.dumps(meta) + ";\n")
    print("[landmark-shoot] DONE", flush=True)


main()
