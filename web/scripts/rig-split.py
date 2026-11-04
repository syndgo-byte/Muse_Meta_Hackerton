# A7b 블렌더 파일럿 attempt-2 (fire-01, 부위 분리). 백그라운드 실행:
#   blender --background --factory-startup --python-exit-code 1 \
#     --python scripts/rig-split.py -- --src <원본GLB> --outdir <출력디렉토리>
# - 2차 지시: 복사본을 부위별(torso/head/tail/armL/armR)로 분리하고 뼈 위치
#   기준 거리로 나눈다. 분리 경계는 몸통 쪽으로 겹쳐(중복면) 틈을 막고,
#   부위 쪽 중복면은 0.5mm 안쪽으로 넣어 z-fighting을 막는다.
# - 부위별 자동 웨이트(Bone Heat) 시도 → bare 정점이 있으면 부위 캡슐로 대체.
#   팔 부위는 강체(100% 팔, 분절 분배)로 고정: 웨브 늘어짐(1차 불합격) 방지.
#   몸통은 팔/머리/꼬리 뼈에 0 (몸통+다리만).
# - 다리뼈(legL/legR, 루트라 허리 포즈에서 고정). 뼈 11개.
# - 원본은 읽기+복사만 (sha256 전후 대조). 산출물은 outdir에만.
# - 수치는 기록만 하고 통과/실패를 정하지 않는다 (판정은 스냅샷 육안).
import hashlib
import json
import math
import os
import shutil
import sys
import traceback

import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

ARM_BONES = {
    "armL_shoulder", "armL_elbow", "armL_wrist",
    "armR_shoulder", "armR_elbow", "armR_wrist",
}
LEG_BONES = {"legL", "legR"}
ALL_BONES = ["torso", "head"] + sorted(ARM_BONES) + ["tail"] + sorted(LEG_BONES)
PART_KEEP = {
    "torso": {"torso", "legL", "legR"},
    "head": {"head", "torso"},
    "tail": {"tail", "torso"},
    "armL": {"armL_shoulder", "armL_elbow", "armL_wrist", "torso"},
    "armR": {"armR_shoulder", "armR_elbow", "armR_wrist", "torso"},
}


def log(msg):
    print(f"[rig-blender] {msg}", flush=True)


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
        fail("usage: --python rig-blender.py -- --src <glb> --outdir <dir>")
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
    # 이후 메시 로컬 = 원본 glTF 좌표(Y-up, 정면 +Z).
    # 주의: 임포터는 rotation_mode를 QUATERNION으로 둔다. Euler 대입 전에 XYZ로 바꿔야 한다.
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


# ---------- 2. 뼈 9개 ----------
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

    # torso 피벗(머리쪽 끝) = 허리 높이. 허리 비틀기/굽히기가 허리에서 돈다.
    torso = bone("torso", (cx, y0 + H * 0.34, cz), (cx, y0 + H * 0.58, cz))
    head = bone("head", (cx, y0 + H * 0.74, cz), (cx, y0 + H * 0.86, cz))
    head.parent = torso
    # 꼬리 실측: 몸통 뒤(-0.01,-0.05,-0.06)에서 불꽃(-0.07,-0.15,-0.17) 방향.
    tail = bone("tail", (cx - 0.004, -0.05, -0.06), (cx - 0.065, -0.15, -0.175))
    tail.parent = torso
    # 팔 중심선 실측(probe-armtail.py). 모델이 좌우 비대칭이라 측면별 배치.
    # R: 어깨 뿌리(0.27,0.00,0.17) → 팔꿈(0.37,-0.20,0.12) → 손(0.34,-0.35,0.10).
    # L: 어깨 피벗(-0.29,0.16,0.10, 주먹 꼭대기) → 팔꿈(-0.37,-0.17,0.11) → 손(-0.32,-0.28,0.11).
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
    # 다리뼈: 루트(부모 없음)라 허리 포즈에서 고정된다.
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


