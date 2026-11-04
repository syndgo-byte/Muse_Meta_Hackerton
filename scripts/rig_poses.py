# 공유 포즈 적용: rig-type.py / rig-pose-render.py / rig-tear.py 공용.
# - reset_pose/world_rot은 rig-type.py와 동일식.
# - arm-spread new: 손끝이 몸 중심선(X=0)에서 멀어지는 부호(종마다 계산) +
#   손끝 높이 > 어깨 높이 + 팔 길이*0.5 이면 각도 절반씩 축소.
# - dance-test: 한쪽 arm-raise + twist 0.4 + 반대쪽 foot-lift + hip 높이 -5% Sz.
#   팔은 armL 우선(없으면 armR, 둘 다 없으면 생략). 다리는 반대쪽 우선.
#   hip은 마지막에 적용해 서브트리 통째로 내린다(rigid-follow).
import math

from mathutils import Matrix, Vector

SPREAD_ANGLE = 1.2


def reset_pose(arm):
    # pb.matrix 직접 쓰기는 depsgraph 갱신을 안 타서(4차 측정 버그) 채널로만 건든다.
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)


def world_rot(pb, axis, angle):
    # 뼈 머리 기준 월드축 회전. 부모가 정지 상태라는 전제(현 포즈 전부 만족).
    arm = pb.id_data
    R = Matrix.Rotation(angle, 4, axis).to_quaternion()
    if pb.parent is not None:
        P = (arm.matrix_world @ pb.parent.bone.matrix_local).to_quaternion()
    else:
        P = arm.matrix_world.to_quaternion()
    pb.rotation_mode = "QUATERNION"
    pb.rotation_quaternion = P.inverted() @ R @ P


def _rot_y(v, th):
    c, s = math.cos(th), math.sin(th)
    return Vector((v.x * c + v.z * s, v.y, -v.x * s + v.z * c))


def arm_spread_sign(S, H, legacy_sign):
    base = H - S
    ax = {}
    for sgn in (1.0, -1.0):
        tip = S + _rot_y(base, sgn * SPREAD_ANGLE)
        ax[sgn] = abs(tip.x)
    if abs(ax[1.0] - ax[-1.0]) < 1e-9:
        return legacy_sign
    return 1.0 if ax[1.0] > ax[-1.0] else -1.0


def apply_arm_spread(arm, pts=None, mode="new"):
    """pts: {이름: Vector} 랜드마크. 없으면 뼈 head/tail로 대체한다."""
    info = {}
    for a, legacy in (("armL", -1.0), ("armR", 1.0)):
        if a not in arm.pose.bones:
            continue
        side = a[-1]
        S = pts.get(f"shoulder{side}") if pts else None
        H = pts.get(f"hand{side}") if pts else None
        if S is None or H is None:
            b = arm.data.bones[a]
            S, H = Vector(b.head_local), Vector(b.tail_local)
            print(f"[pose-spread] {a}: 랜드마크 없음, 뼈 사용", flush=True)
        S, H = Vector(S), Vector(H)
        seglen = (H - S).length
        if mode == "old":
            ang = legacy * SPREAD_ANGLE
        else:
            ang = arm_spread_sign(S, H, legacy) * SPREAD_ANGLE
            lim = S.z + 0.5 * seglen
            tip = S + _rot_y(H - S, ang)
            while tip.z > lim and abs(ang) > 0.1:
                ang *= 0.5
                tip = S + _rot_y(H - S, ang)
        world_rot(arm.pose.bones[a], "Y", ang)
        tip = S + _rot_y(H - S, ang)
        info[a] = (abs(H.x), H.z, abs(tip.x), tip.z, ang)
        print(f"[pose-spread] {a} rest|x|={abs(H.x):.4f} rest_z={H.z:.4f} -> "
              f"posed|x|={abs(tip.x):.4f} posed_z={tip.z:.4f} angle={ang:.3f}", flush=True)
    return info


def apply_dance(arm, Sz):
    pb = arm.pose.bones
    bones = set(pb.keys())
    if "armL" in bones:
        arm_side, leg_side = "L", "R"
    elif "armR" in bones:
        arm_side, leg_side = "R", "L"
    else:
        arm_side, leg_side = None, None
    if arm_side:
        world_rot(pb[f"arm{arm_side}"], "X", -0.6)
    if "spine" in bones:
        world_rot(pb["spine"], "Z", 0.4)
    leg = None
    if leg_side and f"leg{leg_side}" in bones:
        leg = f"leg{leg_side}"
    elif arm_side and f"leg{arm_side}" in bones:
        leg = f"leg{arm_side}"
    elif "legL" in bones:
        leg = "legL"
    elif "legR" in bones:
        leg = "legR"
    if leg:
        world_rot(pb[leg], "X", -0.8)
    if "hip" in bones:
        pb["hip"].location = (0, 0, -0.05 * Sz)
    aname = f"arm{arm_side}" if arm_side else "-"
    print(f"[pose-dance] arm={aname} leg={leg or '-'} twist=0.4 hip_dz={-0.05 * Sz:.4f}", flush=True)
    return aname, leg


def apply_pose(arm, tag, pts=None, Sz=1.0, spread_mode="new"):
    pb = arm.pose.bones
    bones = set(pb.keys())
    if tag == "rest":
        return
    if tag == "twist":
        if "spine" in bones:
            world_rot(pb["spine"], "Z", 0.6)
    elif tag == "bend":
        if "spine" in bones:
            world_rot(pb["spine"], "X", 0.4)
    elif tag == "arm-raise":
        for a in ("armL", "armR"):
            if a in bones:
                world_rot(pb[a], "X", -0.6)
    elif tag == "arm-spread":
        apply_arm_spread(arm, pts, spread_mode)
    elif tag == "foot-lift":
        if "legL" in bones:
            world_rot(pb["legL"], "X", -0.8)
    elif tag == "tail-swing":
        tails = sorted(b for b in bones if b.startswith("tail"))
        if tails:
            world_rot(pb[tails[0]], "X", 0.6)
    elif tag == "wing-flap":
        wl = sorted(b for b in bones if b.startswith("wingL"))
        wr = sorted(b for b in bones if b.startswith("wingR"))
        if wl and wr:
            world_rot(pb[wl[0]], "Y", -0.8)
            world_rot(pb[wr[0]], "Y", 0.8)
    elif tag == "fan-08":
        if "fan" in bones:
            world_rot(pb["fan"], "Y", 0.8)
    elif tag == "fan-16":
        if "fan" in bones:
            world_rot(pb["fan"], "Y", 1.6)
    elif tag == "dance-test":
        apply_dance(arm, Sz)
