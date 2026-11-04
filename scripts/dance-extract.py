#!/usr/bin/env python3
"""Dance motion extraction (MOTION workorder task 3 + 3b, video variant).

Reads (never copies) public/dance/*.mp4 + *.m4a, runs MediaPipe Pose,
maps human joints to the creature's 7 bones (see lib/autoRig.ts), and emits
data-only dance clips under lib/motion/dances/.

Subcommands:
  extract   video -> scratch/dance/<name>-raw.json (33 joints x/y/z/visibility)
  analyze   raw JSON(s) -> scratch/dance/<id>-clip.json (16 keys + stats)
  emit      <id>-clip.json -> lib/motion/dances/{types,ateez,a2o,index}.ts
  figures   clip + raw + video -> scratch/dance/<id>-compare.png + sign check

Run with: scratch/dance-venv/Scripts/python.exe scripts/dance-extract.py ...
Model: scratch/dance/pose_landmarker.task (MediaPipe PoseLandmarker lite,
  https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task)

MediaPipe landmark ids used: 0 nose, 11/12 shoulders (L/R = subject's left/right),
13/14 elbows, 15/16 wrists, 23/24 hips, 25/26 knees, 27/28 ankles.
Screen-side rule (fix 1): a limb seen on video screen-right must appear on
render screen-right (+X = autoRig R bones). The person faces the camera, so
the person's anatomical left drives autoRig armR/legR.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DANCE_DIR = os.path.join(ROOT, "scratch", "dance")
MODEL_PATH = os.path.join(DANCE_DIR, "pose_landmarker.task")

NOSE = 0
SH_L, SH_R = 11, 12
EL_L, EL_R = 13, 14
WR_L, WR_R = 15, 16
HIP_L, HIP_R = 23, 24
KN_L, KN_R = 25, 26
ANK_L, ANK_R = 27, 28

# Spec clamps (MOTION task 3).
ARM_RX_MIN = -1.9
LEG_RX_MAX = 0.6
TORSO_RY_MAX = 0.35
# Extra sanity clamps (noise guard, reported in REPORT.md).
HEAD_RX_MAX = 0.6
HEAD_RZ_MAX = 0.6
TORSO_RX_MAX = 0.5
TORSO_RZ_MAX = 0.5
ARM_RZ_MAX = 1.5
LEG_RZ_MAX = 0.8
SY_MIN, SY_MAX = 0.90, 1.10

EXAGGERATE = 1.3  # point-move emphasis, applied before clamping.


# ---------------------------------------------------------------- extract ---

def cmd_extract(args: argparse.Namespace) -> int:
    import cv2
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    video = args.video
    cap = cv2.VideoCapture(video)
    if not cap.isOpened():
        print(f"ERROR: cannot open {video}", file=sys.stderr)
        return 1
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    nframes = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)

    options = vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=args.model),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=args.num_poses,
        min_pose_detection_confidence=0.5,
        min_pose_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    frames = []
    detected = 0
    with vision.PoseLandmarker.create_from_options(options) as landmarker:
        idx = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            t_ms = int(idx / fps * 1000)
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            try:
                res = landmarker.detect_for_video(mp_image, t_ms)
            except Exception as exc:  # noqa: BLE001 - keep going, mark missing
                print(f"warn: frame {idx}: {exc}", file=sys.stderr)
                frames.append({"i": idx, "t": idx / fps, "pose": None, "poses": []})
                idx += 1
                continue
            poses = getattr(res, "pose_landmarks", None) or []
            allj = []
            for lm in poses[:args.num_poses]:
                allj.append([
                    [float(p.x), float(p.y), float(p.z),
                     float(getattr(p, "visibility", -1.0))]
                    for p in lm
                ])
            if allj:
                detected += 1
            frames.append({"i": idx, "t": idx / fps,
                           "pose": allj[0] if allj else None, "poses": allj})
            idx += 1
            if idx % 100 == 0:
                print(f"  {os.path.basename(video)}: {idx}/{nframes} "
                      f"(detected {detected})", flush=True)
    cap.release()
    out = {
        "meta": {"video": os.path.basename(video), "fps": fps,
                 "nframes": idx, "width": w, "height": h,
                 "duration": idx / fps if fps else 0.0,
                 "detected": detected, "num_poses": args.num_poses},
        "frames": frames,
    }
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f)
    print(f"wrote {args.out}: {idx} frames, {detected} detected "
          f"({100.0 * detected / max(idx, 1):.1f}%)")
    return 0


# ------------------------------------------------------------------ tempo ---

def decode_audio_mono(m4a_path: str, sr: int = 22050) -> "list[float]":
    """Decode .m4a to mono float samples using the venv's imageio-ffmpeg."""
    import imageio_ffmpeg
    exe = imageio_ffmpeg.get_ffmpeg_exe()
    cmd = [exe, "-v", "error", "-i", m4a_path, "-ac", "1", "-ar", str(sr),
           "-f", "f32le", "-acodec", "pcm_f32le", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    import numpy as np
    return np.frombuffer(raw, dtype=np.float32).copy()


def tempo_from_audio(m4a_path: str) -> tuple[float, dict]:
    """BPM from spectral-flux onset autocorrelation, searched in 80..180."""
    import numpy as np
    sr = 22050
    y = decode_audio_mono(m4a_path, sr)
    n_fft, hop = 1024, 256
    win = np.hanning(n_fft)
    n_spec = 1 + (len(y) - n_fft) // hop
    prev: np.ndarray | None = None
    flux = np.zeros(max(n_spec, 0))
    for i in range(n_spec):
        seg = y[i * hop:i * hop + n_fft] * win
        mag = np.abs(np.fft.rfft(seg))
        if prev is not None:
            d = mag - prev
            flux[i] = float(np.sum(d[d > 0] ** 2))
        prev = mag
    flux -= flux.mean()
    ac = np.correlate(flux, flux, mode="full")[len(flux) - 1:]
    ac /= max(ac[0], 1e-9)
    fps = sr / hop  # onset-envelope frames per second
    lo, hi = int(fps * 60 / 180), int(fps * 60 / 80)
    seg = ac[lo:hi + 1]
    order = np.argsort(seg)[::-1]
    best = lo + int(order[0])
    bpm = 60.0 * fps / best
    cands = [round(60.0 * fps / (lo + int(o)), 1) for o in order[:3]]
    return bpm, {"method": "audio-onset-autocorr", "file": os.path.basename(m4a_path),
                 "candidates": cands, "strength": round(float(seg[order[0]]), 3)}


def tempo_from_hips(times: "Any", hip_y: "Any") -> tuple[float | None, dict]:
    """BPM from hip-height local autocorr maxima (80..180).

    Returns (None, info) when no local maximum clears 0.15: a global argmax
    on a monotonic-decay curve would just pick the search edge (wrong).
    """
    import numpy as np
    from scipy.interpolate import interp1d
    t = np.asarray(times, float)
    y = np.asarray(hip_y, float)
    m = np.isfinite(y)
    f = interp1d(t[m], y[m], kind="linear", fill_value="extrapolate")
    fs = 60.0
    tu = np.arange(t[0], t[-1], 1 / fs)
    yu = f(tu)
    k = int(fs * 4.0)  # 4 s moving-average detrend
    trend = np.convolve(yu, np.ones(k) / k, mode="same")
    d = yu - trend
    ac = np.correlate(d, d, mode="full")[len(d) - 1:]
    ac /= max(ac[0], 1e-9)
    lo, hi = int(fs * 60 / 180), int(fs * 60 / 80)
    peaks = []
    for lag in range(lo + 1, hi):
        if ac[lag] > ac[lag - 1] and ac[lag] >= ac[lag + 1] and ac[lag] > 0.15:
            peaks.append((float(ac[lag]), lag))
    peaks.sort(reverse=True)
    info = {"method": "hip-height-periodicity",
            "candidates": [round(60.0 * fs / lag, 1) for _, lag in peaks[:3]],
            "strength": round(peaks[0][0], 3) if peaks else 0.0}
    if not peaks:
        return None, info
    return 60.0 * fs / peaks[0][1], info


def tempo_from_accents(raw: dict) -> tuple[float, dict]:
    """Fallback BPM: median interval of motion-envelope accent peaks."""
    import numpy as np
    from scipy.signal import find_peaks
    fps = raw["meta"]["fps"]
    smooth, _ = joint_motion(raw)
    k = max(int(fps * 0.12), 3)
    env = np.convolve(smooth, np.ones(k) / k, mode="same")
    peaks, _ = find_peaks(env, prominence=env.std() * 0.5,
                          distance=int(fps * 0.25))
    iv = np.diff(np.asarray(peaks, float) / fps)
    iv = iv[(iv > 0.25) & (iv < 1.0)]
    med = float(np.median(iv)) if len(iv) else 0.5
    bpm = 60.0 / med
    return bpm, {"method": "motion-accent-intervals", "n_accents": int(len(peaks)),
                 "n_intervals": int(len(iv)), "median_iv": round(med, 3),
                 "strength": round(float(len(iv)) / max(len(peaks), 1), 3)}


def torso_brightness(gray: "Any", P: "Any") -> float:
    """Mean grayscale (0..255) inside the shoulder/hip quad."""
    import cv2
    import numpy as np
    P = np.asarray(P, float)
    h, w = gray.shape[:2]
    poly = (P[[SH_L, SH_R, HIP_R, HIP_L]][:, :2] * [w, h]).astype(int)
    mask = np.zeros((h, w), np.uint8)
    cv2.fillPoly(mask, [poly], 1)
    m = mask > 0
    return float(gray[m].mean()) if m.any() else 128.0


def _frame_poses(fr: dict) -> list:
    """Pose list for a frame (new 'poses' or legacy single 'pose')."""
    if fr.get("poses"):
        return [p for p in fr["poses"] if p is not None]
    return [fr["pose"]] if fr.get("pose") is not None else []


def cmd_retrack(args: argparse.Namespace) -> int:
    """Follow ONE person (the darker/black-clothed one) across frames.

    num_poses=2 raw in, single-pose raw out. Per 2-pose frame: darker torso
    wins; if brightness differs by < 15, the hip-center x nearer the previous
    frame's wins instead.
    """
    import cv2
    import numpy as np
    with open(args.input, encoding="utf-8") as f:
        raw = json.load(f)
    cap = cv2.VideoCapture(args.video)
    counts = {"brightness": 0, "position": 0, "single": 0, "none": 0}
    prev_hipx: float | None = None
    out_frames = []
    for fr in raw["frames"]:
        cap.set(cv2.CAP_PROP_POS_FRAMES, fr["i"])
        ok, img = cap.read()
        poses = _frame_poses(fr)
        if not ok or not poses:
            out_frames.append({"i": fr["i"], "t": fr["t"], "pose": None,
                               "poses": [], "track": {"method": "none", "b": []}})
            counts["none"] += 1
            continue
        if len(poses) == 1:
            P = np.asarray(poses[0], float)
            prev_hipx = float((P[HIP_L][0] + P[HIP_R][0]) / 2)
            out_frames.append({"i": fr["i"], "t": fr["t"], "pose": poses[0],
                               "poses": [], "track": {"method": "single", "b": []}})
            counts["single"] += 1
            continue
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        P0 = np.asarray(poses[0], float)
        P1 = np.asarray(poses[1], float)
        b = [torso_brightness(gray, P0), torso_brightness(gray, P1)]
        hx = [float((P[HIP_L][0] + P[HIP_R][0]) / 2) for P in (P0, P1)]
        if abs(b[0] - b[1]) >= 15 or prev_hipx is None:
            pick = 0 if b[0] <= b[1] else 1
            method = "brightness"
        else:
            pick = 0 if abs(hx[0] - prev_hipx) <= abs(hx[1] - prev_hipx) else 1
            method = "position"
        prev_hipx = hx[pick]
        counts[method] += 1
        out_frames.append({"i": fr["i"], "t": fr["t"], "pose": poses[pick],
                           "poses": [],
                           "track": {"method": method,
                                     "b": [round(b[0], 1), round(b[1], 1)]}})
    cap.release()
    meta = dict(raw["meta"])
    meta["retracked_from"] = os.path.basename(args.input)
    meta["retrack_counts"] = counts
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "frames": out_frames}, f)
    n2 = counts["brightness"] + counts["position"]
    print(f"  retrack {meta['video']}: 2-pose frames={n2} "
          f"(brightness {counts['brightness']}, position {counts['position']}), "
          f"single={counts['single']}, none={counts['none']}")
    print(f"wrote {args.out}")
    return 0


