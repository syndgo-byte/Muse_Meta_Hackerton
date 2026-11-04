// J-3 검증: 얼굴 페인트 가장자리 페더링 (위치 계산 불변).
// - 글리프 획/뚜껑/백킹 경계에 이진(0/1) 절단이 없음을 검사한다.
// - 커버리지(게이트 20px·위치식)는 그대로임을 함께 고정한다.
// 실행: node scripts/verify-face-feather.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, "scratch", ".build-feather");
const require = createRequire(import.meta.url);

rmSync(BUILD, { recursive: true, force: true });
mkdirSync(BUILD, { recursive: true });
execFileSync(process.execPath, [
  join(ROOT, "node_modules", "typescript", "bin", "tsc"),
  join("lib", "facePaint.ts"),
  join("lib", "faceAnchors.ts"),
  join("lib", "motion", "faces.ts"),
  join("lib", "motion", "emotes.ts"),
  "--outDir", BUILD, "--module", "commonjs", "--target", "es2020",
  "--moduleResolution", "node", "--skipLibCheck", "--esModuleInterop",
], { cwd: ROOT, stdio: "inherit" });

const fp = require(join(BUILD, "facePaint.js"));

let fail = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` (${extra})` : ""}`);
  if (!ok) fail++;
};
const maxStep = (xs) => {
  let m = 0;
  for (let i = 1; i < xs.length; i++) m = Math.max(m, Math.abs(xs[i] - xs[i - 1]));
  return m;
};
const scan = (f, a, b, n) => {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(f(a + ((b - a) * i) / n));
  return out;
};

// --- legacy(작업 전) 수식 참조: 아래 predicate가 레거시를 기각해야 테스트가 변별력을 갖는다.
const legacyValidEdge = (dPx) => (dPx > 20 ? 0 : 1); // 이진 게이트
const legacyCap = (ax, lim) => (ax < lim ? 1 : 0); // 이진 끝캡
const LEGACY_AA_K = 1.2;

check("exports present", ["validEdgeWeight", "strokeAA", "endCapFade", "discCoverLin",
  "eyeGlyph", "mouthGlyph", "backingSpatial", "VALID_GATE_PX", "VALID_FULL_PX", "STROKE_AA_K"]
  .every((k) => fp[k] !== undefined));

// 1. 커버리지 불변: 게이트 20px, 풀 웨이트 12px.
//    (J-3-1에서 MUL·게이트 확대를 시도했으나 잔상은 미표본 무효 텍셀이어서
//    풋프린트 확대로 소거 불가 판명 → 원복. 후속은 표본 밀도 쪽.)
check("VALID_GATE_PX == 20 (coverage unchanged)", fp.VALID_GATE_PX === 20, String(fp.VALID_GATE_PX));
check("VALID_FULL_PX == 12", fp.VALID_FULL_PX === 12, String(fp.VALID_FULL_PX));

// 2. validity 가장자리: 레거시 기각 + 모듈 평활.
if (typeof fp.validEdgeWeight === "function") {
  const rej = maxStep(scan(legacyValidEdge, 0, 24, 96));
  check("legacy binary gate rejected", rej > 0.5, `step=${rej.toFixed(2)}`);
  const w = fp.validEdgeWeight;
  check("edge full interior", w(0) === 1 && w(12) === 1, `w0=${w(0)} w12=${w(12)}`);
  check("edge zero outside", w(20) === 0 && w(24) === 0, `w20=${w(20)} w24=${w(24)}`);
  const curve = scan(w, 0, 24, 96);
  const mono = curve.every((v, i) => i === 0 || v <= curve[i - 1] + 1e-12);
  check("edge monotonic", mono);
  const st = maxStep(curve);
  check("edge smooth (no binary cut)", st < 0.15, `maxstep=${st.toFixed(3)}`);
  check("edge feather zone active", w(16) > 0 && w(16) < 1, `w16=${w(16).toFixed(3)}`);
} else {
  check("edge smooth (no binary cut)", false, "missing export");
}

// 3. 획 AA 확대: 레거시 1.2 < 기준 <= 모듈.
check("STROKE_AA_K widens legacy 1.2", fp.STROKE_AA_K >= 2.2 && LEGACY_AA_K < 2.2,
  `K=${fp.STROKE_AA_K}`);
if (typeof fp.strokeAA === "function") {
  const aa = fp.strokeAA(0.023, 1);
  check("strokeAA typical patch >= 0.05", aa >= 0.05, `aa=${aa.toFixed(4)}`);
  check("strokeAA scales", Math.abs(fp.strokeAA(0.046, 1) - 2 * aa) < 1e-9);
} else {
  check("strokeAA typical patch >= 0.05", false, "missing export");
}

// 4. happy ∩ 획 램프 폭 (disc 단위, 대표 wpt/R=0.023).
if (typeof fp.eyeGlyph === "function" && typeof fp.strokeAA === "function") {
  const aa = fp.strokeAA(0.023, 1);
  const cov = scan((ny) => fp.eyeGlyph("happy", 0, ny, aa, null, null)[0], 0.0, 0.5, 250);
  const span = cov.filter((c) => c > 0.05 && c < 0.95).length * (0.5 / 250);
  check("happy stroke ramp widened", span >= 0.12, `span=${span.toFixed(4)}`);
  check("happy peak readable", Math.max(...cov) >= 0.99, `peak=${Math.max(...cov).toFixed(3)}`);
  check("happy ramp smooth", maxStep(cov) < 0.25, `maxstep=${maxStep(cov).toFixed(3)}`);
  // 끝캡: 호 연장선(nx 0.55→0.7, ny=-0.28)에서 레거시는 0.62에서 절단.
  const capCurve = scan((nx) => fp.eyeGlyph("happy", nx, -0.28, aa, null, null)[0], 0.55, 0.7, 60);
  check("happy end-cap smooth", maxStep(capCurve) < 0.3, `maxstep=${maxStep(capCurve).toFixed(3)}`);
} else {
  check("happy stroke ramp widened", false, "missing export");
}

// 5. endCapFade 직접: 레거시 기각 + 평활.
if (typeof fp.endCapFade === "function") {
  const rej = maxStep(scan((x) => legacyCap(x, 0.62), 0.3, 0.7, 80));
  check("legacy binary cap rejected", rej > 0.5, `step=${rej.toFixed(2)}`);
  const aa = 0.0575;
  check("cap open interior", fp.endCapFade(0.3, 0.62, aa) === 1);
  check("cap closed outside", fp.endCapFade(0.62, 0.62, aa) === 0 && fp.endCapFade(0.7, 0.62, aa) === 0);
  const curve = scan((x) => fp.endCapFade(x, 0.62, aa), 0.3, 0.7, 80);
  check("cap smooth", maxStep(curve) < 0.2, `maxstep=${maxStep(curve).toFixed(3)}`);
  check("cap taper active", fp.endCapFade(0.6, 0.62, aa) > 0 && fp.endCapFade(0.6, 0.62, aa) < 1);
} else {
  check("cap smooth", false, "missing export");
}

// 6. smile ∪ 끝캡 평활.
if (typeof fp.mouthGlyph === "function" && typeof fp.strokeAA === "function") {
  const aa = fp.strokeAA(0.023, 1);
  const smile = scan((ex) => fp.mouthGlyph("smile", ex, 0.046, aa)[0], 0.45, 0.65, 80);
  check("smile end-cap smooth", maxStep(smile) < 0.3, `maxstep=${maxStep(smile).toFixed(3)}`);
  check("smile peak readable", fp.mouthGlyph("smile", 0, -0.25, aa)[0] >= 0.99);
} else {
  check("smile end-cap smooth", false, "missing export");
}

// 7. open 혀 경계: 혼합 샘플 존재 (레거시 이진=0).
if (typeof fp.mouthGlyph === "function" && typeof fp.strokeAA === "function") {
  const aa = fp.strokeAA(0.023, 1);
  let mixed = 0;
  for (let i = 0; i <= 40; i++) {
    const ey = -0.05 + (0.2 * i) / 40;
    const [, r, g, b] = fp.mouthGlyph("open", 0, ey, aa);
    if (r > 92 && r < 226 && g > 26 && g < 96 && b > 18 && b < 110) mixed++;
  }
  check("open tongue edge blends", mixed >= 3, `mixed=${mixed}/41`);
} else {
  check("open tongue edge blends", false, "missing export");
}

// 8. sad/wow 동공 경계: 부분 커버리지 구간 존재.
if (typeof fp.eyeGlyph === "function" && typeof fp.strokeAA === "function") {
  const aa = fp.strokeAA(0.023, 1);
  const sad = scan((ny) => fp.eyeGlyph("sad", 0, ny, aa, null, null)[0], 0.15, 0.45, 60);
  const sadPartial = sad.filter((c) => c > 0.05 && c < 0.95).length;
  check("sad pupil edge blends", sadPartial >= 3, `partial=${sadPartial}/61`);
  const wow = scan((nx) => fp.eyeGlyph("wow", nx, 0.05, aa, null, null)[0], 0.1, 0.45, 70);
  const wowPartial = wow.filter((c) => c > 0.05 && c < 0.95).length;
  check("wow pupil edge blends", wowPartial >= 3, `partial=${wowPartial}/71`);
} else {
  check("sad pupil edge blends", false, "missing export");
}

// 9. backing 공간 램프 평활 (회귀 가드: 전후 모두 통과).
if (typeof fp.backingSpatial === "function") {
  const curve = scan((r) => fp.backingSpatial(r, 0.82), 0, 1.2, 120);
  check("backing ramp smooth", maxStep(curve) < 0.1, `maxstep=${maxStep(curve).toFixed(3)}`);
  check("backing ramp endpoints", fp.backingSpatial(0, 0.82) === 1 && fp.backingSpatial(1, 0.82) === 0);
} else {
  check("backing ramp smooth", false, "missing export");
}

// 10. J-3-2 median consensus: REMOVED (cam eye anomaly cause).
//     Consensus exports+fixtures deleted; see NIGHT_REPORT cam-eye section.

// 11. 전수 유한성: 전 상태·격자 NaN 없음, 커버리지 [0,1].
if (typeof fp.eyeGlyph === "function" && typeof fp.mouthGlyph === "function" && typeof fp.strokeAA === "function") {
  const aa = fp.strokeAA(0.023, 1);
  let bad = 0;
  for (const st of ["heart", "happy", "closed", "sad", "wow"]) {
    for (let ix = -10; ix <= 10; ix++) for (let iy = -10; iy <= 10; iy++) {
      if (st === "heart") continue; // Path2D/ctx 필요 — 브라우저 캡처로 검증
      const [c, r, g, b] = fp.eyeGlyph(st, ix / 10, iy / 10, aa, null, null);
      if (![c, r, g, b].every(Number.isFinite) || c < 0 || c > 1) bad++;
    }
  }
  for (const st of ["smile", "open", "flat", "ooh"]) {
    for (let ix = -10; ix <= 10; ix++) for (let iy = -10; iy <= 10; iy++) {
      const [c, r, g, b] = fp.mouthGlyph(st, ix / 10, iy / 10, aa);
      if (![c, r, g, b].every(Number.isFinite) || c < 0 || c > 1) bad++;
    }
  }
  check("glyph outputs finite in [0,1]", bad === 0, bad ? `bad=${bad}` : "1764 samples");
} else {
  check("glyph outputs finite in [0,1]", false, "missing export");
}

console.log(fail === 0 ? "ALL PASSED" : `FAILED (${fail})`);
process.exit(fail === 0 ? 0 : 1);
