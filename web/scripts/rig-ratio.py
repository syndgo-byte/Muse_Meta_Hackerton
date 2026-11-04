# A7b 블렌더 파일럿 attempt-3 (fire-01, 무절단 + 최근접2본 거리비율).
#   blender --background --factory-startup --python-exit-code 1 \
#     --python scripts/rig-ratio.py -- --src <원본GLB> --outdir <출력디렉토리>
# - 3차 지시(방식 A 최종): 메시를 자르지 않는다. 한 메시 그대로 둔다.
# - 각 정점은 가장 가까운 두 부위 뼈까지의 거리 비율로 웨이트를 나눈다.
#   점수 기반 겹침 밴드는 쓰지 않는다. 경계에서 웨이트 합은 1로 정규화.
# - 겹침: 팔/머리 뼈가 최근접인데 몸통이 차순위+0.02 안에 있으면 몸통을
#   차순위로 강제 → 몸통 쪽으로 최소 0.02 겹침.
# - 꼬리 불꽃(꼬리뼈 끝쪽 0.12 이내)은 꼬리 뼈 1.0 고정.
# - 다리뼈(legL/legR, 루트) 유지: 허리 굽히기에서 다리 고정.
# - Bone Heat 없음 (지시된 웨이트 규칙을 직접 적용).
# - 원본은 읽기+복사만 (sha256 전후 대조). 산출물은 outdir에만.
# - 수치는 기록만 하고 통과/실패를 정하지 않는다 (판정은 스냅샷 육안).
import hashlib
import json
import math
import os
import shutil
import sys

import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

ARM_BONES = {
    "armL_shoulder", "armL_elbow", "armL_wrist",
    "armR_shoulder", "armR_elbow", "armR_wrist",
}
LEG_BONES = {"legL", "legR"}
LIMB_BONES = ARM_BONES | {"head"}
ALL_BONES = ["torso", "head"] + sorted(ARM_BONES) + ["tail"] + sorted(LEG_BONES)

OVERLAP = 0.02      # 몸통 쪽 최소 겹침
TAIL_PIN_T = 0.35   # 꼬리뼈 t 이상(끝쪽)
TAIL_PIN_R = 0.12   # 꼬리뼈 거리 이내 → 꼬리 1.0 고정


def log(msg):
    print(f"[rig-ratio] {msg}", flush=True)


def fail(msg):
    raise RuntimeError(msg)


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def parse_args():
    argv = sys.argv
    args = argv[argv.index("--") + 1:] if "--" in argv else []
    src, outdir = None, None
    i = 0
    while i < len(args):
        if args[i] == "--src":
            src = args[i + 1]
            i += 2
        elif args[i] == "--outdir":
            outdir = args[i + 1]
            i += 2
        else:
            i += 1
    if not src or not outdir:
        fail("usage: --python rig-ratio.py -- --src <glb> --outdir <dir>")
    return src, outdir


def activate(obj):
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def sstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


