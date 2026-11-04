// F3-1: GLB를 고치지 않고 런타임에 눈꺼풀·입 메시를 만들어 머리 본에 붙인다.
// - 위치: lib/faceAnchors.ts (블렌더 Z-up → (x, z, -y), facePaint와 같은 변환)
// - 붙이기: 앵커 주변 스킨 정점의 가중치 합이 가장 큰 본에 bone.attach → 춤·걷기 중에도 따라감
// - 모양: 앵커 주변 표면을 2차식으로 맞춰(fit) 그 위로 살짝 띄운 격자. 매 값 변화 때 정점만 다시 계산.
// 텍스처·재질·GLB는 건드리지 않는다 (새 재질만 만든다).
import * as THREE from "three";
import { FACE_ANCHORS, type FaceAnchorPoint } from "../faceAnchors";

export type FaceMeshes = {
  /** 눈꺼풀 덮임 0(안 보임)..1(완전히 감음) */
  setLids: ((cover: number) => void) | null;
  /** 입: open 세로 벌림, round 동그랗게 (둘 다 0이면 안 보임) */
  setMouth: ((open: number, round: number) => void) | null;
  parts: THREE.Mesh[];
};

/**
 * 종별 눈꺼풀 보정 (F3-1c). scale=눈꺼풀 반지름 배율, ox/oy=중심 이동
 * (rEye 단위). ox는 양쪽 눈이 얼굴 중심선에서 멀어지는 쪽(거울대칭),
 * oy는 프레임 위쪽(양쪽 동일). 표에 없는 종은 기본값 그대로라 영향 없음.
 */
export type LidTune = { scale?: number; ox?: number; oy?: number };
export const LID_TUNE: Record<string, LidTune> = {
  // grass-01: 눈 간격 대비 눈이 커서 기본 반지름(0.36S)으로는 흰자리가 남는다.
  "grass-01": { scale: 1.3, ox: 0.15 },
};

type Frame = {
  o: THREE.Vector3; // 앵커 (world)
  x: THREE.Vector3;
  y: THREE.Vector3; // 위쪽
  n: THREE.Vector3; // 표면 바깥
  c: number[]; // z = c0 + c1 x + c2 y + c3 x² + c4 xy + c5 y²
  pts: Array<[number, number, number]>; // 주변 정점 (프레임 로컬)
  parent: THREE.Object3D;
  mesh: THREE.Mesh;
  vi: number; // 가장 가까운 정점 (검증용)
  color: THREE.Color;
};

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

function bodyMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !m.userData.face3d && m.geometry?.attributes.position) out.push(m);
  });
  const skinned = out.filter((m) => (m as THREE.SkinnedMesh).isSkinnedMesh);
  return skinned.length ? skinned : out;
}

// 6x6 최소제곱 (가우스 소거). 점이 적으면 평면(평균 높이)만.
function fitSurface(pts: Array<[number, number, number]>): number[] {
  if (pts.length < 10) return [pts.reduce((s, p) => s + p[2], 0) / Math.max(1, pts.length), 0, 0, 0, 0, 0];
  const A = Array.from({ length: 6 }, () => new Array(7).fill(0));
  for (const [x, y, z] of pts) {
    const f = [1, x, y, x * x, x * y, y * y];
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) A[i][j] += f[i] * f[j];
      A[i][6] += f[i] * z;
    }
  }
  for (let i = 0; i < 6; i++) A[i][i] += 1e-9;
  for (let i = 0; i < 6; i++) {
    let p = i;
    for (let r = i + 1; r < 6; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]];
    for (let r = 0; r < 6; r++) {
      if (r === i) continue;
      const k = A[r][i] / A[i][i];
      for (let c = i; c < 7; c++) A[r][c] -= k * A[i][c];
    }
  }
  return A.map((row, i) => row[6] / row[i]);
}
const surf = (c: number[], x: number, y: number) => c[0] + c[1] * x + c[2] * y + c[3] * x * x + c[4] * x * y + c[5] * y * y;

// 텍스처 평균색 (브라우저에서만; 실패/노드면 null).
const texCache = new WeakMap<object, { d: Uint8ClampedArray; w: number; h: number } | null>();
function texPixels(map: THREE.Texture | null | undefined) {
  const img = map?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!img || typeof document === "undefined") return null;
  if (texCache.has(img)) return texCache.get(img)!;
  let out: { d: Uint8ClampedArray; w: number; h: number } | null = null;
  try {
    const w = 256, h = 256;
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, w, h);
    out = { d: ctx.getImageData(0, 0, w, h).data, w, h };
  } catch {
    out = null;
  }
  texCache.set(img, out);
  return out;
}

