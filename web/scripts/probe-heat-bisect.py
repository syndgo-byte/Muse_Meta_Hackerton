# 3차 2번: 프록시 복셀 리메시 + Automatic Weights + Data Transfer 비교 실험.
#   blender --background --factory-startup --python-exit-code 1 --python scripts/rig-heat.py -- \
#     --id <종> --src public/models --lm scratch/landmarks/landmarks-3d.json --out scratch/rig-types/<종>
# - 원본 메시를 voxel remesh(몸 높이 Sz의 1/80 → 실패 시 1/60 → 1/40)해 프록시를 만든다.
# - 원통 방식과 같은 뼈(아래 뼈 정의는 rig-type.py와 동일식 복사)에 프록시를
#   "With Automatic Weights"로 바인딩하고, Data Transfer(정점 웨이트,
#   nearest face interpolated)로 원본에 옮긴다.
# - 출력: <id>-heat.glb (실패 시 파일 없음 + 메시지 기록).
import json
import math
import os
import sys

import bpy
from mathutils import Vector

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


def V(p):
    return Vector((p[0], p[1], p[2]))


def mean_wsum(obj):
    tot, n = 0.0, 0
    for v in obj.data.vertices:
        tot += sum(g.weight for g in v.groups)
        n += 1
    return tot / max(n, 1)


def build_armature(sid, t, pts, lo, hi, ctr, S, Sz, decided):
    W = pts.get("waist", Vector((ctr.x, ctr.y, lo.z + 0.35 * Sz)))
    if "waist" not in pts:
        decided.append("waist없음: bbox 35% 높이를 허리로 사용")
    C = pts.get("chin")
    if C is None:
        decided.append("chin없음: head뼈 생략, chest가 꼭대기까지")
    chain = [b for b in TYPE_CHAIN.get(t, TYPE_CHAIN["A"]) if b != "head" or C is not None]
    adata = bpy.data.armatures.new(sid)
    arm = bpy.data.objects.new(sid, adata)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    defs = {}
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
    if t in TAIL_SEG and has("tailBase", "tailTip"):
        n = TAIL_SEG[t]
        a, b = pts["tailBase"], pts["tailTip"]
        for i in range(n):
            add_bone(f"tail{i + 1}", a + (b - a) * i / n, a + (b - a) * (i + 1) / n)
    if t == "D":
        for s in ("L", "R"):
            if has(f"wing{s}", f"wingTip{s}"):
                a, b = pts[f"wing{s}"], pts[f"wingTip{s}"]
                for i in range(2):
                    add_bone(f"wing{s}{i + 1}", a + (b - a) * i / 2, a + (b - a) * (i + 1) / 2)
    has_fan = sid == "wind-04" and "hub" in pts
    if has_fan:
        add_bone("fan", pts["hub"], pts["hub"] + Vector((0, -0.12 * S, 0)))
    tail_names = sorted(n for n in defs if n.startswith("tail"))
    wing_names = {s: sorted(n for n in defs if n.startswith(f"wing{s}")) for s in ("L", "R")}
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
    return arm, sorted(defs)


def voxel_proxy(context, src_obj, voxel_size):
    tmp = src_obj.copy()
    tmp.data = src_obj.data.copy()
    context.scene.collection.objects.link(tmp)
    mod = tmp.modifiers.new("VX", "REMESH")
    mod.mode = "VOXEL"
    mod.voxel_size = voxel_size
    deps = context.evaluated_depsgraph_get()
    deps.update()
    ev = tmp.evaluated_get(deps)
    pm = bpy.data.meshes.new_from_object(ev)
    proxy = bpy.data.objects.new("proxy", pm)
    context.scene.collection.objects.link(proxy)
    bpy.data.objects.remove(tmp, do_unlink=True)
    return proxy


