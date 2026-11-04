# 3차 보고서 표 생성 (임시)
import csv

rows = list(csv.DictReader(open("scratch/rig-types/summary.csv", encoding="utf-8")))


def cell(r):
    return f"{float(r['max_ratio']):.1f}/{r['n_over25']}"


print("=== BASELINE ===")
for r in rows:
    if r["method"] == "base":
        print(r["species"], r["pose"], cell(r))

print("=== COMPARE 7 ===")
seven = ["wind-05", "fire-03", "rock-03", "fire-05", "water-04", "water-02", "fire-01"]
idx = {(r["species"], r["method"], r["pose"]): r for r in rows}
for sid in seven:
    poses = sorted({p for (s, m, p) in idx if s == sid and m == "cyl"})
    for p in poses:
        b = idx.get((sid, "base", p))
        c = idx.get((sid, "cyl", p))
        h = idx.get((sid, "heat", p))
        bs = cell(b) if b else "-"
        cs = cell(c) if c else "-"
        hs = cell(h) if h else "-"
        print(sid, p, "base=" + bs, "cyl=" + cs, "heat=" + hs)