function frameAt(root: THREE.Object3D, meshes: THREE.Mesh[], a: FaceAnchorPoint, r: number): Frame | null {
  // 앵커: meshes[0] 로컬 기준 (facePaint anchorToWorld와 동일).
  const o = new THREE.Vector3(a.pos[0], a.pos[2], -a.pos[1]).applyMatrix4(meshes[0].matrixWorld);
  const up = new THREE.Vector3(0, 1, 0).transformDirection(meshes[0].matrixWorld);
  let best = { m: null as THREE.Mesh | null, i: -1, d: Infinity };
  for (const m of meshes) {
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const d = _v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld).distanceToSquared(o);
      if (d < best.d) best = { m, i, d };
    }
  }
  const mesh = best.m;
  if (!mesh || Math.sqrt(best.d) > r * 1.5) return null; // 앵커가 몸에서 떨어져 있음
  const g = mesh.geometry;
  const P = g.attributes.position;
  const N = g.attributes.normal;
  const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const n0 = N ? new THREE.Vector3().fromBufferAttribute(N, best.i).applyMatrix3(nm).normalize() : new THREE.Vector3(0, 0, 1);
  // 주변 정점: 같은 쪽을 향한 것만 (팔·꼬리 등 다른 면 제외)
  const near: number[] = [];
  const n = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    _v.fromBufferAttribute(P, i).applyMatrix4(mesh.matrixWorld);
    const d = _v.distanceTo(o);
    if (d > r * 1.9) continue;
    if (N) {
      _w.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
      if (_w.dot(n0) < 0.2) continue;
      if (d < r) n.add(_w);
    }
    near.push(i);
  }
  if (n.lengthSq() < 1e-8) n.copy(n0);
  n.normalize();
  const x = new THREE.Vector3().crossVectors(up, n);
  if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
  x.normalize();
  const y = new THREE.Vector3().crossVectors(n, x).normalize();

  const pts: Array<[number, number, number]> = [];
  const skin = mesh as THREE.SkinnedMesh;
  const boneW = new Map<number, number>();
  const SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
  const uv = g.attributes.uv;
  const tex = texPixels((mesh.material as THREE.MeshStandardMaterial)?.map);
  const cols: number[][] = [[], [], []];
  for (const i of near) {
    _v.fromBufferAttribute(P, i).applyMatrix4(mesh.matrixWorld).sub(o);
    const lx = _v.dot(x), ly = _v.dot(y), lz = _v.dot(n);
    const rr = Math.hypot(lx, ly);
    if (rr < r * 1.4) pts.push([lx, ly, lz]);
    if (rr < r * 1.2 && SI && SW) {
      for (let k = 0; k < 4; k++) {
        const wgt = SW.getComponent(i, k);
        if (wgt > 0) boneW.set(SI.getComponent(i, k), (boneW.get(SI.getComponent(i, k)) ?? 0) + wgt);
      }
    }
    // 눈 위쪽 고리(눈썹 자리) = 눈꺼풀 피부색. 둘레 전체 평균은 털 무늬가 섞여 탁해짐.
    if (tex && uv && rr > r * 1.15 && rr < r * 1.8 && ly > r * 0.3) {
      const u = uv.getX(i) - Math.floor(uv.getX(i));
      const vv = uv.getY(i) - Math.floor(uv.getY(i));
      // glTF 텍스처 flipY=false → v 그대로 행
      const px = Math.min(tex.w - 1, Math.floor(u * tex.w));
      const py = Math.min(tex.h - 1, Math.floor(vv * tex.h));
      const k = (py * tex.w + px) * 4;
      for (let ch = 0; ch < 3; ch++) cols[ch].push(tex.d[k + ch]);
    }
  }
  let parent: THREE.Object3D = mesh;
  if (skin.isSkinnedMesh && boneW.size) {
    let bi = -1, bw = -1;
    boneW.forEach((w, i) => { if (w > bw) { bw = w; bi = i; } });
    parent = skin.skeleton.bones[bi] ?? mesh;
  }
  const mat = mesh.material as THREE.MeshStandardMaterial;
  const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1] / 255;
  const color = cols[0].length >= 3
    ? new THREE.Color().setRGB(med(cols[0]), med(cols[1]), med(cols[2]), THREE.SRGBColorSpace)
    : (mat?.color?.clone() ?? new THREE.Color(0xffffff));
  void root;
  return { o, x, y, n, c: fitSurface(pts), pts, parent, mesh, vi: best.i, color };
}

