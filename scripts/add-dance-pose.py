# 5차: dance-test가 없는 decision.json에 추가 (uniform, 17종).
import glob
import json

for p in sorted(glob.glob("scratch/rig-types/*/decision.json")):
    r = json.load(open(p, encoding="utf-8"))
    if "dance-test" not in r.get("poses", []):
        r["poses"].append("dance-test")
        json.dump(r, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print("added", p)
print("DONE")
