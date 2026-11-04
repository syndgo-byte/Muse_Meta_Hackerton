// Face expression system v4: measured UV texture switching (no floating planes).
// baked 텍스처 위에 눈/입 glyph를 직접 페인트한 변형 텍스처를 미리 구워두고
// setFace에서 map만 교체한다. 얼굴 곡면/UV와 100% 일체화된 진짜 3D 표정.
// (1) 돌출 안구 0: Floating Sphere 방식은 존재하지 않으며(생성 코드 0건),
//     attachFace는 어떤 메시도 추가하지 않는다(compat용 빈 group만 반환).
//     레거시 외부 눈이 모델에 주입돼 있으면 purge하고 시작한다(아래 purge 블록).
// (2) DecalGeometry 미도입 (평가 후 기각): UV paint는 머리 메시 자신의 텍셀에
//     직접 그리므로 법선 곡률 밀착이 정의상 완벽하고, autoRig CPU 스키닝에도
//     정점을 따라 자동 추종한다. 별도 데칼 메시는 오프셋+z-fighting 튜닝을
//     부활시키고 스킨 변형을 따라가지 못해 돌출/어긋남이 재발한다.
//     필요 시 표준 경로: three/examples/jsm/geometries/DecalGeometry.js
//     (three 0.170.0 + @types/three 0.170 동봉 확인, 본 모듈은 import하지 않음).
// (3) Baked-face 보존: 전안(全眼)에서 휘도 대비 ≥18이면 원본 GLB 베이크드
//     페이스로 판정(판정식 아래 bakedFace 주석) → 휴지 상태(baked|baked)는
//     변형 캔버스 복사본이 아니라 원본 base 텍스처 객체를 그대로 재바인딩.
// (4) 실측 배치: 눈 라인=정면 휘도 분산 스캔 최대점, 눈 중심=측정 스팬의
//     3등분점+개별 대비 스냅, 디스크=상대 크기. 종별 눈대중 수치(eyeY/eyeS/
//     eyeW/eyeTilt/cxDX/mouthS)는 삭제 — TUNE에는 구조 플래그만 남는다.
// - 입 = 검출된 눈 라인 아래 고정 오프셋 + 정면 히트 검증 (가슴팍 입 원천 차단).
// - glyph 축소·세선화: 반달 눈웃음 ∩, 하트눈, 얇은 깜빡임선, 작은 ∪ 미소/벌림입.
// - 배킹 = glyph 바깥 테두리 링의 순수 털색 (baked 눈 잔상 없이 완전 커버).
// - 입이 없는 종(Type B)은 mouth paint 생략 + 무입 분기 (아래 TUNE.hasMouth)
// - 얼굴 자체가 없는 종(rock-03)은 noFace → ok:false (몸짓만)
import * as THREE from "three";
// 5a: PARAM 종 목록 + 프리웜 표 (런타임 순환 없음: faces→emotes만 의존).
import { PARAM_FACE_SPECIES, PARAM_PREWARM } from "./motion/faces";
// R-F-anchors: Blender anchor positions (generated copy of the JSON; truth file untouched).
import { FACE_ANCHORS, type FaceAnchorPoint } from "./faceAnchors";

// FN-1: 표정 덧대기 전면 off. 원래 모델 눈(baked)은 어떤 종도 지우거나
// 덮지 않는다. false면 attachFace가 paint 없이 반환하고 깜빡임(덧대기)도
// 멈춘다. 코드·데이터는 유지, 상수 하나로 되돌릴 수 있다.
export const FACE_PAINT_ENABLED = false;
// FN-1 검증용: 눈 텍스처 교체 횟수 (apply 호출마다 +1, headless 판독용).
export const facePaintDebug = { writes: 0 };



  

export type EyeState = "baked" | "heart" | "happy" | "closed" | "sad" | "wow";
export type MouthState = "baked" | "smile" | "open" | "flat" | "ooh";

type Tune = {
  single?: boolean; // one eye (center placement + single snap)
  hasMouth?: boolean; // default true. false → Type B (무입: 입 paint 금지)
  noFace?: boolean; // default false. true → paint 전체 생략
  fur?: string; // 털색 오버라이드 (없으면 볼 실측 자동 채취)
};

// 24종 구조 테이블. 기하 수치 없음 — 눈/입 배치는 전종 실측 파이프라인
// (scanEyeLine → third-points → refineEye → 상대 오프셋 입)이 담당한다.
// 구 v3 눈대중 수치(eyeY 24종·eyeS 6종·eyeW/eyeTilt/cxDX/mouthS 일부·
// mouthY 레거시)는 실측 기준으로 대체되어 삭제됨.
const TUNE: Record<string, Tune> = {
  "fire-01": {},
  "grass-01": {},
  "water-01": { hasMouth: false },
  "fire-02": {},
  "fire-03": {},
  "fire-04": { hasMouth: false },
  "fire-05": {},
  "grass-02": { hasMouth: false, fur: "#d8bd8f" },
  "grass-03": {},
  "grass-04": {},
  "grass-05": { hasMouth: false },
  "water-02": { hasMouth: false },
  "water-03": {},
  "water-04": {},
  "water-05": {},
  "rock-01": { hasMouth: false, fur: "#8d8478" },
  "rock-02": { fur: "#9a968e" },
  // 자갈이: 외눈 UV 파편화로 glyph 불가 → baked 유지 + 몸짓 표현.
  "rock-03": { hasMouth: false, noFace: true, fur: "#8d8478" },
  "rock-04": {},
  "wind-01": { hasMouth: false, fur: "#bccfd8" },
  "wind-02": { hasMouth: false },
  "wind-03": { hasMouth: false },
  "wind-04": {},
  "wind-05": {},
};

export function speciesHasMouth(id: string): boolean {
  return TUNE[id]?.hasMouth ?? true;
}
export function speciesNoFace(id: string): boolean {
  return TUNE[id]?.noFace ?? false;
}

// 5a 파라미터 (MOTION_WORKORDER.md §5a). lid/lidLow/mouthOpen 0~1,
// pupil 0.6~1.4 (원본 눈 확대/축소), smile −1~1.
export type FaceParams = {
  lid: number;
  lidLow: number;
  pupil: number;
  smile: number;
  mouthOpen: number;
};

export type FaceRig = {
  group: THREE.Group; // compat anchor (empty: 플레인 없음)
  setFace: (eyes: EyeState, mouth: MouthState) => void;
  // 5a 파라미터 얼굴. PARAM 종에서만 호출된다 (그 외 종 호출 시에도 동작은 함).
  setFaceParams: (p: FaceParams, paintMouth?: boolean, eyes?: EyeState) => void;
  setMouthFrame: (open: boolean) => void;
  ok: boolean;
  fur: string;
  mouthLive: boolean; // mouth paint 성공 여부 (false면 무입 동작)
  bakedFace: boolean; // 원본 GLB 베이크드 페이스 판정 (휴지 시 base 텍스처 보존)
};

type Sample = { u: number; v: number; x: number; y: number };
type Patch = {
  mat: THREE.MeshStandardMaterial;
  u0: number; v0: number; w: number; h: number;
  worlds: Float32Array; // per-texel world x,y (IDW smooth)
  valid: Uint8Array; // per-texel validity (near-cluster gate)
  edge: Float32Array; // J-3: validity-edge feather weight 0..1 (1 = interior)
  count: number; // valid texels
  cx: number; cy: number; R: number; // eye disc (world)
  Rb: number; // backing disc radius (world; eyes erase wider than the glyph)
  kind: "eye" | "mouth";
  mRx: number; mRy: number; // mouth ellipse radii (world)
  backing: [number, number, number]; // local-average base color
  wpt: number; // world-per-texel estimate (AA ramp)
};

// Golden-angle spiral disc points (unit disc).
function spiral(n: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [[0, 0]];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 1; i < n; i++) {
    const r = Math.sqrt(i / n);
    const a = i * golden;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return pts;
}

function sstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// J-3 edge feather: pure blend weights only (position math untouched).
// Verified by scripts/verify-face-feather.mjs — keep these pure (no DOM/THREE).
export const VALID_GATE_PX = 20; // texel-validity gate (unchanged: same painted texels)
export const VALID_FULL_PX = 12; // full paint weight at/below this sample distance
export function validEdgeWeight(dminPx: number): number {
  return 1 - sstep(VALID_FULL_PX, VALID_GATE_PX, dminPx);
}
export const STROKE_AA_K = 2.5; // legacy 1.2 (param eye 1.5): wider stroke ramps
export function strokeAA(wpt: number, radius: number): number {
  return (wpt / radius) * STROKE_AA_K;
}
export function endCapFade(ax: number, lim: number, aa: number): number {
  return 1 - sstep(lim - 2 * aa, lim, ax);
}
// Quadratic-ellipse-metric cover with a uniform linear-space ramp (pupil/tongue).
export function discCoverLin(v: number, aa: number): number {
  return 1 - sstep(1 - 2 * aa, 1 + 2 * aa, Math.sqrt(Math.max(v, 0)));
}
export function backingSpatial(r: number, a: number): number {
  return 1 - sstep(a, 1.0, r);
}

