# EL-1 + DT-3: 리그 GLB에 눈꺼풀·입 안 메시(셰이프 키)를 붙이고, 경계 가중치를 다듬는다.
#
# 실행 (scripts/proj-make.py·landmark-*.py와 같은 headless 방식):
#   blender --background --factory-startup --python-exit-code 1 \
#     --python scripts/blender/face-keys.py -- <in.glb> <out.glb> <species> [옵션]
#
# 옵션:
#   --anchors <json>   landmark 결과 (기본 scratch/landmarks/landmarks-3d.json)
#   --no-mouth         입 안 메시 생략 (speciesHasMouth=false 종)
#   --no-eyes          눈꺼풀 생략 (noFace 종)
#   --smooth <pairs>   DT-3 경계 가중치 다듬기. 예: torso:armL,torso:armR
#   --rings <n>        경계에서 넓힐 정점 링 수 (기본 2 → 경계 포함 2~3줄 양쪽)
#   --report <json>    측정값 기록 경로
#
# 좌표: blender-world Z-up (glTF import), L = +X, 얼굴 정면 −Y.
# 원본 메시의 형태·UV·텍스처는 바꾸지 않는다 (DT-3은 가중치만).
import argparse
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree


def log(msg):
    print(f"[face-keys] {msg}", flush=True)


def fail(msg):
    log(f"FAIL {msg}")
    sys.exit(1)


argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("dst")
ap.add_argument("species")
ap.add_argument("--anchors", default="scratch/landmarks/landmarks-3d.json")
ap.add_argument("--no-mouth", action="store_true")
ap.add_argument("--no-eyes", action="store_true")
ap.add_argument("--smooth", default="")
ap.add_argument("--rings", type=int, default=2)
ap.add_argument("--report", default="")
ap.add_argument("--preview", default="")
A = ap.parse_args(argv)

# ---- 상수 (한 곳) ----
LID_SCALE = 1.12        # 눈보다 약간 크게
LID_MARGIN = 0.006      # 반지름 여유 (m)
LID_OFFSET = 0.008      # 법선 방향 띄움 (보간 중 표면 파고듦 방지 포함)
LID_NU, LID_NT = 28, 14  # 눈꺼풀 격자 (가로 열, 세로 줄) — 눈 테두리 볼록면 따라가게 촘촘히
LASH_T0 = 0.93          # 속눈썹 띠 시작 (눈꺼풀 아래쪽 7%)
HALF_C, BLINK_C = 0.5, 1.04
BASIS_C = 0.0           # 기본 = 위 눈꺼풀 선에 납작 (면적 0, 법선은 custom normal로 고정)
MOUTH_OFFSET = 0.004
MOUTH_GAP = 0.006       # 그려진 입 선 아래로 띄우는 간격 (선은 덮지 않음)
MOUTH_OPEN = (0.13, 0.10)   # 눈 사이 거리 배율: 반폭, 반높이
MOUTH_ROUND = 0.075
SKIN_DIFF = 0.22        # 피부색과 RGB 거리 (눈 영역 판정)
MAX_INFL = 4


def srgb_to_lin(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


# ---- 가져오기 ----
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=A.src)
meshes = [o for o in bpy.data.objects if o.type == "MESH"
          and any(m.type == "ARMATURE" for m in o.modifiers)]
if not meshes:
    fail("skinned mesh 없음")
for o in meshes:
    if o.data.shape_keys or o.name.startswith(("Eyelid", "MouthInner")):
        fail(f"이미 처리된 GLB ({o.name}) — 원본(scratch/face3d/orig/)에서 다시 실행")
body = max(meshes, key=lambda o: len(o.data.vertices))
arm_obj = next(m.object for m in body.modifiers if m.type == "ARMATURE")
me = body.data
mw = body.matrix_world.copy()
nmat = mw.to_3x3().inverted().transposed()
NV = len(me.vertices)
co = np.array([tuple(mw @ v.co) for v in me.vertices])
vn = np.array([tuple((nmat @ v.normal).normalized()) for v in me.vertices])
log(f"body={body.name} verts={NV} armature={arm_obj.name} bones={[b.name for b in arm_obj.data.bones]}")

