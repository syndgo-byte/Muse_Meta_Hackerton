# 4차 보완 2차 보고용 표 + 게이트 판정.
# - 최종: summary-mix3.csv (mix 40행 + fallback-heat 7행 + base 47행 + heat 47행).
# - 2a 기록: summary-mix3-2a.csv. 이전: summary-mix2.csv.
import csv

NEW = "scratch/rig-types/summary-mix3.csv"
A2 = "scratch/rig-types/summary-mix3-2a.csv"
OLD = "scratch/rig-types/summary-mix2.csv"
OUT = "scratch/rig-types/report-4thc.txt"
IDS = ["wind-05", "fire-03", "rock-03", "fire-05", "water-04", "water-02", "fire-01"]


def load(p):
    d, order = {}, {}
    with open(p, encoding="utf-8") as fp:
        for r in csv.DictReader(fp):
            d[(r["species"], r["method"], r["pose"])] = r
            order.setdefault(r["species"], [])
            if r["pose"] not in order[r["species"]]:
                order[r["species"]].append(r["pose"])
    return d, order


new, order = load(NEW)
a2, _ = load(A2)
old, _ = load(OLD)


def cell(r):
    sp = r["spread"] if r["spread"] else "-"
    return (f"{float(r['max_ratio']):.1f}/{r['n_over25']}/"
            f"{float(r['p99']):.2f}/{float(r['stretch_h']):.1f}/{sp}")


def meth(sid):
    return "fallback-heat" if sid == "fire-05" else "mix"


L = []
L.append(f"rows_new={len(new)}")
L.append("== gate: mix/fallback rows max<=20 and spread<=0.02 ==")
fails = []
for sid in IDS:
    for p in order[sid]:
        r = new[(sid, meth(sid), p)]
        mx = float(r["max_ratio"])
        sp = float(r["spread"]) if r["spread"] else None
        if mx > 20:
            fails.append(f"{sid} {p} max={r['max_ratio']}")
        if sp is not None and sp > 0.02:
            fails.append(f"{sid} {p} spread={r['spread']}")
if fails:
    L.append("GATE: FAIL")
    L.extend("  " + f for f in fails)
else:
    L.append("GATE: PASS (47/47 rows)")
L.append("== gate arm-spread subset ==")
sfails = []
for sid in IDS:
    if "arm-spread" not in order[sid]:
        continue
    r = new[(sid, meth(sid), "arm-spread")]
    if float(r["max_ratio"]) > 20:
        sfails.append(f"{sid} arm-spread max={r['max_ratio']}")
L.append("SUBSET: " + ("FAIL " + str(sfails) if sfails else "PASS (5/5)"))
L.append("== mix max v2 -> 2a -> final (heat ref) ==")
for sid in IDS:
    for p in order[sid]:
        h = new[(sid, "heat", p)]["max_ratio"]
        vo = old[(sid, "mix", p)]["max_ratio"]
        va = a2[(sid, "mix", p)]["max_ratio"]
        vf = new[(sid, meth(sid), p)]["max_ratio"]
        tag = " [fallback]" if sid == "fire-05" else ""
        L.append(f"{sid} {p}: heat={h} v2={vo} -> 2a={va} -> final={vf}{tag}")
L.append("== full final table (base/heat/mix-or-fallback) ==")
for sid in IDS:
    for p in order[sid]:
        b = cell(new[(sid, "base", p)])
        h = cell(new[(sid, "heat", p)])
        m = cell(new[(sid, meth(sid), p)])
        tag = "FB" if sid == "fire-05" else "mix"
        L.append(f"{sid} {p}: base {b} | heat {h} | {tag} {m}")
open(OUT, "w", encoding="utf-8").write("\n".join(L) + "\n")
print(f"DONE {OUT}")