# ---------- 3. 웨이트 (자동 시도 + 수동 캡슐 채움) ----------
def parent_auto(arm, obj):
    activate(obj)
    obj.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    arm.select_set(False)


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


# 몸통 벽(팔 제외) 반폭 프로파일: (y, |x-cx|). probe-shape.py 실측 기반.
SX_PROFILE = [
    (0.20, 0.17), (0.10, 0.19), (0.00, 0.22), (-0.10, 0.27),
    (-0.20, 0.30), (-0.30, 0.26), (-0.36, 0.22), (-0.423, 0.19),
]
ARM_R0, ARM_R1 = 0.075, 0.150   # 팔 캡슐: 굵은 주먹 + 윗면까지 덮음
TAIL_R0, TAIL_R1 = 0.030, 0.075  # 꼬리 캡슐
CAP_R0, CAP_R1 = 0.200, 0.300   # 어깨 캡(뒤어깨 삼각근): 중심은 측면별 아래 지정


def sx_at(y):
    if y >= SX_PROFILE[0][0]:
        return SX_PROFILE[0][1]
    for (y0, x0), (y1, x1) in zip(SX_PROFILE, SX_PROFILE[1:]):
        if y1 <= y <= y0:
            t = (y - y1) / (y0 - y1)
            return x1 + t * (x0 - x1)
    return SX_PROFILE[-1][1]


def dseg(co, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (co - a).dot(ab) / max(ab.length_squared, 1e-18)))
    return (a + ab * t - co).length


def manual_fill_bare(obj, bb, arm):
    # 자동 웨이트가 비워둔 정점을 캡슐+표면 게이트로 채운다.
    # 팔 = 뼈분절 거리 페이드 × 몸통 표면 게이트(벽에서 0→밖 7cm에서 1).
    # 어깨 정점은 팔/몸통을 함께 받는다. 꼬리·머리도 같은 방식.
    cx = bb["cx"]
    bones = {b.name: (b.head_local, b.tail_local) for b in arm.data.bones}
    arm_segs = {}
    for side in ("L", "R"):
        arm_segs[side] = [(n,) + bones[n] for n in
                          (f"arm{side}_shoulder", f"arm{side}_elbow", f"arm{side}_wrist")]
    tail_seg = bones["tail"]
    torso_seg = bones["torso"]

    def fall(d, r0, r1):
        return 1.0 - sstep(r0, r1, d)

    filled = 0
    for v in obj.data.vertices:
        if sum(g.weight for g in v.groups) >= 1e-6:
            continue
        co = v.co
        parts = {}
        arm_max = 0.0
        caps = {"L": Vector((cx - 0.285, 0.06, -0.06)),
                "R": Vector((cx + 0.270, 0.00, -0.06))}
        for side in ("L", "R"):
            # 벽 안쪽부터 블렌드 시작(매몰된 어깨 뿌리 포함). 손/다리 높이에서는
            # 안쪽 경계를 바깥으로 밀어 다리 번짐을 막는다.
            # L은 레버가 길어 안쪽을 더 넓게 (주름 완화).
            k = sstep(-0.18, -0.32, co.y)
            inner = (-0.08 if side == "L" else -0.04) + 0.07 * k
            gate = sstep(inner, 0.06 + 0.02 * k, abs(co.x - cx) - sx_at(co.y))
            if gate <= 0:
                continue
            for n, a, c in arm_segs[side]:
                w = fall(dseg(co, a, c), ARM_R0, ARM_R1) * gate
                if w > 1e-9:
                    parts[n] = w
                    arm_max = max(arm_max, w)
            cap_w = fall((co - caps[side]).length, CAP_R0, CAP_R1) * gate
            if cap_w > 1e-9:
                sh = f"arm{side}_shoulder"
                parts[sh] = parts.get(sh, 0.0) + cap_w
                arm_max = max(arm_max, cap_w)
        tail_gate = sstep(-0.075, -0.125, co.z)
        tail_w = fall(dseg(co, *tail_seg), TAIL_R0, TAIL_R1) * tail_gate
        if tail_w > 1e-9:
            parts["tail"] = tail_w
        hy = sstep(0.047, 0.117, co.y)
        lat = 1.0 - sstep(0.20, 0.28, abs(co.x - cx)) * (1.0 - sstep(0.22, 0.32, co.y))
        # 뒤어깨/목빗면에서는 머리를 미리 빼둔다 (스무딩 홍수·엇갈림 방지).
        shz = (sstep(-0.06, -0.14, co.z) * sstep(0.30, 0.22, co.y)
               * sstep(0.15, 0.23, abs(co.x - cx)))
        head_w = hy * lat * (1.0 - shz)
        if head_w > 1e-9:
            parts["head"] = head_w
        tail_z = sstep(-0.09, -0.14, co.z)
        torso_w = ((1.0 - 0.95 * hy)
                   * (1.0 - 0.90 * min(1.0, arm_max))
                   * (1.0 - 0.90 * min(1.0, tail_w))
                   * (1.0 - 0.90 * tail_z))
        parts["torso"] = max(torso_w, 1e-6)
        tot = sum(parts.values())
        if tot < 0.10:
            # 캡슐 밖 잔여물(불꽃 끝 등): 최근접 뼈로 구조.
            cands = ([(n, dseg(co, a, c)) for side in ("L", "R")
                      for n, a, c in arm_segs[side]]
                     + [("tail", dseg(co, *tail_seg)),
                        ("torso", dseg(co, *torso_seg))])
            nb = min(cands, key=lambda t: t[1])[0]
            parts[nb] = parts.get(nb, 0.0) + 0.5 * (1.0 - tot / 0.10)
            tot = sum(parts.values())
        for name, val in parts.items():
            g = obj.vertex_groups.get(name)
            if g is None:
                g = obj.vertex_groups.new(name=name)
            g.add([v.index], val / tot, "REPLACE")
        filled += 1
    log(f"{obj.name}: manual-filled {filled} bare verts")
    return filled


