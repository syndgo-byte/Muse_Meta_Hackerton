# 4차 보완 보고용 표 생성 (summary-mix.csv=구, summary-mix2.csv=신).
import csv

OLD = "scratch/rig-types/summary-mix.csv"
NEW = "scratch/rig-types/summary-mix2.csv"
OUT = "scratch/rig-types/report-4thb.txt"
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


old, _ = load(OLD)
new, order = load(NEW)


def cell(r):
    sp = r["spread"] if r["spread"] else "-"
    return (f"{float(r['max_ratio']):.1f}/{r['n_over25']}/"
            f"{float(r['p99']):.2f}/{float(r['stretch_h']):.1f}/{sp}")


L = []
L.append(f"rows_new={len(new)} rows_old={len(old)}")
L.append("== gate: arm-spread max_ratio, target <= 20 ==")
for sid in ("fire-05", "water-02"):
    h = new[(sid, "heat", "arm-spread")]["max_ratio"]
    mo = old[(sid, "mix", "arm-spread")]["max_ratio"]
    mn = new[(sid, "mix", "arm-spread")]["max_ratio"]
    ok = "PASS" if float(mn) <= 20 else "FAIL"
    L.append(f"{sid} heat={h} mix_old={mo} mix_new={mn} -> {ok}")
L.append("== mix max old -> new (heat ref), all poses ==")
for sid in IDS:
    for p in order[sid]:
        h = new[(sid, "heat", p)]["max_ratio"]
        mo = old[(sid, "mix", p)]["max_ratio"]
        mn = new[(sid, "mix", p)]["max_ratio"]
        L.append(f"{sid} {p}: heat={h} mix {mo} -> {mn}")
L.append("== full new table (base/heat/mix, max/n25/p99/stretch_h/spread) ==")
for sid in IDS:
    for p in order[sid]:
        b = cell(new[(sid, "base", p)])
        h = cell(new[(sid, "heat", p)])
        m = cell(new[(sid, "mix", p)])
        L.append(f"{sid} {p}: base {b} | heat {h} | mix {m}")
open(OUT, "w", encoding="utf-8").write("\n".join(L) + "\n")
print(f"DONE {OUT}")
