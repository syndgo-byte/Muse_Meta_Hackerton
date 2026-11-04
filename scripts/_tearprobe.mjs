// throwaway FR-1b: per-species emote tear probe. Mirrors scripts/verify-rigged.mjs
// R-C-6 math exactly (poseCases, CPU skinning, drift<=1% + stretch<=30%H).
// usage: node emote-tear.mjs <glbdir> <id1,id2,...>
// glbdir holds <id>.glb files (backup or live).
import { readFileSync, writeFileSync } from "node:fs";

globalThis.self = globalThis;
const THREE = await import("three");
const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
const err0 = console.error;
console.error = (...a) => {
  if (typeof a[0] === "string" && a[0].includes("Couldn't load texture")) return;
  err0(...a);
};
const DIR = process.argv[2];
const IDS = process.argv[3].split(",");
const loader = new GLTFLoader();
async function load(path) {
  const buf = readFileSync(path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return loader.parseAsync(ab, "");
}
const { execFileSync } = await import("node:child_process");
const { createRequire } = await import("node:module");
const { mkdirSync, rmSync } = await import("node:fs");
const { join } = await import("node:path");
const BUILD = join("scratch", ".build-tearprobe");
rmSync(BUILD, { recursive: true, force: true });
mkdirSync(BUILD, { recursive: true });
execFileSync(process.execPath, [
  join("node_modules", "typescript", "bin", "tsc"),
  join("lib", "motion", "dances", "index.ts"),
  join("lib", "autoRig.ts"),
  join("lib", "motion", "rigRetarget.ts"),
  "--outDir", BUILD, "--module", "commonjs", "--target", "es2020",
  "--moduleResolution", "node", "--skipLibCheck", "--esModuleInterop",
], { stdio: "inherit" });
const require = createRequire(join(process.cwd(), "scratch", "x.cjs"));
const rig = require(join(process.cwd(), BUILD, "autoRig.js"));
const emotesMod = require(join(process.cwd(), BUILD, "motion", "emotes.js"));
const rtx = require(join(process.cwd(), BUILD, "motion", "rigRetarget.js"));
const { EMOTE_DUR } = emotesMod;
const { poseFor } = rig;
const { BoneRetarget } = require(join(process.cwd(), BUILD, "motion", "rigRetarget.js"));
const { RIG_TAIL_EXTRA, applyMissingBoneFallback } = rtx;
const EMOTE12 = ["greet", "happy", "pat", "cuddle", "cry", "hurt", "attack", "eat",
  "drowsy", "zoomies", "beg", "faint"];
const out = [];
for (const id of IDS) {
  const g = await load(`${DIR}/${id}.glb`);
  g.scene.updateMatrixWorld(true);
  let sm2;
  g.scene.traverse((o) => { if (o.isSkinnedMesh && !sm2) sm2 = o; });
  const bones2 = new Map(sm2.skeleton.bones.map((b) => [b.name, b]));
  const rt2 = new BoneRetarget(g.scene, bones2, [RIG_TAIL_EXTRA]);
  const posB = sm2.geometry.attributes.position;
  const idxB = sm2.geometry.attributes.skinIndex;
  const wgtB = sm2.geometry.attributes.skinWeight;
  const jointOf2 = new Map(sm2.skeleton.bones.map((b, i) => [b.name, i]));
  const headJ2 = jointOf2.get("head");
  const torsoJ2 = jointOf2.get("torso");
  const headW2 = (i) => {
    let w = 0;
    for (let k = 0; k < 4; k++) {
      if (idxB.getComponent(i, k) === headJ2) w += wgtB.getComponent(i, k);
    }
    return w;
  };
  const torsoW2 = (i) => {
    let w = 0;
    for (let k = 0; k < 4; k++) {
      if (idxB.getComponent(i, k) === torsoJ2) w += wgtB.getComponent(i, k);
    }
    return w;
  };
  sm2.geometry.computeBoundingBox();
  const gb2 = sm2.geometry.boundingBox;
  const H2 = gb2.max.y - gb2.min.y;
  const face2 = [];
  for (let i = 0; i < posB.count; i++) {
    if (headJ2 !== undefined) {
      if (headW2(i) > 1 - 1e-6) face2.push(i);
    } else if (torsoW2(i) > 1 - 1e-6 && posB.getY(i) > gb2.min.y + 0.55 * H2) {
      face2.push(i);
    }
  }
  const K2 = 200;
  const stride2 = Math.max(1, Math.floor(face2.length / K2));
  const sample2 = face2.filter((_, k) => k % stride2 === 0).slice(0, K2);
  const indexAttr = sm2.geometry.index;
  const triCount = indexAttr ? indexAttr.count / 3 : Math.floor(posB.count / 3);
  const corner = (t, c) => indexAttr ? indexAttr.getX(t * 3 + c) : t * 3 + c;
  const allEdges = [];
  for (let t = 0; t < triCount; t++) {
    const a = corner(t, 0), b = corner(t, 1), c = corner(t, 2);
    allEdges.push([a, b], [b, c], [c, a]);
  }
  const estride = Math.max(1, Math.floor(allEdges.length / 3000));
  const edges = allEdges.filter((_, k) => k % estride === 0).slice(0, 3000);
  const _m2 = new THREE.Matrix4();
  const _v2 = new THREE.Vector3();
  const skinnedAt2 = (i, out) => {
    out.set(posB.getX(i), posB.getY(i), posB.getZ(i));
    out.applyMatrix4(sm2.bindMatrix);
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 4; k++) {
      const w = wgtB.getComponent(i, k);
      if (!w) continue;
      const j = idxB.getComponent(i, k);
      _m2.multiplyMatrices(sm2.skeleton.bones[j].matrixWorld, sm2.skeleton.boneInverses[j]);
      _v2.copy(out).applyMatrix4(_m2);
      x += _v2.x * w;
      y += _v2.y * w;
      z += _v2.z * w;
    }
    out.set(x, y, z).applyMatrix4(sm2.bindMatrixInverse);
    out.applyMatrix4(sm2.matrixWorld);
    return out;
  };
  const rest2 = sample2.map((i) => skinnedAt2(i, new THREE.Vector3()));
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const restEdge = edges.map(([a, b]) =>
    skinnedAt2(a, new THREE.Vector3()).distanceTo(skinnedAt2(b, new THREE.Vector3())));
  const poseCases = [];
  for (const em of EMOTE12) {
    const hugs = em === "eat" ? [false, true] : [false];
    for (const hug of hugs) {
      const dur = EMOTE_DUR[em];
      for (let f = 0; f < 8; f++) {
        const e = ((f + 0.5) / 8) * dur;
        poseCases.push({
          label: hug ? `${em}+hug` : em,
          pose: poseFor({ emote: em, k: e / dur, t: e, e, walkAmp: 0, walkPhase: 0, hug, dancing: false, beat: 0 }),
        });
      }
    }
  }
  for (let f = 0; f < 8; f++) {
    const b = (f + 0.5);
    poseCases.push({
      label: "dance",
      pose: poseFor({ emote: "idle", k: 0, t: b, e: b, walkAmp: 0, walkPhase: 0, hug: false, dancing: true, beat: b }),
    });
  }
  for (let f = 0; f < 4; f++) {
    poseCases.push({
      label: "walk",
      pose: poseFor({ emote: "idle", k: 0, t: f, e: f, walkAmp: 1, walkPhase: (f / 4) * Math.PI * 2, hug: false, dancing: false, beat: 0 }),
    });
  }
  const worst = new Map();
  for (const { label, pose } of poseCases) {
    applyMissingBoneFallback(pose, bones2);
    rt2.pose(pose);
    g.scene.updateMatrixWorld(true);
    sm2.skeleton.update();
    const cur = sample2.map((i) => skinnedAt2(i, new THREE.Vector3()));
    let md = worst.get(label)?.drift ?? 0;
    for (let a = 0; a < sample2.length; a++) {
      for (let b = a + 1; b < sample2.length; b++) {
        const d0 = rest2[a].distanceTo(rest2[b]);
        if (d0 < 1e-3 * H2) continue;
        const d = cur[a].distanceTo(cur[b]);
        const drift = Math.abs(d - d0) / d0;
        if (!(drift <= md)) md = Number.isNaN(drift) ? Infinity : drift;
      }
    }
    let ms = worst.get(label)?.stretch ?? 0;
    for (let ei = 0; ei < edges.length; ei++) {
      const [a, b] = edges[ei];
      skinnedAt2(a, tmpA);
      skinnedAt2(b, tmpB);
      const st = Math.abs(tmpA.distanceTo(tmpB) - restEdge[ei]) / H2;
      if (st > ms) ms = st;
    }
    worst.set(label, { drift: md, stretch: ms });
  }
  let wD = 0, wS = 0, wSL = "";
  for (const [label, w] of worst.entries()) {
    if (w.drift > wD) wD = w.drift;
    if (w.stretch > wS) { wS = w.stretch; wSL = label; }
  }
  const ok = wD <= 0.01 && wS <= 0.30;
  console.log(`${ok ? "TEAR-OK  " : "TEAR-FAIL"} ${id} drift=${(wD * 100).toFixed(3)}% maxStretch=${(wS * 100).toFixed(2)}%H@${wSL} faceN=${face2.length}`);
  out.push({ id, drift: wD, stretch: wS, stretchLabel: wSL, faceN: face2.length, ok });
}
writeFileSync(process.env.TEAR_OUT || "scratch/.tearprobe.json", JSON.stringify(out, null, 1));
