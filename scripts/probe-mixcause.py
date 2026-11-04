# 4차 보완 2차 항목 1: mix 찢어짐 원인 진단 (수정 전 실행).
#   blender --background --factory-startup --python-exit-code 1 --python scripts/probe-mixcause.py -- \
#     --src scratch/rig-types --ids fire-05,water-02 --lm scratch/landmarks/landmarks-3d.json --pose arm-spread
# - <id>-heat.glb vs <id>-mix.glb(현행), 동일 포즈 평가 후 비교.
# - mix 정점 -> heat 정점은 rest 위치 KDTree 최근접 매칭.
# - 종별 scratch/rig-types/<id>/mixcause.log 기록.
import json
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector, kdtree  # noqa: E402

import rig_poses  # noqa: E402
import rig_region  # noqa: E402

TOPN = 20


def parse_args():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    o = dict(zip(args[::2], args[1::2]))
    return (os.path.abspath(o["--src"]), o["--ids"].split(","),
            o["--lm"], o.get("--pose", "arm-spread"))


def load_pose(d, sid, fname, tag, spec):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(d, fname))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    mesh = max([o for o in bpy.data.objects if o.type == "MESH"],
               key=lambda o: len(o.data.vertices))
    mw = mesh.matrix_world.copy()
    t = spec.get("type", "A")
    pts = {k: Vector(v["pos"]) for k, v in spec["points"].items()}
    spans = {k: float(v.get("span", 0.0)) for k, v in spec["points"].items()}
    bb = [mw @ Vector(c) for c in mesh.bound_box]
    lo = Vector([min(p[i] for p in bb) for i in range(3)])
    hi = Vector([max(p[i] for p in bb) for i in range(3)])
    ctr = (lo + hi) / 2
    S = max(hi - lo)
    Sz = hi.z - lo.z
    segs, RR, _fan = rig_region.build(sid, t, pts, spans, S, Sz, lo, ctr)
    rest_co = [v.co.copy() for v in mesh.data.vertices]
    rig_poses.reset_pose(arm)
    rig_poses.apply_pose(arm, tag, pts, Sz, "new")
    deps = bpy.context.evaluated_depsgraph_get()
    deps.update()
    ev = mesh.evaluated_get(deps)
    posed_co = [ev.data.vertices[i].co.copy() for i in range(len(rest_co))]
    names = {g.index: g.name for g in mesh.vertex_groups}
    w = []
    for v in mesh.data.vertices:
        dd = {}
        for g in v.groups:
            if g.weight > 0.0:
                dd[names[g.group]] = g.weight
        w.append(dd)
    edges = [(e.vertices[0], e.vertices[1]) for e in mesh.data.edges]
    return {"rest": rest_co, "posed": posed_co, "w": w, "edges": edges,
            "segs": segs, "RR": RR, "Sz": Sz, "mw": mw}


def l1(a, b):
    s = 0.0
    for k in set(a) | set(b):
        s += abs(a.get(k, 0.0) - b.get(k, 0.0))
    return s


def top3(dd):
    return sorted(dd.items(), key=lambda kv: -kv[1])[:3]


def dom(dd):
    return max(dd, key=dd.get) if dd else "NONE"