def cmd_audit(args: argparse.Namespace) -> int:
    """How many old-1-pose frames tracked the beige (non-black) person?

    Brightness threshold comes from the retracked raw's clear 2-pose frames
    (midpoint of darker/lighter medians); each old pose is classified alone.
    """
    import cv2
    import numpy as np
    with open(args.old, encoding="utf-8") as f:
        old = json.load(f)
    with open(args.tracked, encoding="utf-8") as f:
        tracked = json.load(f)
    dark, light = [], []
    for fr in tracked["frames"]:
        b = (fr.get("track") or {}).get("b") or []
        if len(b) == 2 and abs(b[0] - b[1]) >= 15:
            dark.append(min(b))
            light.append(max(b))
    if not dark:
        print("  audit: no clear 2-pose frames, cannot set threshold")
        return 1
    thr = (float(np.median(dark)) + float(np.median(light))) / 2
    print(f"  audit threshold: black_med={np.median(dark):.1f} "
          f"beige_med={np.median(light):.1f} -> thr={thr:.1f} (n={len(dark)})")
    cap = cv2.VideoCapture(args.video)
    beige, black, missing = 0, 0, 0
    for fr in old["frames"]:
        if fr.get("pose") is None:
            missing += 1
            continue
        cap.set(cv2.CAP_PROP_POS_FRAMES, fr["i"])
        ok, img = cap.read()
        if not ok:
            missing += 1
            continue
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        v = torso_brightness(gray, fr["pose"])
        if v < thr:
            black += 1
        else:
            beige += 1
    cap.release()
    print(f"  old 1-pose tracking: black={black} beige={beige} "
          f"missing={missing} (of {len(old['frames'])})")
    return 0