// 프레임(world) 기준으로 메시를 놓고 본에 붙인다. 정점은 프레임 로컬 (x, y, z=법선).
function place(f: Frame, geo: THREE.BufferGeometry, mat: THREE.MeshStandardMaterial, kind: string): THREE.Mesh {
  // 몸 재질 상태 따라가기 (dex: 미포획 반투명 홀로그램 / 포획 텍스처 발광)
  const body = f.mesh.material as THREE.MeshStandardMaterial;
  if (body && "emissive" in body) {
    mat.transparent = body.transparent;
    mat.opacity = body.opacity;
    mat.emissiveIntensity = body.emissiveIntensity;
    mat.emissive.copy(body.emissiveMap ? mat.color : body.emissive);
    mat.roughness = body.roughness;
  }
  const m = new THREE.Mesh(geo, mat);
  m.name = `Face3D_${kind}`;
  m.userData.face3d = { kind, vi: f.vi, body: f.mesh };
  m.matrix.makeBasis(f.x, f.y, f.n).setPosition(f.o);
  m.matrix.decompose(m.position, m.quaternion, m.scale);
  m.frustumCulled = false;
  m.castShadow = false;
  m.receiveShadow = false;
  m.layers.mask = f.mesh.layers.mask; // DexScene 슬롯 레이어 격리
  m.visible = false;
  f.parent.updateWorldMatrix(true, false);
  f.parent.attach(m);
  return m;
}

