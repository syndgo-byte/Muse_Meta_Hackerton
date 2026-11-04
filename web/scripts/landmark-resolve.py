# R1: 2D 랜드마크 → 3D 위치 해석 + 확인 그림 48장.
#   blender --background --factory-startup --python-exit-code 1 --python scripts/landmark-resolve.py -- \
#     --src public/models --lm scratch/landmarks/landmarks.json --out scratch/landmarks/check --json scratch/landmarks/landmarks-3d.json
# - 원본 GLB·landmarks.json은 읽기만 한다.
# - 각 점을 모델 밖(o = origin - dir*scale*2)에서 dir 방향으로 레이캐스트해 3D 위치를 구한다.
#   landmarks.json의 origin은 bbox 중심 평면에 있어 앞에서 쏘지 않으면 앞쪽 절반을 놓친다(§2 주의).
#   - 관절 점(foot/waist/chin/tailBase/tailTip/wing/wingTip): 첫 히트와 마지막 히트의 중간점
#   - 어깨/손(shoulder/hand): 첫 진입-이탈 교차 쌍의 중간 (3차)
#   - 눈·코·입 점: 첫 히트
#   - hub 점: 마지막 히트
#   - miss: 대체값 없이 기록만
# - 확인 그림: 반투명 메시 위에 3D 점(이름 표시) — 정면·옆면 종당 2장.
import json
import os
import sys

import bpy
from mathutils import Vector

RES = 800

JOINT_BASE = {"shoulder", "hand", "foot", "waist", "chin", "tailBase", "tailTip", "wing", "wingTip"}
FACE_BASE = {"eye", "nose", "mouth"}


def base_name(name):
    if name in JOINT_BASE or name in FACE_BASE or name == "hub":
        return name
    if (name.endswith("L") or name.endswith("R")) and name[:-1] in JOINT_BASE:
        return name[:-1]
    if (name.endswith("L") or name.endswith("R")) and name[:-1] in FACE_BASE:
        return name[:-1]
    return name


def rule_of(name):
    b = base_name(name)
    if b in ("shoulder", "hand"):
        return "joint-pair1"
    if b in JOINT_BASE:
        return "joint-mid"
    if b in FACE_BASE:
        return "face-first"
    if name == "hub":
        return "hub-last"
    return "face-first"


def parse_args():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opts = dict(zip(args[::2], args[1::2]))
    return opts["--src"], opts["--lm"], opts["--out"], opts["--json"]


def ray_hits(context, origin, direction):
    # 같은 광선의 모든 히트를 순서대로. (장면 레이캐스트 + 전진 마칭)
    deps = context.evaluated_depsgraph_get()
    deps.update()
    hits = []
    o = Vector(origin)
    d = Vector(direction).normalized()
    for _ in range(60):
        hit, loc, _n, _i, _o, _m = context.scene.ray_cast(deps, o, d)
        if not hit:
            break
        hits.append(Vector(loc))
        o = Vector(loc) + d * 1e-4
    return hits


def resolve_point(context, origin, direction, rule):
    hits = ray_hits(context, origin, direction)
    if not hits:
        return None, 0, 0.0
    span = (hits[-1] - hits[0]).length if len(hits) > 1 else 0.0
    if rule == "joint-mid":
        pos = (hits[0] + hits[-1]) / 2
    elif rule == "joint-pair1":
        # 3차: 첫 진입-이탈 교차 쌍의 중간 (마지막 교차 사용 안 함)
        pos = (hits[0] + hits[1]) / 2 if len(hits) > 1 else hits[0]
    elif rule == "hub-last":
        pos = hits[-1]
    else:
        pos = hits[0]
    return pos, len(hits), span


def setup_render_eevee():
    sc = bpy.context.scene
    try:
        sc.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x = sc.render.resolution_y = RES
    sc.render.film_transparent = False
    world = bpy.data.worlds.new("CheckWorld")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.05, 0.07, 0.06, 1.0)
    bg.inputs[1].default_value = 1.0
    sc.world = world
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    bpy.context.scene.collection.objects.link(sun)
    sun.data.energy = 2.0
    sun.location = (2.0, -2.0, 3.0)


def ghost_material(base_color):
    mat = bpy.data.materials.new("Ghost")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (base_color[0], base_color[1], base_color[2], 1.0)
    bsdf.inputs["Roughness"].default_value = 0.8
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Alpha"].default_value = 0.32
    mat.blend_method = "BLEND"
    mat.show_transparent_back = False
    return mat


def marker_material():
    mat = bpy.data.materials.new("Marker")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    emi = nodes.new("ShaderNodeEmission")
    emi.inputs["Color"].default_value = (1.0, 0.15, 0.1, 1.0)
    emi.inputs["Strength"].default_value = 3.0
    mat.node_tree.links.new(emi.outputs[0], out.inputs[0])
    return mat