def smooth_groups(obj, iterations=3, factor=0.5):
    # 이웃 평균 블러: 게이트·마스크 경계의 불연속을 위상 기준으로 완화한다.
    import numpy as np
    me = obj.data
    nv = len(me.vertices)
    e = np.empty(len(me.edges) * 2, dtype=np.int32)
    me.edges.foreach_get("vertices", e)
    e = e.reshape(-1, 2)
    deg = np.zeros(nv, dtype=np.float64)
    np.add.at(deg, e.ravel(), 1.0)
    deg_safe = np.maximum(deg, 1.0)
    cols = {g.index: i for i, g in enumerate(obj.vertex_groups)}
    W = np.zeros((nv, len(cols)), dtype=np.float64)
    for v in me.vertices:
        for g in v.groups:
            W[v.index, cols[g.group]] = g.weight
    for _ in range(iterations):
        for j in range(W.shape[1]):
            w = W[:, j]
            S = np.zeros(nv)
            np.add.at(S, e[:, 0], w[e[:, 1]])
            np.add.at(S, e[:, 1], w[e[:, 0]])
            avg = S / deg_safe
            W[:, j] = np.where(deg > 0, (1 - factor) * w + factor * avg, w)
    names = [g.name for g in obj.vertex_groups]
    for v in me.vertices:
        for j, name in enumerate(names):
            w = float(W[v.index, j])
            if w > 1e-9:
                obj.vertex_groups[name].add([v.index], w, "REPLACE")
            else:
                try:
                    obj.vertex_groups[name].remove([v.index])
                except RuntimeError:
                    pass
    log(f"{obj.name}: smoothed {iterations} iters (factor {factor})")