function lidMesh(f: Frame, r: number): { mesh: THREE.Mesh; set: (s: number) => void } {
  const NX = 16, NY = 9;
  const R = r * 1.16, bulge = r * 0.08;
  // 띄움 = 눈꺼풀 아래에서 가장 튀어나온 정점(눈썹 돌기 등)만큼. 고정 높이로 크게 띄우면 고개 젖힐 때 시차로 흰자가 비침.
  let lift = r * 0.03;
  for (const [px, py, pz] of f.pts) {
    const q = 1 - (px * px + py * py) / (R * R);
    if (q > 0) lift = Math.max(lift, pz - surf(f.c, px, py) - bulge * q + r * 0.03);
  }
  lift = Math.min(lift, r * 0.35); // 앵커 근처에 다른 부위가 섞인 경우 상한
  const pos = new Float32Array((NX + 1) * (NY + 1) * 3);
  const colA = new Float32Array((NX + 1) * (NY + 1) * 3);
  const idx: number[] = [];
  for (let j = 0; j <= NY; j++) {
    const t = j / NY;
    const shade = t > 0.82 ? 0.35 : 1; // 아래 가장자리 = 속눈썹 선
    for (let i = 0; i <= NX; i++) {
      const k = (j * (NX + 1) + i) * 3;
      colA[k] = colA[k + 1] = colA[k + 2] = shade;
      if (i < NX && j < NY) {
        const a = j * (NX + 1) + i;
        idx.push(a, a + NX + 1, a + 1, a + 1, a + NX + 1, a + NX + 2);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colA, 3));
  geo.setIndex(idx);
  const mat = new THREE.MeshStandardMaterial({
    color: f.color, vertexColors: true, roughness: 0.75, metalness: 0,
    side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = place(f, geo, mat, "lid");
  let last = -1;
  const set = (s: number) => {
    s = Math.min(1, Math.max(0, s));
    if (Math.abs(s - last) < 0.004) return;
    last = s;
    mesh.visible = s > 0.02;
    if (!mesh.visible) return;
    // 위 가장자리(원 윗부분)에서 아래로 내려오는 커튼. 아래 가장자리는 아래로 볼록.
    for (let j = 0; j <= NY; j++) {
      const t = j / NY;
      for (let i = 0; i <= NX; i++) {
        const xx = -R + (2 * R * i) / NX;
        const half = Math.sqrt(Math.max(0, R * R - xx * xx));
        const yTop = half;
        const yLow = Math.max(-half, Math.min(yTop, R - s * (R + half)));
        const yy = yTop + t * (yLow - yTop);
        const q = 1 - (xx * xx + yy * yy) / (R * R);
        const k = (j * (NX + 1) + i) * 3;
        pos[k] = xx;
        pos[k + 1] = yy;
        pos[k + 2] = surf(f.c, xx, yy) + lift + bulge * Math.max(0, q);
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
  };
  return { mesh, set };
}

function mouthMesh(f: Frame, hw: number): { mesh: THREE.Mesh; set: (o: number, r: number) => void } {
  const NR = 4, NA = 24;
  const pos = new Float32Array((1 + NR * NA) * 3);
  const idx: number[] = [];
  for (let a = 0; a < NA; a++) {
    const b = (a + 1) % NA;
    idx.push(0, 1 + b, 1 + a);
    for (let ring = 0; ring < NR - 1; ring++) {
      const p = 1 + ring * NA, q = p + NA;
      idx.push(p + a, p + b, q + a, p + b, q + b, q + a);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x3a0d10, roughness: 0.9, metalness: 0, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
  const mesh = place(f, geo, mat, "mouth");
  const lift = hw * 0.08;
  let lo = -1, lr = -1;
  const set = (open: number, round: number) => {
    if (Math.abs(open - lo) < 0.004 && Math.abs(round - lr) < 0.004) return;
    lo = open;
    lr = round;
    const rx = hw * (1 - 0.3 * round);
    const ry = hw * Math.max(open * 1.1, round * 0.7);
    mesh.visible = ry > hw * 0.04;
    if (!mesh.visible) return;
    const put = (k: number, xx: number, yy: number) => {
      pos[k * 3] = xx;
      pos[k * 3 + 1] = yy;
      pos[k * 3 + 2] = surf(f.c, xx, yy) + lift;
    };
    put(0, 0, 0);
    for (let ring = 0; ring < NR; ring++) {
      const rho = (ring + 1) / NR;
      for (let a = 0; a < NA; a++) {
        const th = (a / NA) * Math.PI * 2;
        put(1 + ring * NA + a, rx * rho * Math.cos(th), ry * rho * Math.sin(th));
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
  };
  return { mesh, set };
}

/** 앵커가 없거나 몸에서 떨어져 있으면 그 부위는 null. */
export function buildFaceMeshes(root: THREE.Object3D, speciesId: string): FaceMeshes | null {
  const set = FACE_ANCHORS[speciesId];
  if (!set) return null;
  root.updateWorldMatrix(true, true);
  const meshes = bodyMeshes(root);
  if (!meshes.length) return null;
  const box = new THREE.Box3();
  for (const m of meshes) box.expandByObject(m);
  const H = box.max.y - box.min.y;
  const toW = (a: FaceAnchorPoint) => new THREE.Vector3(a.pos[0], a.pos[2], -a.pos[1]).applyMatrix4(meshes[0].matrixWorld);
  // 크기 기준: 두 눈 사이 거리 (한 눈/눈 겹침이면 몸 높이). 모카퐁 실측 눈 반지름 ≈ 0.36×눈 간격.
  const eyeDist = set.eyeL && set.eyeR ? toW(set.eyeL).distanceTo(toW(set.eyeR)) : 0;
  const S = eyeDist > H * 0.05 ? eyeDist : H * 0.25;
  const rEye = Math.min(S * 0.36, H * 0.13);
  const eyes = (eyeDist > H * 0.05 ? [set.eyeL, set.eyeR] : [set.eyeL ?? set.eyeR]).filter(Boolean) as FaceAnchorPoint[];

  const parts: THREE.Mesh[] = [];
  const lids: Array<(s: number) => void> = [];
  const tune = LID_TUNE[speciesId] ?? {};
  const rLid = rEye * (tune.scale ?? 1);
  const tuneOx = tune.ox ?? 0;
  const tuneOy = tune.oy ?? 0;
  const mid = set.eyeL && set.eyeR ? toW(set.eyeL).add(toW(set.eyeR)).multiplyScalar(0.5) : null;
  for (const a of eyes) {
    const f = frameAt(root, meshes, a, rLid);
    if (f && (tuneOx !== 0 || tuneOy !== 0)) {
      const side = mid ? Math.sign(toW(a).sub(mid).dot(f.x)) || 1 : 1;
      f.o.addScaledVector(f.x, tuneOx * side * rEye).addScaledVector(f.y, tuneOy * rEye);
    }
    if (!f) continue;
    const l = lidMesh(f, rLid);
    parts.push(l.mesh);
    lids.push(l.set);
  }
  let setMouth: FaceMeshes["setMouth"] = null;
  if (set.mouth) {
    const hw = S * 0.14;
    const f = frameAt(root, meshes, set.mouth, Math.max(hw * 2, rEye));
    if (f) {
      const mm = mouthMesh(f, hw);
      parts.push(mm.mesh);
      setMouth = mm.set;
    }
  }
  if (!parts.length) return null;
  return {
    parts,
    setLids: lids.length ? (s) => lids.forEach((fn) => fn(s)) : null,
    setMouth,
  };
}