// Glyph coverage tests. Eye: (nx,ny) in disc units. Returns [coverage, r,g,b].
// J-3: exported for scripts/verify-face-feather.mjs (no binary edges).
export function eyeGlyph(
  state: Exclude<EyeState, "baked">,
  nx: number,
  ny: number,
  aa: number,
  heartPath: Path2D,
  scratch: CanvasRenderingContext2D,
  // 5a: 하트 크기 (pupil 매핑. 기본 1 = 기존과 동일).
  heartScale = 1
): [number, number, number, number] {
  const cov = (d: number, w: number) => 1 - sstep(w - aa, w + aa, Math.abs(d));
  if (state === "heart") {
    // Path2D hit test (unit-disc coords via transform). J-3: 3×3 taps soften
    // the otherwise binary outline; sparkle dot blends pink→white.
    const hx = nx / heartScale, hy = ny / heartScale;
    scratch.save();
    scratch.setTransform(1, 0, 0, 1, 0, 0);
    let hits = 0;
    for (const [ox, oy] of [[0, 0], [aa, 0], [-aa, 0], [0, aa], [0, -aa], [aa, aa], [aa, -aa], [-aa, aa], [-aa, -aa]]) {
      if (scratch.isPointInPath(heartPath, hx + ox, hy + oy)) hits++;
    }
    scratch.restore();
    const hc = hits / 9;
    if (hc <= 0) return [0, 0, 0, 0];
    const hd = Math.hypot(hx + 0.22, hy + 0.27);
    const hl = 1 - sstep(0.15 - 1.2 * aa, 0.15 + 1.2 * aa, hd);
    return [hc, 255, 77 + (255 - 77) * hl, 109 + (255 - 109) * hl];
  }
  if (state === "happy") {
    // 반달 눈웃음 ∩: peak (0,0.25), ends (±0.55,−0.30). 얇은 선으로 재생성.
    const d = Math.hypot(nx, ny + 0.30) - 0.55;
    const c = ny > -0.32 ? cov(d, 0.075) * endCapFade(Math.abs(nx), 0.62, aa) : 0;
    return [c, 43, 33, 24];
  }
  if (state === "closed") {
    // 눈 깜빡임 − −: 눈 중앙의 얇은 속눈썹선.
    const d = ny - (-0.02 + 0.06 * nx * nx);
    return [cov(d, 0.07) * endCapFade(Math.abs(nx), 0.6, aa), 43, 33, 24];
  }
  if (state === "sad") {
    const pupil = (nx / 0.24) ** 2 + ((ny + 0.02) / 0.30) ** 2;
    const pc = discCoverLin(pupil, aa);
    if (pc > 0) {
      const hd = Math.hypot(nx - 0.08, ny + 0.10);
      const hl = 1 - sstep(0.09 - 1.2 * aa, 0.09 + 1.2 * aa, hd);
      return [pc, 43 + (160 - 43) * hl, 33 + (220 - 33) * hl, 24 + (255 - 24) * hl];
    }
    const lid = ny - (0.10 + 0.15 * nx * nx);
    return [cov(lid, 0.08), 43, 33, 24];
  }
  // wow: white + pupil + highlights
  const w = Math.hypot(nx, ny - 0.02);
  if (w > 0.55 + aa) return [0, 0, 0, 0];
  const p = Math.hypot(nx, ny - 0.05);
  const pc = 1 - sstep(0.26 - 2 * aa, 0.26 + 2 * aa, p);
  if (pc > 0) {
    const h1 = Math.hypot(nx + 0.10, ny + 0.10);
    const h2 = Math.hypot(nx - 0.11, ny - 0.14);
    const hl = Math.max(
      1 - sstep(0.11 - 1.2 * aa, 0.11 + 1.2 * aa, h1),
      1 - sstep(0.055 - 1.2 * aa, 0.055 + 1.2 * aa, h2)
    );
    return [pc, 32 + (255 - 32) * hl, 36 + (255 - 36) * hl, 44 + (255 - 44) * hl];
  }
  return [1 - sstep(0.55 - aa, 0.55 + aa, w), 255, 255, 255];
}

// J-3: exported for scripts/verify-face-feather.mjs (no binary edges).
export function mouthGlyph(
  state: Exclude<MouthState, "baked">,
  ex: number,
  ey: number,
  aa: number
): [number, number, number, number] {
  const cov = (d: number, w: number) => 1 - sstep(w - aa, w + aa, Math.abs(d));
  if (state === "smile") {
    // 작은 ∪ 미소: bottom (0,−0.25), ends (±0.5,0.05). 가슴팍 대화창 금지.
    const d = Math.hypot(ex, ey - 0.32) - 0.57;
    return [ey < 0.07 ? cov(d, 0.085) * endCapFade(Math.abs(ex), 0.58, aa) : 0, 74, 44, 26];
  }
  if (state === "open") {
    // 덥석 벌림: 얼굴 안에 들어가는 작은 타원 + 혀.
    const m = (ex / 0.42) ** 2 + (ey / 0.58) ** 2;
    const fill = 1 - sstep(0.92, 1.02, m);
    const tongue = (ex / 0.26) ** 2 + ((ey - 0.30) / 0.28) ** 2;
    const tc = discCoverLin(tongue, aa);
    const k = Math.max(fill, tc);
    if (k <= 0) return [0, 0, 0, 0];
    return [k, 92 + (226 - 92) * tc, 26 + (96 - 26) * tc, 18 + (110 - 18) * tc];
  }
  if (state === "flat") {
    return [cov(ey, 0.085) * endCapFade(Math.abs(ex), 0.55, aa), 74, 44, 26];
  }
  // ooh
  const m = Math.hypot(ex, ey);
  return [1 - sstep(0.32 - aa, 0.32 + aa, m), 92, 26, 18];
}