def detect_cuts(raw: dict) -> list[int]:
    """Frame indices where >40% of joints jump >0.05 (edit point / re-track)."""
    import numpy as np
    frames = raw["frames"]
    cuts = []
    for i in range(1, len(frames)):
        a, b = frames[i - 1], frames[i]
        if a["pose"] is None or b["pose"] is None:
            continue
        d = np.abs(np.asarray(b["pose"], float)[:, :2]
                   - np.asarray(a["pose"], float)[:, :2])
        if (d > 0.05).mean() > 0.4:
            cuts.append(i)
    return cuts


# ------------------------------------------------------------------ stats ---

def recognition_stats(raw: dict) -> dict:
    """Detection rate + mean visibility over detected frames x 33 joints."""
    import numpy as np
    frames = raw["frames"]
    vis = []
    det = 0
    for fr in frames:
        if fr["pose"] is None:
            continue
        det += 1
        vis.extend([j[3] for j in fr["pose"]])
    vis = np.asarray(vis, float)
    known = vis[vis >= 0]
    n = len(frames)
    return {
        "video": raw["meta"]["video"],
        "frames": n,
        "detected": det,
        "detection_rate": round(det / max(n, 1), 4),
        "visibility_mean": round(float(known.mean()) if len(known) else -1.0, 4),
        "visibility_varying": bool(len(known) and known.std() > 1e-6),
    }


def joint_motion(raw: dict) -> "Any":
    """Per-frame mean joint speed (normalized x/y units per frame)."""
    import numpy as np
    frames = raw["frames"]
    P = []
    for fr in frames:
        if fr["pose"] is None:
            P.append(None)
        else:
            P.append(np.asarray(fr["pose"], float)[:, :2])
    mot = np.zeros(len(frames))
    for i in range(1, len(frames)):
        if P[i] is None or P[i - 1] is None:
            mot[i] = 0.0
        else:
            mot[i] = float(np.abs(P[i] - P[i - 1]).mean())
    k = 5  # light smoothing for window scoring only
    ker = np.ones(k) / k
    return np.convolve(mot, ker, mode="same"), mot


def pick_segment(raw: dict, bpm: float) -> tuple[float, dict]:
    """8-beat window with the most distinct motion.

    Missing frames are penalized; windows containing an edit cut are excluded.
    """
    import numpy as np
    fps = raw["meta"]["fps"]
    win_s = 8 * 60.0 / bpm
    win_f = max(int(round(win_s * fps)), 8)
    smooth, _ = joint_motion(raw)
    frames = raw["frames"]
    missing = np.array([1.0 if fr["pose"] is None else 0.0 for fr in frames])
    cut = np.zeros(len(frames))
    for c in detect_cuts(raw):
        cut[c] = 1.0
    pen = float(np.median(smooth[smooth > 0])) if (smooth > 0).any() else 0.0
    score = smooth - 3.0 * pen * missing
    csum = np.concatenate([[0.0], np.cumsum(score)])
    ccut = np.concatenate([[0], np.cumsum(cut)])
    best_i, best_v = 0, -1e18
    for i in range(0, len(frames) - win_f + 1):
        if ccut[i + win_f] - ccut[i] > 0:
            continue  # never sample across an edit cut
        v = csum[i + win_f] - csum[i]
        if v > best_v:
            best_v, best_i = v, i
    t0 = frames[best_i]["t"]
    info = {"t0": round(t0, 3), "window_s": round(win_s, 3),
            "frames": [best_i, best_i + win_f],
            "score": round(float(best_v), 4),
            "mean_motion_window": round(float(smooth[best_i:best_i + win_f].mean()), 5),
            "mean_motion_video": round(float(smooth.mean()), 5),
            "missing_in_window": int(missing[best_i:best_i + win_f].sum())}
    return t0, info


