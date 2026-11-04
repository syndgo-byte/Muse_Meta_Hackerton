# 4차 보고서 표 생성 (임시)
import csv

rows = list(csv.DictReader(open("scratch/rig-types/summary-mix.csv", encoding="utf-8")))
print("rows:", len(rows))
idx = {(r["species"], r["method"], r["pose"]): r for r in rows}


def cell(r):
    if r is None:
        return "-"
    s = f"{float(r['max_ratio']):.1f}/{r['n_over25']}/{float(r['p99']):.2f}/{float(r['stretch_h']):.1f}"
    sp = r["spread"]
    return s + (f"/{float(sp):.3f}" if sp else "/-")


seven = ["wind-05", "fire-03", "rock-03", "fire-05", "water-04", "water-02", "fire-01"]
for sid in seven:
    poses = sorted({p for (s, m, p) in idx if s == sid})
    for p in poses:
        b = cell(idx.get((sid, "base", p)))
        h = cell(idx.get((sid, "heat", p)))
        m = cell(idx.get((sid, "mix", p)))
        print(f"{sid} {p} base={b} heat={h} mix={m}")
