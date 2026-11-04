# R2/R3: 유형표대로 리깅 + 포즈 렌더. 지시서에 없는 결정은 보고서에 기록.
#   blender --background --factory-startup --python-exit-code 1 --python scripts/rig-type.py -- \
#     --id <종> --src public/models --lm scratch/landmarks/landmarks-3d.json --out scratch/rig-types/<종>
# 출력: <id>-rigged.glb, color-compare.png, rest/twist/bend/<포즈>-front/side.png, decision.json
# 금지 준수: 뼈는 landmarks-3d + bbox에서만 유도(숫자 하드코딩 없음), Bone Heat 없음,
#   가장-가까운-뼈 거리비율 없음, 메시 절단 없음. 웨이트는 지시서 R2 영역 규칙.
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rig_poses

RES = 800

# 유형별 뼈 (지시서 R2 표). leg는 foot 점이 있으면 유형 무관하게 추가(2-1 규칙, 보고서 기록).
TYPE_CHAIN = {
    "A": ["hip", "spine", "chest", "head"],
    "B": ["hip", "spine", "chest", "head"],
    "C": ["hip", "spine", "chest", "head"],
    "D": ["hip", "spine", "head"],
    "E": ["hip", "spine", "head"],
}
TAIL_SEG = {"A": 2, "B": 3}


def parse_args():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    o = dict(zip(args[::2], args[1::2]))
    return o["--id"], o["--src"], o["--lm"], os.path.abspath(o["--out"])


def sstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a) if b > a else 1.0))
    return t * t * (3.0 - 2.0 * t)


def V(p):
    return Vector((p[0], p[1], p[2]))