def sample_pose_at(raw: dict, t: float) -> "Any":
    """Linearly interpolated 33x4 pose at time t (nearest if gap)."""
    import numpy as np
    frames = raw["frames"]
    det = [fr for fr in frames if fr["pose"] is not None]
    if not det:
        raise ValueError("no detected frames")
    if t <= det[0]["t"]:
        return np.asarray(det[0]["pose"], float)
    if t >= det[-1]["t"]:
        return np.asarray(det[-1]["pose"], float)
    for a, b in zip(det, det[1:]):
        if a["t"] <= t <= b["t"]:
            pa = np.asarray(a["pose"], float)
            pb = np.asarray(b["pose"], float)
            s = 0.0 if b["t"] == a["t"] else (t - a["t"]) / (b["t"] - a["t"])
            return pa + (pb - pa) * s
    return np.asarray(det[-1]["pose"], float)


# ----------------------------------------------------------------- mapping ---

def _ang_limbs(root: "Any", end: "Any") -> tuple[float, float]:
    """(beta, rz) for an arm/leg from root->end joint (x right, y down)."""
    dx = end[0] - root[0]
    dy = end[1] - root[1]
    fwd = -(end[2] - root[2])  # toward camera positive
    beta = math.atan2(fwd, dy)  # 0=down, -pi/2=forward, +/-pi=up
    rz = math.atan2(dx, abs(dy) + 0.3 * abs(fwd))
    return beta, rz


def _unwrap_arm_up(beta: float, dy: float) -> float:
    # Arms-up reads as up even when tilted slightly back: unwrap the -pi
    # branch so up-back maps to -1.9 (up) instead of +1.x (down-back).
    if dy < 0 and beta < 0:
        beta += 2 * math.pi
    return beta


def map_pose_to_bones(P: "Any", ref: dict) -> dict:
    """Human joints -> creature 7-bone angles (pre-exaggeration)."""
    nose = P[NOSE]
    shL, shR = P[SH_L], P[SH_R]
    wrL, wrR = P[WR_L], P[WR_R]
    hipL, hipR = P[HIP_L], P[HIP_R]
    ankL, ankR = P[ANK_L], P[ANK_R]
    shC = (shL + shR) / 2
    hipC = (hipL + hipR) / 2
    sw = max(float(abs(shL[0] - shR[0])), 1e-3)  # shoulder width (scale)
    torso_len = max(float(math.hypot(shC[0] - hipC[0], shC[1] - hipC[1])), 1e-3)

    # Arms: range-mapped so straight-up lands on the mascot limit (-1.9).
    # pL/pR = person's anatomical left/right. Screen-side rule (fix 1):
    # person's anatomical left (video screen-right, facing camera) drives
    # the R bones (+X = render screen-right). Values are NOT changed by the
    # swap: rx is side-free, and rz>0 already means toward +X for both bones,
    # so the same numbers on the other bone give the same screen motion.
    bPL, rzPL = _ang_limbs(shL, wrL)
    bPR, rzPR = _ang_limbs(shR, wrR)
    bPL = _unwrap_arm_up(bPL, wrL[1] - shL[1])
    bPR = _unwrap_arm_up(bPR, wrR[1] - shR[1])
    armPL_rx = -(1.9 / math.pi) * bPL
    armPR_rx = -(1.9 / math.pi) * bPR
    # Legs: centered on window median (standing = 0), spec clamp applies.
    gPL, lrzPL = _ang_limbs(hipL, ankL)
    gPR, lrzPR = _ang_limbs(hipR, ankR)
    legPL_rx = -(gPL - ref["legL_beta_med"])
    legPR_rx = -(gPR - ref["legR_beta_med"])

    # Torso twist: shoulder-line angle minus hip-line angle.
    def line_ang(a: "Any", b: "Any") -> float:
        return math.atan2(a[1] - b[1], a[0] - b[0])
    d_psi = line_ang(shL, shR) - line_ang(hipL, hipR)
    d_psi = (d_psi + math.pi) % (2 * math.pi) - math.pi
    torso_ry = d_psi - ref["twist_med"]
    # Torso bow: vertical shortening + shoulders moving toward camera.
    torso_rx = (2.0 * (ref["torso_len_med"] - torso_len) / ref["torso_len_med"]
                + 1.0 * (-(shC[2] - hipC[2])))
    # Torso lean: shoulder-center x shift vs hips (upper point: +x needs rz<0).
    torso_rz = -1.5 * ((shC[0] - hipC[0]) - ref["lean_med"]) / ref["torso_len_med"]
    # Head: nose vs shoulder-center (chin-down gap grows -> rx>0 bow).
    gap = nose[1] - shC[1]
    head_rx = 2.0 * (gap - ref["gap_med"]) / sw
    head_rz = -1.5 * ((nose[0] - shC[0]) - ref["nose_dx_med"]) / sw
    # Squash: hips lower in image -> sy<1.
    sy = 1.0 - 2.0 * (hipC[1] - ref["hipy_med"])
    return {"torso": [torso_rx, torso_ry, torso_rz, sy],
            "head": [head_rx, head_rz],
            "armL": [armPR_rx, rzPR], "armR": [armPL_rx, rzPL],
            "legL": [legPR_rx, lrzPR], "legR": [legPL_rx, lrzPL]}


def clamp_bones(b: dict) -> tuple[dict, int]:
    """Spec clamps + sanity clamps. Returns (clamped, n_clamped_channels)."""
    n = 0

    def cl(v: float, lo: float, hi: float) -> float:
        nonlocal n
        c = min(max(v, lo), hi)
        if c != v:
            n += 1
        return c

    t = b["torso"]
    h = b["head"]
    aL, aR = b["armL"], b["armR"]
    lL, lR = b["legL"], b["legR"]
    return {
        "torso": [cl(t[0], -TORSO_RX_MAX, TORSO_RX_MAX),
                  cl(t[1], -TORSO_RY_MAX, TORSO_RY_MAX),
                  cl(t[2], -TORSO_RZ_MAX, TORSO_RZ_MAX),
                  cl(t[3], SY_MIN, SY_MAX)],
        "head": [cl(h[0], -HEAD_RX_MAX, HEAD_RX_MAX),
                 cl(h[1], -HEAD_RZ_MAX, HEAD_RZ_MAX)],
        "armL": [cl(aL[0], ARM_RX_MIN, 1.9), cl(aL[1], -ARM_RZ_MAX, ARM_RZ_MAX)],
        "armR": [cl(aR[0], ARM_RX_MIN, 1.9), cl(aR[1], -ARM_RZ_MAX, ARM_RZ_MAX)],
        "legL": [cl(lL[0], -LEG_RX_MAX, LEG_RX_MAX), cl(lL[1], -LEG_RZ_MAX, LEG_RZ_MAX)],
        "legR": [cl(lR[0], -LEG_RX_MAX, LEG_RX_MAX), cl(lR[1], -LEG_RZ_MAX, LEG_RZ_MAX)],
    }, n