def main():
    sid, src, lm_path, out = parse_args()
    os.makedirs(out, exist_ok=True)
    decided = []
    spec = json.load(open(lm_path, encoding="utf-8"))["landmarks"][sid]
    t = spec.get("type", "A")
    pts = {k: V(v["pos"]) for k, v in spec["points"].items()}
    ctx = bpy.context
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(src, f"{sid}.glb"))
    mesh = next(o for o in bpy.data.objects if o.type == "MESH")
    bpts = [mesh.matrix_world @ Vector(c) for c in mesh.bound_box]
    lo = Vector([min(p[i] for p in bpts) for i in range(3)])
    hi = Vector([max(p[i] for p in bpts) for i in range(3)])
    ctr = (lo + hi) / 2
    S = max(hi - lo)
    Sz = hi.z - lo.z
    def snap(tag):
        print(f"[bisect] {tag}: {sorted((o.name, o.type) for o in bpy.data.objects)}", flush=True)
        for o in bpy.data.objects:
            if o.type == "ARMATURE":
                print(f"[bisect] {tag} bones {o.name}: {[b.name for b in o.data.bones]}", flush=True)
    snap("post-import")
    arm, bones = build_armature(sid, t, pts, lo, hi, ctr, S, Sz, decided)
    snap("post-armature")
    try:
        dec_bones = json.load(open(os.path.join(out, "decision.json"), encoding="utf-8"))["bones"]
        print(f"[heat] {sid} bones-match={sorted(dec_bones) == bones}", flush=True)
    except OSError:
        print(f"[heat] {sid} bones-match=(decision 없음)", flush=True)
    print(f"[heat] {sid} type={t} bones={bones} Sz={Sz:.4f}", flush=True)

    proxy, used_vs, fails = None, None, []
    for div in (80, 60, 40):
        vs = Sz / div
        print(f"[heat] {sid} voxel 1/{div} (size={vs:.5f}) 시도", flush=True)
        try:
            cand = voxel_proxy(ctx, mesh, vs)
        except Exception as e:  # noqa: BLE001
            msg = f"remesh 실패: {e}"
            print(f"[heat] {sid} voxel 1/{div} FAIL {msg}", flush=True)
            fails.append(f"1/{div}: {msg}")
            continue
        nv = len(cand.data.vertices)
        print(f"[heat] {sid} voxel 1/{div} proxy_verts={nv}", flush=True)
        for o in (mesh, arm):
            o.select_set(False)
        cand.select_set(True)
        arm.select_set(True)
        ctx.view_layer.objects.active = arm
        try:
            bpy.ops.object.parent_set(type="ARMATURE_AUTO")
            err = ""
        except Exception as e:  # noqa: BLE001
            err = str(e)
        ms = mean_wsum(cand)
        ng = len(cand.vertex_groups)
        if err or ms < 0.5:
            msg = err if err else f"웨이트 합 평균 {ms:.3f} < 0.5 (groups={ng})"
            print(f"[heat] {sid} voxel 1/{div} FAIL {msg}", flush=True)
            fails.append(f"1/{div}: {msg}")
            bpy.data.objects.remove(cand, do_unlink=True)
            continue
        proxy, used_vs = cand, vs
        print(f"[heat] {sid} voxel 1/{div} OK mean_wsum={ms:.3f} groups={ng}", flush=True)
        snap(f"post-heat-1/{div}")
        break
    if proxy is None:
        print(f"[heat] {sid} HEAT-FAIL", flush=True)
        for f in fails:
            print(f"[heat] {sid} fail-hist {f}", flush=True)
        return

    for o in (mesh, arm, proxy):
        o.select_set(False)
    mesh.select_set(True)
    ctx.view_layer.objects.active = mesh
    dt = mesh.modifiers.new("DT", "DATA_TRANSFER")
    dt.object = proxy
    dt.use_vert_data = True
    dt.data_types_verts = {"VGROUP_WEIGHTS"}
    dt.vert_mapping = "POLYINTERP_NEAREST"  # nearest face interpolated (5.x 명칭)
    # src ALL → dst NAME(기본값). 빈 그룹을 미리 만들어 둔다.
    for b in bones:
        mesh.vertex_groups.new(name=b)
    try:
        bpy.ops.object.modifier_apply(modifier=dt.name)
        err = ""
    except Exception as e:  # noqa: BLE001
        err = str(e)
    ms = mean_wsum(mesh)
    ng = len(mesh.vertex_groups)
    if err or ms < 0.5 or ng == 0:
        msg = err if err else f"전송 후 합 평균 {ms:.3f}, groups={ng}"
        print(f"[heat] {sid} TRANSFER-FAIL {msg}", flush=True)
        return
    print(f"[heat] {sid} transfer OK mean_wsum={ms:.3f} groups={ng}", flush=True)
    snap("post-transfer")
    names = {g.index: g.name for g in mesh.vertex_groups}
    per = {}
    for v in mesh.data.vertices:
        for g in v.groups:
            if g.weight > 0.5:
                per[names[g.group]] = per.get(names[g.group], 0) + 1
    for b in bones:
        print(f"[heat] {sid} bone {b} heat50={per.get(b, 0)}", flush=True)

    bpy.data.objects.remove(proxy, do_unlink=True)
    mod = mesh.modifiers.new("RIG", "ARMATURE")
    mod.object = arm
    mesh.parent = arm
    for o in bpy.data.objects:
        o.select_set(o in (mesh, arm))
    snap("pre-export")
    print(f"[bisect] selected: {[o.name for o in bpy.data.objects if o.select_get()]}", flush=True)
    ctx.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(out, f"{sid}-heat.glb"), export_format="GLB",
        use_selection=True, export_skins=True, export_morph=False)
    print(f"[heat] {sid} DONE voxel={used_vs:.5f}", flush=True)


main()
