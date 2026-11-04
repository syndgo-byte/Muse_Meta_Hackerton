# 4차 1번: mix 웨이트 (사지 heat×영역마스크 + 몸통 heat, 재정규화).
#   blender --background --factory-startup --python-exit-code 1 --python scripts/rig-mix.py -- \
#     --src scratch/rig-types --id <종> --lm scratch/landmarks/landmarks-3d.json
# - 입력: <id>-heat.glb (히트 웨이트). 출력: <id>-mix.glb.
# - 합 0 정점은 가장 가까운 몸통 뼈에 1.
# - 4차 보완: 마스크 감쇠 [1.3R, 1.8R] (rig_region). 경계 정점(사지 마스크가
#   0<m<1인 뼈를 하나라도 가진 정점)은 자신+1-ring 이웃의 마스크 적용 웨이트
#   평균으로 교체한 뒤 재정규화한다.
# - 4차 보완 2차: 마스크 감쇠 [1.3R, 2.2R]. 경계 평균을 2회 연속 적용한다
#   (2회차는 1회차 결과 위에서 평균, 경계 집합은 마스크 기준 동일).
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import rig_region  # noqa: E402

LIMB_PREFIX = ("arm", "leg", "tail", "wing")


def parse_args():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    o = dict(zip(args[::2], args[1::2]))
    return o["--id"], os.path.abspath(o["--src"]), o["--lm"]


def main():
    sid, src, lm_path = parse_args()
    d = os.path.join(src, sid)
    spec = json.load(open(lm_path, encoding="utf-8"))["landmarks"][sid]
    t = spec.get("type", "A")
    pts = {k: Vector(v["pos"]) for k, v in spec["points"].items()}
    spans = {k: float(v.get("span", 0.0)) for k, v in spec["points"].items()}
    ctx = bpy.context
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(d, f"{sid}-heat.glb"))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    mesh = max(meshes, key=lambda o: len(o.data.vertices))
    bones = [b.name for b in arm.data.bones]
    mw = mesh.matrix_world
    bpts = [mw @ Vector(c) for c in mesh.bound_box]
    lo = Vector([min(p[i] for p in bpts) for i in range(3)])
    hi = Vector([max(p[i] for p in bpts) for i in range(3)])
    ctr = (lo + hi) / 2
    S = max(hi - lo)
    Sz = hi.z - lo.z
    segs, RR, fan = rig_region.build(sid, t, pts, spans, S, Sz, lo, ctr)
    tseg = rig_region.torso_segs(t, pts, S, lo, hi, ctr)
    torso_bones = [b for b in ("hip", "spine", "chest", "head") if b in bones]
    names = {g.index: g.name for g in mesh.vertex_groups}
    heat = {}
    for v in mesh.data.vertices:
        for g in v.groups:
            heat.setdefault(names[g.group], {})[v.index] = g.weight
    mask_sum, mask_n = {}, {}
    raw_w = {}
    band = set()
    zero_ct = 0
    verts = list(mesh.data.vertices)
    for v in verts:
        p = mw @ v.co
        ws = {}
        is_band = False
        for b in bones:
            h = heat.get(b, {}).get(v.index, 0.0)
            if b.startswith(LIMB_PREFIX) and b in segs:
                a, bb = segs[b]
                m = rig_region.mask_limb(p, a, bb, RR[b])
                mask_sum[b] = mask_sum.get(b, 0.0) + m
                mask_n[b] = mask_n.get(b, 0) + 1
                if 0.0 < m < 1.0:
                    is_band = True
                w = h * m
            elif b == "fan" and fan is not None:
                m = rig_region.mask_fan(p, fan["hub"], S)
                if 0.0 < m < 1.0:
                    is_band = True
                w = h * m
            else:
                w = h
            if w > 0.0:
                ws[b] = w
        raw_w[v.index] = ws
        if is_band:
            band.add(v.index)
    adj = [[] for _ in verts]
    for e in mesh.data.edges:
        u, wv = e.vertices[0], e.vertices[1]
        adj[u].append(wv)
        adj[wv].append(u)
    vals = {i: dict(ws) for i, ws in raw_w.items()}
    for _ in range(2):
        upd = {}
        for i in band:
            grp = [i] + adj[i]
            acc = {}
            for j in grp:
                for b, w in vals[j].items():
                    acc[b] = acc.get(b, 0.0) + w
            n = len(grp)
            upd[i] = {b: acc[b] / n for b in acc}
        vals.update(upd)
    new_w = {}
    band_ct = len(band)
    for v in verts:
        i = v.index
        ws = vals[i]
        ws = {b: w for b, w in ws.items() if w >= 1e-6}
        tot = sum(ws.values())
        if tot <= 0.0:
            best, bd = torso_bones[0], None
            for b in torso_bones:
                a, bb = tseg[b]
                dd = rig_region.seg_dist(p, a, bb)
                if bd is None or dd < bd:
                    bd, best = dd, b
            ws = {best: 1.0}
            zero_ct += 1
        else:
            for b in ws:
                ws[b] /= tot
        new_w[v.index] = ws
    for g in list(mesh.vertex_groups):
        mesh.vertex_groups.remove(g)
    groups = {b: mesh.vertex_groups.new(name=b) for b in bones}
    for i, ws in new_w.items():
        for b, w in ws.items():
            groups[b].add([i], w, "REPLACE")
    print(f"[mix] {sid} bones={bones}", flush=True)
    for b in sorted(mask_sum):
        print(f"[mix] {sid} mask {b} mean={mask_sum[b] / mask_n[b]:.4f}", flush=True)
    print(f"[mix] {sid} zero-fixed={zero_ct} band-averaged={band_ct} avgpasses=2 verts={len(verts)}", flush=True)
    for o in bpy.data.objects:
        o.select_set(o in (mesh, arm) or (o.type == "EMPTY" and o.name == "world"))
    ctx.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(d, f"{sid}-mix.glb"), export_format="GLB",
        use_selection=True, export_skins=True, export_morph=False)
    print(f"[mix] {sid} DONE", flush=True)


main()
