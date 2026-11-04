# 영역 마스크 (mix 적용 + 번짐 측정 공용). rig-type.py 3차 규칙과 동일식.
# - 팔다리 R: 팔 0.11S, 다리 clamp(0.6span, 0.05S, 0.14S)+좌우평균화, 꼬리/날개 0.13S.
# - 마스크: dist <= 1.3R이면 1, [1.3R, 2.2R]에서 0으로 smoothstep. 평면 항 없음.
#   (4차 보완: 감쇠 0.2R → 0.5R. 4차 보완 2차: 0.5R → 0.9R.
#    mix 생성과 번짐 지표가 같은 정의를 쓴다.)
# - 팬: y-blend × radial(dxz, R=0.30S) 마스크. radial 감쇠도 [1.3R, 2.2R].
import math

from mathutils import Vector

TAIL_SEG = {"A": 2, "B": 3}


def sstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a) if b > a else 1.0))
    return t * t * (3.0 - 2.0 * t)


def seg_dist(p, a, b):
    ab = b - a
    denom = ab.dot(ab)
    t = ((p - a).dot(ab) / denom) if denom > 1e-12 else 0.0
    t = max(0.0, min(1.0, t))
    return (p - (a + ab * t)).length


def leg_R_clamped(spans, S, Sz):
    ref = S if S > 1e-9 else Sz * 0.4
    out = {}
    for nm, tp in (("legL", "footL"), ("legR", "footR")):
        r = 0.6 * spans.get(tp, 0.0)
        if r <= 0.0:
            r = 0.06 * S
        out[nm] = max(0.05 * ref, min(0.14 * ref, r))
    a0, b0 = out["legL"], out["legR"]
    if max(a0, b0) / min(a0, b0) >= 2.0:
        m = (a0 + b0) / 2
        out["legL"] = out["legR"] = m
    return out


def build(sid, t, pts, spans, S, Sz, lo, ctr):
    """(segs {뼈: (a, b)}, R {뼈: 반경}, fan or None)를 돌려준다."""
    segs, R = {}, {}
    W = pts.get("waist", Vector((ctr.x, ctr.y, lo.z + 0.35 * Sz)))
    b_waist = W.z

    def has(a, b):
        return a in pts and b in pts

    if t in ("A", "B"):
        for s in ("L", "R"):
            if has(f"shoulder{s}", f"hand{s}"):
                segs[f"arm{s}"] = (pts[f"shoulder{s}"], pts[f"hand{s}"])
                R[f"arm{s}"] = 0.11 * S
    lr = leg_R_clamped(spans, S, Sz)
    for s in ("L", "R"):
        if f"foot{s}" in pts:
            f = pts[f"foot{s}"]
            segs[f"leg{s}"] = (Vector((f.x, f.y, b_waist)), f)
            R[f"leg{s}"] = lr[f"leg{s}"]
    if t in TAIL_SEG and has("tailBase", "tailTip"):
        n = TAIL_SEG[t]
        a, b = pts["tailBase"], pts["tailTip"]
        for i in range(n):
            nm = f"tail{i + 1}"
            segs[nm] = (a + (b - a) * i / n, a + (b - a) * (i + 1) / n)
            R[nm] = 0.13 * S
    if t == "D":
        for s in ("L", "R"):
            if has(f"wing{s}", f"wingTip{s}"):
                a, b = pts[f"wing{s}"], pts[f"wingTip{s}"]
                for i in range(2):
                    nm = f"wing{s}{i + 1}"
                    segs[nm] = (a + (b - a) * i / 2, a + (b - a) * (i + 1) / 2)
                    R[nm] = 0.13 * S
    fan = None
    if sid == "wind-04" and "hub" in pts:
        fan = {"hub": pts["hub"]}
    return segs, R, fan


def torso_segs(t, pts, S, lo, hi, ctr):
    """몸통 뼈 선분 {이름: (a, b)}. (zero-fallback용)"""
    W = pts.get("waist", Vector((ctr.x, ctr.y, lo.z + 0.35 * (hi.z - lo.z))))
    C = pts.get("chin")
    b_waist = W.z
    b_mid = (W.z + C.z) / 2 if C is not None else W.z + 0.30 * (hi.z - W.z)
    out = {
        "hip": (Vector((W.x, W.y, lo.z)), Vector((W.x, W.y, b_waist))),
        "spine": (Vector((W.x, W.y, b_waist)), Vector((W.x, W.y, b_mid))),
    }
    if t in ("A", "B", "C"):
        ctop = C.z if C is not None else hi.z
        out["chest"] = (Vector((W.x, W.y, b_mid)), Vector((W.x, W.y, ctop)))
    if C is not None:
        out["head"] = (Vector((C.x, C.y, C.z)), Vector((C.x, C.y, C.z + 0.12 * S)))
    return out


def mask_limb(p, a, b, R):
    d = seg_dist(p, a, b)
    if d <= 1.3 * R:
        return 1.0
    return 1.0 - sstep(1.3 * R, 2.2 * R, d)


def mask_fan(p, hub, S):
    sy = sstep(hub.y - 0.12 * S, hub.y - 0.04 * S, p.y)
    if sy <= 0.0:
        return 0.0
    dxz = math.hypot(p.x - hub.x, p.z - hub.z)
    R = 0.30 * S
    m = 1.0 if dxz <= 1.3 * R else 1.0 - sstep(1.3 * R, 2.2 * R, dxz)
    return sy * m
