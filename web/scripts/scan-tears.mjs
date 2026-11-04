// DT-2: dance tear scan. CPU-skins every /dex rigged GLB through every dance
// clip at >=15fps and flags tears (edge stretch > 1.8 or normal flip).
// Pose path reuses the production code (compiled dancePose/danceRoot/BoneRetarget)
// with a minimal headless GLB reader (positions/normals/skin only, no textures).
// Run: node scripts/scan-tears.mjs [--species=<id>] [--clip=<ateez|a2o>] [--fps=15]
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, "scratch", ".build-tear");
const require = createRequire(import.meta.url);

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)=(.*)$/);
  return m ? [m[1], m[2]] : [a.replace(/^--/, ""), "1"];
}));
const FPS = Number(args.fps ?? 15);
const TEAR_RATIO = 1.8; // DT-2 order: stretch ratio threshold
const WANT_SPECIES = args.species ?? null;
const WANT_CLIP = args.clip ?? null;

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
const THREE = require(join(ROOT, "node_modules", "three", "build", "three.cjs"));
const dances = require(join(BUILD, "motion", "dances", "index.js"));
const rig = require(join(BUILD, "autoRig.js"));
const { dancePose, danceRoot, ateez, a2o } = dances;
const { B_TORSO, B_HEAD, neutralPose } = rig;
const { BoneRetarget } = require(join(BUILD, "motion", "rigRetarget.js"));

