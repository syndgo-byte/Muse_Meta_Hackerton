# 디버그: 현 strict 규칙의 캡슐(R=0.6span, S평면) 커버리지 시각화
import json
import sys

import bpy
from mathutils import Vector


def main():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    o = dict(zip(args[::2], args[1::2]))
    sid = o["--id"]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=f"public/models/{sid}.glb")
    mesh = next(x for x in bpy.data.objects if x.type == "MESH")
    spec = json.load(open("scratch/landmarks/landmarks-3d.json", encoding="utf-8"))["landmarks"][sid]
    pts = {k: Vector(v["pos"]) for k, v in spec["points"].items()}
    spans = {k: float(v.get("span", 0.0)) for k, v in spec["points"].items()}
    mw = mesh.matrix_world
    segs = {}
    for side in ("L", "R"):
        S = pts[f"shoulder{side}"]
        H = pts[f"hand{side}"]
        R = 0.6 * spans[f"hand{side}"]
        segs[side] = (S, H, R, (H - S).normalized())

    def seg_dist(p, a, b):
        ab = b - a
        t = max(0.0, min(1.0, (p - a).dot(ab) / ab.dot(ab)))
        return (p - (a + ab * t)).length

    me = mesh.data
    attr = me.color_attributes.new("dbg", "FLOAT_COLOR", "POINT")
    counts = {}
    for v in me.vertices:
        p = mw @ v.co
        best = None
        for side, (S, H, R, u) in segs.items():
            along0 = (p - S).dot(u)
            d = seg_dist(p, S, H)
            if best is None or d / R < best[0]:
                best = (d / R, along0, side, R)
        r, along0, side, R = best
        if along0 >= 0 and r <= 1.0:
            c, k = (0.1, 1.0, 0.1), "captured"
        elif r <= 2.0:
            c, k = (1.0, 1.0, 0.1), "near-miss x2R"
        elif r <= 3.0:
            c, k = (1.0, 0.5, 0.1), "miss x3R"
        else:
            c, k = (0.5, 0.5, 0.5), "far"
        counts[f"{side}-{k}"] = counts.get(f"{side}-{k}", 0) + 1
        attr.data[v.index].color = (*c, 1.0)
    print(f"[debug] {sid} {counts}", flush=True)
    me.color_attributes.active_color = attr
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.render.resolution_x = sc.render.resolution_y = 800
    sc.display.shading.color_type = "VERTEX"
    pts_bb = [mw @ Vector(c) for c in mesh.bound_box]
    lo = Vector([min(p[i] for p in pts_bb) for i in range(3)])
    hi = Vector([max(p[i] for p in pts_bb) for i in range(3)])
    ctr, size = (lo + hi) / 2, max(hi - lo)
    cam = bpy.data.objects.new("front", bpy.data.cameras.new("front"))
    sc.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = size * 1.25
    cam.location = ctr + Vector((0, -1, 0)) * size * 3
    cam.rotation_euler = (ctr - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam
    sc.render.filepath = f"scratch/rig-types/{sid}/debug-arm-front.png"
    bpy.ops.render.render(write_still=True)
    print("[debug] DONE", flush=True)


main()
