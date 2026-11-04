// scripts/verify-scanreveal.mjs — UI-2 보완: 야생 등장 전 경로가 같은 ScanReveal을 거치는지 정적 검사.
// 실행: node scripts/verify-scanreveal.mjs (종료코드 0 = 전부 통과)
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pov = readFileSync(join(root, "app/pov/page.tsx"), "utf8");
const povLines = pov.split("\n");
const reveal = readFileSync(join(root, "components/battle/ScanReveal.tsx"), "utf8");

let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  if (ok) { pass++; }
  else { fail++; console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

// 함수 본문 span (시작 줄 1-based → 끝 줄 1-based, 중괄호 매칭).
function fnSpan(lines, startIdx0) {
  let depth = 0;
  let started = false;
  for (let i = startIdx0; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") { depth++; started = true; }
      if (ch === "}") depth--;
    }
    if (started && depth === 0) return [startIdx0 + 1, i + 1];
  }
  return [startIdx0 + 1, lines.length];
}

// 1. 단일 진입점 revealHint 존재 + 가드 3종.
const rhIdx = povLines.findIndex((l) => l.includes("function revealHint"));
check("reveal-entry", rhIdx >= 0, "function revealHint 없음");
const [rhS, rhE] = rhIdx >= 0 ? fnSpan(povLines, rhIdx) : [0, 0];
const rhBody = povLines.slice(rhS - 1, rhE).join("\n");
check("reveal-guard-battle", rhBody.includes('battlePhaseRef.current !== "none"'), "배틀 가드 없음");
check("reveal-guard-hint", rhBody.includes("wildHintRef.current"), "카드 가드 없음");
check("reveal-guard-reveal", rhBody.includes("scanRevealRef.current"), "연출중복 가드 없음");
check("reveal-sets-state", rhBody.includes("setScanReveal({"), "setScanReveal 호출 없음");