// ---------- minimal GLB reader (skin-relevant data only) ----------
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function readGlb(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: not a GLB`);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString("utf8", 20, 20 + jsonLen));
  const binOff = 20 + jsonLen;
  let bin = null;
  if (binOff + 8 <= buf.length) {
    const binLen = buf.readUInt32LE(binOff);
    bin = buf.subarray(binOff + 8, binOff + 8 + binLen);
  }
  return { json, bin: bin ?? Buffer.alloc(0) };
}
function accessorArray(g, bin, idx) {
  const acc = g.accessors[idx];
  const view = g.bufferViews[acc.bufferView];
  const n = NCOMP[acc.type];
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const stride = view.byteStride ?? 0;
  const out = new Float64Array(acc.count * n);
  const ct = acc.componentType;
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < n; c++) {
      const o = base + (stride ? i * stride : i * n * compSize(ct)) + c * compSize(ct);
      out[i * n + c] = compRead(dv, o, ct);
    }
  }
  return { data: out, count: acc.count, n };
}
function compSize(ct) {
  return ct === 5120 || ct === 5121 ? 1 : ct === 5122 || ct === 5123 ? 2 : 4;
}
function compRead(dv, o, ct) {
  if (ct === 5126) return dv.getFloat32(o, true);
  if (ct === 5123) return dv.getUint16(o, true);
  if (ct === 5125) return dv.getUint32(o, true);
  if (ct === 5121) return dv.getUint8(o);
  if (ct === 5120) return dv.getInt8(o);
  if (ct === 5122) return dv.getInt16(o, true);
  throw new Error(`componentType ${ct}`);
}
function nodeLocalMatrix(nd) {
  const t = nd.translation ?? [0, 0, 0];
  const r = nd.rotation ?? [0, 0, 0, 1];
  const s = nd.scale ?? [1, 1, 1];
  return new THREE.Matrix4().compose(
    new THREE.Vector3(t[0], t[1], t[2]),
    new THREE.Quaternion(r[0], r[1], r[2], r[3]),
    new THREE.Vector3(s[0], s[1], s[2]));
}

function loadSpecies(glbPath) {
  const { json: g, bin } = readGlb(glbPath);
  const root = new THREE.Group();
  const nodeObjs = g.nodes.map((nd, i) => {
    const o = new THREE.Bone();
    o.name = nd.name ?? `node${i}`;
    o.matrix.copy(nodeLocalMatrix(nd));
    o.matrix.decompose(o.position, o.quaternion, o.scale);
    o.matrixAutoUpdate = true;
    o.updateMatrix();
    return o;
  });
  const hasParent = new Array(g.nodes.length).fill(false);
  g.nodes.forEach((nd, i) => {
    for (const c of nd.children ?? []) {
      nodeObjs[i].add(nodeObjs[c]);
      hasParent[c] = true;
    }
  });
  const sceneIdx = g.scene ?? 0;
  for (const r of g.scenes[sceneIdx].nodes) root.add(nodeObjs[r]);
  root.updateMatrixWorld(true);
  // skinned primitives: mesh node world at bind + per-joint IBM
  const prims = [];
  g.nodes.forEach((nd, ni) => {
    if (nd.mesh === undefined || nd.skin === undefined) return;
    const mesh = g.meshes[nd.mesh];
    const skin = g.skins[nd.skin];
    const ibm = accessorArray(g, bin, skin.inverseBindMatrices).data;
    const ibms = skin.joints.map((_, j) =>
      new THREE.Matrix4().fromArray(ibm.subarray(j * 16, j * 16 + 16)));
    const bind = nodeObjs[ni].matrixWorld.clone();
    const bindInv = bind.clone().invert();
    for (const p of mesh.primitives) {
      const pos = accessorArray(g, bin, p.attributes.POSITION);
      const nrm = p.attributes.NORMAL !== undefined
        ? accessorArray(g, bin, p.attributes.NORMAL) : null;
      const joints = accessorArray(g, bin, p.attributes.JOINTS_0);
      const weights = accessorArray(g, bin, p.attributes.WEIGHTS_0);
      let index = null;
      if (p.indices !== undefined) {
        index = Array.from(accessorArray(g, bin, p.indices).data);
      } else {
        index = [...Array(pos.count).keys()];
      }
      prims.push({
        pos: pos.data, nrm: nrm?.data ?? null, joints: joints.data,
        weights: weights.data, index, count: pos.count,
        jointNodes: skin.joints, ibms, bind, bindInv,
      });
    }
  });
  const bones = new Map();
  for (const o of nodeObjs) if (o.name) bones.set(o.name, o);
  return { root, nodeObjs, bones, prims, nodeNames: g.nodes.map((n, i) => n.name ?? `node${i}`) };
}

// ---------- CPU skin + tear metric ----------
function buildEdges(index) {
  const set = new Set();
  const edges = [];
  for (let t = 0; t + 2 < index.length; t += 3) {
    const tri = [index[t], index[t + 1], index[t + 2]];
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3];
      const k = a < b ? a * 1e7 + b : b * 1e7 + a;
      if (!set.has(k)) { set.add(k); edges.push(a, b); }
    }
  }
  return new Uint32Array(edges);
}

function skinPrim(prim, nodeObjs, outPos, outNrm) {
  const { joints, weights, count, jointNodes, ibms, bind, bindInv } = prim;
  const nj = jointNodes.length;
  // A_j = bindInv * (W_j * IBM_j) * bind, hoisted as element arrays.
  const AE = new Float64Array(nj * 16);
  const m1 = new THREE.Matrix4(), m2 = new THREE.Matrix4();
  for (let j = 0; j < nj; j++) {
    m1.multiplyMatrices(nodeObjs[jointNodes[j]].matrixWorld, ibms[j]);
    m2.multiplyMatrices(bindInv, m1).multiply(bind);
    AE.set(m2.elements, j * 16);
  }
  const P = prim.pos;
  for (let v = 0; v < count; v++) {
    let x = 0, y = 0, z = 0;
    const px = P[v * 3], py = P[v * 3 + 1], pz = P[v * 3 + 2];
    for (let k = 0; k < 4; k++) {
      const w = weights[v * 4 + k];
      if (w === 0) continue;
      const e = joints[v * 4 + k] * 16;
      x += w * (AE[e] * px + AE[e + 4] * py + AE[e + 8] * pz + AE[e + 12]);
      y += w * (AE[e + 1] * px + AE[e + 5] * py + AE[e + 9] * pz + AE[e + 13]);
      z += w * (AE[e + 2] * px + AE[e + 6] * py + AE[e + 10] * pz + AE[e + 14]);
    }
    outPos[v * 3] = x; outPos[v * 3 + 1] = y; outPos[v * 3 + 2] = z;
  }
  if (prim.nrm && outNrm) {
    const N = prim.nrm;
    for (let v = 0; v < count; v++) {
      let x = 0, y = 0, z = 0;
      const nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2];
      for (let k = 0; k < 4; k++) {
        const w = weights[v * 4 + k];
        if (w === 0) continue;
        const e = joints[v * 4 + k] * 16;
        x += w * (AE[e] * nx + AE[e + 4] * ny + AE[e + 8] * nz);
        y += w * (AE[e + 1] * nx + AE[e + 5] * ny + AE[e + 9] * nz);
        z += w * (AE[e + 2] * nx + AE[e + 6] * ny + AE[e + 10] * nz);
      }
      const l = Math.hypot(x, y, z) || 1;
      outNrm[v * 3] = x / l; outNrm[v * 3 + 1] = y / l; outNrm[v * 3 + 2] = z / l;
    }
  }
}

function maxWeightJoint(prim, v) {
  let bj = 0, bw = -1;
  for (let k = 0; k < 4; k++) {
    const w = prim.weights[v * 4 + k];
    if (w > bw) { bw = w; bj = prim.joints[v * 4 + k]; }
  }
  return bj;
}

function scanClip(speciesId, data, clip) {
  const { root, nodeObjs, bones, prims, nodeNames } = data;
  // reset bones to rest (a previous scanClip left them posed with autoUpdate off)
  for (const o of nodeObjs) o.matrixAutoUpdate = true;
  root.updateMatrixWorld(true);
  const retarget = new BoneRetarget(root, bones); // no extras: DexScene passes none
  // rest pass (neutral pose) + edge tables
  retarget.pose(neutralPose());
  root.updateMatrixWorld(true);
  let restErr = 0;
  for (const prim of prims) {
    prim.edges = buildEdges(prim.index);
    prim.restPos = new Float64Array(prim.count * 3);
    prim.restNrm = prim.nrm ? new Float64Array(prim.count * 3) : null;
    skinPrim(prim, nodeObjs, prim.restPos, prim.restNrm);
    prim.restLen = new Float64Array(prim.edges.length / 2);
    for (let e = 0; e < prim.edges.length; e += 2) {
      const a = prim.edges[e] * 3, b = prim.edges[e + 1] * 3;
      const dx = prim.restPos[a] - prim.restPos[b];
      const dy = prim.restPos[a + 1] - prim.restPos[b + 1];
      const dz = prim.restPos[a + 2] - prim.restPos[b + 2];
      prim.restLen[e / 2] = Math.hypot(dx, dy, dz);
    }
    for (let v = 0; v < prim.count * 3; v++) {
      restErr = Math.max(restErr, Math.abs(prim.restPos[v] - prim.pos[v]));
    }
    prim.defPos = new Float64Array(prim.count * 3);
    prim.defNrm = prim.nrm ? new Float64Array(prim.count * 3) : null;
  }
  const dur = (clip.counts * 60) / clip.bpm;
  const nFrames = Math.max(1, Math.floor(dur * FPS));
  let worst = null; // {ratio, frame, prim, edge, va, vb, joint}
  let worstBig = null; // worst among edges with rest length >= 1e-4
  const top = []; // top-5 by ratio (dedup by frame+edge)
  let flipCount = 0, worstFlip = null;
  let ev18 = 0, ev3 = 0, ev10 = 0; // edge*frame events over ratio bands
  let evBig = 0; // events with restLen >= 1e-3
  const evVerts = new Set(); // unique verts touching a >1.8 edge
  const flipVerts = new Set();
  const evByJoint = new Map();
  let badFrames = 0;
  let bbMin = [1e9, 1e9, 1e9], bbMax = [-1e9, -1e9, -1e9];
  const t0 = Date.now();
  for (let f = 0; f < nFrames; f++) {
    const t = f / FPS;
    const beat124 = (t * 124) / 60;
    const pose = dancePose(clip, beat124, neutralPose());
    const rd = danceRoot(clip, beat124);
    pose.ry[B_HEAD] = rd.headRy;
    pose.ry[B_TORSO] += rd.torsoRyAdd;
    const AMP = Number(args.amp ?? 1);
    if (AMP !== 1) {
      for (const a of [pose.rx, pose.ry, pose.rz]) {
        for (let i = 0; i < a.length; i++) a[i] *= AMP;
      }
    }
    if (args.zero) {
      const { B_TORSO: ZT, B_HEAD: ZH, B_LEGL: ZL, B_LEGR: ZR, B_ARML: ZAL, B_ARMR: ZAR } = rig;
      const ZM = { torso: ZT, head: ZH, legL: ZL, legR: ZR, armL: ZAL, armR: ZAR };
      for (const zn of String(args.zero).split(",")) {
        const zi = ZM[zn];
        if (zi === undefined) continue;
        pose.rx[zi] = 0; pose.ry[zi] = 0; pose.rz[zi] = 0;
      }
    }
    retarget.pose(pose);
    root.updateMatrixWorld(true);
    const evBefore = ev18;
    for (let pi = 0; pi < prims.length; pi++) {
      const prim = prims[pi];
      skinPrim(prim, nodeObjs, prim.defPos, prim.defNrm);
      const D = prim.defPos, E = prim.edges, RL = prim.restLen;
      for (let e = 0; e < E.length; e += 2) {
        const rl = RL[e / 2];
        if (rl < 1e-9) continue;
        const a = E[e] * 3, b = E[e + 1] * 3;
        const dx = D[a] - D[b], dy = D[a + 1] - D[b + 1], dz = D[a + 2] - D[b + 2];
        const r = Math.sqrt(dx * dx + dy * dy + dz * dz) / rl;
        if (r > TEAR_RATIO) {
          ev18++;
          if (r > 3) ev3++;
          if (r > 10) ev10++;
          if (rl >= 1e-3) evBig++;
          evVerts.add(`${pi}:${E[e]}`);
          evVerts.add(`${pi}:${E[e + 1]}`);
          const ja = maxWeightJoint(prim, E[e]);
          const jn = nodeNames[prim.jointNodes[ja]] ?? `j${ja}`;
          evByJoint.set(jn, (evByJoint.get(jn) ?? 0) + 1);
        }
        if (args.verbose && (top.length < 5 || r > top[top.length - 1].ratio)) {
          top.push({ ratio: r, frame: f, beat124, prim: pi, restLen: rl, joint: null, va: E[e], vb: E[e + 1] });
          top.sort((a, b) => b.ratio - a.ratio);
          if (top.length > 5) top.length = 5;
        }
        if (rl >= 1e-4 && (!worstBig || r > worstBig.ratio)) {
          const va = E[e], vb = E[e + 1];
          const ja = maxWeightJoint(prim, va);
          worstBig = {
            ratio: r, frame: f, beat124, prim: pi, va, vb, restLen: rl,
            joint: nodeNames[prim.jointNodes[ja]] ?? `j${ja}`,
            edgeVec: [
              prim.restPos[a] - prim.restPos[b],
              prim.restPos[a + 1] - prim.restPos[b + 1],
              prim.restPos[a + 2] - prim.restPos[b + 2],
            ],
          };
        }
        if (!worst || r > worst.ratio) {
          const va = E[e], vb = E[e + 1];
          const ja = maxWeightJoint(prim, va);
          worst = {
            ratio: r, frame: f, beat124, prim: pi, va, vb,
            joint: nodeNames[prim.jointNodes[ja]] ?? `j${ja}`,
            edgeVec: [
              prim.restPos[a] - prim.restPos[b],
              prim.restPos[a + 1] - prim.restPos[b + 1],
              prim.restPos[a + 2] - prim.restPos[b + 2],
            ],
          };
        }
      }
      if (prim.defNrm) {
        const DN = prim.defNrm, RN = prim.restNrm;
        for (let v = 0; v < prim.count; v++) {
          const d = DN[v * 3] * RN[v * 3] + DN[v * 3 + 1] * RN[v * 3 + 1] + DN[v * 3 + 2] * RN[v * 3 + 2];
          if (d < 0) {
            flipCount++;
            flipVerts.add(`${pi}:${v}`);
            if (!worstFlip || d < worstFlip.dot) {
              const ja = maxWeightJoint(prim, v);
              worstFlip = {
                dot: d, frame: f, beat124, prim: pi, vert: v,
                joint: nodeNames[prim.jointNodes[ja]] ?? `j${ja}`,
              };
            }
          }
        }
      }
    }
    if (ev18 !== evBefore) badFrames++;
  }
  const ms = Date.now() - t0;
  // attribute joints for verbose top-5 (needs prim refs)
  for (const s of top) {
    const prim = prims[s.prim];
    const ja = maxWeightJoint(prim, s.va);
    s.joint = nodeNames[prim.jointNodes[ja]] ?? `j${ja}`;
    const wstr = (v) => [0, 1, 2, 3]
      .map((k) => `${nodeNames[prim.jointNodes[prim.joints[v * 4 + k]]]}:${prim.weights[v * 4 + k].toFixed(2)}`)
      .filter((t) => !t.endsWith(":0.00")).join(" ");
    const pstr = (v) => [0, 1, 2].map((c) => prim.restPos[v * 3 + c].toFixed(3)).join(",");
    s.anat = `va@${pstr(s.va)}[${wstr(s.va)}] vb@${pstr(s.vb)}[${wstr(s.vb)}]`;
  }
  // model bbox diagonal (rest pose) for scale context
  for (const prim of prims) {
    for (let v = 0; v < prim.count; v++) {
      for (let c = 0; c < 3; c++) {
        const x = prim.restPos[v * 3 + c];
        if (x < bbMin[c]) bbMin[c] = x;
        if (x > bbMax[c]) bbMax[c] = x;
      }
    }
  }
  const bbDiag = Math.hypot(bbMax[0] - bbMin[0], bbMax[1] - bbMin[1], bbMax[2] - bbMin[2]);
  return {
    worst, worstBig, top, flipCount, worstFlip, flipVerts: flipVerts.size,
    ev18, ev3, ev10, evBig, evVerts: evVerts.size, bbDiag,
    evByJoint: [...evByJoint.entries()].sort((a, b) => b[1] - a[1]),
    badFrames, nFrames, restErr, ms,
  };
}

// ---------- driver ----------
if (args.peaks) {
  // Per-joint|axis peak |angle| over each clip (dancePose + danceRoot head/torso
  // compensation, pre-retarget). Informs soft-limit choice (<=10% shave).
  const { B_TORSO: PT, B_HEAD: PH, B_LEGL: PL, B_LEGR: PR, B_ARML: PAL, B_ARMR: PAR, B_TAIL: PTA } = rig;
  const JN = [[PT, "torso"], [PH, "head"], [PL, "legL"], [PR, "legR"], [PAL, "armL"], [PAR, "armR"], [PTA, "tail"]];
  for (const clip of [ateez, a2o]) {
    console.log(`clip ${clip.id} (bpm ${clip.bpm}, counts ${clip.counts}):`);
    const dur = (clip.counts * 60) / clip.bpm;
    const n = Math.floor(dur * FPS);
    const peak = {};
    for (const [, nm] of JN) peak[nm] = [0, 0, 0];
    for (let f = 0; f < n; f++) {
      const beat124 = (f / FPS) * 124 / 60;
      const pose = dancePose(clip, beat124, neutralPose());
      const rd = danceRoot(clip, beat124);
      pose.ry[PH] = rd.headRy;
      pose.ry[PT] += rd.torsoRyAdd;
      for (const [bi, nm] of JN) {
        peak[nm][0] = Math.max(peak[nm][0], Math.abs(pose.rx[bi]));
        peak[nm][1] = Math.max(peak[nm][1], Math.abs(pose.ry[bi]));
        peak[nm][2] = Math.max(peak[nm][2], Math.abs(pose.rz[bi]));
      }
    }
    for (const [, nm] of JN) {
      console.log(`  ${nm}: [${peak[nm].map((v) => v.toFixed(3)).join(", ")}]`);
    }
  }
  process.exit(0);
}

if (args.validate) {
  // Rigid check: rotate torso rx=0.3 alone; edges whose endpoints are both
  // 100% single-joint weighted must keep ratio ~1.0 if the math is right.
  const { B_TORSO: BT } = rig;
  const id = WANT_SPECIES ?? "grass-01";
  const data = loadSpecies(join(ROOT, "public", "models-rigged", `${id}.glb`));
  const retarget = new BoneRetarget(data.root, data.bones);
  retarget.pose(neutralPose());
  data.root.updateMatrixWorld(true);
  const prim = data.prims[0];
  const rest = new Float64Array(prim.count * 3);
  skinPrim(prim, data.nodeObjs, rest, null);
  const pose = neutralPose();
  pose.rx[BT] = 0.3;
  retarget.pose(pose);
  data.root.updateMatrixWorld(true);
  const def = new Float64Array(prim.count * 3);
  skinPrim(prim, data.nodeObjs, def, null);
  const edges = buildEdges(prim.index);
  let nRigid = 0, maxRigid = 0, maxAll = 0;
  for (let e = 0; e < edges.length; e += 2) {
    const va = edges[e], vb = edges[e + 1];
    const a = va * 3, b = vb * 3;
    const rl = Math.hypot(rest[a] - rest[b], rest[a + 1] - rest[b + 1], rest[a + 2] - rest[b + 2]);
    if (rl < 1e-9) continue;
    const dl = Math.hypot(def[a] - def[b], def[a + 1] - def[b + 1], def[a + 2] - def[b + 2]);
    const r = dl / rl;
    if (r > maxAll) maxAll = r;
    const singleJoint = (v) => {
      let n = 0, wmax = 0, j = -1;
      for (let k = 0; k < 4; k++) {
        const w = prim.weights[v * 4 + k];
        if (w > 1e-6) { n++; wmax = Math.max(wmax, w); j = prim.joints[v * 4 + k]; }
      }
      return n === 1 && wmax > 1 - 1e-6 ? j : -1;
    };
    const ja = singleJoint(va), jb = singleJoint(vb);
    if (ja >= 0 && ja === jb) {
      nRigid++;
      if (r > maxRigid) maxRigid = r;
    }
  }
  console.log(`validate ${id}: rigid edges ${nRigid}, maxRigidRatio ${maxRigid.toFixed(6)} (want ~1.0), maxAll ${maxAll.toFixed(3)}`);
  process.exit(0);
}

function domAxis(v) {
  const [x, y, z] = v.map(Math.abs);
  return x >= y && x >= z ? "x" : y >= z ? "y" : "z";
}

const clips = [ateez, a2o].filter((c) => !WANT_CLIP || c.id === WANT_CLIP);
const riggedDir = join(ROOT, "public", "models-rigged");
let speciesIds = readdirSync(riggedDir).filter((f) => f.endsWith(".glb")).map((f) => f.slice(0, -4));
if (WANT_SPECIES) speciesIds = speciesIds.filter((s) => s === WANT_SPECIES);
if (!speciesIds.length) {
  console.error("no species GLB matched");
  process.exit(1);
}

const rows = [];
let tearCases = 0;
console.log(`scan: ${speciesIds.length} species x ${clips.map((c) => c.id).join(",")} @${FPS}fps, threshold ${TEAR_RATIO}`);
for (const id of speciesIds) {
  const glbPath = join(riggedDir, `${id}.glb`);
  const mtime = statSync(glbPath).mtime.toISOString();
  let data;
  try {
    data = loadSpecies(glbPath);
  } catch (e) {
    console.log(`${id}: LOAD FAIL ${e.message}`);
    continue;
  }
  const nVerts = data.prims.reduce((s, p) => s + p.count, 0);
  for (const clip of clips) {
    const r = scanClip(id, data, clip);
    const tear = (r.worst && r.worst.ratio > TEAR_RATIO) || r.flipCount > 0;
    const flag = tear ? "TEAR" : "ok";
    const wsum = r.worst
      ? `max ${r.worst.ratio.toFixed(3)} @beat${r.worst.beat124.toFixed(2)} f${r.worst.frame} ${r.worst.joint}`
      : "no edges";
    const fsum = r.flipCount > 0
      ? ` flips ${r.flipCount} worst ${r.worstFlip.dot.toFixed(3)} @beat${r.worstFlip.beat124.toFixed(2)} ${r.worstFlip.joint}`
      : "";
    console.log(`${id} ${clip.id}: ${flag} ${wsum}${fsum} restErr ${r.restErr.toExponential(1)}`
      + ` frames ${r.nFrames} verts ${nVerts} bb ${r.bbDiag.toFixed(2)}`
      + ` ev>1.8 ${r.ev18} (>3:${r.ev3} >10:${r.ev10} big:${r.evBig} verts:${r.evVerts}) flipVerts ${r.flipVerts}`
      + ` badFrames ${r.badFrames}/${r.nFrames} byJoint ${r.evByJoint.map(([j, n]) => `${j}:${n}`).join(" ")}`
      + ` ${(r.ms / 1000).toFixed(1)}s`);
    if (args.verbose) {
      console.log(`  worstBig(>=1e-4): ${r.worstBig ? `${r.worstBig.ratio.toFixed(3)} restLen ${r.worstBig.restLen.toExponential(2)} @beat${r.worstBig.beat124.toFixed(2)} ${r.worstBig.joint}` : "none"}`);
      for (const s of r.top) {
        console.log(`  top r=${s.ratio.toFixed(2)} restLen=${s.restLen.toExponential(2)} @beat${s.beat124.toFixed(2)} f${s.frame} ${s.joint} p${s.prim} v${s.va}/${s.vb}`);
        console.log(`    ${s.anat}`);
      }
    }
    if (tear) {
      tearCases++;
      const stretchTear = r.worst && r.worst.ratio > TEAR_RATIO;
      const ev = stretchTear ? r.worst : r.worstFlip;
      rows.push([
        id, ev.joint, clip.id, ev.beat124.toFixed(2), FPS,
        stretchTear ? r.worst.ratio.toFixed(4) : r.worst.ratio.toFixed(4),
        stretchTear ? domAxis(r.worst.edgeVec) : `flip:${r.worstFlip.dot.toFixed(3)}`,
        `models-rigged/${id}.glb`, mtime,
      ].join(","));
    }
  }
}
const csvPath = join(ROOT, "scratch", "dance", "tears.csv");
const header = "species,joint,clip,beat,fps,ratio,axis,glb,glb_mtime";
mkdirSync(dirname(csvPath), { recursive: true });
writeFileSync(csvPath, `${header}\n${rows.join("\n")}${rows.length ? "\n" : ""}`);
console.log(`\ntear cases: ${tearCases} -> ${csvPath}`);
