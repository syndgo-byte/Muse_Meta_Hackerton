// DT-2 jitter sweep. DT-1 method (per scratch/dance/REPORT.md DT-1 section):
// 4000 steps (2000/clip), all-joints + arms-only, max frame-to-frame applied-
// angle jump + pop count, raw vs soft. The old 0.96 hard gate no longer exists
// (removed by design), so raw-vs-soft only. No 4% snap allowed in soft.
// Run: node scripts/sweep-jitter.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, "scratch", ".build-sweep");
const require = createRequire(import.meta.url);

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

const dances = require(join(BUILD, "motion", "dances", "index.js"));
const rig = require(join(BUILD, "autoRig.js"));
const rt = require(join(BUILD, "motion", "rigRetarget.js"));
const { dancePose, danceRoot, ateez, a2o } = dances;
const { B_TORSO, B_HEAD, B_LEGL, B_LEGR, B_ARML, B_ARMR, B_TAIL, neutralPose } = rig;

const ALL = [B_TORSO, B_HEAD, B_LEGL, B_LEGR, B_ARML, B_ARMR, B_TAIL];
const ARMS = [B_ARML, B_ARMR];
const CH = ["rx", "ry", "rz"];
const BONE_OF = new Map([
  [B_TORSO, "torso"], [B_HEAD, "head"], [B_LEGL, "legL"], [B_LEGR, "legR"],
  [B_ARML, "armL"], [B_ARMR, "armR"], [B_TAIL, "tail"],
]);
const POP_JUMP = 0.05; // pop = single-step applied-angle jump above this (rad)

function softApplied(pose) {
  // mirror BoneRetarget.pose clamping (soft path for DT1_SOFT_BONES)
  const out = {};
  for (const b of ALL) {
    const name = BONE_OF.get(b);
    const soft = rt.DT1_SOFT_ON && rt.DT1_SOFT_BONES.includes(name);
    const lim = soft ? rt.DT2_SOFT_CLAMP[name] : rt.RETARGET_TABLE[name].clamp;
    out[b] = CH.map((c, i) => {
      const v = pose[c][b];
      if (!soft) return Math.min(lim[i], Math.max(-lim[i], v));
      return rt.softClamp(v, lim[i]);
    });
  }
  return out;
}

function sweep(clip, bones, label) {
  const STEPS = 2000;
  const dur = (clip.counts * 60) / clip.bpm;
  let maxRaw = 0, maxSoft = 0, popRaw = 0, popSoft = 0;
  let prevRaw = null, prevSoft = null;
  for (let s = 0; s <= STEPS; s++) {
    const beat124 = ((s / STEPS) * dur * 124) / 60;
    const pose = dancePose(clip, beat124, neutralPose());
    const rd = danceRoot(clip, beat124);
    pose.ry[B_HEAD] = rd.headRy;
    pose.ry[B_TORSO] += rd.torsoRyAdd;
    const soft = softApplied(pose);
    if (prevRaw) {
      for (const b of bones) {
        for (let i = 0; i < 3; i++) {
          const jr = Math.abs(pose[CH[i]][b] - prevRaw[b][i]);
          const js = Math.abs(soft[b][i] - prevSoft[b][i]);
          if (jr > maxRaw) maxRaw = jr;
          if (js > maxSoft) maxSoft = js;
          if (jr > POP_JUMP) popRaw++;
          if (js > POP_JUMP) popSoft++;
        }
      }
    }
    prevRaw = {};
    prevSoft = soft;
    for (const b of bones) prevRaw[b] = [pose.rx[b], pose.ry[b], pose.rz[b]];
  }
  console.log(`${clip.id} ${label}: maxJump raw=${maxRaw.toFixed(4)} soft=${maxSoft.toFixed(4)}`
    + ` pop raw=${popRaw} soft=${popSoft}`);
  return { maxRaw, maxSoft, popRaw, popSoft };
}

console.log("DT-1 reference: ateez maxJump raw=hard=soft 0.1588 pop 456/461/401;"
  + " a2o maxJump raw=soft 0.0638 pop 28/30/28; no 4% snap.");
let fail = 0;
for (const clip of [ateez, a2o]) {
  const a = sweep(clip, ALL, "all-joints");
  const m = sweep(clip, ARMS, "arms-only");
  // gates: soft adds no jumps/pops over raw; arms within DT-1 maxima
  // (DT-1's 0.1588/0.0638 were arms-only; C1 continuity is pinned in
  // verify-dances, which is the real no-snap guard, not jump-size counting).
  const dt1max = clip.id === "ateez" ? 0.1588 : 0.0638;
  const checks = [
    ["soft maxJump <= raw", a.maxSoft <= a.maxRaw + 1e-9],
    ["soft pop <= raw", a.popSoft <= a.popRaw],
    ["arms soft maxJump <= raw", m.maxSoft <= m.maxRaw + 1e-9],
    ["arms soft pop <= raw", m.popSoft <= m.popRaw],
    [`arms soft maxJump <= DT-1 (${dt1max})`, m.maxSoft <= dt1max + 1e-4],
  ];
  for (const [msg, cond] of checks) {
    console.log(`  ${cond ? "PASS" : "FAIL"} ${msg}`);
    if (!cond) fail++;
  }
}
process.exit(fail ? 1 : 0);