// 2. 직접 applyHint(pick|timed) 호출 잔존 금지 (def·onDone·revealHint 내부만 허용).
const applySites = [];
povLines.forEach((l, i) => {
  if (/applyHint\s*\(/.test(l) && !/function applyHint/.test(l)) applySites.push(i + 1);
});
const scanJsxIdx = povLines.findIndex((l) => l.includes("<ScanReveal"));
const onDoneIdx = povLines.findIndex((l, i) => i > scanJsxIdx && l.includes("onDone={() => {"));
const [, onDoneE] = onDoneIdx >= 0 ? fnSpan(povLines, onDoneIdx) : [0, 0];
const bad = applySites.filter((n) => !((n >= rhS && n <= rhE) || (n >= onDoneIdx + 1 && n <= onDoneE)));
check("no-direct-apply", bad.length === 0, `직접 호출 잔존 줄: ${bad.join(",")}`);

// 3. 경로 4곳이 revealHint 호출 (데모·빗나감·자동스캔·타이머).
const callSites = [];
povLines.forEach((l, i) => {
  if (/revealHint\s*\(/.test(l) && !/function revealHint/.test(l)) callSites.push(i + 1);
});
check("reveal-callsites", callSites.length >= 4, `호출 ${callSites.length}곳 (4 필요): ${callSites.join(",")}`);

// 4. setScanReveal({ 는 revealHint 내부에서만.
const setSites = [];
povLines.forEach((l, i) => { if (l.includes("setScanReveal({")) setSites.push(i + 1); });
const setBad = setSites.filter((n) => !(n >= rhS && n <= rhE));
check("setscan-single", setSites.length > 0 && setBad.length === 0, `외부 set 줄: ${setBad.join(",")}`);

// 5. exp 분기에 연출 없음.
const expIdx = povLines.findIndex((l) => l.includes('d.kind === "exp"'));
const expBlock = expIdx >= 0 ? povLines.slice(expIdx, expIdx + 12).join("\n") : "";
check("exp-no-reveal", expIdx >= 0 && !expBlock.includes("eveal"), "exp 분기에 연출 있음");

// 6. 같은 컴포넌트 1곳 + 같은 타이밍.
const jsxCount = (pov.match(/<ScanReveal/g) || []).length;
check("single-component", jsxCount === 1, `<ScanReveal ${jsxCount}곳`);
check("timing-finder", /FINDER_MS\s*=\s*1100/.test(reveal), "FINDER 1100 아님");
check("timing-scanned", /SCANNED_MS\s*=\s*900/.test(reveal), "SCANNED 900 아님");
check("timing-found", /FOUND_MS\s*=\s*1300/.test(reveal), "FOUND 1300 아님");
check("phase-attr", reveal.includes("data-phase") && reveal.includes('data-testid="scan-reveal"'), "계측 속성 없음");

// 7. §4 라벨: 대체 라벨이 코드에 있고 화면 표시식(Scanned: ${label}) 유지.
check("label-demo", pov.includes('"데모"'), "데모 라벨 없음");
check("label-fallback", pov.includes('"주변 탐색"'), "대체 라벨 없음");
check("label-shown", reveal.includes("스캔 완료: ${label}"), "라벨 표시식 없음");

// 7b. VF-1: 뷰파인더 고도화 (색·브래킷·호·눈금·추적·운전중 숨김).
const shutter = readFileSync(join(root, "components/battle/CaptureShutter.tsx"), "utf8");
check("vf-hidden-prop", reveal.includes("hidden") && /if\s*\(hidden\)\s*return null/.test(reveal), "hidden 숨김 없음");
check("vf-getbox-prop", reveal.includes("getBox") && reveal.includes("requestAnimationFrame"), "추적 루프 없음");
check("vf3-bracket-2px", /2px solid rgba\(111,243,255,0\.85\)/.test(reveal), "2px 시안 브래킷 없음");
check("vf-bracket-glow", reveal.includes("drop-shadow"), "브래킷 그림자 없음");
check("vf3-center-dot", reveal.includes("vf-center-dot"), "중앙 점 없음");
check("vf3-no-ticks", !reveal.includes("VF_TICKS"), "눈금 잔존");
check("vf3-no-arc", !/vfArc/.test(reveal), "호 잔존");
check("vf3-caption-below", reveal.includes("cur.cy + cur.h / 2"), "아래 캡션 없음");
check("vf3-no-attr", !reveal.includes("ELEMENT_FX_COLOR"), "속성색 잔존");
check("vf3-no-dim", !reveal.includes("radial-gradient") && !/rgba\(8, ?26, ?38/.test(reveal) && !/rgba\(3, ?10, ?16/.test(reveal) && !reveal.includes("backdrop"), "덮개 잔존");
check("vf3-caption-shadow", reveal.includes("textShadow"), "캡션 그림자 없음");
check("vf-pov-hidden", (pov.match(/hidden=\{driving\}/g) || []).length === 2, "pov hidden 배선 2곳 아님");
check("vf-pov-getbox", pov.includes("getBox={"), "pov getBox 배선 없음");
check("vf-pov-element", pov.includes("element={"), "pov element 배선 없음");
check("vf-shutter-hidden", shutter.includes("hidden") && /if\s*\(hidden\)\s*return null/.test(shutter), "셔터 hidden 없음");
check("vf-shutter-flash", shutter.includes("after(60"), "플래시 60ms 아님");
check("vf-shutter-en", shutter.includes("셔터") && shutter.includes("시도 {attempt}"), "셔터 한국어 없음");

// 8. SR-1: 감지 박스 중심 뷰파인더.
check("sr1-place-fn", reveal.includes("placeViewfinder"), "placeViewfinder 없음");
check("vf3-size-rule", /const VF_RATIO = 0\.45/.test(reveal) && /const VF_MIN = 72/.test(reveal) && /const VF_MAX = 140/.test(reveal), "0.45·72·140 규칙 없음");
const vfConstIdx = reveal.indexOf("const VF_RATIO");
check("vf3-const-top", vfConstIdx >= 0 && vfConstIdx < reveal.indexOf("export function placeViewfinder"), "상수 상단 없음");
check("sr1-clamp", reveal.includes("size / 2"), "화면 클램프 없음");
check("sr1-box-prop", /box\?:/.test(reveal) || /box:/.test(reveal), "box prop 없음");
check("sr1-reveal-box", pov.includes("function revealHint(pick: HintPick, label: string, box"), "revealHint 3번째 인자 없음");
check("sr1-box-default", /box[^=]*=\s*null/.test(pov), "box 기본 null 없음");
check("sr1-auto-box", (pov.match(/topBox/g) || []).length >= 2, "자동스캔 topBox 전달 없음");
// VF-2가 SR-1 중앙 규칙을 대체: miss·timed는 최근 박스 전달, 데모만 null 유지.
// (구 sr1-hint-center "힌트 3경로 2인자" 기대는 VF-2 지시 변경으로 아래와 교체.)
const twoArg = povLines.filter((l) => /revealHint\((pick|timed),[^,]*\);/.test(l)).length;
check("vf2-hint-boxcount", twoArg === 1, `데모 외 2인자 잔존: ${twoArg}곳 (데모 1곳만)`);
// VF-2: miss·timed는 최근 박스, 데모만 null 유지 (SR-1 중앙 규칙 대체).
check("vf2-hint-box", (pov.match(/freshBox\(recentBoxRef\.current/g) || []).length === 2, "miss·timed freshBox 전달 아님");
check("vf2-demo-null", pov.includes('revealHint(pick, "데모")'), "데모 2인자 아님");
check("vf2-record-site", pov.includes("recentBoxRef.current = { box:"), "최근 박스 기록 없음");
// 8b. VF-4: 대상 1개 고정 + 가변 사각 + 1eurofilter 추적.
check("vf4-pick-fn", reveal.includes("export function pickScanTarget"), "pickScanTarget 없음");
check("vf4-rect-fn", reveal.includes("export function placeFinderRect"), "placeFinderRect 없음");
check("vf4-euro", reveal.includes("OneEuroFilter") && reveal.includes("VF4_MIN_CUT") && reveal.includes("VF4_BETA"), "1eurofilter 배선 없음");
check("vf4-euro-param", /VF4_MIN_CUT = 1\.0/.test(reveal) && /VF4_BETA = 0\.01/.test(reveal), "1.0·0.01 아님");
check("vf4-finding", reveal.includes("스캔할 물건을 찾는 중"), "대상없음 캡션 없음");
check("vf4-oss", reveal.includes("casiez/OneEuroFilter") && reveal.includes("BSD-3-Clause"), "출처 주석 없음");
check("vf4-reveal-pick", rhBody.includes("pickScanTarget"), "revealHint 대상 고정 없음");
check("vf4-target-state", pov.includes("target: det ? det.label : null") && pov.includes("scanReveal.target || scanReveal.label"), "target 배선 없음");
check("vf4-rect-rule", /VF4_MARGIN = 0\.1/.test(reveal) && /VF4_MAX_SHORT = 0\.55/.test(reveal), "여백 10%·55% 없음");
check("sr1-box-passthrough", pov.includes("box={scanReveal.box}"), "box 전달 없음");
check("sr1-threshold-intact", pov.includes("autoScanTick(autoScanRef.current, label, confidence)"), "감지 호출 변경됨");

// 9. SR-1 수학: placeViewfinder 실제 실행 (tsc 컴파일 후 require).
// react 해결을 위해 저장소 안에 임시 디렉터리 (검사 후 삭제).
const BUILD = mkdtempSync(join(root, ".tmp-verify-scanreveal-"));
const rmBuild = () => {
  try {
    rmSync(BUILD, { recursive: true, force: true });
  } catch { /* ignore */ }
};
try {
  execFileSync(
    process.execPath,
    [
      join(root, "node_modules", "typescript", "bin", "tsc"),
      "--outDir", BUILD,
      "--rootDir", root,
      "--module", "commonjs",
      "--target", "es2021",
      "--jsx", "react-jsx",
      "--moduleResolution", "node",
      "--esModuleInterop",
      "--skipLibCheck",
      "--noEmitOnError",
      "components/battle/ScanReveal.tsx",
      "components/battle/fx.ts",
      "lib/josa.ts",
    ],
    { cwd: root, stdio: "pipe" },
  );
  const req = createRequire(join(root, "package.json"));
  const { placeViewfinder, freshBox } = req(join(BUILD, "components", "battle", "ScanReveal.js"));
  const VW = 390;
  const VH = 844;
  const eq = (a, b) => Math.abs(a - b) < 1e-6;
  let p = placeViewfinder(null, VW, VH);
  check("vf3-null-small", eq(p.cx, 195) && eq(p.cy, 337.6) && eq(p.size, 96), JSON.stringify(p));
  check("vf2-fresh-recent", JSON.stringify(freshBox({ box: { x0: 0, y0: 0, x1: 1, y1: 1 }, at: 1000 }, 2500)) === JSON.stringify({ x0: 0, y0: 0, x1: 1, y1: 1 }), "2초 이내 박스 미반환");
  check("vf2-fresh-stale", freshBox({ box: { x0: 0, y0: 0, x1: 1, y1: 1 }, at: 1000 }, 3001) === null, "2초 초과 박스 반환");
  check("vf2-fresh-null", freshBox(null, 2000) === null, "null 미처리");
  p = placeViewfinder({ x0: 0.45, y0: 0.45, x1: 0.55, y1: 0.55 }, VW, VH); // 39x84 → 최소 72
  check("vf3-small-min", eq(p.size, 72) && eq(p.cx, 195), JSON.stringify(p));
  p = placeViewfinder({ x0: 0, y0: 0, x1: 1, y1: 1 }, VW, VH); // 전체 → 140 고정
  check("vf3-big-max", eq(p.size, 140), JSON.stringify(p));
  p = placeViewfinder({ x0: 0.25, y0: 0.3, x1: 0.75, y1: 0.5 }, VW, VH); // 195x169 → 0.45 비율
  check("vf3-mid-scale", eq(p.size, 87.75), JSON.stringify(p));
  p = placeViewfinder({ x0: 0, y0: 0.4, x1: 0.1, y1: 0.6 }, VW, VH); // 왼쪽 끝
  check("sr1m-left", eq(p.cx, p.size / 2) && p.cx - p.size / 2 >= 0, JSON.stringify(p));
  p = placeViewfinder({ x0: 0.4, y0: 0, x1: 0.6, y1: 0.08 }, VW, VH); // 위 끝
  check("sr1m-top", eq(p.cy, p.size / 2) && p.cy - p.size / 2 >= 0, JSON.stringify(p));
  p = placeViewfinder({ x0: 0.7, y0: 0.4, x1: 0.75, y1: 0.45 }, VW, VH); // 오른쪽 (클램프 없음)
  check("sr1m-right", eq(p.cx, 0.725 * VW) && p.cx + p.size / 2 <= VW, JSON.stringify(p));
  const inside = (q) => q.cx - q.size / 2 >= -1e-6 && q.cx + q.size / 2 <= VW + 1e-6
    && q.cy - q.size / 2 >= -1e-6 && q.cy + q.size / 2 <= VH + 1e-6;
  const corners = [
    { x0: 0, y0: 0, x1: 0.05, y1: 0.05 },
    { x0: 0.95, y0: 0, x1: 1, y1: 0.05 },
    { x0: 0, y0: 0.95, x1: 0.05, y1: 1 },
    { x0: 0.95, y0: 0.95, x1: 1, y1: 1 },
    { x0: 0.3, y0: 0.3, x1: 0.7, y1: 0.7 },
  ];
  check("sr1m-inside", corners.every((b) => inside(placeViewfinder(b, VW, VH))), "화면 이탈");
  const { placeFinderRect, pickScanTarget } = req(join(BUILD, "components", "battle", "ScanReveal.js"));
  let q = placeFinderRect(null, VW, VH);
  check("vf4-rect-null", q === null, "null이 rect 반환");
  q = placeFinderRect({ x0: 0.3, y0: 0.3, x1: 0.7, y1: 0.5 }, VW, VH); // 156x169 → 여백 10%
  check("vf4-rect-aspect", q !== null && eq(q.w, 171.6) && eq(q.h, 185.68) && eq(q.cx, 195), JSON.stringify(q));
  q = placeFinderRect({ x0: 0, y0: 0, x1: 1, y1: 1 }, VW, VH); // 전체 → 55% 고정
  check("vf4-rect-max", q !== null && eq(q.w, 214.5) && eq(q.h, 214.5), JSON.stringify(q));
  q = placeFinderRect({ x0: 0.45, y0: 0.45, x1: 0.55, y1: 0.55 }, VW, VH); // 39x84 → 최소 72
  check("vf4-rect-min", q !== null && eq(q.w, 72) && eq(q.h, (0.55 - 0.45) * VH * 1.1), JSON.stringify(q));
  const isMapped = (l) => ["cup", "dog"].includes((l || "").toLowerCase());
  let tg = pickScanTarget([
    { label: "cup", score: 0.7, box: { x0: 0, y0: 0, x1: 0.1, y1: 0.1 } },
    { label: "dog", score: 0.9, box: { x0: 0.5, y0: 0.5, x1: 0.6, y1: 0.6 } },
    { label: "person", score: 0.99, box: { x0: 0, y0: 0, x1: 1, y1: 1 } },
  ], isMapped);
  check("vf4-pick-mapped", tg !== null && tg.label === "dog", JSON.stringify(tg));
  tg = pickScanTarget([
    { label: "person", score: 0.99, box: { x0: 0, y0: 0, x1: 1, y1: 1 } },
    { label: "chair", score: 0.8, box: { x0: 0.4, y0: 0.4, x1: 0.6, y1: 0.6 } },
    { label: "bench", score: 0.5, box: { x0: 0, y0: 0, x1: 0.5, y1: 0.5 } },
  ], isMapped);
  check("vf4-pick-area", tg !== null && tg.label === "chair", JSON.stringify(tg));
  tg = pickScanTarget([
    { label: "person", score: 0.9, box: { x0: 0.3, y0: 0.3, x1: 0.7, y1: 0.7 } },
    { label: "car", score: 0.9, box: { x0: 0.3, y0: 0.3, x1: 0.7, y1: 0.7 } },
  ], isMapped);
  check("vf4-pick-none", tg === null, JSON.stringify(tg));
  tg = pickScanTarget([
    { label: "chair", score: 0.8, box: { x0: 0, y0: 0.4, x1: 0.6, y1: 0.6 } },
  ], isMapped);
  check("vf4-pick-edge", tg === null, JSON.stringify(tg));
} catch (e) {
  check("sr1m-compile", false, String(e).slice(0, 200));
} finally {
  rmBuild();
}

console.log(`verify-scanreveal: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