def moving_average_cyclic(keys: list[dict], name: str, idx: int) -> None:
    vals = [k[name][idx] for k in keys]
    n = len(vals)
    avg = [(vals[(i - 1) % n] + vals[i] + vals[(i + 1) % n]) / 3 for i in range(n)]
    for k, v in zip(keys, avg):
        k[name][idx] = v


SMOOTH_CHANNELS = [("torso", 0), ("torso", 1), ("torso", 2), ("torso", 3),
                   ("head", 0), ("head", 1),
                   ("armL", 0), ("armL", 1), ("armR", 0), ("armR", 1),
                   ("legL", 0), ("legL", 1), ("legR", 0), ("legR", 1)]


def window_refs(raw: dict, i0: int, i1: int) -> dict:
    """Median reference values over detected window frames."""
    import numpy as np
    twists, lens, leans, gaps, ndx, hipy, legB = [], [], [], [], [], [], []
    for fr in raw["frames"][i0:i1]:
        if fr["pose"] is None:
            continue
        P = np.asarray(fr["pose"], float)
        shC = (P[SH_L] + P[SH_R]) / 2
        hipC = (P[HIP_L] + P[HIP_R]) / 2
        la = math.atan2(P[SH_L][1] - P[SH_R][1], P[SH_L][0] - P[SH_R][0])
        lb = math.atan2(P[HIP_L][1] - P[HIP_R][1], P[HIP_L][0] - P[HIP_R][0])
        d = (la - lb + math.pi) % (2 * math.pi) - math.pi
        twists.append(d)
        lens.append(math.hypot(shC[0] - hipC[0], shC[1] - hipC[1]))
        leans.append(shC[0] - hipC[0])
        gaps.append(P[NOSE][1] - shC[1])
        ndx.append(P[NOSE][0] - shC[0])
        hipy.append(hipC[1])
        gL, _ = _ang_limbs(P[HIP_L], P[ANK_L])
        gR, _ = _ang_limbs(P[HIP_R], P[ANK_R])
        legB.append((gL, gR))
    med = lambda v, d=0.0: float(np.median(v)) if v else d  # noqa: E731
    return {"twist_med": med(twists), "torso_len_med": med(lens, 0.2),
            "lean_med": med(leans), "gap_med": med(gaps),
            "nose_dx_med": med(ndx), "hipy_med": med(hipy, 0.5),
            "legL_beta_med": med([b[0] for b in legB]),
            "legR_beta_med": med([b[1] for b in legB])}


# ---------------------------------------------------------------- analyze ---