def text_material():
    mat = bpy.data.materials.new("MarkText")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    emi = nodes.new("ShaderNodeEmission")
    emi.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    emi.inputs["Strength"].default_value = 2.0
    mat.node_tree.links.new(emi.outputs[0], out.inputs[0])
    return mat


def main():
    src, lm_path, out, json_path = parse_args()
    out = os.path.abspath(out)
    os.makedirs(out, exist_ok=True)
    with open(lm_path, encoding="utf-8") as fp:
        lm = json.load(fp)["landmarks"]
    result = {}
    all_miss = []
    for sid in sorted(lm.keys()):
        spec = lm[sid]
        glb = os.path.join(src, f"{sid}.glb")
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=glb)
        meshes = [o for o in bpy.data.objects if o.type == "MESH"]
        pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
        lo = Vector([min(p[i] for p in pts) for i in range(3)])
        hi = Vector([max(p[i] for p in pts) for i in range(3)])
        ctr = (lo + hi) / 2
        scale = max(hi - lo) * 1.15
        # 3D 해석 ('none' 문자열 = 없는 점, 건너뛴다)
        pts3d = {}
        misses = []
        absent = []
        for name in sorted(spec["points"].keys()):
            p = spec["points"][name]
            if not isinstance(p, dict):
                absent.append(name)
                continue
            rule = rule_of(name)
            # 모델 밖에서 쏜다: o = origin - dir * (scale * 2)
            start = Vector(p["origin"]) - Vector(p["dir"]).normalized() * (scale * 2)
            pos, nhits, span = resolve_point(bpy.context, start, p["dir"], rule)
            if pos is None:
                misses.append(name)
                all_miss.append(f"{sid}:{name}")
            else:
                pts3d[name] = {"pos": [pos.x, pos.y, pos.z], "hits": nhits, "rule": rule, "span": span}
        result[sid] = {"type": spec.get("type"), "points": pts3d, "misses": misses, "absent": absent}
        # 반투명 메시 + 마커 + 이름
        setup_render_eevee()
        for o in meshes:
            slot0 = o.data.materials[0] if len(o.data.materials) else None
            try:
                bc = tuple(slot0.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value[:3])
            except (AttributeError, KeyError):
                bc = (0.7, 0.7, 0.7)
            o.data.materials.clear()
            o.data.materials.append(ghost_material(bc))
        mmat = marker_material()
        tmat = text_material()
        markers = []
        for name, q in pts3d.items():
            v = Vector(q["pos"])
            bpy.ops.mesh.primitive_uv_sphere_add(radius=scale * 0.008, segments=12, ring_count=8, location=v)
            s = bpy.context.active_object
            s.data.materials.clear()
            s.data.materials.append(mmat)
            markers.append(s)
            curve = bpy.data.curves.new(name, type="FONT")
            curve.body = name
            curve.size = scale * 0.028
            curve.align_x = "CENTER"
            curve.align_y = "CENTER"
            t = bpy.data.objects.new(name + "_t", curve)
            bpy.context.scene.collection.objects.link(t)
            t.location = v + Vector((0, 0, scale * 0.022))
            t.data.materials.clear()
            t.data.materials.append(tmat)
            markers.append(t)
        sc = bpy.context.scene
        texts = [o for o in markers if o.type == "FONT"]
        for view, d in (("front", Vector((0, -1, 0))), ("side", Vector((1, 0, 0)))):
            cam = bpy.data.objects.new(view, bpy.data.cameras.new(view))
            sc.collection.objects.link(cam)
            cam.data.type = "ORTHO"
            cam.data.ortho_scale = scale
            cam.location = ctr + d * scale * 3
            cam.rotation_euler = (ctr - cam.location).to_track_quat("-Z", "Y").to_euler()
            sc.camera = cam
            for t in texts:
                t.rotation_euler = (cam.location - t.location).to_track_quat("Z", "Y").to_euler()
            sc.render.filepath = os.path.join(out, f"{sid}-{view}.png")
            bpy.ops.render.render(write_still=True)
        print(f"[resolve] {sid} ok={len(pts3d)} miss={len(misses)} {misses} absent={len(absent)}", flush=True)
    with open(json_path, "w", encoding="utf-8") as fp:
        json.dump({"frame": "blender-world Z-up (glTF import), L = +X", "landmarks": result}, fp, indent=1)
    print(f"[resolve] DONE species={len(result)} total_miss={len(all_miss)}", flush=True)
    for m in all_miss:
        print(f"[resolve] MISS {m}", flush=True)


main()