function sampleFur(mesh: THREE.Mesh, uv: THREE.Vector2 | undefined): string {
  try {
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const map = mat?.map;
    const img = map?.image as HTMLImageElement | undefined;
    if (!img || !uv) return "#cfc4ae";
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return "#cfc4ae";
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    let r = 0, gg = 0, b = 0, n = 0;
    for (const [du, dv] of [[0, 0], [0.004, 0], [-0.004, 0], [0, 0.004], [0, -0.004]]) {
      const sx = Math.min(w - 1, Math.max(0, Math.floor((uv.x + du) * w)));
      const sy = Math.min(h - 1, Math.max(0, Math.floor((uv.y + dv) * h)));
      g.drawImage(img, sx, sy, 1, 1, 0, 0, 1, 1);
      const d = g.getImageData(0, 0, 1, 1).data;
      r += d[0];
      gg += d[1];
      b += d[2];
      n++;
    }
    return `#${[r / n, gg / n, b / n].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return "#cfc4ae";
  }
}

// R-E: eye backing disc = glyph disc × this. Big baked eyes spill past the
// glyph disc (fire-01 실측 ≈1.5R) and the spillover reads as "old expression".
// Backing stays adaptive (contrasting texels only), so flat fur is unharmed.
const EYE_BACK_MUL = 1.6;

export function attachFace(model: THREE.Object3D, speciesId: string): FaceRig {
  const group = new THREE.Group();
  const tune = TUNE[speciesId] ?? {};
  const noop: FaceRig = {
    group,
    setFace: () => {},
    setFaceParams: () => {},
    setMouthFrame: () => {},
    ok: false,
    fur: tune.fur ?? "#cfc4ae",
    mouthLive: false,
    bakedFace: false,
  };
  if (tune.noFace) return noop;
  // FN-1: 덧대기 off — paint 스캔·소거·글리프 전부 생략. 원본 텍스처 그대로.
  // ok:false → 호출자는 setFace를 부르지 않는다. mouthLive는 구조값 유지.
  if (!FACE_PAINT_ENABLED) {
    try {
      (window as unknown as Record<string, unknown>).__facePaintWrites = 0;
    } catch {
      /* ssr */
    }
    return {
      ...noop,
      mouthLive: tune.hasMouth ?? true,
      bakedFace: true,
    };
  }

  // §4 legacy external-eye purge: detach floating-sphere eye meshes injected by
  // older pipelines (identified only by our own markers — never touches GLB
  // authored geometry, which carries no such flags).
  try {
    const legacy: THREE.Object3D[] = [];
    model.traverse((o) => {
      const u = (o as THREE.Mesh).userData;
      if (u && (u.externalEye === true || u.floatingEye === true)) legacy.push(o);
      else if ((o.name ?? "").startsWith("__faceEye")) legacy.push(o);
    });
    for (const o of legacy) o.parent?.remove(o);
  } catch {
    /* purge is best-effort; UV paint below is the real path */
  }

  const meshes: THREE.Mesh[] = [];
  model.updateMatrixWorld(true);
  model.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  if (!meshes.length) return noop;
  // R-C-4: SkinnedMesh 레이캐스트는 광선마다 전 정점을 CPU 스키닝해서 느리다
  // (three getVertexPosition→applyBoneTransform). 부착 시점은 레스트 자세
  // (=바인드)라 정적 Mesh 프록시가 동일한 히트(uv·point·material)를 낸다.
  const proxyOf = new Map<THREE.Mesh, THREE.Mesh>();
  const toStatic = (m: THREE.Mesh): THREE.Mesh => {
    if (!(m as THREE.SkinnedMesh).isSkinnedMesh) return m;
    let p = proxyOf.get(m);
    if (!p) {
      m.updateWorldMatrix(true, false);
      p = new THREE.Mesh(m.geometry, m.material);
      p.matrixWorld.copy(m.matrixWorld);
      p.matrixAutoUpdate = false;
      proxyOf.set(m, p);
    }
    return p;
  };
  const textured = meshes
    .filter(
      (m) => (m.material as THREE.MeshStandardMaterial)?.map?.image
    )
    .map(toStatic);
  if (!textured.length) return noop;

  const bbox = new THREE.Box3().setFromObject(model);
  const size = bbox.getSize(new THREE.Vector3());
  if (size.y <= 0.001) return noop;
  const H = size.y;

  const ray = new THREE.Raycaster();
  const fwd = new THREE.Vector3(0, 0, -1);
  const castFront = (x: number, y: number) => {
    ray.set(new THREE.Vector3(x, y, bbox.max.z + 3), fwd);
    const hits = ray.intersectObjects(textured, false);
    return hits[0] ?? null;
  };

  // Face span at a height: coarse bidirectional march from bbox center.
  // Fully measured per height — replaces the old per-model cxDX correction.
  const marchSpan = (y: number): [number, number] => {
    const x0 = (bbox.min.x + bbox.max.x) / 2;
    const step = size.x / 30;
    let L = x0;
    let R = x0;
    for (let i = 0; i < 30; i++) {
      if (castFront(L - step, y)) L -= step;
      else break;
    }
    for (let i = 0; i < 30; i++) {
      if (castFront(R + step, y)) R += step;
      else break;
    }
    return [L, R];
  };

  // Spiral-sample a world disc/ellipse → per-material sample lists.
  const collect = (
    ex: number,
    ey: number,
    rx: number,
    ry: number,
    n: number
  ): Map<THREE.MeshStandardMaterial, Sample[]> => {
    const byMat = new Map<THREE.MeshStandardMaterial, Sample[]>();
    for (const [px, py] of spiral(n)) {
      const hit = castFront(ex + px * rx, ey + py * ry);
      if (!hit || !hit.uv) continue;
      const mat = (hit.object as THREE.Mesh)
        .material as THREE.MeshStandardMaterial;
      if (!mat?.map) continue;
      const arr = byMat.get(mat) ?? [];
      arr.push({ u: hit.uv.x, v: hit.uv.y, x: hit.point.x, y: hit.point.y });
      byMat.set(mat, arr);
    }
    return byMat;
  };

  // Build per-material patches with IDW-smooth texel→world maps.
  // 파편 아틀라스 대응: UV 근접 클러스터(BFS, 20px)마다 별도 패치.
  // 타 아일랜드 침범 방지: 최근접 샘플 20px 밖 텍셀은 무효.
  const buildPatches = (
    ex: number,
    ey: number,
    rx: number,
    ry: number,
    kind: "eye" | "mouth",
    minHits: number
  ): Patch[] | null => {
    const byMat = collect(ex, ey, rx, ry, kind === "eye" ? 64 : 48);
    const patches: Patch[] = [];
    let totalHits = 0;
    const entries = Array.from(byMat.entries());
    for (let ei = 0; ei < entries.length; ei++) {
      const mat = entries[ei][0];
      const samples = entries[ei][1];
      totalHits += samples.length;
      const img = mat.map!.image as HTMLImageElement;
      const tw = img.naturalWidth || img.width;
      const th = img.naturalHeight || img.height;
      if (!tw || !th || !samples.length) continue;
      // Greedy UV clustering (BFS within 20px, pixel units).
      const unassigned = samples.slice();
      const clusters: Sample[][] = [];
      while (unassigned.length) {
        const seed = unassigned.pop()!;
        const cl: Sample[] = [seed];
        let grown = true;
        while (grown) {
          grown = false;
          for (let i = unassigned.length - 1; i >= 0; i--) {
            const s = unassigned[i];
            let near = false;
            for (let mI = 0; mI < cl.length; mI++) {
              const m = cl[mI];
              const du = (s.u - m.u) * tw;
              const dv = (s.v - m.v) * th;
              if (du * du + dv * dv < 20 * 20) {
                near = true;
                break;
              }
            }
            if (near) {
              cl.push(s);
              unassigned.splice(i, 1);
              grown = true;
            }
          }
        }
        clusters.push(cl);
      }
      for (const cl of clusters) {
        let umin = 1, umax = 0, vmin = 1, vmax = 0;
        for (const s of cl) {
          umin = Math.min(umin, s.u);
          umax = Math.max(umax, s.u);
          vmin = Math.min(vmin, s.v);
          vmax = Math.max(vmax, s.v);
        }
        const pad = 2;
        const u0 = Math.max(0, Math.floor(umin * tw) - pad);
        const v0 = Math.max(0, Math.floor(vmin * th) - pad);
        const u1 = Math.min(tw - 1, Math.ceil(umax * tw) + pad);
        const v1 = Math.min(th - 1, Math.ceil(vmax * th) + pad);
        const w = u1 - u0 + 1;
        const h = v1 - v0 + 1;
        if (w <= 1 || h <= 1 || w * h > 200 * 200) continue;
        const uspan = Math.max(1e-6, umax - umin);
        const vspan = Math.max(1e-6, vmax - vmin);
        const wpt = Math.max((2 * rx) / (uspan * tw), (2 * ry) / (vspan * th));
        const worlds = new Float32Array(w * h * 2);
        const valid = new Uint8Array(w * h);
        const edge = new Float32Array(w * h);
        let count = 0;
        for (let py = 0; py < h; py++) {
          const v = (v0 + py + 0.5) / th;
          for (let px = 0; px < w; px++) {
            const u = (u0 + px + 0.5) / tw;
            const scored: Array<[number, number]> = [];
            for (let i = 0; i < cl.length; i++) {
              const du = (cl[i].u - u) * tw;
              const dv = (cl[i].v - v) * th;
              scored.push([du * du + dv * dv, i]);
            }
            scored.sort((a, b) => a[0] - b[0]);
            // Validity gate: nearest sample within 20px (else foreign island).
            if (scored[0][0] > VALID_GATE_PX * VALID_GATE_PX) continue;
            let sw = 0, wx = 0, wy = 0;
            const K = Math.min(6, scored.length);
            for (let k = 0; k < K; k++) {
              const wt = 1 / (scored[k][0] / (tw * tw) + 1e-9);
              const s = cl[scored[k][1]];
              sw += wt;
              wx += wt * s.x;
              wy += wt * s.y;
            }
            const o = (py * w + px) * 2;
            worlds[o] = wx / sw;
            worlds[o + 1] = wy / sw;
            valid[py * w + px] = 1;
            edge[py * w + px] = validEdgeWeight(Math.sqrt(scored[0][0]));
            count++;
          }
        }
        if (!count) continue;
        patches.push({
          mat, u0, v0, w, h, worlds, valid, edge, count,
          cx: ex, cy: ey, R: rx, Rb: rx, kind, mRx: rx, mRy: ry,
          backing: [0, 0, 0], wpt,
        });
      }
    }
    if (totalHits < minHits || !patches.length) return null;
    return patches;
  };

  // Base pixel cache per material (for local-average backing + variant copies).
  const baseCache = new Map<THREE.MeshStandardMaterial, { c: HTMLCanvasElement; img: ImageData; w: number; h: number }>();
  const getBase = (mat: THREE.MeshStandardMaterial) => {
    const hit = baseCache.get(mat);
    if (hit) return hit;
    const img = mat.map!.image as HTMLImageElement;
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, w, h);
    const rec = { c, img: data, w, h };
    baseCache.set(mat, rec);
    return rec;
  };

  // Baked-eye snap: TUNE ballpark → 가장 가까운 실제 눈(동공/흰자) 중심으로 보정.
  // 뿔·장식 때문에 bbox 비율이 어긋나도(이마 한가운데 눈 paint 참사 방지) 눈을 찾는다.
  const readLum = (mat: THREE.MeshStandardMaterial, u: number, v: number): number | null => {
    try {
      const base = getBase(mat);
      const px = Math.min(base.w - 1, Math.max(0, Math.floor(u * base.w)));
      const py = Math.min(base.h - 1, Math.max(0, Math.floor(v * base.h)));
      const o = (py * base.w + px) * 4;
      const d = base.img.data;
      return 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
    } catch {
      return null;
    }
  };
  // Ballpark → 실제 눈(동공/흰자 휘도 대비) 중심으로 스냅. exclude 안의
  // 샘플은 무시한다(근접 쌍안이 같은 동공에 중복 스냅되는 것 방지).
  // Returns [x, y, contrast]: contrast는 털 대비 최대 편차(판정 신호).
  const refineEye = (
    ex: number,
    ey: number,
    R: number,
    exclude?: { x: number; y: number; r: number },
    bipolar = false
  ): [number, number, number] => {
    const scored: Array<{ x: number; y: number; lum: number; rr: number }> = [];
    for (const [px, py] of spiral(56)) {
      const hit = castFront(ex + px * R, ey + py * R);
      if (!hit || !hit.uv) continue;
      if (exclude && Math.hypot(hit.point.x - exclude.x, hit.point.y - exclude.y) < exclude.r)
        continue;
      const mat = (hit.object as THREE.Mesh).material as THREE.MeshStandardMaterial;
      if (!mat?.map) continue;
      const lum = readLum(mat, hit.uv.x, hit.uv.y);
      if (lum === null) continue;
      scored.push({ x: hit.point.x, y: hit.point.y, lum, rr: Math.hypot(px, py) });
    }
    if (scored.length < 8) return [ex, ey, 0];
    // 털 기준 휘도 = 탐색 원 테두리 링 중앙값 (눈이 아닌 순수 털).
    const ring = scored.filter((s) => s.rr > 0.75).map((s) => s.lum).sort((a, b) => a - b);
    if (!ring.length) return [ex, ey, 0];
    const fur = ring[ring.length >> 1];
    // R-E bipolar: 진짜 눈은 동공(어두움)+흰자/테두리(밝음) 양극을 동공
    // 반경 안에 함께 품는다. 넓고 균일한 밝음(이마·배 흰 패치)이나 고립
    // 음영은 반대극이 근처에 없어 가중치가 반감된다. grass-01 실측: 기존
    // 전역 무게중심이 이마·배 패치에 끌려 볼에 찍혔다. contrast 반환(판정
    // 신호)은 전역 최대 편차 그대로라 게이트· baked 판정은 불변이다.
    const poleR = R * 0.3;
    const isBright = (l: number) => l > fur + 25;
    const isDark = (l: number) => l < fur - 25;
    const bright = scored.filter((s) => isBright(s.lum));
    const dark = scored.filter((s) => isDark(s.lum));
    const near = (
      s: { x: number; y: number },
      pole: Array<{ x: number; y: number }>
    ) => pole.some((o) => Math.hypot(o.x - s.x, o.y - s.y) < poleR);
    const ranked = scored
      .map((s) => {
        const d = Math.abs(s.lum - fur);
        const opp =
          bipolar &&
          ((isBright(s.lum) && near(s, dark)) || (isDark(s.lum) && near(s, bright)));
        return { s, d, w: d * (bipolar ? (opp ? 1 : 0.4) : 1) };
      })
      .sort((a, b) => (bipolar ? b.w - a.w : b.d - a.d))
      .slice(0, Math.max(6, scored.length >> 2));
    const maxD = Math.max(...scored.map((s) => Math.abs(s.lum - fur)));
    if (maxD < 18) return [ex, ey, maxD]; // 대비 없음 → ballpark 유지
    let sx = 0, sy = 0, sw = 0;
    for (const { s, w } of ranked) {
      sx += s.x * w;
      sy += s.y * w;
      sw += w;
    }
    const nx = sx / sw, ny = sy / sw;
    // 스냅 거리 제한: 탐색 반경 안에서만 (다른 부위 납치 방지).
    if (Math.hypot(nx - ex, ny - ey) > R) return [ex, ey, maxD];
    return [nx, ny, maxD];
  };

  // Measured eye line (replaces per-model eyeY): sweep heights, score by
  // front-texel luminance variance (pupil+sclera+fur triplets spike it).
  // Band [0.42,0.82]H excludes horns above and chest/belly below; spans
  // narrower than 12% of body width are horn/limb slivers, not faces.
  // R-E: band parameterized for the belly-lock rescue rescan (below).
  const scanEyeLine = (f0 = 0.42, f1 = 0.821, defF = 0.6): { y: number; L: number; R: number } => {
    let best = { y: bbox.min.y + H * defF, L: 0, R: 0, score: -1 };
    for (let f = f0; f <= f1 + 0.001; f += 0.04) {
      const y = bbox.min.y + H * f;
      const [L, R] = marchSpan(y);
      if (R - L < size.x * 0.12) continue;
      let n = 0, mean = 0, m2 = 0;
      for (let i = 0; i <= 20; i++) {
        const hit = castFront(L + ((R - L) * i) / 20, y);
        if (!hit || !hit.uv) continue;
        const mat = (hit.object as THREE.Mesh)
          .material as THREE.MeshStandardMaterial;
        if (!mat?.map) continue;
        const lum = readLum(mat, hit.uv.x, hit.uv.y);
        if (lum === null) continue;
        n++;
        const d = lum - mean;
        mean += d / n;
        m2 += d * (lum - mean);
      }
      if (n < 8) continue;
      const score = m2 / n;
      if (score > best.score) best = { y, L, R, score };
    }
    if (best.score < 0) {
      const [L, R] = marchSpan(best.y);
      return { y: best.y, L, R };
    }
    return best;
  };
  // R-E: eye measurement (scan line + third-points + per-eye snap).
  // bipolar=false reproduces the original plain-centroid path exactly.
  const measureEyes = (f0: number, f1: number, defF: number, bipolar: boolean) => {
    const sc = scanEyeLine(f0, f1, defF);
    const eY = sc.y;
    const c = (sc.L + sc.R) / 2;
    const h = Math.max((sc.R - sc.L) / 2, size.x * 0.1);
    // Facial third-points on the measured span (replaces eyeW/eyeDX/cxDX):
    // two-eye ballparks at ±1/3 half-span, then each eye snaps independently
    // to its own contrast peak (replaces eyeTilt: per-eye Y, no shared line).
    const xs = tune.single ? [c] : [c - h / 3, c + h / 3];
    // Fixed relative disc (replaces eyeS): half the face half-width, capped at
    // 14% of body height so wide bodies don't get dinner-plate eyes.
    const dR = Math.min(h * 0.5, H * 0.14);
    const sR = Math.max(dR * 2.0, H * 0.1);
    const refined: Array<[number, number]> = [];
    const contrasts: number[] = [];
    for (let xi = 0; xi < xs.length; xi++) {
      // Later eyes ignore the disc already claimed by a confident first eye.
      const excl =
        xi === 0 || contrasts[0] < 18
          ? undefined
          : { x: refined[0][0], y: refined[0][1], r: dR };
      const [ex, ey, contrast] = refineEye(xs[xi], eY, sR, excl, bipolar);
      refined.push([ex, ey]);
      contrasts.push(contrast);
    }
    return { sc, eY, c, h, xs, dR, sR, refined, contrasts };
  };
    // R-F-anchors: Blender (x = horizontal, z = height) → runtime world.
  // Runtime model = uniform scale + feet-ground/center offset, no rotation
  // at attach (PovCreature onModel). Use meshes[0] (normalization lives on the
  // loaded object, not the host wrapper) — single-mesh creatures.
  const anchorToWorld = (a: FaceAnchorPoint): [number, number] => {
    const v = new THREE.Vector3(a.pos[0], a.pos[2], -a.pos[1]).applyMatrix4(meshes[0].matrixWorld);
    return [v.x, v.y];
  };
  // Contrast at an anchor (baked-face gate signal, replaces refineEye contrast).
  const anchorContrast = (ax: number, ay: number, R: number): number => {
    const c0 = castFront(ax, ay);
    if (!c0 || !c0.uv) return 0;
    const mat0 = (c0.object as THREE.Mesh).material as THREE.MeshStandardMaterial;
    if (!mat0?.map) return 0;
    const l0 = readLum(mat0, c0.uv.x, c0.uv.y);
    if (l0 === null) return 0;
    let ring = 0, n = 0;
    for (let k = 0; k < 8; k++) {
      const h = castFront(ax + Math.cos((k / 8) * Math.PI * 2) * R, ay + Math.sin((k / 8) * Math.PI * 2) * R);
      if (!h || !h.uv) continue;
      const m = (h.object as THREE.Mesh).material as THREE.MeshStandardMaterial;
      if (!m?.map) continue;
      const l = readLum(m, h.uv.x, h.uv.y);
      if (l === null) continue;
      ring += l; n++;
    }
    if (!n) return 0;
    return Math.abs(l0 - ring / n);
  };
  // Eye anchors (world, x-sorted) or null when absent/single (→ measurement).
  const anchorEyes = (): Array<[number, number]> | null => {
    if (tune.single) return null;
    const set = FACE_ANCHORS[speciesId];
    const aL = set?.eyeL, aR = set?.eyeR;
    if (!aL || !aR) return null;
    return [anchorToWorld(aL), anchorToWorld(aR)].sort((p, q) => p[0] - q[0]);
  };
  // Mouth anchor (world) or null when absent (→ legacy offset fallback).
  const anchorMouth = (): [number, number] | null => {
    const a = FACE_ANCHORS[speciesId]?.mouth;
    if (!a) return null;
    return anchorToWorld(a);
  };
  // Measurement-bundle shape from anchors (sizing formulas unchanged).
  const anchorBundle = (pair: Array<[number, number]>) => {
    const eY = (pair[0][1] + pair[1][1]) / 2;
    const c = (pair[0][0] + pair[1][0]) / 2;
    const h = Math.max(((pair[1][0] - pair[0][0]) * 3) / 2, size.x * 0.1);
    const dR = Math.min(h * 0.5, H * 0.14);
    const sR = Math.max(dR * 2.0, H * 0.1);
    const refined: Array<[number, number]> = [[pair[0][0], pair[0][1]], [pair[1][0], pair[1][1]]];
    const contrasts = [anchorContrast(pair[0][0], pair[0][1], dR), anchorContrast(pair[1][0], pair[1][1], dR)];
    return { sc: { y: eY, L: c - h, R: c + h }, eY, c, h, xs: [pair[0][0], pair[1][0]], dR, sR, refined, contrasts };
  };
  // R-E: plain-centroid first (original path, bit-identical when kept).
  // A split pair (glyphs land on cheek/belly, real eyes untouched — grass-01
  // 실측) retries bipolar snap, then an upper-band rescan; each step is
  // accepted only if strictly better. Agreeing pairs never enter the rescue.
  const aEyes = anchorEyes();
  let mSrc = "measured";
  let M: ReturnType<typeof measureEyes> | null =
    aEyes && aEyes.every(([x, y]) => !!castFront(x, y)) ? anchorBundle(aEyes) : null;
  if (M) mSrc = "anchor";
  if (!M) {
    M = measureEyes(0.42, 0.821, 0.6, false);
  const split = (K: NonNullable<typeof M>) =>
    K.xs.length === 2 && Math.abs(K.refined[0][1] - K.refined[1][1]) > K.dR * 0.5;
  const agree = (K: NonNullable<typeof M>) => Math.abs(K.refined[0][1] - K.refined[1][1]);
  if (split(M)) {
    const Mb = measureEyes(0.42, 0.821, 0.6, true);
    if (agree(Mb) * 2 < agree(M) && Math.min(...Mb.contrasts) >= 18) {
      // eslint-disable-next-line no-console
      console.log(`[dbgface] bipolar ${speciesId} agree ${agree(M).toFixed(3)}→${agree(Mb).toFixed(3)}`);
      M = Mb;
    }
    if (split(M)) {
      const B = measureEyes(0.6, 0.821, 0.7, true);
      if (B.sc.y > M.sc.y && agree(B) * 2 < agree(M) && Math.min(...B.contrasts) >= 18) {
        // eslint-disable-next-line no-console
        console.log(`[dbgface] rescan ${speciesId} eyeY ${M.eY.toFixed(2)}→${B.eY.toFixed(2)}`);
        M = B;
      }
    }
  }
  }
  const scan = M.sc;
  const eyeLineY = scan.y;
  const cx = M.c;
  const half = M.h;
  const ccx = cx;
  const eyeXs = M.xs;
  const discR = M.dR;
  const refinedEyes = M.refined;
  const eyeContrasts = M.contrasts;

  // Eye patches (each eye center must yield ≥1 patch or whole rig fails).
  // eslint-disable-next-line no-console
  console.log(`[dbgface] ${speciesId} meshes=${meshes.length} textured=${textured.length} H=${H.toFixed(2)} cx=${cx.toFixed(2)} half=${half.toFixed(2)} eyeXs=${eyeXs.map((x) => x.toFixed(2)).join(",")} discR=${discR.toFixed(2)} eyeY=${eyeLineY.toFixed(2)} bboxY=[${bbox.min.y.toFixed(2)},${bbox.max.y.toFixed(2)}] src=${mSrc}`);
  const eyePatches: Patch[] = [];
  for (let xi = 0; xi < eyeXs.length; xi++) {
    const [ex, ey] = refinedEyes[xi];
    // R-E: sample a wider disc so backing erases the whole baked eye
    // (fire-01 실측: 베이크드 눈이 글리프 디스크 밖으로 삐져나옴).
    // Glyph radius stays discR (p.R below); Rb spans the backing.
    const ps = buildPatches(ex, ey, discR * EYE_BACK_MUL, discR * EYE_BACK_MUL, "eye", 10);
    // eslint-disable-next-line no-console
    console.log(`[dbgface] eye x=${ex.toFixed(2)} (ballpark ${eyeXs[xi].toFixed(2)},${eyeLineY.toFixed(2)}) patches=${ps ? ps.map((p) => `${p.w}x${p.h}@${p.u0},${p.v0}`).join(";") : "NULL"}`);
    if (!ps) return noop;
    for (const p of ps) p.R = discR;
    eyePatches.push(...ps);
  }
  // Baked-face verdict: EVERY eye shows author-baked luminance contrast
  // (contrast ≥ 18 = the same gate that accepts a snap). Such models keep
  // the artist's exact base texture at rest — see apply() preservation
  // branch. Contrast below gate on any eye → uncertain paint zone (glyphs
  // still available, but rest state is a canvas copy, not the GLB original).
  const bakedFace = eyeContrasts.every((c) => c >= 18);
  // Mouth patches (Type A only; failure → mouthless fallback, eyes still live).
  // 입 = 검출된 눈 라인 아래 고정 오프셋 + 정면 히트 검증. 가슴팍/배 입 원천 차단.
  let mouthPatches: Patch[] = [];
  let mouthLive = false;
  const wantMouth = tune.hasMouth ?? true;
  if (wantMouth) {
    const aM = anchorMouth();
    const eyeLineY = refinedEyes.reduce((a, e) => a + e[1], 0) / refinedEyes.length;
    const gap = Math.min(Math.max(discR * 1.7, H * 0.10), H * 0.30);
    let mX = ccx;
    let mY = eyeLineY - gap;
    // R-F-anchors: Blender mouth anchor when present and front-hitting.
    const mAnchor = !!(aM && castFront(aM[0], aM[1]));
    if (mAnchor && aM) { mX = aM[0]; mY = aM[1]; }
    // 정면 히트 검증: 빗나가면 눈 쪽으로 위로 기어오르며 탐색.
    let validY: number | null = castFront(mX, mY) ? mY : null;
    if (validY === null) {
      for (let s = 1; s <= 6; s++) {
        const cand = mY + (discR * 0.25) * s;
        if (cand > eyeLineY - discR * 0.9) break; // 눈 디스크 침범 금지
        if (castFront(mX, cand)) {
          validY = cand;
          break;
        }
      }
    }
    if (validY !== null && (mAnchor || validY < eyeLineY - discR * 0.9)) {
      // Fixed relative mouth (replaces mouthS): 1.1× eye disc wide.
      const mRx = discR * 1.1;
      const mRy = discR * 0.8;
      const ps = buildPatches(mX, validY, mRx, mRy, "mouth", 8);
      if (ps) {
        mouthPatches = ps;
        mouthLive = true;
      }
    }
  }

  // Backing color per patch: glyph 디스크 바깥 테두리 링(순수 털)에서만 채취.
  // 눈/흰자/입 픽셀에 중앙값이 오염되면 baked 눈이 지워지지 않던 참사 방지.
  for (const p of [...eyePatches, ...mouthPatches]) {
    const base = getBase(p.mat);
    const rs: number[] = [];
    const gs: number[] = [];
    const bs: number[] = [];
    const d = base.img.data;
    const rim: number[] = [];
    const all: number[] = [];
    for (let py = 0; py < p.h; py += 2) {
      for (let px = 0; px < p.w; px += 2) {
        if (!p.valid[py * p.w + px]) continue;
        const o2 = (py * p.w + px) * 2;
        const wx = p.worlds[o2], wy = p.worlds[o2 + 1];
        const rr = p.kind === "eye"
          ? Math.hypot((wx - p.cx) / p.R, (wy - p.cy) / p.R)
          : Math.hypot((wx - p.cx) / p.mRx, (wy - p.cy) / p.mRy);
        const o = (((p.v0 + py) * base.w + (p.u0 + px)) * 4);
        all.push(o);
        if (rr > 0.92 && rr < 1.12) rim.push(o);
      }
    }
    for (const o of rim.length >= 8 ? rim : all) {
      rs.push(d[o]);
      gs.push(d[o + 1]);
      bs.push(d[o + 2]);
    }
    if (!rs.length) {
      p.backing = [207, 196, 174];
      continue;
    }
    rs.sort((a, b) => a - b);
    gs.sort((a, b) => a - b);
    bs.sort((a, b) => a - b);
    const mid = rs.length >> 1;
    p.backing = [rs[mid], gs[mid], bs[mid]];
  }

  // Fur for paw props (cheek sample or override).
  let fur = tune.fur ?? "#cfc4ae";
  if (!tune.fur) {
    const spots: Array<[number, number]> = [
      [ccx + half * 0.55, eyeLineY - H * 0.07],
      [ccx - half * 0.55, eyeLineY - H * 0.07],
      [ccx, eyeLineY + H * 0.1],
    ];
    for (const [px, py] of spots) {
      const hit = castFront(px, py);
      if (!hit) continue;
      const c = sampleFur(hit.object as THREE.Mesh, hit.uv);
      const lum =
        0.299 * parseInt(c.slice(1, 3), 16) +
        0.587 * parseInt(c.slice(3, 5), 16) +
        0.114 * parseInt(c.slice(5, 7), 16);
      if (lum > 28) {
        fur = c;
        break;
      }
    }
  }

  // Heart path in disc-normalized coords (matches old glyph proportions).
  const heartPath = new Path2D();
  {
    const cx0 = 0, cy0 = 0.02, s = 0.62;
    heartPath.moveTo(cx0, cy0 + s * 0.75);
    heartPath.bezierCurveTo(
      cx0 - s * 1.2, cy0 - s * 0.1, cx0 - s * 0.55, cy0 - s * 0.95,
      cx0, cy0 - s * 0.35
    );
    heartPath.bezierCurveTo(
      cx0 + s * 0.55, cy0 - s * 0.95, cx0 + s * 1.2, cy0 - s * 0.1,
      cx0, cy0 + s * 0.75
    );
    heartPath.closePath();
  }
  const scratch = document.createElement("canvas").getContext("2d")!;

  const mats: THREE.MeshStandardMaterial[] = [];
  for (const p of [...eyePatches, ...mouthPatches]) {
    if (mats.indexOf(p.mat) < 0) mats.push(p.mat);
  }
  // Original base textures (captured once at attach): the preservation
  // branch in apply() rebinds these exact objects for baked-face models at
  // rest, so the artist's GLB texel data — not a canvas copy — idles.
  const baseMaps = new Map<THREE.MeshStandardMaterial, THREE.Texture | null>();
  for (const mat of mats) baseMaps.set(mat, mat.map);
  const variants = new Map<string, Map<THREE.MeshStandardMaterial, THREE.CanvasTexture>>();

  // eslint-disable-next-line no-console
  let dbgPaintLogged = false;
  const paintPatchEyes = (
    data: Uint8ClampedArray,
    baseW: number,
    p: Patch,
    state: Exclude<EyeState, "baked">,
    // 5a: 하트 크기. 기본 1 = 기존과 동일 (PARAM 외 종은 전달 안 함).
    heartScale = 1
  ) => {
    const dbg = state === "closed" && !dbgPaintLogged;
    if (dbg) dbgPaintLogged = true;
    let nValid = 0, nRr = 0, nBackHi = 0, nBackLo = 0, nGlyph = 0;
    let sumD = 0, nD = 0;
    const aa = strokeAA(p.wpt, p.R);
    const [br, bg, bb] = p.backing;
    for (let py = 0; py < p.h; py++) {
      for (let px = 0; px < p.w; px++) {
        if (!p.valid[py * p.w + px]) continue;
        const e = p.edge[py * p.w + px]; // J-3: validity rim fades to original
        const o = (py * p.w + px) * 2;
        const nx = (p.worlds[o] - p.cx) / p.R;
        const ny = (p.worlds[o + 1] - p.cy) / p.R;
        const rr = Math.hypot(nx, ny);
        // R-E: backing spans Rb (≥R); the ring between erases baked spillover.
        const rrb = Math.hypot((p.worlds[o] - p.cx) / p.Rb, (p.worlds[o + 1] - p.cy) / p.Rb);
        if (rr > 1.05 && rrb > 1.0) continue;
        const fo = (((p.v0 + py) * baseW + (p.u0 + px)) * 4);
        const dr = data[fo], dg = data[fo + 1], db = data[fo + 2];
        // Adaptive backing: 중앙값 털색과 대비되는 픽셀(눈/입)만 가린다.
        // R-E: gate lowered (22,65)→(12,45) so fur-toned irises also lift.
        const dBack = (Math.abs(dr - br) + Math.abs(dg - bg) + Math.abs(db - bb)) / 3;
        const back = backingSpatial(rrb, 0.82) * sstep(12, 45, dBack) * e;
        const [gc0, gr, gg, gb] = rr <= 1.05
          ? eyeGlyph(state, nx, ny, aa, heartPath, scratch, heartScale)
          : [0, 0, 0, 0];
        const gc = gc0 * e;
        const nb = 1 - back;
        const ng = 1 - gc;
        data[fo] = dr * nb * ng + br * back * ng + gr * gc;
        data[fo + 1] = dg * nb * ng + bg * back * ng + gg * gc;
        data[fo + 2] = db * nb * ng + bb * back * ng + gb * gc;
        if (dbg) {
          nValid++;
          if (rr <= 1.05) nRr++;
          if (back > 0.5) nBackHi++;
          if (back < 0.05) nBackLo++;
          if (gc > 0.5) nGlyph++;
          sumD += dBack;
          nD++;
        }
      }
    }
    // eslint-disable-next-line no-console
    if (dbg) console.log(`[dbgpaint] backing=[${br | 0},${bg | 0},${bb | 0}] valid=${nValid} rrOk=${nRr} backHi=${nBackHi} backLo=${nBackLo} glyph=${nGlyph} meanDBack=${(sumD / Math.max(1, nD)).toFixed(1)} R=${p.R.toFixed(3)} wpt=${p.wpt.toFixed(4)}`);
  };

  const paintPatchMouth = (
    data: Uint8ClampedArray,
    baseW: number,
    p: Patch,
    state: Exclude<MouthState, "baked">
  ) => {
    const aa = strokeAA(p.wpt, p.mRx);
    const [br, bg, bb] = p.backing;
    for (let py = 0; py < p.h; py++) {
      for (let px = 0; px < p.w; px++) {
        if (!p.valid[py * p.w + px]) continue;
        const e = p.edge[py * p.w + px]; // J-3: validity rim fades to original
        const o = (py * p.w + px) * 2;
        const ex = (p.worlds[o] - p.cx) / p.mRx;
        const ey = (p.worlds[o + 1] - p.cy) / p.mRy;
        const rr = Math.hypot(ex, ey);
        if (rr > 1.05) continue;
        const fo = (((p.v0 + py) * baseW + (p.u0 + px)) * 4);
        const dr = data[fo], dg = data[fo + 1], db = data[fo + 2];
        const dBack = (Math.abs(dr - br) + Math.abs(dg - bg) + Math.abs(db - bb)) / 3;
        const back = backingSpatial(rr, 0.80) * sstep(22, 65, dBack) * e;
        const [gc0, gr, gg, gb] = mouthGlyph(state, ex, ey, aa);
        const gc = gc0 * e;
        const nb = 1 - back;
        const ng = 1 - gc;
        data[fo] = dr * nb * ng + br * back * ng + gr * gc;
        data[fo + 1] = dg * nb * ng + bg * back * ng + gg * gc;
        data[fo + 2] = db * nb * ng + bb * back * ng + gb * gc;
      }
    }
  };

  // ---------- 5a 파라미터 얼굴 (PARAM 종만 호출) ----------
  // 원본 눈을 지우지 않고 눈꺼풀로 덮는다. 입은 기존처럼 baked를 지운다
  // (원본 보존 규칙은 눈에만 적용 — 5a). 비-PARAM 종은 아래를 타지 않는다.
  type InvGrid = {
    x0: number; y0: number; dx: number; dy: number; G: number;
    idx: Int32Array; // 셀별 대표 텍셀 번호 (−1 없음)
  };
  // pupil 줌용 world→texel 역맵 (패치당 1회, O(n)).
  const buildInvGrid = (p: Patch, G = 24): InvGrid => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < p.w * p.h; i++) {
      if (!p.valid[i]) continue;
      const wx = p.worlds[i * 2], wy = p.worlds[i * 2 + 1];
      if (wx < x0) x0 = wx;
      if (wx > x1) x1 = wx;
      if (wy < y0) y0 = wy;
      if (wy > y1) y1 = wy;
    }
    if (!(x1 > x0)) x1 = x0 + 1;
    if (!(y1 > y0)) y1 = y0 + 1;
    const dx = (x1 - x0) / G, dy = (y1 - y0) / G;
    const idx = new Int32Array(G * G).fill(-1);
    const best = new Float64Array(G * G).fill(Infinity);
    for (let i = 0; i < p.w * p.h; i++) {
      if (!p.valid[i]) continue;
      const wx = p.worlds[i * 2], wy = p.worlds[i * 2 + 1];
      const ix = Math.min(G - 1, Math.max(0, Math.floor((wx - x0) / dx)));
      const iy = Math.min(G - 1, Math.max(0, Math.floor((wy - y0) / dy)));
      const ddx = wx - (x0 + (ix + 0.5) * dx), ddy = wy - (y0 + (iy + 0.5) * dy);
      const d = ddx * ddx + ddy * ddy;
      const c = iy * G + ix;
      if (d < best[c]) {
        best[c] = d;
        idx[c] = i;
      }
    }
    return { x0, y0, dx, dy, G, idx };
  };
  const invLookup = (g: InvGrid, wx: number, wy: number): number => {
    const ix = Math.floor((wx - g.x0) / g.dx), iy = Math.floor((wy - g.y0) / g.dy);
    if (ix < 0 || iy < 0 || ix >= g.G || iy >= g.G) return -1;
    return g.idx[iy * g.G + ix];
  };

  const paramMode = PARAM_FACE_SPECIES.includes(speciesId);
  const invGrids = new Map<Patch, InvGrid>();
  if (paramMode) {
    for (const p of eyePatches) invGrids.set(p, buildInvGrid(p));
  }
  // 비-PARAM 종에서 setFaceParams가 호출돼도 동작하도록 lazy 폴백.
  const gridFor = (p: Patch): InvGrid => {
    let g = invGrids.get(p);
    if (!g) {
      g = buildInvGrid(p);
      invGrids.set(p, g);
    }
    return g;
  };

  const paintPatchEyesP = (
    data: Uint8ClampedArray,
    baseData: Uint8ClampedArray,
    baseW: number,
    p: Patch,
    fp: FaceParams,
    grid: InvGrid,
    glyph: "heart" | "happy" | null
  ) => {
    const aa = strokeAA(p.wpt, p.R);
    const [br, bg, bb] = p.backing;
                                  const zoom = !glyph && Math.abs(fp.pupil - 1) > 1e-9;
    const ly0 = 1 - fp.lid * 2.1; // 윗꺼풀선 중심 높이
    const arch = 0.35; // 꺼풀 아치 (고정)
    const ly2 = -1 + fp.lidLow * 1.6; // 아랫꺼풀선
    const cov = (d: number, w: number) => 1 - sstep(w - aa, w + aa, Math.abs(d));
    for (let py = 0; py < p.h; py++) {
      for (let px = 0; px < p.w; px++) {
        const ti = py * p.w + px;
        if (!p.valid[ti]) continue;
        const o = ti * 2;
        const e = p.edge[ti]; // J-3: validity rim fades to original
        const wx = p.worlds[o], wy = p.worlds[o + 1];
        const nx = (wx - p.cx) / p.R;
        const ny = (wy - p.cy) / p.R;
        const rr = Math.hypot(nx, ny);
        const rrb = Math.hypot((wx - p.cx) / p.Rb, (wy - p.cy) / p.Rb);
        if (rr > 1.05 && rrb > 1.0) continue;
        const fo = ((p.v0 + py) * baseW + (p.u0 + px)) * 4;
        let dr: number, dg: number, db: number;
        if (zoom) {
          const sx = p.cx + (wx - p.cx) / fp.pupil;
          const sy = p.cy + (wy - p.cy) / fp.pupil;
          const si = invLookup(grid, sx, sy);
          if (si < 0) {
            dr = br;
            dg = bg;
            db = bb;
          } else {
            const sfo = (((p.v0 + ((si / p.w) | 0)) * baseW + (p.u0 + (si % p.w))) * 4);
            dr = baseData[sfo];
            dg = baseData[sfo + 1];
            db = baseData[sfo + 2];
          }
        } else {
          dr = data[fo];
          dg = data[fo + 1];
          db = data[fo + 2];
        }
        if (glyph) {
          // R-F: glyph 폴백. heart(분홍 하트, 기존) + happy(∩, R-F 추가:
          // 어긋난 동공 위에서 꺼풀으로 ∩을 만들면 흰자만 남고 찌그러진다).
          // heart일 때만 pupil=글리프 크기.
          const dBack = (Math.abs(dr - br) + Math.abs(dg - bg) + Math.abs(db - bb)) / 3;
          const back = backingSpatial(rrb, 0.82) * sstep(12, 45, dBack) * e;
          const [gc0, gr, gg, gb] =
            rr <= 1.05
              ? eyeGlyph(glyph, nx, ny, aa, heartPath, scratch, glyph === "heart" ? fp.pupil : 1)
              : [0, 0, 0, 0];
          const gc = gc0 * e;
          const nb = 1 - back, ng = 1 - gc;
          data[fo] = dr * nb * ng + br * back * ng + gr * gc;
          data[fo + 1] = dg * nb * ng + bg * back * ng + gg * gc;
          data[fo + 2] = db * nb * ng + bb * back * ng + gb * gc;
          continue;
        }
        // 윗꺼풀(아치)+아랫꺼풀 덮개 (털색) + 윗 속눈썹선.
        const edge = ly0 - arch * nx * nx;
        const upCover = fp.lid > 0 ? sstep(edge - aa, edge + aa, ny) : 0;
        const loCover = fp.lidLow > 0 ? 1 - sstep(ly2 - aa, ly2 + aa, ny) : 0;
        const cover = Math.max(upCover, loCover) * e;
        const lash = fp.lid > 0.01 ? cov(ny - edge, 0.07) * endCapFade(Math.abs(nx), 0.62, aa) * e : 0;
        const nb = 1 - cover, nl = 1 - lash;
        data[fo] = dr * nb * nl + br * cover * nl + 43 * lash;
        data[fo + 1] = dg * nb * nl + bg * cover * nl + 33 * lash;
        data[fo + 2] = db * nb * nl + bb * cover * nl + 24 * lash;
      }
    }
  };

  const paintPatchMouthP = (
    data: Uint8ClampedArray,
    baseW: number,
    p: Patch,
    smile: number,
    open: number
  ) => {
    const aa = strokeAA(p.wpt, p.mRx);
    const [br, bg, bb] = p.backing;
    const cov = (d: number, w: number) => 1 - sstep(w - aa, w + aa, Math.abs(d));
    for (let py = 0; py < p.h; py++) {
      for (let px = 0; px < p.w; px++) {
        if (!p.valid[py * p.w + px]) continue;
        const e = p.edge[py * p.w + px]; // J-3: validity rim fades to original
        const o = (py * p.w + px) * 2;
        const ex = (p.worlds[o] - p.cx) / p.mRx;
        const ey = (p.worlds[o + 1] - p.cy) / p.mRy;
        const rr = Math.hypot(ex, ey);
        if (rr > 1.05) continue;
        const fo = (((p.v0 + py) * baseW + (p.u0 + px)) * 4);
        const dr = data[fo], dg = data[fo + 1], db = data[fo + 2];
        const dBack = (Math.abs(dr - br) + Math.abs(dg - bg) + Math.abs(db - bb)) / 3;
        const back = backingSpatial(rr, 0.8) * sstep(22, 65, dBack) * e;
        // 곡선: 양끝 (±0.5, 0), 중간 (0, −0.3·smile). open≥0.3이면 타원이 덮어 선 생략.
        let gc = 0, gr = 0, gg = 0, gb = 0;
        if (open < 0.3) {
          const t = Math.min(1, Math.abs(ex) / 0.5);
          const yc = -0.3 * smile * (1 - t * t);
          gc = cov(ey - yc, 0.085) * endCapFade(Math.abs(ex), 0.58, aa) * e;
          gr = 74;
          gg = 44;
          gb = 26;
        }
        if (open >= 0.05) {
          const m = (ex / 0.42) ** 2 + (ey / (0.58 * open)) ** 2;
          const fill = 1 - sstep(0.92, 1.02, m);
          if (fill > 0) {
            const k = 0.5 + 0.5 * open;
            const tongue = (ex / (0.26 * k)) ** 2 + ((ey - 0.3 * open) / (0.28 * k)) ** 2;
            const tc = discCoverLin(tongue, aa);
            gc = Math.max(fill, tc) * e;
            gr = 92 + (226 - 92) * tc;
            gg = 26 + (96 - 26) * tc;
            gb = 18 + (110 - 18) * tc;
          }
        }
        const nb = 1 - back;
        const ng = 1 - gc;
        data[fo] = dr * nb * ng + br * back * ng + gr * gc;
        data[fo + 1] = dg * nb * ng + bg * back * ng + gg * gc;
        data[fo + 2] = db * nb * ng + bb * back * ng + gb * gc;
      }
    }
  };

  // setFace 호환 래퍼용 합성 프리셋 (PARAM 종의 깜빡임·하품·리뷰·배틀 분기).
  const EYE_PRESET: Record<EyeState, { lid: number; lidLow: number; pupil: number }> = {
    baked: { lid: 0, lidLow: 0, pupil: 1 },
    heart: { lid: 0, lidLow: 0, pupil: 1 },
    happy: { lid: 0.36, lidLow: 0.42, pupil: 1 },
    closed: { lid: 0.56, lidLow: 0.08, pupil: 1 },
    sad: { lid: 0.38, lidLow: 0.08, pupil: 0.85 },
    wow: { lid: 0, lidLow: 0, pupil: 1.3 },
  };
  const MOUTH_PRESET: Record<MouthState, { smile: number; open: number } | null> = {
    baked: null,
    smile: { smile: 1, open: 0 },
    open: { smile: 0.2, open: 1 },
    flat: { smile: 0, open: 0 },
    ooh: { smile: 0, open: 0.55 },
  };

  const P_Q = 0.1, P_EPS = 0.004, P_TAU = 0.067, P_CAP = 48;
  const P_REST: FaceParams = { lid: 0, lidLow: 0, pupil: 1, smile: 0, mouthOpen: 0 };
  const pKeyOf = (fp: FaceParams, mouth: boolean, eyes: EyeState) => {
    const q = (v: number) => (Math.round(v / P_Q) * P_Q).toFixed(2);
    return `P|${q(fp.lid)},${q(fp.lidLow)},${q(fp.pupil)},${q(fp.smile)},${q(fp.mouthOpen)}|${mouth ? 1 : 0}|${eyes}`;
  };
  const ensureVariantP = (key: string, fp: FaceParams, paintMouth: boolean, eyes: EyeState) => {
    let v = variants.get(key);
    if (v) return v;
    v = new Map();
    for (const mat of mats) {
      const base = getBase(mat);
      const out = new ImageData(
        new Uint8ClampedArray(base.img.data),
        base.w,
        base.h
      );
      for (const p of eyePatches) {
        if (p.mat !== mat) continue;
        paintPatchEyesP(out.data, base.img.data, base.w, p, fp, gridFor(p), eyes === "heart" || eyes === "happy" ? eyes : null);
      }
      if (paintMouth && mouthLive) {
        for (const p of mouthPatches) {
          if (p.mat !== mat) continue;
          paintPatchMouthP(out.data, base.w, p, fp.smile, fp.mouthOpen);
        }
      }
      const c = document.createElement("canvas");
      c.width = base.w;
      c.height = base.h;
      c.getContext("2d")!.putImageData(out, 0, 0);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.flipY = false; // GLB convention (matches base map)
      t.anisotropy = 4;
      v.set(mat, t);
    }
    variants.set(key, v);
    // FIFO 상한 (전환 키 증가 대비. 재빌드되므로 관찰상 무해).
    while (variants.size > P_CAP) {
      const oldest = variants.keys().next().value;
      if (oldest === undefined || oldest === key) break;
      variants.delete(oldest);
    }
    return v;
  };

  // 지수 전환 (τ≈0.067 → 약 0.2초 수렴) + ε 스킵 + 리페인트 스로틀.
  // 호출자는 매 프레임 호출한다 (PovCreature tick) — 여기서 전진한다.
  let pCur: FaceParams = { ...P_REST };
  let pTgt: FaceParams = { ...P_REST };
  let pMouth = false;
  let pEyes: EyeState = "baked";
  let pKey = "";
  let pLast = 0;
  let pLastPaint = 0;
  const clampP = (fp: FaceParams): FaceParams => ({
    lid: Math.min(1, Math.max(0, fp.lid)),
    lidLow: Math.min(1, Math.max(0, fp.lidLow)),
    pupil: Math.min(1.4, Math.max(0.6, fp.pupil)),
    smile: Math.min(1, Math.max(-1, fp.smile)),
    mouthOpen: Math.min(1, Math.max(0, fp.mouthOpen)),
  });
  const setFaceParamsImpl = (fp: FaceParams, paintMouth = true, eyes: EyeState = "baked") => {
    pTgt = clampP(fp);
    pMouth = paintMouth && mouthLive;
    pEyes = eyes;
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (now - (pLast || now - 16)) / 1000));
    pLast = now;
    const k = 1 - Math.exp(-dt / P_TAU);
    (Object.keys(pTgt) as Array<keyof FaceParams>).forEach((f) => {
      pCur[f] += (pTgt[f] - pCur[f]) * k;
    });
    const dMax = Math.max(
      Math.abs(pTgt.lid - pCur.lid),
      Math.abs(pTgt.lidLow - pCur.lidLow),
      Math.abs(pTgt.pupil - pCur.pupil),
      Math.abs(pTgt.smile - pCur.smile),
      Math.abs(pTgt.mouthOpen - pCur.mouthOpen)
    );
    if (dMax < P_EPS) pCur = { ...pTgt };
    const settled = dMax < P_EPS;
    const key = pKeyOf(pCur, pMouth, pEyes);
    if (key === pKey) return; // ε-스킵
    if (!settled && now - pLastPaint < 80) return; // 전환 중 스로틀
    pKey = key;
    pLastPaint = now;
    const rest =
      settled &&
      pCur.lid === 0 && pCur.lidLow === 0 && pCur.pupil === 1 &&
      pCur.smile === 0 && pCur.mouthOpen === 0 && !pMouth && pEyes === "baked";
    if (rest && bakedFace) {
      baseMaps.forEach((t, mat) => {
        mat.map = t;
      });
      return;
    }
    const v = ensureVariantP(key, pCur, pMouth, pEyes);
    v.forEach((t, mat) => {
      mat.map = t;
    });
  };

  const ensureVariant = (key: string, eyes: EyeState, mouth: MouthState) => {
    let v = variants.get(key);
    if (v) return v;
    v = new Map();
    for (const mat of mats) {
      const base = getBase(mat);
      const out = new ImageData(
        new Uint8ClampedArray(base.img.data),
        base.w,
        base.h
      );
      if (eyes !== "baked") {
        for (const p of eyePatches) {
          if (p.mat !== mat) continue;
          paintPatchEyes(out.data, base.w, p, eyes);
        }
      }
      if (mouth !== "baked" && mouthLive) {
        for (const p of mouthPatches) {
          if (p.mat !== mat) continue;
          paintPatchMouth(out.data, base.w, p, mouth);
        }
      }
      const c = document.createElement("canvas");
      c.width = base.w;
      c.height = base.h;
      c.getContext("2d")!.putImageData(out, 0, 0);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.flipY = false; // GLB convention (matches base map)
      t.anisotropy = 4;
      v.set(mat, t);
    }
    variants.set(key, v);
    return v;
  };

  let curKey = "baked|baked";
  let curEyes: EyeState = "baked";
  let curMouth: MouthState = "baked";
  const apply = (eyes: EyeState, mouth: MouthState) => {
    facePaintDebug.writes++;
    try {
      const w = window as unknown as Record<string, unknown>;
      w.__facePaintWrites = ((w.__facePaintWrites as number) ?? 0) + 1;
    } catch {
      /* ssr */
    }
    const m = mouthLive ? mouth : "baked";
    const key = `${eyes}|${m}`;
    if (key === curKey) return;
    curKey = key;
    curEyes = eyes;
    curMouth = m;
    // Base-texture preservation branch: baked-face models at rest rebind
    // the original GLB maps (overpaint fully lifted — pixel-identical to
    // the authored asset). Emotes still paint transiently from base-pixel
    // copies (baseMaps objects are never mutated), and lifting an emote
    // always lands back on the untouched originals. Non-baked models keep
    // the legacy copy-variant path below.
    if (bakedFace && eyes === "baked" && m === "baked") {
      baseMaps.forEach((t, mat) => {
        mat.map = t;
      });
      return;
    }
    const v = ensureVariant(key, eyes, m);
    v.forEach((t, mat) => {
      mat.map = t;
    });
    // TODO(survey-temp): 변형 비트맵 덤프 훅. 검증 후 삭제.
    try {
      (window as unknown as Record<string, unknown>).__faceDbg = v;
    } catch {
      /* ssr */
    }
  };

  // Pre-warm the 9 combos used by POV (one-time hitch, no mid-anim stalls).
  // PARAM 종은 param 표만 프리웜한다 (legacy 변형 미사용).
  if (!paramMode) {
    try {
      const combos: Array<[EyeState, MouthState]> = [
        ["heart", "smile"], ["sad", "flat"], ["happy", "smile"],
        ["closed", "baked"], ["wow", "open"], ["happy", "open"],
        ["happy", "flat"], ["wow", "flat"], ["wow", "baked"],
      ];
      for (const [e, m] of combos) ensureVariant(`${e}|${mouthLive ? m : "baked"}`, e, m);
    } catch {
      /* pre-warm 실패해도 lazy 빌드로 동작 */
    }
  }

  // 5a param 프리웜 (PARAM 종만): 19 감정 + alt 3종 + 래퍼 2종.
  if (paramMode) {
    try {
      for (const row of PARAM_PREWARM) {
        const mouth = row.mouth && mouthLive;
        ensureVariantP(pKeyOf(row.p, mouth, row.eyes), row.p, mouth, row.eyes);
      }
      const ec = EYE_PRESET.closed;
      const shut: FaceParams = { ...P_REST, lid: ec.lid, lidLow: ec.lidLow, pupil: ec.pupil };
      ensureVariantP(pKeyOf(shut, false, "closed"), shut, false, "closed");
      const mo = MOUTH_PRESET.open!;
      const yawn: FaceParams = { ...shut, smile: mo.smile, mouthOpen: mo.open };
      ensureVariantP(pKeyOf(yawn, mouthLive, "closed"), yawn, mouthLive, "closed");
    } catch {
      /* pre-warm 실패해도 lazy 빌드로 동작 */
    }
  }

  // R-C 리뷰: 패치 집합 서명 (어느 눈 패치가 살아있는지 원격 확인용).
  try {
    (window as unknown as Record<string, unknown>).__povPatches = JSON.stringify({
      eyes: eyePatches.map((p) => [p.u0, p.v0, p.w, p.h, p.count, p.cx.toFixed(3), p.cy.toFixed(3)]),
      mouth: mouthPatches.map((p) => [p.u0, p.v0, p.w, p.h, p.count]),
      refined: refinedEyes.map(([x, y]) => [x.toFixed(3), y.toFixed(3)]),
      contrasts: eyeContrasts.map((c) => Math.round(c)),
    });
  } catch {
    /* review flag only */
  }

  return {
    group,
    fur,
    ok: true,
    mouthLive,
    bakedFace,
    // 5a: PARAM 종의 setFace는 프리셋 합성 호환 래퍼. 그 외 종은 기존 경로.
    setFace: (eyes, mouth) => {
      if (!paramMode) {
        apply(eyes, mouth);
        return;
      }
      const e = EYE_PRESET[eyes];
      const m = MOUTH_PRESET[mouth];
      setFaceParamsImpl(
        {
          lid: e.lid,
          lidLow: e.lidLow,
          pupil: e.pupil,
          smile: m?.smile ?? 0,
          mouthOpen: m?.open ?? 0,
        },
        m !== null,
        eyes
      );
    },
    setFaceParams: (p, paintMouth, eyes) =>
      setFaceParamsImpl(p, paintMouth ?? true, eyes ?? "baked"),
    setMouthFrame: (open) => apply(curEyes, open ? "open" : "flat"),
  };
}
