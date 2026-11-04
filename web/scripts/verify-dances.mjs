// MOTION task 3 verification: data dance clips loop, vary, and respect limits.
// Run: node scripts/verify-dances.mjs
// 8-J: expectations updated to v3 data (ateez 41ct/164k, a2o 23ct/92k,
// loop-vs-N, torso-ry bound 0.7 per verify_v3 R-B). No data touched.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, "scratch", ".build-dance");
const require = createRequire(import.meta.url);

function compile() {
  rmSync(BUILD, { recursive: true, force: true });
  mkdirSync(BUILD, { recursive: true });
  execFileSync(process.execPath, [
    join(ROOT, "node_modules", "typescript", "bin", "tsc"),
    join("lib", "motion", "dances", "index.ts"),
    join("lib", "motion", "rigRetarget.ts"),
    join("lib", "autoRig.ts"),
    "--outDir", BUILD,
    "--module", "commonjs",
    "--target", "es2020",
    "--moduleResolution", "node",
    "--skipLibCheck",
    "--esModuleInterop",
  ], { cwd: ROOT, stdio: "inherit" });
}

compile();
const dances = require(join(BUILD, "motion", "dances", "index.js"));
const rig = require(join(BUILD, "autoRig.js"));
const { pickDance, dancePose, ateez, a2o } = dances;
const { B_TORSO, B_HEAD, B_LEGL, B_LEGR, B_ARML, B_ARMR, B_TAIL, neutralPose } = rig;

