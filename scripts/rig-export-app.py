# R-A: heat GLB -> 앱용 리그 GLB (public/models-rigged/<id>.glb).
#   blender --background --factory-startup --python-exit-code 1 --python scripts/rig-export-app.py -- \
#     --src public/models --heat scratch/rig-types --out public/models-rigged
# - 메시/UV/텍스처/재질/트랜스폼은 손대지 않는다 (정점 그룹+아마추어만 정리).
# - 뼈 이름 앱 기준 통일 + 좌우 뒤집기 (Blender L=+X -> 앱 armL=-X):
#   hip,spine,chest->torso / tail1..->tail / wingL*->wingR, wingR*->wingL
#   armL<->armR, legL<->legR / head,fan 유지. 없는 뼈는 만들지 않는다.
# - 출력: <id>.glb, bones.json, 종별 export-app.json(원본/heat/리그 통계+비교).
import hashlib
import json
import os
import sys
from array import array

import bpy
from mathutils import Matrix, Vector

IDS = ([f"fire-0{i}" for i in range(1, 6)] + [f"grass-0{i}" for i in range(1, 6)]
       + [f"rock-0{i}" for i in range(1, 5)] + [f"water-0{i}" for i in range(1, 6)]
       + [f"wind-0{i}" for i in range(1, 6)])

MERGE = {"hip": "torso", "spine": "torso", "chest": "torso",
         "tail1": "tail", "tail2": "tail", "tail3": "tail",
         "wingL1": "wingR", "wingL2": "wingR", "wingR1": "wingL", "wingR2": "wingL",
         "armL": "armR", "armR": "armL", "legL": "legR", "legR": "legL",
         "head": "head", "fan": "fan"}
# 8-H-2: 정점 그룹 병합표. Blender에서 edit-bone 개명은 같은 이름의 정점
# 그룹을 함께 끌고 간다(실측: 뼈 armL->armR가 그룹 armL->armR를 동반).
# 그래서 2-순환(armL<->armR, legL<->legR)을 그룹 단계에서 뒤집으면 뼈 개명
# 때 다시 뒤집혀(계통적 크로스: -X 정점이 +X 뼈를 따름, A2O 킥 91%H 찢어짐
# 원인) 원위치가 된다. 교환쌍은 그룹 단계에서 heat 이름을 유지하고 개명
# 드래그에 뒤집기를 맡긴다. 병합(hip->torso 등)은 드래그 대상 그룹이 없어
# 그대로 둔다.
MERGE_GROUPS = dict(MERGE)
MERGE_GROUPS.update({"armL": "armL", "armR": "armR",
                     "legL": "legL", "legR": "legR"})
DELETE_BONES = ["tail3", "tail2", "wingL2", "wingR2", "chest", "spine"]
# 8-H-2 얼굴 경계 램프: 턱선 hard cut(위 head 1.0 <-> 띠 arm heat)이
# A2O 킥(head·torso ry 스윙)에서 리본 찢어짐(23~29%H)을 만든다. 강제
# 대상의 팔다리만 z·가중치 2D smoothstep으로 점진 제거하고 우세뼈에
# 몰아준다. 삼중혼합(genuine h&t+팔다리)은 heat 그대로(건드리면 밴드
# 합류). 램프는 폴드선(턱-3%H) 위로만. 띠는 heat 그대로(게이트 3%H).
FACE_BOT = -0.03
FACE_TOP = 0.01
WT_LO = 0.2
WT_HI = 0.45
# 미량 head/torso(heat 번짐 0.09 이하)는 우세뼈로 접는다. 안 접으면
# 팔다리 램프 뒤 head·torso가 둘 다 살아 밴드에 합류해 게이트를 깬다.
# (이마 torso 번짐 0.02~0.08 선반이 차례로 상단을 만들었음.)
TRACE_T = 0.09
# 턱 위 강제 임계: h0+t0>=0.45면 head 1.0 (0.45~0.5 코너의 팔다리 리본을
# 강제한다. water-02형 턱-팔 중 0.45 이상도 함께 강제되니 sweep+육안 확인.)
FORCE_T = 0.45
# 얼굴 강체 복원: 확장 강제(TRACE_T 초과)에서 손대지 않을 부속 지배.
# (날개·꼬리·팬은 R-B-7 '우세 유지' + 채널 없음/관절이므로 heat 유지.)
APPENDAGE_KEEP = ("wingL", "wingR", "tail", "fan")
# 확장 강제 제외 종: water-02는 지느러미 뿌리↔턱이 연속 블렌드라 강제 경계가
# 지느러미 안에서 찢어짐(emote 변 45%H+) — 13:59 가중치 유지. (flood로도 분리
# 불가: 뿌리가 head 지배라 flood에 안 잡히고, 강제하면 spared 몸통과 단차.)
FACE_RIGID_SKIP = frozenset({"water-02"})