bvh = BVHTree.FromPolygons([Vector(c) for c in co], [tuple(p.vertices) for p in me.polygons])
kd = KDTree(NV)
for i, c in enumerate(co):
    kd.insert(c, i)
kd.balance()

# 정점별 가중치 (vg index → weight)
gnames = [g.name for g in body.vertex_groups]
W = np.zeros((NV, len(gnames)))
for v in me.vertices:
    for g in v.groups:
        W[v.index, g.group] = g.weight

# 텍스처 (Base Color 이미지) + 정점 UV
def base_image(mat):
    if not mat or not mat.node_tree:
        return None
    for n in mat.node_tree.nodes:
        if n.type == "TEX_IMAGE" and n.image and any(
                l.to_socket.name == "Base Color" for l in n.outputs[0].links):
            return n.image
    return None


mat0 = me.materials[0] if me.materials else None
img = base_image(mat0)
vcol = np.full((NV, 3), 0.5)
if img is not None and me.uv_layers.active:
    Wd, Hd = img.size
    px = np.empty(Wd * Hd * 4, np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(Hd, Wd, 4)
    uvl = me.uv_layers.active.data
    vuv = np.zeros((NV, 2))
    for loop in me.loops:
        vuv[loop.vertex_index] = uvl[loop.index].uv
    xs = np.clip((vuv[:, 0] % 1.0) * Wd, 0, Wd - 1).astype(int)
    ys = np.clip((vuv[:, 1] % 1.0) * Hd, 0, Hd - 1).astype(int)
    vcol = px[ys, xs, :3].astype(np.float64)
else:
    log("WARN base color 텍스처 없음 → 회색 기준")


def pbr_of(mat):
    rough, metal = 0.65, 0.0
    if mat and mat.node_tree:
        for n in mat.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED":
                rough = n.inputs["Roughness"].default_value
                metal = n.inputs["Metallic"].default_value
    return rough, metal


ROUGH, METAL = pbr_of(mat0)

# ---- 앵커 ----
with open(A.anchors, encoding="utf-8") as f:
    LM = json.load(f)["landmarks"].get(A.species)
if not LM:
    fail(f"landmark 없음: {A.species}")
P = LM["points"]
report = {"species": A.species, "body_verts": NV}


def frame_at(center, radius):
    d = np.linalg.norm(co - center, axis=1)
    sel = d < max(radius, 0.02)
    n = vn[sel].mean(0) if sel.any() else np.array([0, -1, 0.0])
    n = Vector(n).normalized()
    up = Vector((0, 0, 1))
    up = (up - n * up.dot(n)).normalized()
    right = up.cross(n).normalized()
    return n, up, right


def surface(pt, n, off):
    """평면 점 pt를 법선 반대로 쏴서 몸 표면에 붙이고 off만큼 띄운다."""
    o = Vector(pt) + n * 0.5
    hit, hn, _, _ = bvh.ray_cast(o, -n, 1.0)
    if hit is None:
        return Vector(pt) + n * off, n
    hn = hn.normalized()
    if hn.dot(n) < 0:
        hn = -hn
    return hit + hn * off, hn


def detect_eye(anchor, eye_dist):
    """눈 영역(피부와 다른 색) 반지름을 링 단위로 잰다. 실패하면 눈 사이 거리로 추정."""
    a = np.array(anchor)
    d = np.linalg.norm(co - a, axis=1)
    ring = (d > 0.06) & (d < 0.25)
    skin = np.median(vcol[ring], axis=0) if ring.any() else np.array([0.5, 0.5, 0.5])
    diff = np.linalg.norm(vcol - skin, axis=1) > SKIN_DIFF
    # 링(5mm)마다 "눈 색" 여부. 눈동자가 피부색과 비슷한 종(모카퐁 주황 홍채)이 있어
    # 첫 끊김에서 멈추지 않고, 뒤에 피부가 4링(2cm) 이어지는 마지막 눈 링을 경계로 본다.
    step, nb = 0.005, 32
    flags = []
    for k in range(nb):
        s = (d >= k * step) & (d < (k + 1) * step)
        flags.append(bool(s.sum() >= 2 and diff[s].mean() >= 0.3))
    R = None
    for k in range(nb - 4):
        if flags[k] and not any(flags[k + 1:k + 5]) and (k + 1) * step >= 0.015:
            R = (k + 1) * step
            break
    if R is None or R > 0.13:
        r = float(np.clip(0.16 * eye_dist, 0.025, 0.1))
        return np.array(anchor), r, r, skin, "fallback"
    n, up, right = frame_at(a, R)
    m = (d <= R) & diff
    if m.sum() < 6:
        return np.array(anchor), R, R, skin, "ring"
    rel = co[m] - a
    u = rel @ np.array(right)
    v = rel @ np.array(up)
    u0, u1 = np.percentile(u, [3, 97])
    v0, v1 = np.percentile(v, [3, 97])
    ru, rv = max((u1 - u0) / 2, 0.5 * R), max((v1 - v0) / 2, 0.5 * R)
    center = a + np.array(right) * (u0 + u1) / 2 + np.array(up) * (v0 + v1) / 2
    return center, float(ru), float(rv), skin, "color"


def copy_weights(obj, positions):
    """새 정점마다 가장 가까운 몸 정점의 가중치를 그대로 복사 (춤 중에도 붙어 다님)."""
    groups = {g: obj.vertex_groups.new(name=g) for g in gnames}
    used = set()
    for i, p in enumerate(positions):
        _, j, _ = kd.find(p)
        for gi in np.nonzero(W[j] > 1e-4)[0]:
            groups[gnames[gi]].add([i], float(W[j, gi]), "REPLACE")
            used.add(gnames[gi])
    return sorted(used)


def make_material(name, rgb_lin, rough, metal):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*[float(x) for x in rgb_lin], 1.0)
    bsdf.inputs["Roughness"].default_value = float(rough)
    bsdf.inputs["Metallic"].default_value = float(metal)
    return m