def main():
    src, ids, lm_path, tag = parse_args()
    lm = json.load(open(lm_path, encoding="utf-8"))["landmarks"]
    for sid in ids:
        d = os.path.join(src, sid)
        spec = lm[sid]
        H = load_pose(d, sid, f"{sid}-heat.glb", tag, spec)
        M = load_pose(d, sid, f"{sid}-mix.glb", tag, spec)
        lines = []
        L = lines.append
        L(f"[mixcause] {sid} {tag} nvert heat={len(H['rest'])} "
          f"mix={len(M['rest'])} Sz={M['Sz']:.6f}")
        kd = kdtree.KDTree(len(H["rest"]))
        for i, c in enumerate(H["rest"]):
            kd.insert(c, i)
        kd.balance()
        match, mdist = [], 0.0
        for c in M["rest"]:
            _co, idx, dist = kd.find(c)
            match.append(idx)
            mdist = max(mdist, dist)
        L(f"[mixcause] {sid} match maxdist={mdist:.3e}")
        bl = [x for x in ("armL", "armR") if x in M["segs"]]
        amask = []
        for c in M["rest"]:
            p = M["mw"] @ c
            ms = {}
            for b in bl:
                sa, sb = M["segs"][b]
                ms[b] = rig_region.mask_limb(p, sa, sb, M["RR"][b])
            amask.append(ms)
        union = [max(ms.values()) if ms else 0.0 for ms in amask]

        def cls(m):
            if m <= 0.0:
                return "OUT"
            if m >= 1.0 - 1e-9:
                return "IN"
            return "BAND"

        cl = [cls(m) for m in union]

        def ratios(D):
            r = []
            for (u, v) in D["edges"]:
                r0 = (D["rest"][u] - D["rest"][v]).length
                r1 = (D["posed"][u] - D["posed"][v]).length
                r.append(r1 / r0 if r0 > 1e-12 else 1.0)
            return r

        rm = ratios(M)
        rest_len = [(M["rest"][u] - M["rest"][v]).length
                    for (u, v) in M["edges"]]
        order = sorted(range(len(rm)), key=lambda i: rest_len[i])
        keep = set(order[int(len(order) * 0.10):])
        kept_sorted = sorted(keep, key=lambda i: -rm[i])
        L(f"[mixcause] {sid} mix max(kept)={rm[kept_sorted[0]]:.4f} "
          f"edge={kept_sorted[0]} (csv 대조용)")
        hpair = {}
        rh = ratios(H)
        for i, (u, v) in enumerate(H["edges"]):
            hpair[(min(u, v), max(u, v))] = rh[i]
        L(f"[mixcause] {sid} TOP{TOPN} mix worst edges:")
        for rank, ei in enumerate(kept_sorted[:TOPN]):
            u, v = M["edges"][ei]
            hu, hv = match[u], match[v]
            hr = hpair.get((min(hu, hv), max(hu, hv)), None)
            hrs = f"{hr:.4f}" if hr is not None else "-"
            L(f"  #{rank + 1} edge={ei} restlen={rest_len[ei]:.6f} "
              f"mix_q={rm[ei]:.4f} heat_q={hrs}")
            for vi, hv_i in ((u, hu), (v, hv)):
                ms = " ".join(f"{b}={amask[vi][b]:.3f}" for b in bl)
                mt = " ".join(f"{b}:{w:.3f}" for b, w in top3(M["w"][vi]))
                ht = " ".join(f"{b}:{w:.3f}" for b, w in top3(H["w"][hv_i]))
                L(f"    mixv={vi} cls={cl[vi]} masks[{ms}] "
                  f"heatv={hv_i} mix[{mt}] heat[{ht}]")
        for c in ("IN", "BAND", "OUT"):
            idx = [i for i in range(len(M["rest"])) if cl[i] == c]
            if not idx:
                L(f"[mixcause] {sid} class {c}: n=0")
                continue
            dhm = sum(l1(M["w"][i], H["w"][match[i]]) for i in idx) / len(idx)
            L(f"[mixcause] {sid} class {c}: n={len(idx)} "
              f"meanL1(mix,heat)={dhm:.4f}")
        out = [i for i in range(len(M["rest"])) if cl[i] == "OUT"]
        if out:
            def armw(W, i, use_match):
                j = match[i] if use_match else i
                return sum(w for b, w in W[j].items() if b.startswith("arm"))

            nz_m = sum(1 for i in out if armw(M["w"], i, False) > 1e-6)
            nz_h = sum(1 for i in out if armw(H["w"], i, True) > 1e-6)
            mu_m = sum(armw(M["w"], i, False) for i in out) / len(out)
            mu_h = sum(armw(H["w"], i, True) for i in out) / len(out)
            L(f"[mixcause] {sid} OUT n={len(out)} armw>1e-6: "
              f"mix={nz_m} heat={nz_h} mean_armw: mix={mu_m:.5f} "
              f"heat={mu_h:.5f}")
            dm = Counter(dom(M["w"][i]) for i in out)
            dh = Counter(dom(H["w"][match[i]]) for i in out)
            L(f"[mixcause] {sid} OUT dominant mix: {dm.most_common(8)}")
            L(f"[mixcause] {sid} OUT dominant heat: {dh.most_common(8)}")
        chg = {"IN": 0, "BAND": 0, "OUT": 0}
        tot = {"IN": 0, "BAND": 0, "OUT": 0}
        for i in range(len(M["rest"])):
            tot[cl[i]] += 1
            if dom(M["w"][i]) != dom(H["w"][match[i]]):
                chg[cl[i]] += 1
        L("[mixcause] %s dominant changed mix!=heat: %s" % (
            sid, " ".join(f"{c}={chg[c]}/{tot[c]}"
                          for c in ("IN", "BAND", "OUT"))))
        stat = defaultdict(lambda: [0, 0.0, 0.0])
        for (u, v) in M["edges"]:
            key = "+".join(sorted((cl[u], cl[v])))
            s = stat[key]
            s[0] += 1
            s[1] += l1(M["w"][u], M["w"][v])
            s[2] += l1(H["w"][match[u]], H["w"][match[v]])
        L(f"[mixcause] {sid} edge endpoint-L1 by class pair (n, mix, heat):")
        for key in sorted(stat):
            n, sm, sh = stat[key]
            L(f"  {key}: n={n} mix={sm / n:.4f} heat={sh / n:.4f}")
        L(f"[mixcause] {sid} DONE")
        with open(os.path.join(d, "mixcause.log"), "w", encoding="utf-8") as fp:
            fp.write("\n".join(lines) + "\n")
        for ln in lines:
            print(ln, flush=True)
    print("[mixcause] DONE", flush=True)


main()