def _smoothstep(f):
    f = min(1.0, max(0.0, f))
    return f * f * (3.0 - 2.0 * f)


def parse_args():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    o = dict(zip(args[::2], args[1::2]))
    ids = o.get("--ids", "").split(",") if o.get("--ids") else IDS
    return (os.path.abspath(o["--src"]), os.path.abspath(o["--heat"]),
            os.path.abspath(o["--out"]), [i for i in ids if i])


def img_hash(img):
    try:
        raw = array("f", img.pixels[:]).tobytes()
    except Exception:  # noqa: BLE001
        return f"{img.name}:unreadable"
    h = hashlib.sha1()
    h.update(f"{img.size[0]}x{img.size[1]}:".encode())
    h.update(raw)
    return f"{img.size[0]}x{img.size[1]}:{h.hexdigest()[:12]}"


def mesh_stats(mesh):
    me = mesh.data
    bpts = [mesh.matrix_world @ Vector(c) for c in mesh.bound_box]
    lo = [min(p[i] for p in bpts) for i in range(3)]
    hi = [max(p[i] for p in bpts) for i in range(3)]
    uvs = [ul.data for ul in me.uv_layers] if me.uv_layers else []
    return {
        "verts": len(me.vertices),
        "loops": len(me.loops),
        "uv_layers": len(me.uv_layers),
        "uv_count": len(uvs[0]) if uvs else 0,
        "materials": sorted(set(me.materials[s.material_index].name
                                for s in me.polygons
                                if s.material_index < len(me.materials)
                                and me.materials[s.material_index])),
        "images": sorted(img_hash(i) for i in bpy.data.images
                         if i.type != "RENDER_RESULT"),
        "bbox": [round(v, 5) for v in (lo + hi)],
    }