def build_object(name, keys, faces, normals, weight_pos, mat):
    """keys: [(key_name, [Vector...])], 첫 항목은 Basis."""
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(p) for p in keys[0][1]], [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    mesh.materials.append(mat)
    for poly in mesh.polygons:
        poly.use_smooth = True
    obj.shape_key_add(name="Basis", from_mix=False)
    for kname, pos in keys[1:]:
        sk = obj.shape_key_add(name=kname, from_mix=False)
        for i, p in enumerate(pos):
            sk.data[i].co = p
    # 법선 = 닫힌 상태 표면 법선 (기본이 납작해도 조명이 깨지지 않게)
    try:
        mesh.normals_split_custom_set_from_vertices([tuple(n) for n in normals])
    except Exception as e:  # noqa: BLE001
        log(f"WARN custom normals: {e}")
    used = copy_weights(obj, weight_pos)
    obj.parent = arm_obj
    obj.matrix_parent_inverse = arm_obj.matrix_world.inverted()
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm_obj
    return obj, used


def lid_grid(c0, n, up, right, ru, rv, t0, t1, c):
    pts, nrm = [], []
    for jt in range(LID_NT + 1):
        t = t0 + (t1 - t0) * jt / LID_NT
        for iu in range(LID_NU + 1):
            uu = -1 + 2 * iu / LID_NU
            x = uu * ru
            vtop = rv * math.sqrt(max(0.0, 1 - uu * uu))
            y = vtop - t * c * 2 * vtop
            p, hn = surface(Vector(c0) + right * x + up * y, n, LID_OFFSET + (0.0012 if t0 > 0 else 0))
            pts.append(p)
            nrm.append(hn)
    return pts, nrm


def grid_faces():
    f = []
    w = LID_NU + 1
    for jt in range(LID_NT):
        for iu in range(LID_NU):
            a = jt * w + iu
            f.append((a, a + 1, a + 1 + w, a + w))
    return f


eyes = []
if not A.no_eyes and "eyeL" in P and "eyeR" in P:
    eL, eR = np.array(P["eyeL"]["pos"]), np.array(P["eyeR"]["pos"])
    eye_dist = float(np.linalg.norm(eL - eR))
    if eye_dist < 0.01:
        log("WARN eyeL==eyeR (외눈/정면 1점) → 눈꺼풀 1개")
        eyes = [("L", eL)]
    else:
        eyes = [("L", eL), ("R", eR)]
    report["eye_dist"] = eye_dist
    for side, a0 in eyes:
        a, ru, rv, skin, how = detect_eye(a0, eye_dist)
        ru = ru * LID_SCALE + LID_MARGIN
        rv = rv * LID_SCALE + LID_MARGIN
        n, up, right = frame_at(a, max(ru, rv))
        # 피부색 = 눈 위쪽 바깥 링 평균 (텍스처 샘플)
        rel = co - a
        dd = np.linalg.norm(rel, axis=1)
        above = (rel @ np.array(up)) > 0
        ring = (dd > max(ru, rv) * 1.05) & (dd < max(ru, rv) * 1.6) & above
        ring &= np.linalg.norm(vcol - skin, axis=1) <= SKIN_DIFF
        lid_srgb = vcol[ring].mean(0) if ring.sum() >= 4 else skin
        lid_mat = make_material(f"Eyelid_{side}_skin", srgb_to_lin(lid_srgb), ROUGH, METAL)
        lash_mat = make_material(f"Eyelid_{side}_lash", srgb_to_lin(lid_srgb * 0.22), 0.8, 0.0)
        keys, normals = [], None
        for kname, c in (("Basis", BASIS_C), ("blink", BLINK_C), ("half", HALF_C)):
            pts, nrm = lid_grid(a, n, up, right, ru, rv, 0.0, 1.0, c)
            keys.append((kname, pts))
            if kname == "blink":
                normals, wpos = nrm, pts
        build_object(f"Eyelid_{side}", keys, grid_faces(), normals, wpos, lid_mat)
        lkeys = []
        for kname, c in (("Basis", BASIS_C), ("blink", BLINK_C), ("half", HALF_C)):
            pts, nrm = lid_grid(a, n, up, right, ru, rv, LASH_T0, 1.0, c)
            lkeys.append((kname, pts))
            if kname == "blink":
                lnormals, lwpos = nrm, pts
        _, used = build_object(f"EyelidLash_{side}", lkeys, grid_faces(), lnormals, lwpos, lash_mat)
        report[f"eye{side}"] = {"ru": ru, "rv": rv, "how": how, "center": [round(float(x), 4) for x in a], "skin_srgb": [round(float(x), 3) for x in lid_srgb],
                                "groups": used}
        log(f"Eyelid_{side}: ru={ru:.3f} rv={rv:.3f} ({how}) skin={np.round(lid_srgb, 2)} groups={used}")

if not A.no_mouth and "mouth" in P:
    m0 = np.array(P["mouth"]["pos"])
    ed = report.get("eye_dist", 0.2) or 0.2
    n, up, right = frame_at(m0, 0.04)
    NA, NR = 24, 5

    def disc(cx, cy, rx, ry):
        pts, nrm = [], []
        p, hn = surface(Vector(m0) + right * cx + up * cy, n, MOUTH_OFFSET)
        pts.append(p); nrm.append(hn)
        for r in range(1, NR + 1):
            for k in range(NA):
                ang = 2 * math.pi * k / NA
                x = cx + rx * (r / NR) * math.cos(ang)
                y = cy + ry * (r / NR) * math.sin(ang)
                p, hn = surface(Vector(m0) + right * x + up * y, n, MOUTH_OFFSET)
                pts.append(p); nrm.append(hn)
        return pts, nrm

    faces = [(0, 1 + k, 1 + (k + 1) % NA) for k in range(NA)]
    for r in range(1, NR):
        b0, b1 = 1 + (r - 1) * NA, 1 + r * NA
        for k in range(NA):
            k1 = (k + 1) % NA
            faces.append((b0 + k, b1 + k, b1 + k1, b0 + k1))
    hw, hh = MOUTH_OPEN[0] * ed, MOUTH_OPEN[1] * ed
    rr = MOUTH_ROUND * ed
    basis, _ = disc(0, -MOUTH_GAP, 0.0002, 0.0002)
    opn, nrm = disc(0, -MOUTH_GAP - hh, hw, hh)
    rnd, _ = disc(0, -MOUTH_GAP - rr, rr, rr)
    mmat = make_material("MouthInner_dark", (0.045, 0.008, 0.012), 0.85, 0.0)
    _, used = build_object("MouthInner", [("Basis", basis), ("open", opn), ("round", rnd)],
                           faces, nrm, opn, mmat)
    report["mouth"] = {"hw": hw, "hh": hh, "round": rr, "groups": used}
    log(f"MouthInner: hw={hw:.3f} hh={hh:.3f} round={rr:.3f} groups={used}")

# ---- DT-3: 경계 가중치 다듬기 ----
if A.smooth:
    pairs = [tuple(p.split(":")) for p in A.smooth.split(",") if ":" in p]
    gidx = {g: i for i, g in enumerate(gnames)}
    pairs = [(gidx[a], gidx[b]) for a, b in pairs if a in gidx and b in gidx]
    if not pairs:
        log("WARN smooth 대상 그룹 없음 → 생략")
    else:
        nbr = [[] for _ in range(NV)]
        for e in me.edges:
            a, b = e.vertices
            nbr[a].append(b)
            nbr[b].append(a)
        dom = W.argmax(1)
        band = np.zeros(NV, bool)
        for a_, b_ in pairs:
            ps = {a_, b_}
            for e in me.edges:
                a, b = e.vertices
                if dom[a] != dom[b] and {dom[a], dom[b]} == ps:
                    band[a] = band[b] = True
        seed = int(band.sum())
        for _ in range(A.rings):
            grow = band.copy()
            for i in np.nonzero(band)[0]:
                grow[nbr[i]] = True
            band = grow
        idx = np.nonzero(band)[0]

        def cliff(Wm):
            # 띠 안 간선의 최대 가중치 차 (쌍 그룹 기준)
            mx = 0.0
            for i in idx:
                for j in nbr[i]:
                    for a_, b_ in pairs:
                        mx = max(mx, abs(Wm[i, a_] - Wm[j, a_]), abs(Wm[i, b_] - Wm[j, b_]))
            return mx

        before = cliff(W)
        Wn = W.copy()
        for _ in range(6):
            Wt = Wn.copy()
            for i in idx:
                nb = nbr[i]
                if nb:
                    Wt[i] = 0.5 * Wn[i] + 0.5 * Wn[nb].mean(0)
            Wn = Wt
        # 본당 최대 4개 + 정규화
        for i in idx:
            row = Wn[i]
            if (row > 1e-4).sum() > MAX_INFL:
                cut = np.sort(row)[-MAX_INFL]
                row[row < cut] = 0
            row[row < 1e-4] = 0
            s = row.sum()
            Wn[i] = row / s if s > 0 else W[i]
        after = cliff(Wn)
        for gi, g in enumerate(body.vertex_groups):
            col_ = Wn[idx, gi]
            nz = idx[col_ > 0]
            z = idx[col_ <= 0]
            if len(z):
                g.remove([int(i) for i in z])
            for i in nz:
                g.add([int(i)], float(Wn[i, gi]), "REPLACE")
        report["dt3"] = {"pairs": A.smooth, "seed_verts": seed, "band_verts": int(len(idx)),
                         "cliff_before": round(before, 4), "cliff_after": round(after, 4)}
        log(f"DT-3 {A.smooth}: seed={seed} band={len(idx)} cliff {before:.3f} → {after:.3f}")

# ---- 내보내기 ----
os.makedirs(os.path.dirname(os.path.abspath(A.dst)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=A.dst, export_format="GLB", export_skins=True,
                          export_morph=True, export_morph_normal=False,
                          export_draco_mesh_compression_enable=False)


def body_first(path, body_name):
    """기존 검증·런타임 일부가 '첫 SkinnedMesh = 몸'을 가정 → 자식 순서에서 몸 노드를 맨 앞으로."""
    with open(path, "rb") as f:
        data = f.read()
    jl = int.from_bytes(data[12:16], "little")
    gj = json.loads(data[20:20 + jl].decode("utf-8"))
    rest = data[20 + jl:]
    nodes = gj["nodes"]
    bi = next((i for i, n in enumerate(nodes) if n.get("name") == body_name), None)
    if bi is None:
        return
    for n in nodes:
        ch = n.get("children")
        if ch and bi in ch:
            ch.remove(bi)
            ch.insert(0, bi)
    for s in gj.get("scenes", []):
        if bi in s.get("nodes", []):
            s["nodes"].remove(bi)
            s["nodes"].insert(0, bi)
    js = json.dumps(gj, separators=(",", ":")).encode("utf-8")
    js += b" " * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + len(rest)
    with open(path, "wb") as f:
        f.write(data[:4] + data[4:8] + total.to_bytes(4, "little"))
        f.write(len(js).to_bytes(4, "little") + b"JSON" + js + rest)


body_first(A.dst, body.name)
s0, s1 = os.path.getsize(A.src), os.path.getsize(A.dst)
report.update({"size_in": s0, "size_out": s1, "size_delta": s1 - s0})
log(f"export {A.dst} {s0} → {s1} bytes ({(s1 - s0) / 1024:+.1f} KB)")

with open(A.dst, "rb") as f:
    head = f.read(20)
    jl = int.from_bytes(head[12:16], "little")
    gj = json.loads(f.read(jl).decode("utf-8"))
names = [m.get("name") for m in gj["meshes"]]
targets = {m.get("name"): m.get("extras", {}).get("targetNames") for m in gj["meshes"]}
report["glb_meshes"] = names
report["glb_targets"] = targets
log(f"glb meshes={names} skins={len(gj.get('skins', []))} targets={targets}")
if A.preview:
    # 확인용 정면 렌더 3장: 뜬 눈 / blink+round / half+open (내보낸 뒤라 GLB에 영향 없음)
    scn = bpy.context.scene
    cam = bpy.data.objects.new("pv_cam", bpy.data.cameras.new("pv_cam"))
    scn.collection.objects.link(cam)
    scn.camera = cam
    cam.data.type = "ORTHO"
    ctr = np.mean([np.array(P[k]["pos"]) for k in ("eyeL", "eyeR", "mouth") if k in P], axis=0)
    cam.data.ortho_scale = max(0.3, 2.6 * report.get("eye_dist", 0.2))
    cam.location = (ctr[0], ctr[1] - 2.0, ctr[2])
    cam.rotation_euler = (math.pi / 2, 0, 0)
    scn.render.engine = "BLENDER_EEVEE"
    world = bpy.data.worlds.new("pv")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (1, 1, 1, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scn.world = world
    scn.view_settings.view_transform = "Standard"
    scn.render.resolution_x = scn.render.resolution_y = 480
    states = {"open": {}, "blink": {"blink": 1.0, "round": 1.0}, "half": {"half": 1.0, "open": 1.0}}
    for tag, vals in states.items():
        for o in bpy.data.objects:
            if o.type == "MESH" and o.data.shape_keys:
                for kb in o.data.shape_keys.key_blocks[1:]:
                    kb.value = vals.get(kb.name, 0.0)
        scn.render.filepath = os.path.abspath(f"{A.preview}-{tag}.png")
        bpy.ops.render.render(write_still=True)
    log(f"preview {A.preview}-{{open,blink,half}}.png")

if A.report:
    with open(A.report, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