def average_coincident(obj, dist=5e-4):
    # dist 이내 근접 정점들의 웨이트를 평균: 스무딩이 벌려놓은
    # 쌍둥이 정점을 다시 일치시켜 바늘 찢어짐을 막는다.
    import numpy as np
    me = obj.data
    nv = len(me.vertices)
    co = np.empty(nv * 3, dtype=np.float64)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    order = np.argsort(co[:, 0], kind="stable")
    parent = list(range(nv))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    pairs = 0
    for ii, i in enumerate(order):
        i = int(i)
        xi = co[i, 0]
        for jj in range(ii + 1, nv):
            j = int(order[jj])
            if co[j, 0] - xi >= dist:
                break
            d = co[i] - co[j]
            if d.dot(d) < dist * dist:
                ri, rj = find(i), find(j)
                if ri != rj:
                    parent[rj] = ri
                    pairs += 1
    if pairs == 0:
        log(f"{obj.name}: coincident: no pairs < {dist}")
        return
    cols = {g.index: k for k, g in enumerate(obj.vertex_groups)}
    W = np.zeros((nv, len(cols)))
    for v in me.vertices:
        for g in v.groups:
            W[v.index, cols[g.group]] = g.weight
    roots = {}
    for i in range(nv):
        roots.setdefault(find(i), []).append(i)
    multi = sum(1 for m in roots.values() if len(m) > 1)
    for m in roots.values():
        if len(m) > 1:
            W[m] = W[m].mean(axis=0)
    names = [g.name for g in obj.vertex_groups]
    for v in me.vertices:
        for k, name in enumerate(names):
            w = float(W[v.index, k])
            if w > 1e-9:
                obj.vertex_groups[name].add([v.index], w, "REPLACE")
            else:
                try:
                    obj.vertex_groups[name].remove([v.index])
                except RuntimeError:
                    pass
    log(f"{obj.name}: coincident-averaged {multi} clusters ({pairs} pairs)")


def part_bones(arm):
    bones = {b.name: (b.head_local, b.tail_local) for b in arm.data.bones}
    segs = {}
    for side in ("L", "R"):
        segs[side] = [(n,) + bones[n] for n in
                      (f"arm{side}_shoulder", f"arm{side}_elbow", f"arm{side}_wrist")]
    return bones, segs


def zone_scores(co, cx, bones, segs, caps):
    def fall(d, r0, r1):
        return 1.0 - sstep(r0, r1, d)

    out = {}
    # 꼬리관 브리지: 밑동→불꽃 guess 구간을 팔L에 포함시켜 통째로 강체 이동.
    # (게이트 무시: 몸통 내부를 지나므로. 절단은 밑동 매몰부에 숨는다.)
    tube_bridge = 1.0 - sstep(0.05, 0.09, dseg(
        co, Vector((cx + 0.005, -0.05, -0.07)), Vector((cx - 0.285, -0.05, 0.06))))
    for side in ("L", "R"):
        k = sstep(-0.18, -0.32, co.y)
        inner = (-0.08 if side == "L" else -0.04) + 0.07 * k
        gate = sstep(inner, 0.06 + 0.02 * k, abs(co.x - cx) - sx_at(co.y))
        if gate <= 0:
            out["arm" + side] = 0.0
            continue
        f = max([fall(dseg(co, a, c), ARM_R0, ARM_R1) for _, a, c in segs[side]]
                + [fall((co - caps[side]).length, CAP_R0, CAP_R1)])
        w = min(1.0, f) * gate
        if side == "L":
            w = max(w, tube_bridge)
        out["arm" + side] = w
    hy = sstep(0.047, 0.117, co.y)
    lat = 1.0 - sstep(0.20, 0.28, abs(co.x - cx)) * (1.0 - sstep(0.22, 0.32, co.y))
    shz = (sstep(-0.06, -0.14, co.z) * sstep(0.30, 0.22, co.y)
           * sstep(0.15, 0.23, abs(co.x - cx)))
    out["head"] = hy * lat * (1.0 - shz)
    out["tail"] = fall(dseg(co, *bones["tail"]), TAIL_R0, TAIL_R1) \
        * sstep(-0.075, -0.125, co.z)
    return out


