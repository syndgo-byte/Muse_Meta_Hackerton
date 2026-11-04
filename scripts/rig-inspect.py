# 리깅 결과 눈 검사: 뼈 위치 그림 + 뼈별 웨이트 색 그림 (정면·옆면).
#   blender --background --factory-startup --python scripts/rig-inspect.py -- \
#     --glb <리깅된 GLB> --out <출력 폴더> [--name 접두사]
# 출력: <name>-bones-front/side.png, <name>-weights-front/side.png
# 웨이트 색: 빨강=armL 노랑=armR 파랑=legL 하늘=legR 청록=head 자주=tail 회색=torso/spine/hip
#           연두=wing, 주황=fan, 그 밖의 뼈는 흰색. 섞인 정점은 가중 평균색.
# 판정 기준(검토자 육안): 팔·발·꼬리·날개 색이 그 돌기에만 있어야 한다.
import os
import sys

import bpy
from mathutils import Vector

COLORS = {
    "armL": (1.0, 0.15, 0.1), "armR": (1.0, 0.7, 0.0),
    "legL": (0.1, 0.2, 1.0), "legR": (0.1, 0.6, 1.0), "foot": (0.1, 0.4, 1.0),
    "head": (0.2, 0.8, 0.9), "tail": (0.8, 0.2, 0.9), "wing": (0.5, 0.9, 0.2),
    "fan": (1.0, 0.45, 0.0),
    "torso": (0.6, 0.6, 0.6), "spine": (0.6, 0.6, 0.6), "hip": (0.45, 0.45, 0.45),
    "chest": (0.7, 0.7, 0.7),
}


def color_of(bone):
    for k, c in COLORS.items():
        if bone.startswith(k) or bone.lower().startswith(k.lower()):
            return c
    return (1.0, 1.0, 1.0)


def parse_args():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    o = dict(zip(args[::2], args[1::2]))
    glb, out = o["--glb"], os.path.abspath(o["--out"])
    return glb, out, o.get("--name", os.path.splitext(os.path.basename(glb))[0])


def shoot(sc, ctr, size, path_base):
    for view, d in (("front", Vector((0, -1, 0))), ("side", Vector((1, 0, 0)))):
        cam = bpy.data.objects.new(view, bpy.data.cameras.new(view))
        sc.collection.objects.link(cam)
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = size * 1.25
        cam.location = ctr + d * size * 3
        cam.rotation_euler = (ctr - cam.location).to_track_quat("-Z", "Y").to_euler()
        sc.camera = cam
        sc.render.filepath = f"{path_base}-{view}.png"
        bpy.ops.render.render(write_still=True)


def main():
    glb, out, name = parse_args()
    os.makedirs(out, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)
    arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
    if arm is None:
        raise RuntimeError("GLB에 뼈(armature)가 없다")
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    mesh = max(meshes, key=lambda o: len(o.data.vertices))
    pts = [mesh.matrix_world @ Vector(c) for c in mesh.bound_box]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    ctr, size = (lo + hi) / 2, max(hi - lo)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.render.resolution_x = sc.render.resolution_y = 800

    # 1) 웨이트 색
    names = {g.index: g.name for g in mesh.vertex_groups}
    me = mesh.data
    attr = me.color_attributes.new("rig_inspect", "FLOAT_COLOR", "POINT")
    for v in me.vertices:
        c = [0.0, 0.0, 0.0]
        for g in v.groups:
            col = color_of(names[g.group])
            for i in range(3):
                c[i] += col[i] * g.weight
        attr.data[v.index].color = (*c, 1.0)
    me.color_attributes.active_color = attr
    sc.display.shading.color_type = "VERTEX"
    sc.display.shading.show_xray = False
    shoot(sc, ctr, size, os.path.join(out, f"{name}-weights"))

    # 2) 뼈 위치 (반투명 메시 위에 막대+구)
    mesh.color = (0.85, 0.75, 0.65, 1)
    r = size * 0.012
    for b in arm.data.bones:
        h = arm.matrix_world @ b.head_local
        t = arm.matrix_world @ b.tail_local
        col = (*color_of(b.name), 1)
        d = t - h
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=max(d.length, 1e-4), location=(h + t) / 2)
        c = bpy.context.object
        c.rotation_mode = "QUATERNION"
        c.rotation_quaternion = d.to_track_quat("Z", "Y")
        c.color = col
        for p in (h, t):
            bpy.ops.mesh.primitive_uv_sphere_add(radius=r * 1.8, location=p)
            bpy.context.object.color = col
        print(f"[rig-inspect] bone {b.name} {tuple(round(x, 3) for x in h)} -> {tuple(round(x, 3) for x in t)}")
    sc.display.shading.color_type = "OBJECT"
    sc.display.shading.show_xray = True
    sc.display.shading.xray_alpha = 0.35
    shoot(sc, ctr, size, os.path.join(out, f"{name}-bones"))
    print("[rig-inspect] DONE", flush=True)


main()
