// Builds OUR 24 roster creatures as original low-poly 3D models.
// Each species in lib/species.ts gets a faithful design (body color/shape,
// horns, ears, eyes, tail, hats, spots) matching its portrait prompt.
// Zero dependencies, no signups, no network. Output: public/models/<id>.glb
// Usage: node scripts/build-creature-models.mjs
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "public", "models");

// ---------- tiny geometry toolkit (non-indexed, flat normals) ----------
function makeKit() {
  const buckets = new Map(); // matIndex -> number[]
  const push = (m, a, b, c) => {
    if (!buckets.has(m)) buckets.set(m, []);
    buckets.get(m).push(a, b, c);
  };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  function tri(m, a, b, c) {
    const n = norm(cross(sub(b, a), sub(c, a)));
    const arr = buckets.get(m) ?? buckets.set(m, []).get(m);
    for (const p of [a, b, c]) arr.push(...p, ...n);
  }
  function octa(m, cx, cy, cz, rx, ry, rz) {
    const T = [cx, cy + ry, cz], B = [cx, cy - ry, cz];
    const X = [cx + rx, cy, cz], x = [cx - rx, cy, cz];
    const Z = [cx, cy, cz + rz], z = [cx, cy, cz - rz];
    tri(m, T, X, Z); tri(m, T, Z, x); tri(m, T, x, z); tri(m, T, z, X);
    tri(m, B, Z, X); tri(m, B, x, Z); tri(m, B, z, x); tri(m, B, X, z);
  }
  function pyramid(m, cx, cy, cz, r, h, dx = 0, dz = 0) {
    const A = [cx + dx * h, cy + h, cz + dz * h];
    const c = [[-r, -r], [r, -r], [r, r], [-r, r]].map(([ox, oz]) => [cx + ox, cy, cz + oz]);
    for (let i = 0; i < 4; i++) tri(m, A, c[i], c[(i + 1) % 4]);
    tri(m, c[0], c[2], c[1]); tri(m, c[0], c[3], c[2]);
  }
  function box(m, cx, cy, cz, w, h, d) {
    const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    const v = [[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];
    for (const [a, b, c, d] of [[0,1,2,3],[5,4,7,6],[4,0,3,7],[1,5,6,2],[3,2,6,7],[4,5,1,0]]) {
      tri(m, v[a], v[b], v[c]); tri(m, v[a], v[c], v[d]);
    }
  }
  return { buckets, tri, octa, pyramid, box };
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- species designs (match lib/species.ts portrait prompts) ----------
// c = color [r,g,b]; horns lean outward; tails/hats per species.
const CREAM = [0.96, 0.93, 0.82];
const DARK = [0.18, 0.16, 0.15];
const WHITE = [1, 1, 1];
const SPECIES = [
  { id: "fire-01", body: [0.85, 0.37, 0.12], shape: [1, 1, 0.95], horns: { n: 2, s: 0.55, c: DARK }, eyes: {}, tail: { k: "flame", c: [1, 0.55, 0.15] }, glow: [1, 0.6, 0.24] },
  { id: "fire-02", body: [0.95, 0.55, 0.2], shape: [0.95, 0.9, 0.9], ears: { k: "cat", c: [0.95, 0.55, 0.2] }, eyes: { s: 1.15 }, tail: { k: "flame", c: [1, 0.5, 0.1] }, glow: [1, 0.6, 0.24] },
  { id: "fire-03", body: [0.8, 0.2, 0.15], shape: [1.1, 0.95, 1], horns: { n: 1, s: 0.5, c: [0.25, 0.2, 0.18] }, dots: { c: [0.2, 0.18, 0.16], n: 6 }, glow: [1, 0.55, 0.2] },
  { id: "fire-04", body: [0.45, 0.2, 0.12], shape: [0.8, 1.2, 0.8], dots: { c: [1, 0.5, 0.12], n: 9 }, glow: [1, 0.55, 0.15] },
  { id: "fire-05", body: [0.97, 0.9, 0.75], shape: [0.95, 1.05, 0.9], hat: { k: "wick" }, glow: [1, 0.7, 0.3] },
  { id: "grass-01", body: [0.31, 0.61, 0.28], shape: [1, 1.05, 0.95], horns: { n: 2, s: 0.45, c: [0.25, 0.55, 0.25] }, feet: [0.42, 0.29, 0.18], glow: [0.62, 0.91, 0.44] },
  { id: "grass-02", body: [0.65, 0.85, 0.4], shape: [0.8, 1.15, 0.8], horns: { n: 2, s: 0.5, c: [0.3, 0.65, 0.3] }, tail: { k: "root", c: [0.5, 0.35, 0.2] }, glow: [0.62, 0.91, 0.44] },
  { id: "grass-03", body: [0.95, 0.9, 0.78], shape: [0.9, 0.85, 0.9], hat: { k: "cap", c: [0.8, 0.2, 0.2], dots: WHITE }, feet: [0.9, 0.8, 0.65], glow: [0.62, 0.91, 0.44] },
  { id: "grass-04", body: [0.45, 0.75, 0.35], shape: [1.05, 0.9, 1], ears: { k: "round", c: [0.35, 0.6, 0.3] }, tail: { k: "puff", c: WHITE }, glow: [0.62, 0.91, 0.44] },
  { id: "grass-05", body: [0.3, 0.6, 0.32], shape: [1, 1, 1], hat: { k: "bud", c: [1, 0.55, 0.7] }, dots: { c: [0.85, 0.95, 0.8], n: 8 }, glow: [0.62, 0.91, 0.44] },
  { id: "water-01", body: [0.35, 0.65, 0.95], shape: [0.85, 1.2, 0.85], ears: { k: "fin", c: [0.6, 0.85, 1] }, tail: { k: "drop", c: [0.4, 0.7, 1] }, glow: [0.49, 0.78, 1] },
  { id: "water-02", body: [0.3, 0.6, 0.9], shape: [0.9, 1, 0.9], hat: { k: "helmet", c: [0.6, 0.62, 0.65] }, glow: [0.49, 0.78, 1] },
  { id: "water-03", body: [0.55, 0.8, 0.9], shape: [1, 0.95, 1], horns: { n: 3, s: 0.4, c: [0.2, 0.5, 0.3] }, feet: [0.55, 0.5, 0.45], glow: [0.49, 0.78, 1] },
  { id: "water-04", body: [0.4, 0.7, 0.55], shape: [1.1, 0.9, 1], hat: { k: "cloud" }, eyes: { s: 1.2 }, glow: [0.49, 0.78, 1] },
  { id: "water-05", body: [0.75, 0.88, 0.95], shape: [0.85, 1.05, 0.85], dots: { c: WHITE, n: 8 }, ears: { k: "round", c: [0.9, 0.95, 1] }, glow: [0.49, 0.78, 1] },
  { id: "rock-01", body: [0.55, 0.52, 0.48], shape: [1.1, 0.9, 1], hat: { k: "brow" }, dots: { c: [0.35, 0.55, 0.3], n: 5 }, glow: [1, 0.77, 0.42] },
  { id: "rock-02", body: [0.5, 0.5, 0.52], shape: [1.15, 1, 1], horns: { n: 2, s: 0.5, c: [0.5, 0.3, 0.2] }, dots: { c: [0.95, 0.6, 0.15], n: 4 }, glow: [1, 0.77, 0.42] },
  { id: "rock-03", body: [0.6, 0.58, 0.55], shape: [1, 1, 1], eyes: { n: 1, s: 1.6 }, glow: [1, 0.77, 0.42] },
  { id: "rock-04", body: [0.35, 0.3, 0.4], shape: [0.95, 0.9, 0.9], ears: { k: "bat", c: [0.3, 0.25, 0.35] }, dots: { c: [0.55, 0.85, 1], n: 6 }, tail: { k: "fin", c: [0.3, 0.25, 0.35] }, glow: [0.7, 0.85, 1] },
  { id: "wind-01", body: [0.5, 0.77, 0.71], shape: [0.85, 1.2, 0.85], hat: { k: "scarf" }, feet: WHITE, glow: [0.84, 1, 0.95] },
  { id: "wind-02", body: [0.85, 0.85, 0.8], shape: [0.8, 0.85, 0.8], eyes: { s: 1.2 }, glow: [1, 0.95, 0.8] },
  { id: "wind-03", body: [0.95, 0.95, 0.92], shape: [0.8, 1, 0.8], hat: { k: "wings" }, tail: { k: "string", c: [0.7, 0.7, 0.7] }, glow: [0.84, 1, 0.95] },
  { id: "wind-04", body: [0.6, 0.8, 0.9], shape: [0.9, 0.9, 0.9], hat: { k: "blades" }, glow: [0.84, 1, 0.95] },
  { id: "wind-05", body: [0.97, 0.93, 0.85], shape: [1.25, 0.9, 1.1], eyes: { sleepy: true }, dots: { c: [0.85, 0.7, 0.5], n: 5 }, glow: [1, 0.95, 0.85] },
];

function buildCreature(sp) {
  const kit = makeKit();
  const { octa, pyramid, box } = kit;
  const rnd = mulberry32(hashStr(sp.id));
  const mats = [];
  const matIdx = new Map();
  function M(color, emissive) {
    const key = color.join(",") + (emissive ? "+e" + emissive.join(",") : "");
    if (!matIdx.has(key)) {
      matIdx.set(key, mats.length);
      const m = { name: `m${mats.length}`, pbrMetallicRoughness: { baseColorFactor: [...color, 1], roughnessFactor: 0.65, metallicFactor: 0 } };
      if (emissive) m.emissiveFactor = emissive;
      mats.push(m);
    }
    return matIdx.get(key);
  }
  const mBody = M(sp.body), mBelly = M(sp.belly ?? CREAM), mDark = M(DARK), mWhite = M(WHITE);
  const mGlow = M([0.12, 0.12, 0.12], [sp.glow[0] * 0.9, sp.glow[1] * 0.9, sp.glow[2] * 0.9]);
  const [sx, sy, sz] = sp.shape;
  const rx = 0.75 * sx, ry = 0.95 * sy, rz = 0.7 * sz;

  octa(mBody, 0, 0, 0, rx, ry, rz);                                  // body
  octa(mBelly, 0, -ry * 0.28, rz * 0.72, rx * 0.55, ry * 0.58, rz * 0.32); // cream belly
  octa(mBody, -rx - 0.12, -0.1, 0, 0.15, 0.28, 0.15);                // arms
  octa(mBody, rx + 0.12, -0.1, 0, 0.15, 0.28, 0.15);

  const feetC = sp.feet ?? DARK;
  const mFeet = M(feetC);
  box(mFeet, -0.3, -ry - 0.06, 0.05, 0.3, 0.22, 0.4);                // feet
  box(mFeet, 0.3, -ry - 0.06, 0.05, 0.3, 0.22, 0.4);

  if (sp.horns) {                                                    // horns / sprouts / seaweed
    const mH = M(sp.horns.c);
    for (let i = 0; i < sp.horns.n; i++) {
      const a = sp.horns.n === 1 ? 0 : (i / (sp.horns.n - 1) - 0.5) * 1.6 + (rnd() - 0.5) * 0.3;
      pyramid(mH, Math.sin(a) * 0.3, ry * 0.72, Math.cos(a * 0.5) * 0.1 - 0.05,
        0.13, sp.horns.s * (0.85 + rnd() * 0.4), Math.sin(a) * 0.55, -0.1);
    }
  }
  if (sp.ears === undefined && sp.id !== "rock-03") {
    // default: nothing (horns/hats carry the silhouette)
  }
  if (sp.ears?.k === "cat" || sp.ears?.k === "bat") {
    const mE = M(sp.ears.c);
    const tall = sp.ears.k === "bat" ? 0.55 : 0.38;
    pyramid(mE, -0.3, ry * 0.62, 0, 0.16, tall, -0.25, 0);
    pyramid(mE, 0.3, ry * 0.62, 0, 0.16, tall, 0.25, 0);
  } else if (sp.ears?.k === "fin") {
    const mE = M(sp.ears.c);
    pyramid(mE, -rx - 0.25, 0.15, 0, 0.1, 0.3, -0.9, 0);
    pyramid(mE, rx + 0.25, 0.15, 0, 0.1, 0.3, 0.9, 0);
  } else if (sp.ears?.k === "round") {
    const mE = M(sp.ears.c);
    octa(mE, -0.42, ry * 0.55, -0.05, 0.16, 0.2, 0.12);
    octa(mE, 0.42, ry * 0.55, -0.05, 0.16, 0.2, 0.12);
  } else if (sp.ears?.k === "leaf") {
    const mE = M(sp.ears.c);
    pyramid(mE, -0.25, ry * 0.7, 0, 0.12, 0.4, -0.5, 0);
    pyramid(mE, 0.25, ry * 0.7, 0, 0.12, 0.4, 0.5, 0);
  }

  const eyeN = sp.eyes?.n ?? 2;
  const eyeS = sp.eyes?.s ?? 1;
  const eyeY = 0.28, eyeZ = rz * 0.8;
  const eyeXs = eyeN === 1 ? [0] : [-0.24, 0.24];
  for (const ex of eyeXs) {
    const es = eyeS * (eyeN === 1 ? 1 : 1);
    if (sp.eyes?.sleepy) {
      box(mWhite, ex, eyeY, eyeZ, 0.2 * es, 0.07, 0.1);              // sleepy lids
      box(mGlow, ex, eyeY - 0.01, eyeZ + 0.04, 0.12 * es, 0.03, 0.06);
    } else {
      octa(mWhite, ex, eyeY, eyeZ, 0.14 * es, 0.16 * es, 0.1);
      octa(mGlow, ex, eyeY, eyeZ + 0.09, 0.06 * es, 0.07 * es, 0.05);
    }
  }

  if (sp.tail?.k === "flame") {
    const mT = M(sp.tail.c, [sp.tail.c[0] * 0.8, sp.tail.c[1] * 0.8, sp.tail.c[2] * 0.8]);
    octa(mBody, 0, -0.4, -rz - 0.2, 0.14, 0.14, 0.35);
    octa(mT, 0, -0.25, -rz - 0.5, 0.16, 0.22, 0.16);
  } else if (sp.tail?.k === "drop") {
    const mT = M(sp.tail.c);
    octa(mT, 0, -0.3, -rz - 0.25, 0.14, 0.2, 0.3);
  } else if (sp.tail?.k === "puff" || sp.tail?.k === "fin") {
    const mT = M(sp.tail.c);
    octa(mT, 0, -0.15, -rz - 0.2, 0.18, 0.18, 0.22);
  } else if (sp.tail?.k === "root") {
    const mT = M(sp.tail.c);
    for (let i = -1; i <= 1; i++) pyramid(mT, i * 0.15, -ry - 0.15, -0.1, 0.06, 0.35, i * 0.2, -0.3);
  } else if (sp.tail?.k === "string") {
    box(M(sp.tail.c), 0, -0.5, -rz - 0.15, 0.05, 0.7, 0.05);
  }

  const hat = sp.hat;
  if (hat?.k === "cap") {                                            // mushroom cap + spots
    const mCap = M(hat.c);
    octa(mCap, 0, ry * 0.95, 0, rx * 1.15, ry * 0.5, rz * 1.15);
    const mD = M(hat.dots);
    for (let i = 0; i < 6; i++) {
      const a = rnd() * Math.PI * 2, r = 0.25 + rnd() * 0.45;
      octa(mD, Math.cos(a) * r * rx, ry * (1.05 + rnd() * 0.25), Math.sin(a) * r * rz, 0.09, 0.06, 0.09);
    }
  } else if (hat?.k === "cloud") {
    octa(mWhite, -0.25, ry + 0.25, 0, 0.28, 0.2, 0.25);
    octa(mWhite, 0.2, ry + 0.32, 0, 0.32, 0.22, 0.28);
    octa(mWhite, 0, ry + 0.18, 0.1, 0.25, 0.18, 0.22);
  } else if (hat?.k === "helmet") {
    const mH = M(hat.c);
    octa(mH, 0, ry * 0.85, -0.05, rx * 0.85, ry * 0.4, rz * 0.9);
    box(mH, 0.25, ry * 0.8, rz * 0.7, 0.3, 0.12, 0.25);
  } else if (hat?.k === "bud") {
    const mB = M(hat.c);
    pyramid(M([0.3, 0.6, 0.3]), 0, ry * 0.8, 0, 0.12, 0.15, 0, 0);
    octa(mB, 0, ry + 0.28, 0, 0.14, 0.16, 0.14);
  } else if (hat?.k === "wick") {
    box(mDark, 0, ry + 0.1, 0, 0.07, 0.25, 0.07);
    octa(M([1, 0.6, 0.2], [1, 0.5, 0.15]), 0, ry + 0.35, 0, 0.09, 0.14, 0.09);
  } else if (hat?.k === "blades") {
    const mB = M([0.9, 0.95, 1]);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      box(mB, Math.cos(a) * 0.3, ry + 0.35 + Math.sin(a) * 0.3, 0, 0.42, 0.12, 0.04);
    }
    octa(mDark, 0, ry + 0.35, 0, 0.08, 0.08, 0.08);
  } else if (hat?.k === "wings") {
    const mW = M([0.96, 0.96, 0.94]);
    pyramid(mW, -rx - 0.45, 0.25, -0.1, 0.35, 0.5, -0.7, 0);
    pyramid(mW, rx + 0.45, 0.25, -0.1, 0.35, 0.5, 0.7, 0);
  } else if (hat?.k === "scarf") {
    octa(mWhite, 0, -0.05, 0, rx * 1.05, 0.18, rz * 1.05);
    box(mWhite, 0.35, -0.35, 0.3, 0.18, 0.4, 0.1);
  } else if (hat?.k === "brow") {
    box(mDark, 0, eyeY + 0.22, eyeZ - 0.02, 0.62, 0.12, 0.15);
  }

  if (sp.dots) {                                                     // body spots / cracks / frost
    const mD = M(sp.dots.c, undefined);
    for (let i = 0; i < sp.dots.n; i++) {
      const th = (rnd() - 0.5) * 2.0, ph = (rnd() - 0.5) * 1.6;
      octa(mD, Math.sin(th) * rx * 1.0, Math.sin(ph) * ry * 0.9, Math.cos(th) * rz * 1.0,
        0.07, 0.07, 0.05);
    }
  }
  if (sp.id === "grass-05") {                                        // cactus thorns ring
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      pyramid(mWhite, Math.cos(a) * rx * 1.0, (rnd() - 0.5) * ry, Math.sin(a) * rz * 1.0, 0.04, 0.12, Math.cos(a), Math.sin(a));
    }
  }
  return { buckets: kit.buckets, mats };
}