def fresh_import(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    mesh = max(meshes, key=lambda o: len(o.data.vertices))
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    return mesh, arms[0] if arms else None


def assert_no_cross(sid, mesh, arm):
    # 8-H-2: 크로스 배선 방지. 우세 그룹이 팔·다리인 정점은 같은 이름 뼈와
    # 같은 쪽(x)에 있어야 한다. 어기면 큰 소리로 실패(조용한 크로스 금지).
    bones = {b.name: (arm.matrix_world @ b.head_local) for b in arm.data.bones}
    limbs = [n for n in bones if n in ("armL", "armR", "legL", "legR")]
    if not limbs:
        return
    xb = [(mesh.matrix_world @ Vector(c)).x for c in mesh.bound_box]
    W = max(xb) - min(xb)
    pairs = {"armL": "armR", "armR": "armL", "legL": "legR", "legR": "legL"}
    # 체계적 크로스만 실패: 매끈한 번짐(중간 근처·섞인 가중치)은 heat 정상이다.
    # (fire-01 구 크로스는 팔다리 혹 수백 점이 w=1.0으로 반대편에 있었다.)
    bad, n = [], 0
    step = max(1, len(mesh.data.vertices) // 2000)
    for v in list(mesh.data.vertices)[::step]:
        top, wtop = None, 0.0
        for g in v.groups:
            if g.weight > wtop:
                wtop = g.weight
                top = mesh.vertex_groups[g.group].name
        if top not in limbs or wtop < 0.5:
            continue
        n += 1
        other = pairs[top]
        if other not in bones:
            continue
        bx = bones[top].x
        mid = (bx + bones[other].x) / 2
        vx = (mesh.matrix_world @ v.co).x
        if (wtop >= 0.8 and (vx - mid) * (bx - mid) < 0
                and abs(vx - mid) > 0.05 * W and abs(bx - mid) > 0.05 * W):
            if len(bad) < 5:
                bad.append((v.index, top, round(vx, 3), round(bx, 3),
                            round(wtop, 2)))
            else:
                bad.append(None)
    if len(bad) > max(10, 0.02 * n):
        print(f"[export-app] {sid} CROSSFAIL"
              f" {len(bad)} strong dominant-limb verts on wrong side"
              f" (checked {n}), ex={bad[:5]}", flush=True)
        sys.exit(2)


def remap(sid, mesh, arm):
    present = [b.name for b in arm.data.bones]
    unexpected = [b for b in present if b not in MERGE]
    if unexpected:
        print(f"[export-app] {sid} WARN 예상밖뼈={unexpected}", flush=True)
    # R-B-7 얼굴 규칙: head뼈가 있으면 턱(chin) 위에서 head/torso가
    # 우세한 정점은 head 1.0으로 고정(얼굴=강체, 팔다리 가중치도 제거).
    # 턱 아래 3%H 띠 아래에서는 head를 0으로. 꼬리·날개 등 우세 정점은 유지.
    # 8-H-2 메모: 턱 위 전부 강제+띠 delimb를 시도했으나 water-02처럼 팔이
    # 턱에 붙은 종의 팔다리 자체가 갈라져(53%H) 되돌림. 팔다리/번짐 구분은
    # 기하만으로 불가(연결성까지 같음). 얼굴 앵커 기반 강제는 향후 과제.
    # 킥 찢어짐의 주범(91%H)은 아래 MERGE_GROUPS 크로스였고 이것으로 해소.
    # 8-H-2 후속: 턱선 hard cut이 남긴 리본(위 head 1.0 vs 띠 arm heat,
    # A2O 킥 23~29%H)은 팔다리 점진 램프로 해소. water-02형(팔이 턱에
    # 붙음)은 h0+t0<0.2에서 램프가 0이라 heat 그대로 갈라지지 않는다.
    # 얼굴 강체 복원: 0.45 게이트 유지 + TRACE_T 초과 위턱 번짐 확장 강제.
    # 단 관절 사슬(flood: 아래턱 팔다리 지배와 연결된 위턱 팔다리 지배)과
    # 날개·꼬리·팬 지배는 유지해 지느러미·팔다리·다리·날개가 얼지 않게 한다.
    # (위턱 램프 끄기(띠 아래만)는 water-02 경계단차 확대 → 원복. 램프는
    # 기존대로 두고 강제 뒤집기로 덮어쓴다. 강제 경계단은 캡처+게이트 확인.)
    chin_z = None
    if "head" in present:
        chin_z = (arm.matrix_world @ arm.data.bones["head"].head_local).z
    face_stat = {"applied": chin_z is not None, "above": 0, "moved": 0,
                 "band_mixed": 0, "below_head": 0, "slab_n": 0,
                 "slab_head": 0.0, "ramp_n": 0, "forced_ext": 0,
                 "flooded_n": 0}
    # 1) 정점 그룹 병합 (final 이름으로 합산 후 재생성, 합=1 정규화).
    for m in [o for o in bpy.data.objects
              if o.type == "MESH" and len(o.vertex_groups)]:
        zb = [(m.matrix_world @ Vector(c)).z for c in m.bound_box]
        Hh = max(zb) - min(zb)
        acc = {}
        # Phase A: 병합+접기 사전 계산 (flood 판정용; 아래 루프와 동일 수식).
        pre = {}
        for v in m.data.vertices:
            d = {}
            for g in v.groups:
                old = m.vertex_groups[g.group].name
                if old not in MERGE_GROUPS:
                    continue
                fn = MERGE_GROUPS[old]
                d[fn] = d.get(fn, 0.0) + g.weight
            h = d.get("head", 0.0)
            t = d.get("torso", 0.0)
            ht, tt = h, t
            z = (m.matrix_world @ v.co).z
            if chin_z is not None and h + t > 0:
                if 0.0 < t <= TRACE_T and h > t:
                    h += t
                    t = 0.0
                    d["head"] = d.get("head", 0.0) + d.pop("torso")
                elif 0.0 < h <= TRACE_T and t >= h:
                    t += h
                    h = 0.0
                    d["torso"] = d.get("torso", 0.0) + d.pop("head")
            tot0 = sum(d.values())
            dom0 = max(d, key=lambda k: d[k]) if tot0 > 0 else None
            pre[v.index] = (d, h, t, z, ht, tt, dom0)
        # Phase B: 관절 사슬 flood. 턱 아래 팔다리 지배에서 시작해 팔다리
        # 지배 정점으로만 번진다. flood된 위턱 정점(지느러미·팔다리·다리·
        # 날개 사슬)은 확장 강제에서 제외한다. 고립 번짐(뿔·귀·잎·턱)은 강제.
        flooded = set()
        if chin_z is not None:
            def _limb(dd):
                return dd is not None and dd not in ("head", "torso")
            adj = {}
            for e in m.data.edges:
                a, b = e.vertices[0], e.vertices[1]
                adj.setdefault(a, []).append(b)
                adj.setdefault(b, []).append(a)
            stack = [vi for vi, rec in pre.items()
                     if rec[3] <= chin_z and _limb(rec[6])]
            flooded = set(stack)
            while stack:
                for o in adj.get(stack.pop(), ()):
                    if o not in flooded and _limb(pre[o][6]):
                        flooded.add(o)
                        stack.append(o)
            face_stat["flooded_n"] += sum(
                1 for vi in flooded if pre[vi][3] > chin_z)
        for v in m.data.vertices:
            d, h, t, z, ht, tt, dom0 = pre[v.index]
            if chin_z is not None and h + t > 0:
                # 팔다리 램프: 아래에서 위(강제)로 가며 팔다리를 점진
                # 제거. 우세뼈 몰아주기라 head-torso 띠는 그대로다.
                h0, t0 = h, t
                span = (FACE_TOP - FACE_BOT) * Hh
                if span > 1e-9:
                    gz = _smoothstep(
                        (z - (chin_z + FACE_BOT * Hh)) / span)
                else:
                    gz = 1.0 if z > chin_z else 0.0
                sw = _smoothstep((h0 + t0 - WT_LO) / (WT_HI - WT_LO))
                kf = gz * sw
                if 0.0 < kf < 1.0:
                    face_stat["ramp_n"] += 1
                if kf > 0:
                    # 아래(밴드): h:t 비율로 팔다리 전량 제거(띠 안 안전).
                    # 위: 단일측(리본)만 제거, torso 보유·삼중혼합 유지.
                    # (위턱 램프 끄기를 시도했으나 water-02 지느러미 경계단차가
                    # 커져 찢어짐 → 원복. 위턱은 아래 강제/유지로 결정된다.)
                    if z > chin_z:
                        tripleW = _smoothstep(
                            (min(h0, t0) - TRACE_T) / 0.03)
                        keff = kf * (1.0 - tripleW)
                        if t0 > 0:
                            keff = 0.0
                        domH = h0 >= t0
                    else:
                        keff = kf
                        domH = None
                    killed = 0.0
                    for lb in list(d.keys()):
                        if lb in ("head", "torso"):
                            continue
                        killed += d[lb] * keff
                        d[lb] *= (1.0 - keff)
                    if killed > 0:
                        # 아래(밴드): h:t 비율 배분(띠 안에 머문다).
                        # 위: 우세뼈 몰아주기(동시 생성 금지).
                        if domH is None:
                            if h0 > 0:
                                d["head"] = (d.get("head", 0.0)
                                             + killed * h0 / (h0 + t0))
                            if t0 > 0:
                                d["torso"] = (d.get("torso", 0.0)
                                              + killed * t0 / (h0 + t0))
                        elif domH:
                            d["head"] = d.get("head", 0.0) + killed
                        else:
                            d["torso"] = d.get("torso", 0.0) + killed
                if z > chin_z:
                    if h0 + t0 >= FORCE_T:
                        face_stat["above"] += 1
                        if (d.get("torso", 0.0) > 0.001 or any(
                                kk not in ("head", "torso") and w > 0.001
                                for kk, w in d.items())):
                            face_stat["moved"] += 1
                        d.clear()
                        d["head"] = 1.0
                    elif (h0 + t0 > TRACE_T and v.index not in flooded
                            and dom0 not in APPENDAGE_KEEP
                            and sid not in FACE_RIGID_SKIP):
                        # 얼굴 강체 복원: flood에 안 잡힌 턱 위 번짐(뿔·귀·
                        # 잎·턱 고립 패치)은 head 1.0. 관절 사슬(flood)·
                        # 날개·꼬리·팬 지배는 유지.
                        face_stat["forced_ext"] += 1
                        if (d.get("torso", 0.0) > 0.001 or any(
                                kk not in ("head", "torso") and w > 0.001
                                for kk, w in d.items())):
                            face_stat["moved"] += 1
                        d.clear()
                        d["head"] = 1.0
                elif z < chin_z - 0.03 * Hh:
                    if ht > 0.001:
                        face_stat["below_head"] += 1
                    d["torso"] = d.get("torso", 0.0) + d.get("head", 0.0)
                    d.pop("head", None)
                else:
                    if ht > 0.001 and tt > 0.001:
                        face_stat["band_mixed"] += 1
                if z > chin_z - 0.01 * Hh:
                    tot = sum(d.values())
                    face_stat["slab_n"] += 1
                    face_stat["slab_head"] += (
                        d.get("head", 0.0) / max(tot, 1e-9))
            s = sum(d.values())
            if s > 0:
                for k in d:
                    d[k] /= s
            else:
                d = {"torso": 1.0}
            acc[v.index] = d
        for g in list(m.vertex_groups):
            m.vertex_groups.remove(g)
        finals = sorted({fn for d in acc.values() for fn in d})
        for fn in finals:
            m.vertex_groups.new(name=fn)
        for vi, d in acc.items():
            for fn, w in d.items():
                if w > 0:
                    m.vertex_groups[fn].add([vi], w, "REPLACE")
    # 2) 아마추어: spine/chest 자식->hip, 삭제, keeper 개명(2-pass).
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    for name in DELETE_BONES:
        if name in ("spine", "chest") and name in eb:
            hip = eb.get("hip")
            for b in eb:
                if b.parent and b.parent.name == name:
                    b.parent = hip
        if name in eb:
            eb.remove(eb[name])
    keepers = [(b, MERGE[b]) for b in present
               if b in eb and b in MERGE and b not in DELETE_BONES]
    for old, _ in keepers:
        if old != MERGE[old]:
            eb[old].name = "__rx__" + MERGE[old]
    for old, fn in keepers:
        if old != fn:
            eb["__rx__" + fn].name = fn
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    assert_no_cross(sid, mesh, arm)
    return sorted(b.name for b in arm.data.bones), face_stat


def main():
    src, heat, out, ids = parse_args()
    os.makedirs(out, exist_ok=True)
    bones_all, fails = {}, []
    try:
        bones_all.update(json.load(open(os.path.join(out, "bones.json"),
                                         encoding="utf-8")))
    except OSError:
        pass
    for sid in ids:
        mesh_o, _ = fresh_import(os.path.join(src, f"{sid}.glb"))
        st_o = mesh_stats(mesh_o)
        mesh_h, arm_h = fresh_import(os.path.join(heat, sid, f"{sid}-heat.glb"))
        if arm_h is None:
            print(f"[export-app] {sid} HEATFAIL 아마추어없음", flush=True)
            fails.append(sid)
            continue
        st_h = mesh_stats(mesh_h)
        bones_heat = sorted(b.name for b in arm_h.data.bones)
        bones_app, face_stat = remap(sid, mesh_h, arm_h)
        for o in (mesh_h, arm_h):
            o.select_set(False)
        mesh_h.select_set(True)
        arm_h.select_set(True)
        bpy.context.view_layer.objects.active = arm_h
        bpy.ops.export_scene.gltf(
            filepath=os.path.join(out, f"{sid}.glb"), export_format="GLB",
            use_selection=True, export_skins=True, export_morph=False)
        mesh_r, arm_r = fresh_import(os.path.join(out, f"{sid}.glb"))
        st_r = mesh_stats(mesh_r)
        bones_rig = sorted(b.name for b in arm_r.data.bones) if arm_r else []
        # 정점 수는 Blender GLB 왕복마다 인덱스 공유 방식 탓에 소폭 변동
        # (heat 왕복에서도 이미 변동, 형상 loops/UV/이미지/bbox는 동일).
        # 게이트는 loops·UV·이미지·재질·뼈로 하고 verts는 표 기록용으로만 둔다.
        ok = (st_o["loops"] == st_r["loops"]
              and st_o["uv_count"] == st_r["uv_count"]
              and st_o["images"] == st_r["images"]
              and st_o["materials"] == st_r["materials"]
              and bones_app == bones_rig)
        rec = {"id": sid, "bones_heat": bones_heat, "bones_app": bones_app,
               "bones_rigged": bones_rig, "orig": st_o, "heat": st_h,
               "rigged": st_r, "match": ok, "face": face_stat}
        with open(os.path.join(heat, sid, "export-app.json"), "w",
                  encoding="utf-8") as fp:
            json.dump(rec, fp, ensure_ascii=False, indent=1)
        bones_all[sid] = bones_app
        print(f"[export-app] {sid} bones={bones_app} match={ok} face={face_stat}", flush=True)
        if not ok:
            fails.append(sid)
    with open(os.path.join(out, "bones.json"), "w", encoding="utf-8") as fp:
        json.dump(bones_all, fp, ensure_ascii=False, indent=1)
    print(f"[export-app] DONE {len(ids) - len(fails)}/{len(ids)} "
          f"fails={fails}", flush=True)
    if fails:
        sys.exit(2)


main()