def assign_part(s):
    arm = max(s["armL"], s["armR"])
    side = "armL" if s["armL"] >= s["armR"] else "armR"
    if arm > 0.15 and arm >= s["head"] and arm >= s["tail"]:
        return side, arm
    if s["head"] > 0.45 and s["head"] >= s["tail"]:
        return "head", s["head"]
    if s["tail"] > 0.30:
        return "tail", s["tail"]
    return "torso", 0.0


def split_parts(mesh, bb, arm):
    # 면 단위 부위 분리. 겹침대(부위 점수 0.15~0.55)는 몸통에도 중복 유지하고,
    # 부위 쪽 중복면 정점은 0.5mm 안쪽으로 넣어 z-fighting을 막는다.
    import bmesh
    cx = bb["cx"]
    bones, segs = part_bones(arm)
    caps = {"L": Vector((cx - 0.285, 0.06, -0.06)),
            "R": Vector((cx + 0.270, 0.00, -0.06))}
    bm = bmesh.new()
    bm.from_mesh(mesh.data)
    bm.faces.ensure_lookup_table()
    assign = {}
    for f in bm.faces:
        c = f.calc_center_median()
        assign[f.index] = assign_part(zone_scores(c, cx, bones, segs, caps))
    bm.free()
    counts = {}
    for p, _ in assign.values():
        counts[p] = counts.get(p, 0) + 1
    log(f"split faces: {counts}")
    mesh_objs, info = [], {}
    for pname in ("torso", "head", "tail", "armL", "armR"):
        dup = mesh.copy()
        dup.data = mesh.data.copy()
        dup.name = f"fire-01-{pname}"
        bpy.context.scene.collection.objects.link(dup)
        b2 = bmesh.new()
        b2.from_mesh(dup.data)
        b2.faces.ensure_lookup_table()
        if pname == "torso":
            kill = [f for f in b2.faces
                    if assign[f.index][0] != "torso" and assign[f.index][1] >= 0.80]
        else:
            kill = [f for f in b2.faces if assign[f.index][0] != pname]
        bmesh.ops.delete(b2, geom=kill, context="FACES")
        loose = [v for v in b2.verts if not v.link_faces]
        bmesh.ops.delete(b2, geom=loose, context="VERTS")
        pushed = 0
        if pname != "torso":
            b2.normal_update()
            band = {v for f in b2.faces if assign[f.index][1] < 0.80 for v in f.verts}
            core = {v for f in b2.faces if assign[f.index][1] >= 0.80 for v in f.verts}
            for v in band - core:
                v.co -= v.normal * 0.0005
                pushed += 1
        b2.to_mesh(dup.data)
        b2.free()
        dup["part"] = pname
        mesh_objs.append(dup)
        info[pname] = {"faces": len(dup.data.polygons),
                       "verts": len(dup.data.vertices), "tucked": pushed}
        log(f"part {pname}: faces={info[pname]['faces']} verts={info[pname]['verts']} tucked={pushed}")
    bpy.data.objects.remove(mesh, do_unlink=True)
    bpy.context.view_layer.update()
    return mesh_objs, info


def strip_groups(obj, keep):
    for g in list(obj.vertex_groups):
        if g.name not in keep:
            obj.vertex_groups.remove(g)