# ---------- 1. 복사 + 임포트 + 베이크 ----------
def import_baked(src, outdir):
    sha_before = sha256_of(src)
    work = os.path.join(outdir, "fire-01-work.glb")
    shutil.copy2(src, work)
    log(f"copy: {src} -> {work}")
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=work)
    bpy.context.view_layer.update()
    imported = [o for o in bpy.data.objects if o not in before]
    log(f"imported: {[o.name + '/' + o.type for o in imported]}")
    meshes = [o for o in imported if o.type == "MESH"]
    if len(meshes) == 0:
        fail("imported GLB has no mesh")
    if len(meshes) > 1:
        log(f"WARN: {len(meshes)} meshes, joining into one")
        activate(meshes[0])
        for m in meshes[1:]:
            m.select_set(True)
        bpy.ops.object.join()
        meshes = [bpy.context.view_layer.objects.active]
    main = meshes[0]
    # glTF 임포터가 Y-up→Z-up 회전(Rx+90°)을 걸어두므로 Rx(-90°)로 되돌린 뒤 베이크.
    main.rotation_mode = "XYZ"
    main.rotation_euler = (-math.pi / 2, 0, 0)
    bpy.context.view_layer.update()
    activate(main)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    main.name = "fire-01-body"
    bpy.context.view_layer.update()
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(main.data)
    n0 = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    f0 = len(bm.faces)
    tiny = [f for f in bm.faces if f.calc_area() < 1e-8]
    bmesh.ops.delete(bm, geom=tiny, context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(main.data)
    bm.free()
    n1 = len(main.data.vertices)
    log(f"weld 1e-4: {n0} -> {n1} verts, "
        f"faces {f0} -> {len(main.data.polygons)} "
        f"(tiny<{1e-8}: {len(tiny)}, loose: {len(loose)})")
    main["weld_before"] = n0
    return main, work, sha_before


def bbox_of(obj):
    xs = [v.co.x for v in obj.data.vertices]
    ys = [v.co.y for v in obj.data.vertices]
    zs = [v.co.z for v in obj.data.vertices]
    minX, maxX = min(xs), max(xs)
    minY, maxY = min(ys), max(ys)
    minZ, maxZ = min(zs), max(zs)
    return {
        "minX": minX, "maxX": maxX, "minY": minY, "maxY": maxY,
        "minZ": minZ, "maxZ": maxZ,
        "W": maxX - minX, "H": maxY - minY, "D": maxZ - minZ,
        "cx": (minX + maxX) / 2, "cz": (minZ + maxZ) / 2, "y0": minY,
    }


# ---------- 2. 뼈 11개 (attempt-2와 동일 배치) ----------
def build_armature(bb):
    cx, cz, y0, W, H, D = bb["cx"], bb["cz"], bb["y0"], bb["W"], bb["H"], bb["D"]
    amt = bpy.data.armatures.new("Fire01Rig")
    arm = bpy.data.objects.new("Fire01Rig", amt)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = amt.edit_bones

    def bone(name, head, tail):
        b = eb.new(name)
        b.head = Vector(head)
        b.tail = Vector(tail)
        return b

    torso = bone("torso", (cx, y0 + H * 0.34, cz), (cx, y0 + H * 0.58, cz))
    head = bone("head", (cx, y0 + H * 0.74, cz), (cx, y0 + H * 0.86, cz))
    head.parent = torso
    tail = bone("tail", (cx - 0.004, -0.05, -0.06), (cx - 0.065, -0.15, -0.175))
    tail.parent = torso
    ARM_PTS = {
        "R": [(cx + 0.275, 0.000, 0.170), (cx + 0.355, -0.130, 0.135),
              (cx + 0.377, -0.230, 0.118), (cx + 0.345, -0.345, 0.100)],
        "L": [(cx - 0.290, 0.160, 0.100), (cx - 0.350, -0.030, 0.105),
              (cx - 0.367, -0.170, 0.110), (cx - 0.315, -0.280, 0.105)],
    }
    for side in ("L", "R"):
        p0, p1, p2, p3 = ARM_PTS[side]
        sh = bone(f"arm{side}_shoulder", p0, p1)
        sh.parent = torso
        el = bone(f"arm{side}_elbow", p1, p2)
        el.parent = sh
        el.use_connect = True
        wr = bone(f"arm{side}_wrist", p2, p3)
        wr.parent = el
        wr.use_connect = True
    for side, sx in (("L", -1), ("R", 1)):
        bone(f"leg{side}", (cx + sx * 0.13, -0.24, 0.06),
             (cx + sx * 0.13, -0.40, 0.06))
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()
    names = [b.name for b in arm.data.bones]
    log(f"bones: {names}")
    assert set(names) == set(ALL_BONES), f"bone set mismatch: {names}"
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return arm


# ---------- 3. 웨이트 (최근접 2본 거리비율, 무절단) ----------
def dseg_t(co, a, b):
    ab = b - a
    t = (co - a).dot(ab) / max(ab.length_squared, 1e-18)
    tc = max(0.0, min(1.0, t))
    return (a + ab * tc - co).length, tc


def ratio_weights(obj, arm):
    segs = [(b.name, b.head_local, b.tail_local) for b in arm.data.bones]
    torso_seg = next(s for s in segs if s[0] == "torso")
    tail_seg = next(s for s in segs if s[0] == "tail")
    pinned, forced = 0, 0
    for v in obj.data.vertices:
        co = v.co
        dtail, ttail = dseg_t(co, tail_seg[1], tail_seg[2])
        if ttail >= TAIL_PIN_T and dtail <= TAIL_PIN_R:
            parts = {"tail": 1.0}
            pinned += 1
        else:
            ds = [(n, dseg_t(co, a, c)[0]) for n, a, c in segs]
            ds.sort(key=lambda t: t[1])
            (b1, d1), (b2, d2) = ds[0], ds[1]
            if b1 in LIMB_BONES and b2 != "torso":
                dt = next(d for n, d in ds if n == "torso")
                if dt <= d2 + OVERLAP:
                    b2, d2 = "torso", dt
                    forced += 1
            s = d1 + d2
            if s < 1e-12:
                parts = {b1: 0.5, b2: 0.5}
            else:
                parts = {b1: d2 / s, b2: d1 / s}
        tot = sum(parts.values())
        for name, val in parts.items():
            g = obj.vertex_groups.get(name)
            if g is None:
                g = obj.vertex_groups.new(name=name)
            g.add([v.index], val / tot, "REPLACE")
    log(f"{obj.name}: ratio weights done, tail-pinned={pinned}, torso-forced={forced}")
    return pinned, forced


def ensure_armature(obj, arm):
    if not [m for m in obj.modifiers if m.type == "ARMATURE"]:
        mod = obj.modifiers.new(name="Armature", type="ARMATURE")
        mod.object = arm
    if obj.parent != arm:
        obj.parent = arm
        obj.matrix_parent_inverse.identity()


def log_group_stats(objs):
    for o in objs:
        stat = {}
        for v in o.data.vertices:
            for g in v.groups:
                n = o.vertex_groups[g.group].name
                s = stat.setdefault(n, [0, 0.0])
                s[0] += 1
                s[1] = max(s[1], g.weight)
        log("groups %s: %s" % (o.name, ", ".join(
            f"{k}={v[0]}v/{v[1]:.2f}" for k, v in sorted(stat.items()))))


def bare_vert_count(obj):
    n = 0
    for v in obj.data.vertices:
        if sum(g.weight for g in v.groups) < 1e-6:
            n += 1
    return n


def normalize_top4(obj, arm):
    segs = [(b.name, b.head_local, b.tail_local) for b in arm.data.bones]

    def nearest(co):
        best, bd = segs[0][0], 1e18
        for n, a, c in segs:
            d, _ = dseg_t(co, a, c)
            if d < bd:
                bd, best = d, n
        return best

    trimmed, filled = 0, 0
    for v in obj.data.vertices:
        cur = sorted(((g.weight, g.group) for g in v.groups), reverse=True)
        if len(cur) > 4:
            for _, gid in cur[4:]:
                obj.vertex_groups[gid].remove([v.index])
            cur = cur[:4]
            trimmed += 1
        tot = sum(w for w, _ in cur)
        if tot <= 0:
            nb = obj.vertex_groups.get(nearest(v.co))
            if nb is None:
                nb = obj.vertex_groups.new(name=nearest(v.co))
            nb.add([v.index], 1.0, "REPLACE")
            filled += 1
        elif abs(tot - 1.0) > 1e-6:
            for w, gid in cur:
                obj.vertex_groups[gid].add([v.index], w / tot, "REPLACE")
    log(f"{obj.name}: top4+normalize trimmed={trimmed}, refilled={filled}")


def in_core(co, bb):
    cx, cz, y0, W, H, D = bb["cx"], bb["cz"], bb["y0"], bb["W"], bb["H"], bb["D"]
    dx = (co.x - cx) / (W * 0.20)
    dy = (co.y - (y0 + H * 0.52)) / (H * 0.26)
    dz = (co.z - cz) / (D * 0.45)
    return dx * dx + dy * dy + dz * dz < 1.0


def arm_sum(obj, v):
    s = 0.0
    for g in v.groups:
        if obj.vertex_groups[g.group].name in ARM_BONES:
            s += g.weight
    return s


def core_ratio(objs, bb):
    n, over = 0, 0
    for o in objs:
        for v in o.data.vertices:
            if in_core(v.co, bb):
                n += 1
                if arm_sum(o, v) > 0.1:
                    over += 1
    return n, (over / n if n else 0.0)


# ---------- 4. 포즈 (월드프레임 정확 회전) + 검증 ----------
POSES = {
    "arm-raise": {"armL_shoulder": (-0.6, 0, 0), "armR_shoulder": (-0.6, 0, 0)},
    "arm-spread": {"armL_shoulder": (0, 0, -1.2), "armR_shoulder": (0, 0, 1.2)},
    "waist-bend": {"torso": (0.4, 0, 0)},
}


def clear_pose(arm):
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = Quaternion((1, 0, 0, 0))
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()


def set_world_rot(pb, rx, ry, rz):
    O = pb.bone.matrix_local.to_3x3()
    Rw = Euler((rx, ry, rz), "XYZ").to_matrix()
    Rl = O.inverted() @ Rw @ O
    pb.rotation_mode = "QUATERNION"
    pb.rotation_quaternion = Rl.to_quaternion()


def verify_deform(arm, bone_name, rx, ry, rz):
    pb = arm.pose.bones[bone_name]
    D = pb.matrix @ pb.bone.matrix_local.inverted()
    p = pb.bone.head_local
    exp = (Matrix.Translation(p)
           @ Euler((rx, ry, rz), "XYZ").to_matrix().to_4x4()
           @ Matrix.Translation(-p))
    m = max(abs(a - b) for ra, rb in zip(D, exp) for a, b in zip(ra, rb))
    log(f"deform check {bone_name} ({rx},{ry},{rz}): max|d|={m:.2e}")
    if not m < 1e-5:
        fail(f"deform math wrong for {bone_name}: {m}")


def apply_pose(arm, rot):
    clear_pose(arm)
    for name, (rx, ry, rz) in rot.items():
        set_world_rot(arm.pose.bones[name], rx, ry, rz)
    bpy.context.view_layer.update()
    for name, (rx, ry, rz) in rot.items():
        verify_deform(arm, name, rx, ry, rz)


# ---------- 5. 늘이기 지표 ----------
def loop_tris(obj, with_verts=False):
    deps = bpy.context.evaluated_depsgraph_get()
    eo = obj.evaluated_get(deps)
    em = eo.to_mesh()
    em.calc_loop_triangles()
    if with_verts:
        out = [(t.area, (t.center.x, t.center.y, t.center.z), tuple(t.vertices))
               for t in em.loop_triangles]
    else:
        out = [(t.area, (t.center.x, t.center.y, t.center.z)) for t in em.loop_triangles]
    eo.to_mesh_clear()
    return out


def vert_desc(obj, vi):
    mv = obj.data.vertices[vi]
    ws = sorted(((obj.vertex_groups[g.group].name, round(g.weight, 2))
                 for g in mv.groups), key=lambda x: -x[1])[:4]
    return {"co": [round(mv.co.x, 4), round(mv.co.y, 4), round(mv.co.z, 4)], "w": ws}


def nearest_bone(arm, co):
    best, bd = None, 1e18
    p = Vector(co)
    for b in arm.data.bones:
        d, _ = dseg_t(p, b.head_local, b.tail_local)
        if d < bd:
            bd, best = d, b.name
    return best


def stretch_of(arm, objs, rest):
    qs = []
    worst, over3, total, skipped = 0.0, 0, 0, 0
    detail = None
    for o in objs:
        cur = loop_tris(o, with_verts=True)
        base = rest[o.name]
        assert len(cur) == len(base), f"tri order changed for {o.name}"
        for i, ((r, _), (c, cc, vv)) in enumerate(zip(base, cur)):
            if r < 1e-9:
                skipped += 1
                continue
            q = c / r
            total += 1
            qs.append(q)
            if q > worst:
                worst = q
                detail = {"ratio": q, "restArea": r, "posedArea": c, "obj": o.name,
                          "tri": i, "center": [round(v, 4) for v in cc],
                          "bone": nearest_bone(arm, cc),
                          "verts": [vert_desc(o, vi) for vi in vv]}
            if q >= 3:
                over3 += 1
    qs.sort()
    p999 = qs[min(len(qs) - 1, int(len(qs) * 0.999))] if qs else 0.0
    return {"max": worst, "p999": p999, "over3": over3, "total": total,
            "skipped": skipped, "worstTri": detail}


# ---------- 6. 렌더 ----------
def setup_scene(bb):
    cx, cz, y0, W, H, D = bb["cx"], bb["cz"], bb["y0"], bb["W"], bb["H"], bb["D"]
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.render.resolution_x = 800
    scene.render.resolution_y = 800
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    world = scene.world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.16, 0.16, 0.16, 1)
    target = Vector((cx, y0 + H * 0.45, cz))
    cam_data = bpy.data.cameras.new("PoseCam")
    cam_data.lens = 50
    cam = bpy.data.objects.new("PoseCam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = target + Vector((0, 0, 1.8))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    log(f"camera at {tuple(round(v, 3) for v in cam.location)}")
    return cam


def render_png(name, outdir):
    path = os.path.join(outdir, f"attempt-3-{name}.png")
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    size = os.path.getsize(path)
    log(f"render {name}: {path} ({size} bytes)")
    if size == 0:
        fail(f"empty render: {path}")
    return path


# ---------- 7. 텍스처 색 대조 (Blender 디코드) ----------
def image_stats(img):
    if img is None:
        return {"loaded": False, "reason": "no image"}
    try:
        import numpy as np
    except ImportError:
        return {"loaded": False, "reason": "no numpy"}
    try:
        w, h = img.size[0], img.size[1]
        if len(img.pixels) == 0:
            try:
                img.reload()
            except RuntimeError:
                pass
            if len(img.pixels) == 0:
                return {"loaded": False, "reason": "0 pixels", "size": [w, h]}
        buf = np.empty(w * h * 4, dtype=np.float32)
        try:
            img.pixels.foreach_get(buf)
        except (AttributeError, TypeError):
            buf = np.array(img.pixels[:], dtype=np.float32)
        if buf.size == 0:
            return {"loaded": False, "reason": "0 pixels", "size": [w, h]}
        m = buf.reshape(-1, 4)[:, :3].mean(axis=0)
        return {"loaded": True, "size": [w, h],
                "colorspace": img.colorspace_settings.name,
                "mean": [float(m[0]), float(m[1]), float(m[2])]}
    except Exception as e:
        return {"loaded": False, "reason": f"{type(e).__name__}: {e}"}


def capture_tex(obj):
    try:
        for s in obj.material_slots:
            mat = s.material
            if not mat or not mat.use_nodes:
                continue
            for nd in mat.node_tree.nodes:
                if nd.type != "BSDF_PRINCIPLED":
                    continue
                bc = nd.inputs.get("Base Color")
                img = None
                if bc and bc.is_linked:
                    fn = bc.links[0].from_node
                    if fn.type == "TEX_IMAGE":
                        img = fn.image
                if img is None:
                    continue
                st = image_stats(img)
                st["factors"] = {
                    "baseColor": [round(v, 6) for v in bc.default_value] if bc else None,
                    "metallic": round(nd.inputs["Metallic"].default_value, 6),
                    "roughness": round(nd.inputs["Roughness"].default_value, 6),
                }
                st["image"] = img.name if img else None
                st["ok"] = True
                return st
        return {"ok": False, "reason": "no principled basecolor"}
    except Exception as e:
        return {"ok": False, "reason": f"{type(e).__name__}: {e}"}


def leg_move(mesh_obj):
    deps = bpy.context.evaluated_depsgraph_get()
    eo = mesh_obj.evaluated_get(deps)
    em = eo.to_mesh()
    mv = mesh_obj.data.vertices
    vg = mesh_obj.vertex_groups
    lid = {g.index for g in vg if g.name in LEG_BONES}
    leg_max, hip_max, n_leg, n_hip = 0.0, 0.0, 0, 0
    for i, ev in enumerate(em.vertices):
        w = sum(g.weight for g in mv[i].groups if g.group in lid)
        d = (ev.co - mv[i].co).length
        if w > 0.5:
            n_leg += 1
            leg_max = max(leg_max, d)
        elif w > 0.05:
            n_hip += 1
            hip_max = max(hip_max, d)
    eo.to_mesh_clear()
    return {"legMax": leg_max, "legN": n_leg, "hipMax": hip_max, "hipN": n_hip}


def main():
    log(f"blender {bpy.app.version_string}")
    src, outdir = parse_args()
    src = os.path.abspath(src)
    outdir = os.path.abspath(outdir)
    os.makedirs(outdir, exist_ok=True)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

    mesh, work, sha_before = import_baked(src, outdir)
    tex_orig = capture_tex(mesh)
    log(f"tex orig: {json.dumps(tex_orig)}")
    bb = bbox_of(mesh)
    log(f"bbox min=({bb['minX']:.3f},{bb['minY']:.3f},{bb['minZ']:.3f}) "
        f"size=({bb['W']:.3f},{bb['H']:.3f},{bb['D']:.3f}) verts={len(mesh.data.vertices)}")
    weld_before = int(mesh.get("weld_before", 0))
    arm = build_armature(bb)
    mesh_objs = [mesh]

    pinned, forced = ratio_weights(mesh, arm)
    ensure_armature(mesh, arm)
    normalize_top4(mesh, arm)
    log_group_stats(mesh_objs)
    bare = bare_vert_count(mesh)
    log(f"bare verts after ratio weights: {bare}")
    if bare > 0:
        fail(f"{bare} unweighted verts remain")

    n_core, core_v = core_ratio(mesh_objs, bb)
    log(f"core: n={n_core} arm>0.1 ratio = {core_v:.4f} (mask 없음: 지시 규칙 그대로)")

    clear_pose(arm)
    rest = {o.name: loop_tris(o) for o in mesh_objs}
    log(f"rest tris: {sum(len(v) for v in rest.values())}")

    cam = setup_scene(bb)
    rest_png = render_png("rest", outdir)
    pose_out = {}
    for name, rot in POSES.items():
        apply_pose(arm, rot)
        st = stretch_of(arm, mesh_objs, rest)
        det = st["worstTri"]
        png = render_png(name, outdir)
        entry = {"rot": {k: list(v) for k, v in rot.items()},
                 "maxStretch": st["max"], "p999": st["p999"],
                 "over3": st["over3"], "tris": st["total"],
                 "skippedDegenerate": st["skipped"],
                 "worstTri": det, "png": png}
        if name.startswith("waist-"):
            lm = leg_move(mesh)
            entry["legMove"] = lm
            log(f"pose {name}: legMove={lm['legMax']:.4f} (n={lm['legN']}) "
                f"hipMax={lm['hipMax']:.4f} (n={lm['hipN']})")
        pose_out[name] = entry
        log(f"pose {name}: maxStretch={st['max']:.4f} p999={st['p999']:.4f} "
            f"over3={st['over3']}/{st['total']} skipped={st['skipped']} "
            f"worst={det['obj']}#{det['tri']} rest={det['restArea']:.2e} "
            f"posed={det['posedArea']:.2e} near={det['bone']}")

    bpy.data.objects.remove(cam, do_unlink=True)
    clear_pose(arm)
    arm.rotation_mode = "XYZ"
    arm.rotation_euler = (math.pi / 2, 0, 0)
    bpy.context.view_layer.update()
    glb_path = os.path.join(outdir, "fire-01-rigged-blender.glb")
    bpy.ops.export_scene.gltf(filepath=glb_path, export_format="GLB")
    log(f"export rigged GLB: {glb_path} ({os.path.getsize(glb_path)} bytes)")

    with open(glb_path, "rb") as f:
        head = f.read(20)
        json_len = int.from_bytes(head[12:16], "little")
        gj = json.loads(f.read(json_len).decode("utf-8"))
    mesh_nodes = [n for n in gj["nodes"] if n.get("mesh") is not None]
    log(f"glb: meshes={len(gj['meshes'])} skins={len(gj.get('skins', []))} "
        f"joints={len(gj.get('skins', [{}])[0].get('joints', []))}")
    if len(gj["meshes"]) != 1:
        fail(f"glb meshes {len(gj['meshes'])} != 1")
    if len(gj.get("skins", [])) != 1 or len(gj["skins"][0]["joints"]) != len(ALL_BONES):
        fail("glb skin/joints mismatch")
    if len(mesh_nodes) != 1 or not all(n.get("skin") == 0 for n in mesh_nodes):
        fail("glb mesh node without skin")
    for m in gj["meshes"]:
        for pr in m["primitives"]:
            if "JOINTS_0" not in pr["attributes"] or "WEIGHTS_0" not in pr["attributes"]:
                fail("glb primitive without skin attributes")
    log("glb check: 1 mesh, 1 skin, 11 joints, skinned")

    tex_rigged = {"ok": False, "reason": "not run"}
    try:
        pre_objs = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=glb_path)
        bpy.context.view_layer.update()
        re_mesh = [o for o in bpy.data.objects if o not in pre_objs and o.type == "MESH"]
        if not re_mesh:
            raise RuntimeError("no mesh on reimport")
        tex_rigged = capture_tex(re_mesh[0])
    except Exception as e:
        log(f"tex rigged capture FAILED (non-fatal): {type(e).__name__}: {e}")
        tex_rigged = {"ok": False, "reason": f"{type(e).__name__}: {e}"}
    log(f"tex rigged: {json.dumps(tex_rigged)}")
    tex_delta = None
    if tex_orig.get("ok") and tex_rigged.get("ok") and tex_orig.get("loaded") \
            and tex_rigged.get("loaded"):
        a, b = tex_orig["mean"], tex_rigged["mean"]
        tex_delta = [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
        log(f"tex mean delta (orig-rigged): {[round(v, 6) for v in tex_delta]}")

    sha_after = sha256_of(src)
    log(f"src untouched: {sha_before == sha_after}")
    if sha_before != sha_after:
        fail("source GLB modified during run!")

    metrics = {
        "blender": bpy.app.version_string,
        "attempt": 3,
        "src": src,
        "srcSha256": {"before": sha_before, "after": sha_after,
                      "untouched": sha_before == sha_after},
        "workCopy": work,
        "verts": sum(len(o.data.vertices) for o in mesh_objs),
        "vertsBeforeWeld": weld_before,
        "bones": ALL_BONES,
        "weights": {"rule": "nearest-two-ratio", "overlap": OVERLAP,
                    "tailPinned": pinned, "torsoForced": forced, "bare": bare},
        "core": {"n": n_core, "armOver01": core_v},
        "restPng": rest_png,
        "poses": pose_out,
        "tex": {"orig": tex_orig, "rigged": tex_rigged, "deltaMean": tex_delta},
        "riggedGlb": glb_path,
    }
    mpath = os.path.join(outdir, "metrics.json")

    def _json_default(o):
        log(f"WARN: non-serializable {type(o).__name__}: {str(o)[:200]}")
        return str(o)

    with open(mpath, "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2, default=_json_default)
    log(f"metrics: {mpath}")
    log("DONE")


main()