let fail = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${msg}`);
  if (!cond) fail += 1;
};

const clips = [ateez, a2o];
// 8-J: v3 full-video extraction sizes (was 8 counts / 16 keys in v1).
const WANT = { ateez: { counts: 41, keys: 164 }, a2o: { counts: 23, keys: 92 } };
ok(clips.length === 2, `clip count = ${clips.length} (want 2)`);
for (const clip of clips) {
  const want = WANT[clip.id];
  ok(clip.counts === want.counts, `${clip.id}: counts = ${clip.counts} (want ${want.counts})`);
  ok(clip.keys.length === want.keys, `${clip.id}: keys = ${clip.keys.length} (want ${want.keys})`);
  ok(!("placeholder" in clip), `${clip.id}: no placeholder flag`);

  // (1) b=0 and b=N equal within 1e-6 (clip-beats -> 124-beats; N = loop end).
  const to124 = (b) => (b * 124) / clip.bpm;
  const p0 = dancePose(clip, to124(0), neutralPose());
  const pN = dancePose(clip, to124(clip.counts), neutralPose());
  let maxd = 0;
  for (const b of [B_TORSO, B_HEAD, B_LEGL, B_LEGR, B_ARML, B_ARMR, B_TAIL]) {
    maxd = Math.max(maxd, Math.abs(p0.rx[b] - pN.rx[b]),
      Math.abs(p0.ry[b] - pN.ry[b]), Math.abs(p0.rz[b] - pN.rz[b]));
  }
  maxd = Math.max(maxd, Math.abs(p0.sx - pN.sx), Math.abs(p0.sy - pN.sy),
    Math.abs(p0.sz - pN.sz));
  ok(maxd <= 1e-6, `${clip.id}: |b0-b${clip.counts}| max diff = ${maxd.toExponential(2)} (<=1e-6)`);

  // (2) arm values differ across >= 4 of the 8 counts.
  const seen = [];
  for (let c = 0; c < 8; c++) {
    const p = dancePose(clip, to124(c), neutralPose());
    const v = [p.rx[B_ARML], p.rz[B_ARML], p.rx[B_ARMR], p.rz[B_ARMR]];
    if (!seen.some((s) => s.every((x, i) => Math.abs(x - v[i]) <= 1e-9))) seen.push(v);
  }
  ok(seen.length >= 4, `${clip.id}: distinct arm counts = ${seen.length} (>=4)`);

  // (3) zero constraint violations on all keys.
  // 8-J: torso-ry bound 0.35 -> 0.7, matching verify_v3.py R-B bound
  // (v3 data max |torso.ry| = 0.676 ateez / 0.656 a2o; 0.35 is v1-era).
  let viol = 0;
  clip.keys.forEach((k, i) => {
    if (k.armL.rx < -1.9 - 1e-9 || k.armR.rx < -1.9 - 1e-9) { viol++; console.log(`  ${clip.id} k${i}: arm rx`); }
    if (Math.abs(k.legL.rx) > 0.6 + 1e-9 || Math.abs(k.legR.rx) > 0.6 + 1e-9) { viol++; console.log(`  ${clip.id} k${i}: leg rx`); }
    if (Math.abs(k.torso.ry) > 0.7 + 1e-9) { viol++; console.log(`  ${clip.id} k${i}: torso ry`); }
  });
  ok(viol === 0, `${clip.id}: constraint violations = ${viol} (want 0)`);
}

// pickDance covers both dances; BPM conversion spot-check.
const ids = new Set([pickDance(0).id, pickDance(1).id, pickDance(42).id, pickDance(101).id]);
ok(ids.has("ateez") && ids.has("a2o"), `pickDance covers {${[...ids].join(",")}}`);
const b124 = 8;
const expect = { ateez: (b124 * ateez.bpm) / 124, a2o: (b124 * a2o.bpm) / 124 };
ok(Math.abs(dances.danceBeat(b124, ateez) - expect.ateez) < 1e-12
  && Math.abs(dances.danceBeat(b124, a2o) - expect.a2o) < 1e-12,
  `danceBeat = beat*bpm/124 (ateez ${expect.ateez.toFixed(3)}, a2o ${expect.a2o.toFixed(3)})`);

// D-3: smooth interpolation keeps key amplitudes; soften spares key moves.
const { smoothedKeys, dancePoseLinear } = dances;
const rt = require(join(BUILD, "motion", "rigRetarget.js"));
const km = require(join(BUILD, "motion", "dances", "keyMoves.js"));
const { KEY_MOVES } = km;
const to124c = (clip, b) => (b * 124) / clip.bpm;
function poseKeyDiff(p, k) {
  let d = 0;
  const C = (a, b) => { d = Math.max(d, Math.abs(a - b)); };
  C(p.rx[B_TORSO], k.torso.rx); C(p.ry[B_TORSO], k.torso.ry); C(p.rz[B_TORSO], k.torso.rz);
  C(p.sy, k.torso.sy);
  C(p.rx[B_HEAD], k.head.rx); C(p.rz[B_HEAD], k.head.rz);
  C(p.rx[B_ARML], k.armL.rx); C(p.rz[B_ARML], k.armL.rz);
  C(p.rx[B_ARMR], k.armR.rx); C(p.rz[B_ARMR], k.armR.rz);
  C(p.rx[B_LEGL], k.legL.rx); C(p.rz[B_LEGL], k.legL.rz);
  C(p.rx[B_LEGR], k.legR.rx); C(p.rz[B_LEGR], k.legR.rz);
  return d;
}
// D3-1/2: count-boundary poses bit-exact (smoothing skips boundaries;
// Catmull-Rom passes through keys). 1e-6 = float32 storage rounding.
for (const clip of clips) {
  const cbs = clip.id === "ateez" ? [0, 1, 5, 40] : [0, 1, 22];
  let maxd = 0;
  for (const cb of cbs) {
    const p = dancePose(clip, to124c(clip, cb), neutralPose());
    maxd = Math.max(maxd, poseKeyDiff(p, clip.keys[cb * 4]));
  }
  ok(maxd <= 1e-6, `${clip.id}: boundary-key diff = ${maxd.toExponential(2)} (<=1e-6)`);
}
// D3-3: key-move keys bit-exact (amplitude 100%, diff 0 within float32).
{
  let maxd = 0, n = 0;
  for (const r of KEY_MOVES) {
    const clip = r.clip === "ateez" ? ateez : a2o;
    for (let k = r.fromKey; k <= r.toKey; k++) {
      const p = dancePose(clip, to124c(clip, k / 4), neutralPose());
      maxd = Math.max(maxd, poseKeyDiff(p, clip.keys[k]));
      n++;
    }
  }
  ok(maxd <= 1e-6, `key-move keys: diff = ${maxd.toExponential(2)} over ${n} keys (<=1e-6)`);
}
// DT-1 (replaces STIFF removal pins): belly tearing at the torso/arm weight
// cliff is driven by large arm angles once the joint cap floated free.
// Fix = continuous soft clamp (exponential saturation from 80% of limit),
// never the old 0.96 hard gate (4% value snap at the boundary = pop source).
// Rationale for pinning here: these guard the exact properties the tear fix
// depends on — saturation below the hard limit, identity below the knee,
// C1 continuity at the knee — so a future limit/soften tweak that reopens
// the tear or the pop fails loudly instead of shipping silently.
{
  const src = readFileSync(join(ROOT, "lib", "motion", "rigRetarget.ts"), "utf8");
  // DT-2R: back to DT-1 arms-only (DT-2 all-joint soft made dances floppy).
  const wantBones = ["armL", "armR"];
  const wantTable = {
    torso: [0.45, 0.63, 0.45], head: [0.54, 0.72, 0.54],
    legL: [0.9, 0.63, 0.72], legR: [0.9, 0.63, 0.72],
    armL: [1.35, 0.7, 1.5], armR: [1.35, 0.7, 1.5],
    tail: [0.45, 0.81, 0.45],
  };
  ok(typeof rt.softClamp === "function" && rt.DT1_SOFT_ON === true
    && rt.DT1_SOFT_START === 0.8
    && JSON.stringify(rt.DT1_SOFT_BONES) === JSON.stringify(wantBones)
    && JSON.stringify(rt.DT1_ARM_CLAMP) === JSON.stringify([1.35, 0.7, 1.5])
    && JSON.stringify(rt.DT2_SOFT_CLAMP) === JSON.stringify(wantTable)
    && JSON.stringify(rt.DT2_SOFT_CLAMP.armL) === JSON.stringify(rt.DT1_ARM_CLAMP)
    && JSON.stringify(rt.DT2_SOFT_CLAMP.armR) === JSON.stringify(rt.DT1_ARM_CLAMP)
    && !src.includes("* 0.96") && rt.applyLimbSoften === undefined,
    "soft clamp consts exported (on, 0.8, DT-2R arms-only, DT-1 arm table kept), no hard gate");
  const L = 1.9, a = 0.8 * L, e = 1e-4;
  const below = rt.softClamp(1.0, L) === 1.0;
  const bounded = rt.softClamp(5, L) < L && rt.softClamp(-5, L) > -L;
  const slope = (rt.softClamp(a + e, L) - rt.softClamp(a - e, L)) / (2 * e);
  const c1 = Math.abs(rt.softClamp(a + e, L) - rt.softClamp(a - e, L)) < 3e-4 && Math.abs(slope - 1) < 1e-3;
  ok(below && bounded && c1, `soft clamp: identity/bound/C1 (slope=${slope.toFixed(4)})`);
}
// D3-7: smooth-vs-linear deviation bounded (no explosion).
{
  let maxd = 0;
  for (const clip of clips) {
    const step = (124 / clip.bpm) / 16;
    const n = Math.round(clip.counts * 16);
    for (let i = 0; i < n; i++) {
      const a = dancePose(clip, i * step, neutralPose());
      const b = dancePoseLinear(clip, i * step, neutralPose());
      for (const bone of [B_TORSO, B_HEAD, B_LEGL, B_LEGR, B_ARML, B_ARMR]) {
        maxd = Math.max(maxd, Math.abs(a.rx[bone] - b.rx[bone]),
          Math.abs(a.rz[bone] - b.rz[bone]));
      }
    }
  }
  // Bound is evidence-based: measured 0.6135 on single-key jitter spikes
  // (e.g. ateez k154 armL -0.465 between -1.9/-1.484) pulled to neighbors.
  ok(maxd <= 0.75, `smooth-vs-linear max dev = ${maxd.toFixed(4)} (<=0.75)`);
}

// D4-1: wag present in edit window (armR rz peak-to-peak k132-135 >= 0.4).
{
  const zs = [132, 133, 134, 135].map((k) => ateez.keys[k].armR.rz);
  const pp = Math.max(...zs) - Math.min(...zs);
  ok(pp >= 0.4, `D4 wag peak-to-peak = ${pp.toFixed(3)} (>=0.4)`);
}

console.log(fail === 0 ? "ALL DANCE CHECKS PASSED" : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