def main():
    sid, src, lm_path, out = parse_args()
    os.makedirs(out, exist_ok=True)
    decided = []
    spec = json.load(open(lm_path, encoding="utf-8"))["landmarks"][sid]
    t = spec.get("type", "A")
    pts = {k: V(v["pos"]) for k, v in spec["points"].items()}

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(src, f"{sid}.glb"))
    mesh = next(o for o in bpy.data.objects if o.type == "MESH")
    bpts = [mesh.matrix_world @ Vector(c) for c in mesh.bound_box]
    lo = Vector([min(p[i] for p in bpts) for i in range(3)])
    hi = Vector([max(p[i] for p in bpts) for i in range(3)])
    ctr = (lo + hi) / 2
    S = max(hi - lo)
    Sz = hi.z - lo.z
    W = pts.get("waist", Vector((ctr.x, ctr.y, lo.z + 0.35 * Sz)))
    if "waist" not in pts:
        decided.append("waist없음: bbox 35% 높이를 허리로 사용")
    C = pts.get("chin")
    if C is None:
        decided.append("chin없음: head뼈 생략, chest가 꼭대기까지")

    chain = [b for b in TYPE_CHAIN.get(t, TYPE_CHAIN["A"]) if b != "head" or C is not None]

    # ---- 뼈 정의 (랜드마크+bbox 유도) ----
    adata = bpy.data.armatures.new(sid)
    arm = bpy.data.objects.new(sid, adata)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    defs = {}
    segs = {}  # 웨이트용 뼈 선분 {이름: (head, tail)}
    top = hi.z
    b_waist = W.z
    b_mid = (W.z + C.z) / 2 if C is not None else W.z + 0.30 * (top - W.z)

    def add_bone(name, h, t_):
        h, t_ = Vector(h), Vector(t_)
        if (t_ - h).length < 1e-4:
            t_ = h + Vector((0, 0, 0.05 * S))
            decided.append(f"{name} 퇴화: +Z 0.05S로 밈")
        b = eb.new(name)
        b.head, b.tail = h, t_
        defs[name] = True
        segs[name] = (h, t_)

    add_bone("hip", (W.x, W.y, lo.z), (W.x, W.y, b_waist))
    add_bone("spine", (W.x, W.y, b_waist), (W.x, W.y, b_mid))
    if "chest" in chain:
        ctop = C.z if C is not None else top
        add_bone("chest", (W.x, W.y, b_mid), (W.x, W.y, ctop))
    if "head" in chain:
        add_bone("head", (C.x, C.y, C.z), (C.x, C.y, C.z + 0.12 * S))
    torso_top_bone = "chest" if "chest" in defs else "spine"

    def has(a, b):
        return a in pts and b in pts

    if t in ("A", "B"):
        if has("shoulderL", "handL"):
            add_bone("armL", pts["shoulderL"], pts["handL"])
        if has("shoulderR", "handR"):
            add_bone("armR", pts["shoulderR"], pts["handR"])
    if has("footL", "footL"):
        add_bone("legL", (pts["footL"].x, pts["footL"].y, b_waist), pts["footL"])
    if has("footR", "footR"):
        add_bone("legR", (pts["footR"].x, pts["footR"].y, b_waist), pts["footR"])
    tail_names = []
    if t in TAIL_SEG and has("tailBase", "tailTip"):
        n = TAIL_SEG[t]
        a, b = pts["tailBase"], pts["tailTip"]
        for i in range(n):
            nm = f"tail{i + 1}"
            add_bone(nm, a + (b - a) * i / n, a + (b - a) * (i + 1) / n)
            tail_names.append(nm)
    wing_names = {"L": [], "R": []}
    if t == "D":
        for s in ("L", "R"):
            if has(f"wing{s}", f"wingTip{s}"):
                a, b = pts[f"wing{s}"], pts[f"wingTip{s}"]
                for i in range(2):
                    nm = f"wing{s}{i + 1}"
                    add_bone(nm, a + (b - a) * i / 2, a + (b - a) * (i + 1) / 2)
                    wing_names[s].append(nm)
    has_fan = sid == "wind-04" and "hub" in pts
    if has_fan:
        add_bone("fan", pts["hub"], pts["hub"] + Vector((0, -0.12 * S, 0)))

    parent = {"spine": "hip", "chest": "spine", "head": torso_top_bone,
              "armL": torso_top_bone, "armR": torso_top_bone,
              "legL": "hip", "legR": "hip"}
    if tail_names:
        parent[tail_names[0]] = "hip"
        for i in range(1, len(tail_names)):
            parent[tail_names[i]] = tail_names[i - 1]
    for s in ("L", "R"):
        for i, nm in enumerate(wing_names[s]):
            parent[nm] = torso_top_bone if i == 0 else wing_names[s][i - 1]
    if has_fan:
        parent["fan"] = "head" if "head" in defs else torso_top_bone
    for name, pn in parent.items():
        if name in defs and pn in defs:
            eb[name].parent = eb[pn]
            eb[name].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    print(f"[rig] {sid} type={t} bones={sorted(defs)}", flush=True)

    # ---- 웨이트 (영역 기반, 지시서 R2 규칙 + 팔 웨이트 수정) ----
    # 팔/다리: 관절 평면 바깥 + 선분거리 R 이내면 1, 평면 안쪽 WBL만 fade (지시서식).
    #   R = 끝점(hand/foot)의 첫~마지막 히트 거리 × 0.6 (랜드마크에서 유도, 숫자 하드코딩 없음).
    #   WBL = 0.03S (지시서 0.02~0.04).
    # 꼬리/날개: 기존 along-sstep × radial-fade 유지 (WBL 0.08S).
    WBL = 0.08 * S
    WBL_ARM = 0.02 * S
    spans = {k: float(v.get("span", 0.0)) for k, v in spec["points"].items()}
    print(f"[rig] {sid} S={S:.4f} WBL={WBL:.4f} WBL_ARM={WBL_ARM:.4f}", flush=True)
    mw = mesh.matrix_world
    groups = {}
    for name in defs:
        groups[name] = mesh.vertex_groups.new(name=name)

    def seg_proj(p, a, b):
        ab = b - a
        denom = ab.dot(ab)
        tt = ((p - a).dot(ab) / denom) if denom > 1e-12 else 0.0
        tt = max(0.0, min(1.0, tt))
        return tt, (p - (a + ab * tt)).length

    # 3차 4번: 다리 R 상하한 + 좌우 평균화 (S 없으면 몸 높이*0.4)
    ref = S if S > 1e-9 else Sz * 0.4
    leg_R = {}
    for nm, tp in (("legL", "footL"), ("legR", "footR")):
        if nm in defs:
            r = 0.6 * spans.get(tp, 0.0)
            if r <= 0.0:
                r = 0.06 * S
                decided.append(f"{nm}: span 0 → R 0.06S로 밈")
            leg_R[nm] = max(0.05 * ref, min(0.14 * ref, r))
    if "legL" in leg_R and "legR" in leg_R:
        a0, b0 = leg_R["legL"], leg_R["legR"]
        if max(a0, b0) / min(a0, b0) >= 2.0:
            m = (a0 + b0) / 2
            leg_R["legL"] = leg_R["legR"] = m
            decided.append(f"leg 좌우 R 2배 이상 차이 → 평균 {m:.4f}로 맞춤")
    # fan (wind-04): 아래 팔 캡처보다 먼저 계산 (3차 5번 제외용)
    fan_w = {}
    if has_fan:
        hub = pts["hub"]
        for v in mesh.data.vertices:
            p = mw @ v.co
            sy = sstep(hub.y - 0.12 * S, hub.y - 0.04 * S, p.y)
            dxz = math.hypot(p.x - hub.x, p.z - hub.z)
            sr = 1.0 - sstep(0.30 * S - 0.05 * S, 0.30 * S, dxz)
            f = sy * sr
            if f > 0:
                fan_w[v.index] = f
    protr = {}  # 정점 -> {뼈: 가중} (돌기 뼈만)
    protr_bones = [n for n in defs
                   if n.startswith(("arm", "leg", "tail", "wing"))]
    for name in protr_bones:
        strict = name.startswith(("arm", "leg"))
        if strict:
            tip = {"armL": "handL", "armR": "handR",
                   "legL": "footL", "legR": "footR"}[name]
            if name.startswith("arm"):
                # fire-01 실측: hand 단일-레이 span(0.061/0.098, 비대칭)은
                # 지느러미 팔을 덮지 못함(R=0.037 → 163개만 캡처). 몸통 제외는
                # S-평면이 담당하므로 R은 0.11S로 둠. 다리는 span식이 맞음.
                R = 0.11 * S
            else:
                R = leg_R[name]
            wbl = WBL_ARM
        else:
            R = 0.13 * S
            wbl = WBL
        a, b = segs[name]
        d = (b - a).normalized()
        # 몸통 쪽 판정: waist가 평면 어느 쪽인지. signed: 바깥쪽이 양수.
        side = (W - a).dot(d)
        sgn = -1 if side > 0 else 1
        L1 = 0.2 * (b - a).length
        captured = 0
        if strict:
            print(f"[rig] {sid} bone {name} R={R:.4f} (span {spans[tip]:.4f})", flush=True)
        for v in mesh.data.vertices:
            p = mw @ v.co
            along = ((p - a).dot(d) - side) * sgn
            _, dist = seg_proj(p, a, b)
            if strict:
                # 지시서식: 관절(a) 통과 평면, R 밖은 제외, 바깥은 1, 안쪽 WBL만 fade.
                # 3차 5번: fan에 묶인 정점은 팔 웨이트 제외.
                if name.startswith("arm") and v.index in fan_w:
                    continue
                along0 = (p - a).dot(d)
                if dist > R:
                    continue
                w = 1.0 if along0 >= 0 else 1.0 - sstep(0.0, wbl, -along0)
                if w <= 0.0:
                    continue
            else:
                w = sstep(-wbl, L1, along) * (1.0 - sstep(0.7 * R, R, dist))
                if w <= 0.001:
                    continue
            # 꼬리/날개 체인: 투영 위치로 마디 분배
            target = name
            if name.startswith("tail") and tail_names:
                _, td = seg_proj(p, segs[tail_names[0]][0], segs[tail_names[-1]][1])
                tt2, _ = seg_proj(p, segs[tail_names[0]][0], segs[tail_names[-1]][1])
                target = tail_names[min(len(tail_names) - 1, int(tt2 * len(tail_names)))]
            for s in ("L", "R"):
                if wing_names[s] and name in wing_names[s]:
                    tt2, _ = seg_proj(p, segs[wing_names[s][0]][0], segs[wing_names[s][-1]][1])
                    target = wing_names[s][min(1, int(tt2 * 2))]
            protr.setdefault(v.index, {})[target] = max(
                protr.setdefault(v.index, {}).get(target, 0.0), w)
            if w > 0.5:
                captured += 1
        print(f"[rig] {sid} bone {name} captured50={captured}", flush=True)
        # 2-1: 평면으로 10개 미만일 때만(돌기 없음) foot 거리 감쇠 사용. Y-cut 동일 적용.
        if name in ("legL", "legR") and captured < 10:
            decided.append(f"{name}: 평면캡처 {captured}개→2-1 foot감쇠 사용")
            f = pts["footL" if name == "legL" else "footR"]
            yc = (f.y + 0.04 * S, f.y + 0.12 * S) if f.y < ctr.y else None
            for v in mesh.data.vertices:
                p = mw @ v.co
                w = max(0.0, 1.0 - (p - f).length / (0.25 * S))
                w *= 1.0 - sstep(f.z, f.z + 0.05 * S, p.z)
                if yc is not None:
                    w *= 1.0 - sstep(yc[0], yc[1], p.y)
                if w > 0.001:
                    d2 = protr.setdefault(v.index, {})
                    d2[name] = max(d2.get(name, 0.0), w)
    # 몸통: 높이 캐스케이드 (블렌드폭 0.15S)
    BW = 0.15 * S
    bounds = [b_waist]
    if "chest" in defs:
        bounds.append(b_mid)
    if "head" in defs and C is not None:
        bounds.append(C.z)
    chain_names = [b for b in ["hip", "spine", "chest", "head"] if b in defs]

    def torso_weights(z):
        ws, rest = {}, 1.0
        for i, bnd in enumerate(bounds):
            up = sstep(bnd - BW / 2, bnd + BW / 2, z)
            ws[chain_names[i]] = rest * (1.0 - up)
            rest *= up
        ws[chain_names[-1]] = ws.get(chain_names[-1], 0.0) + rest
        return ws

    head_fallback = "head" if "head" in defs else torso_top_bone
    zero_ct = 0
    for v in mesh.data.vertices:
        p = mw @ v.co
        if v.index in fan_w:
            f = fan_w[v.index]
            ws = {"fan": f, head_fallback: 1.0 - f}
        else:
            pr = protr.get(v.index, {})
            pb = min(1.0, sum(pr.values()))
            ws = {k: x for k, x in pr.items()}
            for k, x in torso_weights(p.z).items():
                ws[k] = ws.get(k, 0.0) + x * (1.0 - pb)
        items = sorted(ws.items(), key=lambda kv: -kv[1])[:4]
        tot = sum(x for _, x in items)
        if tot <= 1e-9:
            zero_ct += 1
            items = [("hip", 1.0)]
            tot = 1.0
        for k, x in items:
            groups[k].add([v.index], x / tot, "REPLACE")
    print(f"[rig] {sid} verts={len(mesh.data.vertices)} zero-fixed={zero_ct}", flush=True)

    # 리그 바인드 (웨이트는 위에서 직접 지정, 자동 없음)
    mod = mesh.modifiers.new("RIG", "ARMATURE")
    mod.object = arm
    mesh.parent = arm

    mesh.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(out, f"{sid}-rigged.glb"), export_format="GLB",
        use_selection=True, export_skins=True, export_morph=False)

    # ---- 렌더 (정사영, 텍스처 워크벤치) ----
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.render.resolution_x = sc.render.resolution_y = RES
    sc.display.shading.light = "STUDIO"
    sc.display.shading.color_type = "TEXTURE"
    size = S * 1.25

    def shoot(tag):
        for view, d in (("front", Vector((0, -1, 0))), ("side", Vector((1, 0, 0)))):
            cam = bpy.data.objects.new(f"{tag}-{view}", bpy.data.cameras.new(f"{tag}-{view}"))
            sc.collection.objects.link(cam)
            cam.data.type = "ORTHO"
            cam.data.ortho_scale = size
            cam.location = ctr + d * size * 3
            cam.rotation_euler = (ctr - cam.location).to_track_quat("-Z", "Y").to_euler()
            sc.camera = cam
            sc.render.filepath = os.path.join(out, f"{sid}-{tag}-{view}.png")
            bpy.ops.render.render(write_still=True)

    def reset_pose():
        rig_poses.reset_pose(arm)

    def world_rot(pb, axis, angle):
        rig_poses.world_rot(pb, axis, angle)

    # 색 비교: 원본 메시 복제본을 옆에 두고 한 장에 (원본=왼쪽)
    orig = mesh.copy()
    orig.data = mesh.data.copy()
    sc.collection.objects.link(orig)
    for m in list(orig.modifiers):
        orig.modifiers.remove(m)
    orig.parent = None
    orig.location.x += S * 1.3
    gctr = ctr + Vector((S * 0.65, 0, 0))
    cam = bpy.data.objects.new("cmp", bpy.data.cameras.new("cmp"))
    sc.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = size * 2.1
    cam.location = gctr + Vector((0, -1, 0)) * size * 3
    cam.rotation_euler = (gctr - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam
    sc.render.filepath = os.path.join(out, f"{sid}-color-compare.png")
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(orig, do_unlink=True)

    shoot("rest")
    poses = ["rest"]
    pb = arm.pose.bones
    if "spine" in pb:
        world_rot(pb["spine"], "Z", 0.6)
        shoot("twist")
        poses.append("twist")
        reset_pose()
        world_rot(pb["spine"], "X", 0.4)
        shoot("bend")
        poses.append("bend")
        reset_pose()
    arms = [a for a in ("armL", "armR") if a in pb]
    if t in ("A", "B") and arms:
        for a in arms:
            world_rot(pb[a], "X", -0.6)
        shoot("arm-raise")
        poses.append("arm-raise")
        reset_pose()
        rig_poses.apply_arm_spread(arm, pts, "new")
        shoot("arm-spread")
        poses.append("arm-spread")
        reset_pose()
    if "legL" in pb:
        world_rot(pb["legL"], "X", -0.8)  # 앞으로 차올리기: 앞(-Y) 방향이므로 음수
        shoot("foot-lift")
        poses.append("foot-lift")
        reset_pose()
    if tail_names and tail_names[0] in pb:
        world_rot(pb[tail_names[0]], "X", 0.6)
        shoot("tail-swing")
        poses.append("tail-swing")
        reset_pose()
    if wing_names["L"] and wing_names["R"]:
        world_rot(pb[wing_names["L"][0]], "Y", -0.8)
        world_rot(pb[wing_names["R"][0]], "Y", 0.8)
        shoot("wing-flap")
        poses.append("wing-flap")
        reset_pose()
    if has_fan:
        world_rot(pb["fan"], "Y", 0.8)
        shoot("fan-08")
        reset_pose()
        world_rot(pb["fan"], "Y", 1.6)
        shoot("fan-16")
        poses.extend(["fan-08", "fan-16"])
        reset_pose()
    rig_poses.apply_dance(arm, Sz)
    shoot("dance-test")
    poses.append("dance-test")
    reset_pose()
    with open(os.path.join(out, "decision.json"), "w", encoding="utf-8") as fp:
        json.dump({"id": sid, "type": t, "bones": sorted(defs), "poses": poses,
                   "decided": decided}, fp, indent=1, ensure_ascii=False)
    print(f"[rig] {sid} poses={poses}", flush=True)
    print(f"[rig] {sid} DONE", flush=True)


main()