def capsule_fill_part(obj, pname, bb, arm, rigid):
    # rigid면 전 정점을 지배뼈에 100%(팔은 최근접 분절), 아니면 bare만 채운다.
    cx = bb["cx"]
    bones, segs = part_bones(arm)
    filled = 0
    for v in obj.data.vertices:
        if not rigid and sum(g.weight for g in v.groups) >= 1e-6:
            continue
        co = v.co
        if pname in ("armL", "armR"):
            side = pname[-1]
            best, bd = segs[side][0][0], 1e18
            for n, a, c in segs[side]:
                d = dseg(co, a, c)
                if d < bd:
                    bd, best = d, n
            parts = {best: 1.0}
        elif pname == "head":
            parts = {"head": 1.0}
        elif pname == "tail":
            parts = {"tail": 1.0}
        else:
            yg = sstep(-0.16, -0.26, co.y)
            wl = (1.0 - sstep(0.09, 0.17, dseg(co, *bones["legL"]))) * yg
            wr = (1.0 - sstep(0.09, 0.17, dseg(co, *bones["legR"]))) * yg
            torso = max(0.0, 1.0 - wl - wr)
            parts = {"legL": wl, "legR": wr, "torso": torso}
        if rigid:
            for g in list(v.groups):
                obj.vertex_groups[g.group].remove([v.index])
        tot = sum(parts.values())
        for name, val in parts.items():
            if val > 1e-9:
                g = obj.vertex_groups.get(name)
                if g is None:
                    g = obj.vertex_groups.new(name=name)
                g.add([v.index], val / tot, "REPLACE")
        filled += 1
    log(f"{obj.name}: capsule-{'rigid' if rigid else 'bare'} filled {filled}")
    return filled


def normalize_top4(obj, arm):
    # 4개 제한 → 정규화 → 무게 0이면 최근접 본.
    segs = [(b.name, b.head_local, b.tail_local) for b in arm.data.bones]

    def nearest(co):
        best, bd = segs[0][0], 1e18
        for n, a, c in segs:
            ab = c - a
            t = max(0.0, min(1.0, (co - a).dot(ab) / max(ab.length_squared, 1e-18)))
            d = (a + ab * t - co).length
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
    # 몸통 벽(SX 최소 0.17) 안쪽에 확실히 들도록 x 반경을 좁힌다.
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


def apply_mask(objs, bb):
    touched = 0
    filled = 0
    for o in objs:
        for v in o.data.vertices:
            if not in_core(v.co, bb):
                continue
            cur = [(g.group, g.weight) for g in v.groups]
            s = sum(w for gid, w in cur if o.vertex_groups[gid].name in ARM_BONES)
            if s <= 0.1:
                continue
            # 목표는 0.095: f32 저장 오차로 0.1이 0.1000000015로 읽혀
            # '> 0.1' 판정에 걸리는 것을 피한다. 판정 기준은 0.1 유지.
            tgt = 0.095
            k = tgt / s
            scaled = [(gid, w * k if o.vertex_groups[gid].name in ARM_BONES else w)
                      for gid, w in cur]
            tot = sum(w for _, w in scaled)
            if tot <= 0:
                continue
            # 순수 팔 웨이트 정점은 재정규화로 복원되므로 몸통을 채운다.
            non_arm = tot - tgt
            fill = max(0.0, (1.0 - tgt) - non_arm)
            if fill > 0:
                tg = o.vertex_groups.get("torso")
                if tg is None:
                    tg = o.vertex_groups.new(name="torso")
                if any(o.vertex_groups[gid].name == "torso" for gid, _ in scaled):
                    scaled = [(gid, w + fill if o.vertex_groups[gid].name == "torso" else w)
                              for gid, w in scaled]
                else:
                    scaled.append((tg.index, fill))
                tot = sum(w for _, w in scaled)
                filled += 1
            for gid, w in scaled:
                o.vertex_groups[gid].add([v.index], w / tot, "REPLACE")
            touched += 1
    log(f"mask: clamped {touched} core verts, torso-filled {filled}")