// ---------- GLB writer ----------
function toGlb(id, built) {
  const pos = [], nrm = [], prims = [];
  let vcount = 0;
  for (const [m, arr] of built.buckets) {
    const n = arr.length / 6;
    if (!n) continue;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < arr.length; i += 6) {
      pos.push(arr[i], arr[i + 1], arr[i + 2]); nrm.push(arr[i + 3], arr[i + 4], arr[i + 5]);
      for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], arr[i + a]); mx[a] = Math.max(mx[a], arr[i + a]); }
    }
    prims.push({ material: m, start: vcount, count: n, min: mn, max: mx });
    vcount += n;
  }
  const posBuf = Buffer.alloc(pos.length * 4), nrmBuf = Buffer.alloc(nrm.length * 4);
  for (let i = 0; i < pos.length; i++) posBuf.writeFloatLE(pos[i], i * 4);
  for (let i = 0; i < nrm.length; i++) nrmBuf.writeFloatLE(nrm[i], i * 4);
  const bin = Buffer.concat([posBuf, nrmBuf]);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3)
    for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], pos[i + a]); max[a] = Math.max(max[a], pos[i + a]); }
  const accessors = [];
  const primitives = prims.map((p) => {
    const base = accessors.length;
    accessors.push(
      { bufferView: 0, byteOffset: p.start * 12, componentType: 5126, count: p.count, type: "VEC3", min: p.min, max: p.max },
      { bufferView: 1, byteOffset: p.start * 12, componentType: 5126, count: p.count, type: "VEC3" },
    );
    return { attributes: { POSITION: base, NORMAL: base + 1 }, material: p.material };
  });
  const json = {
    asset: { version: "2.0", generator: `oishie-originals (${id})` },
    scene: 0, scenes: [{ nodes: [0], name: id }],
    nodes: [{ mesh: 0, name: id }],
    meshes: [{ name: id, primitives }],
    materials: built.mats,
    accessors,
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBuf.length, target: 34962 },
      { buffer: 0, byteOffset: posBuf.length, byteLength: nrmBuf.length, target: 34962 },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  const jsonBuf = Buffer.from(JSON.stringify(json), "utf8");
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  const binPad = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + jsonBuf.length + jsonPad + 8 + bin.length + binPad;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
  let o = 12;
  out.writeUInt32LE(jsonBuf.length + jsonPad, o); out.writeUInt32LE(0x4e4f534a, o + 4); o += 8;
  jsonBuf.copy(out, o); o += jsonBuf.length;
  for (let i = 0; i < jsonPad; i++) out[o++] = 0x20;
  out.writeUInt32LE(bin.length + binPad, o); out.writeUInt32LE(0x004e4942, o + 4); o += 8;
  bin.copy(out, o);
  return { out, json };
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const rows = [];
  for (const sp of SPECIES) {
    const built = buildCreature(sp);
    const { out, json } = toGlb(sp.id, built);
    if (out.readUInt32LE(0) !== 0x46546c67 || out.readUInt32LE(4) !== 2 || out.readUInt32LE(8) !== out.length)
      throw new Error(`invalid GLB: ${sp.id}`);
    if (!json.meshes[0].primitives.length || !json.materials.length) throw new Error(`empty mesh: ${sp.id}`);
    await fs.writeFile(path.join(OUT, `${sp.id}.glb`), out);
    rows.push(`| ${sp.id}.glb (${(out.length / 1024).toFixed(1)} KB) | original — authored in-repo from the species portrait brief | CC0 |`);
  }
  await fs.writeFile(path.join(OUT, "ATTRIBUTION.md"), [
    "# 3D creature assets — attribution",
    "",
    "All 24 files are ORIGINAL low-poly models authored in-repo by",
    "`scripts/build-creature-models.mjs` from each species' portrait brief in",
    "`lib/species.ts`. No third-party art. License: CC0.",
    "",
    "| file | source | license |",
    "|---|---|---|",
    ...rows,
    "",
  ].join("\n"));
  console.log(`done: ${rows.length} original creature models`);
  for (const r of rows) console.log(" -", r.split("|")[1].trim(), r.split("|")[2].trim().slice(0, 60));
}

main().catch((e) => { console.error("build-creature-models failed:", e); process.exit(1); });