def cmd_analyze(args: argparse.Namespace) -> int:
    import numpy as np
    raws = []
    for rp in args.raw:
        with open(rp, encoding="utf-8") as f:
            raws.append((rp, json.load(f)))
    stats = [recognition_stats(r) for _, r in raws]
    for s in stats:
        print(f"  recognition {s['video']}: det={s['detection_rate']:.3f} "
              f"vis_mean={s['visibility_mean']:.3f} varying={s['visibility_varying']}")

    def score(s: dict) -> float:
        v = s["visibility_mean"] if s["visibility_varying"] else 1.0
        return s["detection_rate"] * max(v, 0.0)

    order = sorted(range(len(raws)), key=lambda i: -score(stats[i]))
    chosen_path, chosen = raws[order[0]]
    print(f"  chosen: {stats[order[0]]['video']} (score {score(stats[order[0]]):.3f})")

    if args.audio:
        tempos = {}
        for ap_ in args.audio:
            b_, t_ = tempo_from_audio(ap_)
            tempos[os.path.splitext(os.path.basename(ap_))[0]] = (b_, t_)
            print(f"  audio tempo {os.path.basename(ap_)}: {b_:.1f} "
                  f"(candidates {t_['candidates']})")
        stem = os.path.splitext(stats[order[0]]["video"])[0]
        if stem in tempos:
            bpm, tempo = tempos[stem]
        else:
            bpm, tempo = next(iter(tempos.values()))
            print(f"  warn: no audio matching {stem}, using first");
    else:
        times, hipy = [], []
        for fr in chosen["frames"]:
            times.append(fr["t"])
            if fr["pose"] is None:
                hipy.append(float("nan"))
            else:
                P = np.asarray(fr["pose"], float)
                hipy.append(float((P[HIP_L][1] + P[HIP_R][1]) / 2))
        bpm, tempo = tempo_from_hips(times, hipy)
        if bpm is None:
            print(f"  hips: no periodic structure "
                  f"(candidates {tempo['candidates']}) -> accent fallback")
            bpm, tempo = tempo_from_accents(chosen)
            tempo["hip_attempt"] = "failed: flat autocorr, no local max > 0.15"
    print(f"  bpm: {bpm:.1f} ({tempo['method']}, candidates "
          f"{tempo.get('candidates', tempo.get('median_iv'))})")

    t0, seg = pick_segment(chosen, bpm)
    print(f"  segment: t0={seg['t0']}s window={seg['window_s']}s "
          f"motion win={seg['mean_motion_window']} vs video={seg['mean_motion_video']} "
          f"missing={seg['missing_in_window']}")

    refs = window_refs(chosen, seg["frames"][0], seg["frames"][1])
    beat = 60.0 / bpm
    key_times = [t0 + i * 0.5 * beat for i in range(16)]
    keys, n_clamp_keys, n_clamp_ch, n_spec_keys = [], 0, 0, 0
    for t in key_times:
        P = sample_pose_at(chosen, t)
        b = map_pose_to_bones(P, refs)
        for name in ("torso", "head", "armL", "armR", "legL", "legR"):
            for j in range(len(b[name])):
                if name == "torso" and j == 3:
                    b[name][j] = 1.0 + (b[name][j] - 1.0) * EXAGGERATE
                else:
                    b[name][j] *= EXAGGERATE
        spec_hit = (b["armL"][0] < ARM_RX_MIN or b["armR"][0] < ARM_RX_MIN
                    or abs(b["legL"][0]) > LEG_RX_MAX or abs(b["legR"][0]) > LEG_RX_MAX
                    or abs(b["torso"][1]) > TORSO_RY_MAX)
        b, n = clamp_bones(b)
        if n:
            n_clamp_keys += 1
            n_clamp_ch += n
        if spec_hit:
            n_spec_keys += 1
        keys.append(b)
    for name, idx in SMOOTH_CHANNELS:
        moving_average_cyclic(keys, name, idx)

    # Final spec-constraint audit (post-smoothing).
    viol = 0
    for b in keys:
        if b["armL"][0] < ARM_RX_MIN - 1e-9 or b["armR"][0] < ARM_RX_MIN - 1e-9:
            viol += 1
        if abs(b["legL"][0]) > LEG_RX_MAX + 1e-9 or abs(b["legR"][0]) > LEG_RX_MAX + 1e-9:
            viol += 1
        if abs(b["torso"][1]) > TORSO_RY_MAX + 1e-9:
            viol += 1
    print(f"  clamps: {n_clamp_keys}/16 keys ({n_clamp_ch} channels), "
          f"spec-clamp keys: {n_spec_keys}/16, post-smooth violations: {viol}")

    r6 = lambda v: round(float(v), 6)  # noqa: E731
    clip = {
        "id": args.id, "bpm": round(float(bpm), 2), "counts": 8,
        "keys": [{
            "torso": {"rx": r6(b["torso"][0]), "ry": r6(b["torso"][1]),
                      "rz": r6(b["torso"][2]), "sy": r6(b["torso"][3])},
            "head": {"rx": r6(b["head"][0]), "rz": r6(b["head"][1])},
            "armL": {"rx": r6(b["armL"][0]), "rz": r6(b["armL"][1])},
            "armR": {"rx": r6(b["armR"][0]), "rz": r6(b["armR"][1])},
            "legL": {"rx": r6(b["legL"][0]), "rz": r6(b["legL"][1])},
            "legR": {"rx": r6(b["legR"][0]), "rz": r6(b["legR"][1])},
        } for b in keys],
        "provenance": {
            "videos": [s["video"] for s in stats],
            "chosen_video": stats[order[0]]["video"],
            "source_raw": os.path.basename(chosen_path),
            "cuts": detect_cuts(chosen),
            "recognition": stats,
            "tempo": tempo, "segment": seg,
            "key_times": [round(t, 3) for t in key_times],
            "clamped_keys": n_clamp_keys, "clamped_channels": n_clamp_ch,
            "spec_clamped_keys": n_spec_keys, "violations": viol,
        },
    }
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(clip, f, indent=1)
    print(f"wrote {args.out}")
    return 0


# -------------------------------------------------------------------- emit ---

def _fmt_key(k: dict) -> str:
    f = lambda v: f"{v:.5f}".rstrip("0").rstrip(".") if v != 0 else "0"  # noqa: E731
    return ("{ torso: { rx: %s, ry: %s, rz: %s, sy: %s }, head: { rx: %s, rz: %s }, "
            "armL: { rx: %s, rz: %s }, armR: { rx: %s, rz: %s }, "
            "legL: { rx: %s, rz: %s }, legR: { rx: %s, rz: %s } }" % (
                f(k["torso"]["rx"]), f(k["torso"]["ry"]), f(k["torso"]["rz"]), f(k["torso"]["sy"]),
                f(k["head"]["rx"]), f(k["head"]["rz"]),
                f(k["armL"]["rx"]), f(k["armL"]["rz"]), f(k["armR"]["rx"]), f(k["armR"]["rz"]),
                f(k["legL"]["rx"]), f(k["legL"]["rz"]), f(k["legR"]["rx"]), f(k["legR"]["rz"])))