# ---------- 4. 포즈 (월드프레임 정확 회전) + 검증 ----------
POSES = {
    "arm-raise": {"armL_shoulder": (-0.6, 0, 0), "armR_shoulder": (-0.6, 0, 0)},
    "arm-spread": {"armL_shoulder": (0, 0, -1.2), "armR_shoulder": (0, 0, 1.2)},
    "waist-twist": {"torso": (0, 0.6, 0)},
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
    # R_local = O^-1 · R_world · O (O = 휴지 방향). 본 roll과 무관하게 정확.
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


def dump_slivers(obj, rest_tris, n=8):
    # 휴지 면적 1e-6 미만 삼각형: 위치·정점 웨이트를 덤프 (늘어나기 지표 해석용).
    cands = sorted(((a, i) for i, (a, _) in enumerate(rest_tris) if a < 1e-6))[:n]
    if not cands:
        log("slivers: none < 1e-6")
        return
    deps = bpy.context.evaluated_depsgraph_get()
    eo = obj.evaluated_get(deps)
    em = eo.to_mesh()
    em.calc_loop_triangles()
    ltris = em.loop_triangles
    for a, i in cands:
        t = ltris[i]
        vs = []
        for vi in t.vertices:
            mv = obj.data.vertices[vi]
            ws = sorted(((obj.vertex_groups[g.group].name, round(g.weight, 2))
                         for g in mv.groups), key=lambda x: -x[1])[:3]
            vs.append(f"v{vi}@({mv.co.x:+.3f},{mv.co.y:+.3f},{mv.co.z:+.3f}){ws}")
        log(f"sliver tri{i} rest={a:.2e}: " + " | ".join(vs))
    eo.to_mesh_clear()


def nearest_bone(arm, co):
    best, bd = None, 1e18
    p = Vector(co)
    for b in arm.data.bones:
        a, c = b.head_local, b.tail_local
        ab = c - a
        t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-18)))
        d = (a + ab * t - p).length
        if d < bd:
            bd, best = d, b.name
    return best


def stretch_of(arm, objs, rest):
    # 퇴화 삼각형(rest < 1e-9)은 건너뛰고 기록한다. 최대값과 함께 p99.9를 둔다.
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
    path = os.path.join(outdir, f"attempt-2-{name}.png")
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
        # 주의: img.pixels[i] 직접 인덱싱은 회당 ~13ms로 기하급수적이다.
        # foreach_get 일괄 복사만 쓴다.
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


