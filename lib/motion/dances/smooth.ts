// D-3 smooth playback (2번, 11-02): Catmull-Rom key interpolation +
// light key denoising. Playback-time only: clip.keys data untouched.
// danceRoot stays linear (R-B-6: yaw spin timing + head-ry compensation).
import {
  B_ARML, B_ARMR, B_HEAD, B_LEGL, B_LEGR, B_TORSO,
  type BonePose,
} from "../../autoRig";
import type { DanceClip, DanceKey } from "./types";
import { isKeyMoveKey } from "./keyMoves";

/** Uniform Catmull-Rom through p1..p2 (neighbors p0/p3). t=0 → p1 exactly. */
export function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    2 * p1
    + (-p0 + p2) * t
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
    + (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

function cr4(k0: DanceKey, k1: DanceKey, k2: DanceKey, k3: DanceKey, t: number,
  f: (k: DanceKey) => number): number {
  return catmullRom(f(k0), f(k1), f(k2), f(k3), t);
}

/** Mirror of lerpKey with Catmull-Rom per channel. Wraps around the loop. */
export function smoothKey(keys: DanceKey[], i0: number, t: number, out: BonePose): void {
  const n = keys.length;
  const k0 = keys[(i0 - 1 + n) % n];
  const k1 = keys[i0];
  const k2 = keys[(i0 + 1) % n];
  const k3 = keys[(i0 + 2) % n];
  const C = (f: (k: DanceKey) => number) => cr4(k0, k1, k2, k3, t, f);
  out.rx[B_TORSO] = C((k) => k.torso.rx);
  out.ry[B_TORSO] = C((k) => k.torso.ry);
  out.rz[B_TORSO] = C((k) => k.torso.rz);
  out.sy = C((k) => k.torso.sy);
  out.sx = 1 - (out.sy - 1) * 0.5;
  out.sz = 1 - (out.sy - 1) * 0.5;
  out.rx[B_HEAD] = C((k) => k.head.rx);
  out.rz[B_HEAD] = C((k) => k.head.rz);
  out.rx[B_ARML] = C((k) => k.armL.rx);
  out.rz[B_ARML] = C((k) => k.armL.rz);
  out.rx[B_ARMR] = C((k) => k.armR.rx);
  out.rz[B_ARMR] = C((k) => k.armR.rz);
  out.rx[B_LEGL] = C((k) => k.legL.rx);
  out.rz[B_LEGL] = C((k) => k.legL.rz);
  out.rx[B_LEGR] = C((k) => k.legR.rx);
  out.rz[B_LEGR] = C((k) => k.legR.rz);
  // Tail untouched: existing spring delay (blend.ts) drives it.
}

const cache = new WeakMap<DanceClip, DanceKey[]>();

/**
 * One light 3-tap [0.25, 0.5, 0.25] denoise pass over bone channels.
 * Count-boundary keys and key-move keys keep raw values (D-3 §2 + 정정 100%).
 * head.ry/root pass through (danceRoot reads raw keys; timing-critical).
 */
export function smoothedKeys(clip: DanceClip): DanceKey[] {
  const hit = cache.get(clip);
  if (hit) return hit;
  const n = clip.keys.length;
  const spb = n / clip.counts;
  const out = clip.keys.map((k, i) => {
    if (i % spb === 0 || isKeyMoveKey(clip.id, i)) return k;
    const a = clip.keys[(i - 1 + n) % n];
    const b = clip.keys[(i + 1) % n];
    const avg = (x: number, y: number, z: number) => 0.25 * x + 0.5 * y + 0.25 * z;
    const avgTorso = (f: (k: DanceKey["torso"]) => number) => avg(f(a.torso), f(k.torso), f(b.torso));
    const avgBone = (f: (k: DanceKey) => number) => avg(f(a), f(k), f(b));
    return {
      torso: {
        rx: avgTorso((t) => t.rx), ry: avgTorso((t) => t.ry),
        rz: avgTorso((t) => t.rz), sy: avgTorso((t) => t.sy),
      },
      head: { rx: avgBone((x) => x.head.rx), rz: avgBone((x) => x.head.rz), ry: k.head.ry },
      armL: { rx: avgBone((x) => x.armL.rx), rz: avgBone((x) => x.armL.rz) },
      armR: { rx: avgBone((x) => x.armR.rx), rz: avgBone((x) => x.armR.rz) },
      legL: { rx: avgBone((x) => x.legL.rx), rz: avgBone((x) => x.legL.rz) },
      legR: { rx: avgBone((x) => x.legR.rx), rz: avgBone((x) => x.legR.rz) },
      root: k.root,
    };
  });
  cache.set(clip, out);
  return out;
}