def cmd_emit(args: argparse.Namespace) -> int:
    clips = {}
    for cp in args.clip:
        with open(cp, encoding="utf-8") as f:
            c = json.load(f)
        clips[c["id"]] = c
    outdir = os.path.join(ROOT, "lib", "motion", "dances")
    os.makedirs(outdir, exist_ok=True)

    with open(os.path.join(outdir, "types.ts"), "w", encoding="utf-8") as f:
        f.write("""// MOTION task 3: data-only dance clips (half-beat keys x16 over 8 counts).
// Generated by scripts/dance-extract.py emit from video pose extraction.
export type DanceKeyBone = { rx: number; rz: number };
export type DanceKeyTorso = { rx: number; ry: number; rz: number; sy: number };
export type DanceKeyHead = { rx: number; rz: number };
export type DanceKey = {
  torso: DanceKeyTorso;
  head: DanceKeyHead;
  armL: DanceKeyBone;
  armR: DanceKeyBone;
  legL: DanceKeyBone;
  legR: DanceKeyBone;
};
export type DanceClip = {
  id: string;
  bpm: number;
  counts: 8;
  keys: DanceKey[]; // 16 entries, key i = clip-beat i*0.5, loops every 8 beats
};
""")
    for cid in ("ateez", "a2o"):
        c = clips[cid]
        p = c["provenance"]
        with open(os.path.join(outdir, f"{cid}.ts"), "w", encoding="utf-8") as f:
            f.write(f"// {cid} dance clip extracted from video ({p['chosen_video']}).\n"
                    f"// bpm={c['bpm']} t0={p['segment']['t0']}s "
                    f"method={p['tempo']['method']} keys=16 half-beat, counts=8.\n"
                    f"// Generated by scripts/dance-extract.py emit - do not hand-edit.\n"
                    f"import type {{ DanceClip }} from \"./types\";\n\n"
                    f"export const {cid}: DanceClip = {{\n"
                    f"  id: \"{cid}\",\n  bpm: {c['bpm']},\n  counts: 8,\n  keys: [\n")
            for k in c["keys"]:
                f.write(f"    {_fmt_key(k)},\n")
            f.write("  ],\n};\n")
    with open(os.path.join(outdir, "index.ts"), "w", encoding="utf-8") as f:
        f.write("""// MOTION task 3: dance selection + playback over data clips.
// Generated by scripts/dance-extract.py emit - do not hand-edit.
import {
  B_ARML, B_ARMR, B_HEAD, B_LEGL, B_LEGR, B_TORSO,
  type BonePose,
} from "../../autoRig";
import { ateez } from "./ateez";
import { a2o } from "./a2o";
import type { DanceClip, DanceKey } from "./types";

export type { DanceClip, DanceKey } from "./types";
export { ateez, a2o };

const CLIPS: DanceClip[] = [ateez, a2o];

/** Pick one of the 2 dances from a seed (DexScene calls once per arrival). */
export function pickDance(seed: number): DanceClip {
  const i = Math.abs(Math.floor(seed)) % CLIPS.length;
  return CLIPS[i];
}

/** Convert 124-BPM DexScene beats to clip-local beats. */
export function danceBeat(beat124: number, clip: DanceClip): number {
  return (beat124 * clip.bpm) / 124;
}

function lerpKey(a: DanceKey, b: DanceKey, t: number, out: BonePose): void {
  const L = (x: number, y: number) => x + (y - x) * t;
  out.rx[B_TORSO] = L(a.torso.rx, b.torso.rx);
  out.ry[B_TORSO] = L(a.torso.ry, b.torso.ry);
  out.rz[B_TORSO] = L(a.torso.rz, b.torso.rz);
  out.sy = L(a.torso.sy, b.torso.sy);
  out.sx = 1 - (out.sy - 1) * 0.5;
  out.sz = 1 - (out.sy - 1) * 0.5;
  out.rx[B_HEAD] = L(a.head.rx, b.head.rx);
  out.rz[B_HEAD] = L(a.head.rz, b.head.rz);
  out.rx[B_ARML] = L(a.armL.rx, b.armL.rx);
  out.rz[B_ARML] = L(a.armL.rz, b.armL.rz);
  out.rx[B_ARMR] = L(a.armR.rx, b.armR.rx);
  out.rz[B_ARMR] = L(a.armR.rz, b.armR.rz);
  out.rx[B_LEGL] = L(a.legL.rx, b.legL.rx);
  out.rz[B_LEGL] = L(a.legL.rz, b.legL.rz);
  out.rx[B_LEGR] = L(a.legR.rx, b.legR.rx);
  out.rz[B_LEGR] = L(a.legR.rz, b.legR.rz);
  // Tail untouched: existing spring delay (blend.ts) drives it.
}

/** Write the interpolated clip pose at a 124-BPM beat into `out`. Loops every 8 clip-beats. */
export function dancePose(clip: DanceClip, beat124: number, out: BonePose): BonePose {
  let b = danceBeat(beat124, clip) % clip.counts;
  if (b < 0) b += clip.counts;
  if (clip.counts - b < 1e-9) b = 0; // loop snap: b=8 lands exactly on key 0
  const pos = b * 2; // half-beat key space
  const i0 = Math.floor(pos) % clip.keys.length;
  const i1 = (i0 + 1) % clip.keys.length;
  lerpKey(clip.keys[i0], clip.keys[i1], pos - Math.floor(pos), out);
  return out;
}
""")
    print(f"wrote {outdir}/types.ts, ateez.ts, a2o.ts, index.ts")
    return 0


# ----------------------------------------------------------------- figures ---

def _rot_xyz(rx: float, ry: float, rz: float) -> "Any":
    """Rotation matrix matching THREE.Euler(rx,ry,rz,'XYZ'): R = Rx*Ry*Rz."""
    import numpy as np
    cx, sx = math.cos(rx), math.sin(rx)
    cy, sy = math.cos(ry), math.sin(ry)
    cz, sz = math.cos(rz), math.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rx @ Ry @ Rz


def stick_figure(key: dict) -> dict:
    """2D front-view joints from 7-bone angles (faithful to rig pivot sides:
    L bones deform -X verts, rendered from +Z so L appears screen-left)."""
    import numpy as np
    t, h = key["torso"], key["head"]
    Rt = _rot_xyz(t["rx"], t["ry"], t["rz"])
    Rh = _rot_xyz(h["rx"], 0.0, h["rz"])
    RaL = _rot_xyz(key["armL"]["rx"], 0.0, key["armL"]["rz"])
    RaR = _rot_xyz(key["armR"]["rx"], 0.0, key["armR"]["rz"])
    RlL = _rot_xyz(key["legL"]["rx"], 0.0, key["legL"]["rz"])
    RlR = _rot_xyz(key["legR"]["rx"], 0.0, key["legR"]["rz"])
    hip = np.zeros(3)
    sh = hip + Rt @ np.array([0, 1.0 * t["sy"], 0])
    head = sh + Rh @ np.array([0, 0.45, 0])
    shL = sh + Rt @ np.array([-0.55, 0, 0])
    shR = sh + Rt @ np.array([0.55, 0, 0])
    elL = shL + RaL @ np.array([0, -0.75, 0])
    elR = shR + RaR @ np.array([0, -0.75, 0])
    hipL = hip + np.array([-0.22, 0, 0])
    hipR = hip + np.array([0.22, 0, 0])
    ftL = hipL + RlL @ np.array([0, -0.9, 0])
    ftR = hipR + RlR @ np.array([0, -0.9, 0])
    return {"hip": hip, "sh": sh, "head": head, "shL": shL, "shR": shR,
            "elL": elL, "elR": elR, "hipL": hipL, "hipR": hipR,
            "ftL": ftL, "ftR": ftR}