def leg_move(torso_obj):
    # 다리 우세(leg>0.5) 정점의 휴지→현포즈 최대 이동량 + 엉덩이 블렌드대 참고값.
    deps = bpy.context.evaluated_depsgraph_get()
    eo = torso_obj.evaluated_get(deps)
    em = eo.to_mesh()
    mv = torso_obj.data.vertices
    vg = torso_obj.vertex_groups
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

    # 팩토리 기본 오브젝트(큐브·조명·카메라) 제거. 두면 렌더를 가리고 GLB에 섞인다.
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
    mesh_objs, part_info = split_parts(mesh, bb, arm)
    heat_report, bare_total, filled_total = {}, 0, 0
    for o in mesh_objs:
        try:
            parent_auto(arm, o)
            heat_report[o["part"]] = "attempted"
        except RuntimeError:
            heat_report[o["part"]] = "attempt-failed"
            log(f"weights {o.name}: AUTO FAILED\n{traceback.format_exc(limit=2)}")
        ensure_armature(o, arm)
    for o in mesh_objs:
        pname = o["part"]
        bare = bare_vert_count(o)
        bare_total += bare
        rigid = pname in ("armL", "armR")
        if bare > 0 or rigid:
            filled_total += capsule_fill_part(o, pname, bb, arm, rigid)
            heat_report[pname] = "capsule-rigid" if rigid else "capsule-fallback"
        else:
            heat_report[pname] = "heat"
        strip_groups(o, PART_KEEP[pname])
        normalize_top4(o, arm)
    log_group_stats(mesh_objs)
    log(f"heat report: {json.dumps(heat_report)} bare_total={bare_total} filled={filled_total}")

    n_core, core_v = core_ratio(mesh_objs, bb)
    log(f"core: n={n_core} arm>0.1 ratio = {core_v:.4f} (mask 없음: 몸통 strip 구조)")

    clear_pose(arm)
    rest = {o.name: loop_tris(o) for o in mesh_objs}
    log(f"rest tris: {sum(len(v) for v in rest.values())}")

    cam = setup_scene(bb)
    rest_png = render_png("rest", outdir)
    pose_out = {}
    torso_obj = next(o for o in mesh_objs if o["part"] == "torso")
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
            lm = leg_move(torso_obj)
            entry["legMove"] = lm
            log(f"pose {name}: legMove={lm['legMax']:.4f} (n={lm['legN']}) "
                f"hipMax={lm['hipMax']:.4f} (n={lm['hipN']})")
        pose_out[name] = entry
        log(f"pose {name}: maxStretch={st['max']:.4f} p999={st['p999']:.4f} "
            f"over3={st['over3']}/{st['total']} skipped={st['skipped']} "
            f"worst={det['obj']}#{det['tri']} rest={det['restArea']:.2e} "
            f"posed={det['posedArea']:.2e} near={det['bone']}")

    # 카메라 제거 후 휴지 상태로 리깅 GLB 내보내기 (표준 스킨만).
    bpy.data.objects.remove(cam, do_unlink=True)
    clear_pose(arm)
    # 내보내기: 장면을 Blender 규칙(Z-up)으로 되돌림 (자식 메시가 따라감).
    arm.rotation_mode = "XYZ"
    arm.rotation_euler = (math.pi / 2, 0, 0)
    bpy.context.view_layer.update()
    glb_path = os.path.join(outdir, "fire-01-rigged-blender.glb")
    bpy.ops.export_scene.gltf(filepath=glb_path, export_format="GLB")
    log(f"export rigged GLB: {glb_path} ({os.path.getsize(glb_path)} bytes)")

    # 내보내기 검증: GLB JSON 직접 대조 (메시 5·스킨 1·관절 11·스킨 참조).
    with open(glb_path, "rb") as f:
        head = f.read(20)
        json_len = int.from_bytes(head[12:16], "little")
        gj = json.loads(f.read(json_len).decode("utf-8"))
    mesh_nodes = [n for n in gj["nodes"] if n.get("mesh") is not None]
    log(f"glb: meshes={len(gj['meshes'])} skins={len(gj.get('skins', []))} "
        f"joints={len(gj.get('skins', [{}])[0].get('joints', []))}")
    if len(gj["meshes"]) != 5:
        fail(f"glb meshes {len(gj['meshes'])} != 5")
    if len(gj.get("skins", [])) != 1 or len(gj["skins"][0]["joints"]) != len(ALL_BONES):
        fail("glb skin/joints mismatch")
    if len(mesh_nodes) != 5 or not all(n.get("skin") == 0 for n in mesh_nodes):
        fail("glb mesh node without skin")
    for m in gj["meshes"]:
        for pr in m["primitives"]:
            if "JOINTS_0" not in pr["attributes"] or "WEIGHTS_0" not in pr["attributes"]:
                fail("glb primitive without skin attributes")
    log("glb check: 5 meshes, 1 skin, 11 joints, skinned")

    # 리깅본 텍스처 색 대조 (재인포트 후 베이스컬러 픽셀평균 비교).
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
        "attempt": 2,
        "src": src,
        "srcSha256": {"before": sha_before, "after": sha_after,
                      "untouched": sha_before == sha_after},
        "workCopy": work,
        "verts": sum(len(o.data.vertices) for o in mesh_objs),
        "vertsBeforeWeld": weld_before,
        "bones": ALL_BONES,
        "parts": part_info,
        "weights": {"bareAfterAuto": bare_total, "manualFilled": filled_total,
                    "heatReport": heat_report},
        "core": {"n": n_core, "armOver01_before": core_v, "armOver01_after": core_v},
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