def cmd_signcheck(args: argparse.Namespace) -> int:
    """Math check (fix 1 screen-side rule): the key where a wrist goes
    farthest to video screen-right must pose that side's creature fingertip
    at +X (render screen-right).

    Uses the rig's own rest dirs (autoRig.ts tipLocal) and the same XYZ
    euler convention. On-screen confirmation stays unverified per workorder.
    """
    import numpy as np
    with open(args.clip, encoding="utf-8") as f:
        clip = json.load(f)
    with open(args.raw, encoding="utf-8") as f:
        raw = json.load(f)
    keys = clip["keys"]
    times = clip["provenance"]["key_times"]
    best = None  # (x, key_idx, person_side)
    for j, t in enumerate(times):
        P = sample_pose_at(raw, t)
        for side, lm in (("L", WR_L), ("R", WR_R)):
            x = float(P[lm][0])
            if best is None or x > best[0]:
                best = (x, j, side)
    _, i, side = best
    k = keys[i]
    bone = "armR" if side == "L" else "armL"  # screen-side rule
    rest = {"armL": np.array([-0.35, -1, 0.12]),
            "armR": np.array([0.35, -1, 0.12])}
    tips = {}
    for b in ("armL", "armR"):
        r = rest[b] / np.linalg.norm(rest[b])
        tips[b] = _rot_xyz(k[b]["rx"], 0.0, k[b]["rz"]) @ r
    print(f"  clip {clip['id']}: farthest screen-right wrist = key {i} "
          f"person-{side} (x={best[0]:.3f}) -> {bone} "
          f"(rx={k[bone]['rx']:.3f} rz={k[bone]['rz']:.3f})")
    print(f"  posed tip x: armL={tips['armL'][0]:+.3f} armR={tips['armR'][0]:+.3f}")
    ok = tips[bone][0] > 0
    print(f"  sign check: {'PASS' if ok else 'FAIL'} "
          f"({bone} tip x {'>' if ok else '<='} 0; math only, on-screen unverified)")
    return 0 if ok else 1


def cmd_figures(args: argparse.Namespace) -> int:
    import cv2
    import numpy as np
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    with open(args.clip, encoding="utf-8") as f:
        clip = json.load(f)
    keys = clip["keys"]
    times = clip["provenance"]["key_times"]
    cap = cv2.VideoCapture(args.video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    thumbs = []
    for t in times:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(t * fps))
        ok, frame = cap.read()
        if not ok:
            frame = np.zeros((360, 360, 3), np.uint8)
        frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        H, W = frame.shape[:2]
        s = min(H, W)
        y0, x0 = (H - s) // 2, (W - s) // 2
        thumbs.append(cv2.resize(frame[y0:y0 + s, x0:x0 + s], (160, 160)))
    cap.release()

    fig, axs = plt.subplots(2, 16, figsize=(20, 5.6),
                            gridspec_kw={"hspace": 0.25, "wspace": 0.08})
    for j in range(16):
        ax = axs[0, j]
        ax.imshow(thumbs[j])
        ax.set_title(f"k{j} {times[j]:.2f}s", fontsize=7)
        ax.axis("off")
        ax = axs[1, j]
        ax.set_xlim(-1.6, 1.6)
        ax.set_ylim(-1.3, 1.9)
        ax.set_aspect("equal")
        ax.axis("off")
        S = stick_figure(keys[j])
        P = lambda v: (v[0], v[1])  # noqa: E731
        ax.plot(*zip(P(S["hip"]), P(S["sh"])), color="black", lw=2)
        ax.add_patch(plt.Circle(P(S["head"]), 0.18, fill=False, color="black", lw=1.5))
        ax.plot(*zip(P(S["shL"]), P(S["elL"])), color="crimson", lw=2)   # L = screen-left
        ax.plot(*zip(P(S["shR"]), P(S["elR"])), color="royalblue", lw=2)
        ax.plot(*zip(P(S["hipL"]), P(S["ftL"])), color="crimson", lw=2)
        ax.plot(*zip(P(S["hipR"]), P(S["ftR"])), color="royalblue", lw=2)
        ax.text(0, -1.25, f"k{j}", fontsize=7, ha="center")
    fig.suptitle(f"{clip['id']} (bpm {clip['bpm']}): video frames (top) vs "
                 f"7-bone stick figures front view (bottom; red=L, blue=R)",
                 fontsize=10)
    fig.savefig(args.out, dpi=110, bbox_inches="tight")
    print(f"wrote {args.out}")
    return 0


# --------------------------------------------------------------------- main ---

def main() -> int:
    ap = argparse.ArgumentParser(description="dance motion extraction (task 3+3b)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("extract")
    p.add_argument("--video", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--model", default=MODEL_PATH)
    p.add_argument("--num-poses", type=int, default=1)
    p.set_defaults(fn=cmd_extract)
    p = sub.add_parser("analyze")
    p.add_argument("--raw", required=True, nargs="+")
    p.add_argument("--audio", default=None, nargs="+")
    p.add_argument("--id", required=True)
    p.add_argument("--out", required=True)
    p.set_defaults(fn=cmd_analyze)
    p = sub.add_parser("emit")
    p.add_argument("--clip", required=True, nargs="+")
    p.set_defaults(fn=cmd_emit)
    p = sub.add_parser("figures")
    p.add_argument("--clip", required=True)
    p.add_argument("--video", required=True)
    p.add_argument("--out", required=True)
    p.set_defaults(fn=cmd_figures)
    p = sub.add_parser("signcheck")
    p.add_argument("--clip", required=True)
    p.add_argument("--raw", required=True)
    p.set_defaults(fn=cmd_signcheck)
    p = sub.add_parser("retrack")
    p.add_argument("--in", dest="input", required=True)
    p.add_argument("--video", required=True)
    p.add_argument("--out", required=True)
    p.set_defaults(fn=cmd_retrack)
    p = sub.add_parser("audit")
    p.add_argument("--old", required=True)
    p.add_argument("--video", required=True)
    p.add_argument("--tracked", required=True)
    p.set_defaults(fn=cmd_audit)
    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())

