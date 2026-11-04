// scripts/verify-hud.mjs — E2 /hud 검증 (RAYBAN_UI §4).
// 정적 검사 + Chrome headless 스크린샷 4종 + PIL 발광 픽셀 비율.
// dev 서버(3000)는 끄지 않고 그대로 쓴다.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shotDir = join(root, "scratch", "hud");
mkdirSync(shotDir, { recursive: true });

let pass = 0;
let fail = 0;
function check(name, ok, extra = "") {
  if (ok) { pass++; console.log(`PASS ${name}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`FAIL ${name}${extra ? " — " + extra : ""}`); }
}

const page = join(root, "app", "hud", "page.tsx");
const src = existsSync(page) ? readFileSync(page, "utf8") : "";
check("hud-page-exists", existsSync(page));

// 1. 스프라이트 존재 + 묶음 300KB 이하
const hudDir = join(root, "public", "hud");
const pngs = existsSync(hudDir) ? readdirSync(hudDir).filter((f) => f.endsWith(".png")) : [];
const total = pngs.reduce((a, f) => a + statSync(join(hudDir, f)).size, 0);
check("sprites-exist", pngs.length >= 3, `${pngs.length}개`);
check("sprites-under-300KB", pngs.length > 0 && total <= 300 * 1024, `${total}B`);

// 2. 드래그·호버·터치 핸들러 없음
const banned = ["onMouse", "onDrag", "onTouch", "onPointer", "onWheel", "onHover", ":hover", "draggable"];
const found = banned.filter((b) => src.includes(b));
check("no-drag-hover-handlers", found.length === 0, found.join(",") || "없음");

// 3. 글자 크기 전부 28px 이상
const sizes = [...src.matchAll(/fontSize:\s*(\d+)/g)].map((m) => Number(m[1]));
check("font-sizes-found", sizes.length > 0, `${sizes.length}곳`);
check("font-min-28px", sizes.length > 0 && sizes.every((n) => n >= 28), `min=${Math.min(...sizes, 99)}`);

// 4. 한글 문자열 한 줄 14자 이내 (주석 제거 후 검사)
const noComment = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const ko = [...new Set([...noComment.matchAll(/[가-힣0-9!、。]{1,}/g)].map((m) => m[0]))];
const long = ko.filter((s) => s.length > 14);
check("line-max-14chars", long.length === 0, long.join(",") || `${ko.length}개 문자열`);

// 5. 방향키 + Enter 처리 있음
const keys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"];
check("arrow-enter-handlers", keys.every((k) => src.includes(k)));

// 6. 모든 버튼 포커스 가능 (tabIndex -1·disabled 없음)
const buttons = (src.match(/<button/g) || []).length;
const unfocusable = (src.match(/tabIndex=\{-1\}|disabled/g) || []).length;
check("buttons-focusable", buttons > 0 && unfocusable === 0, `${buttons}개 버튼`);

// 7. /api/status 읽기만 (POST·PUT·DELETE 없음), battle은 lib/battle import만
check("status-readonly", !/(fetch\([^)]*,\s*\{[^}]*method:\s*"(POST|PUT|DELETE)")/i.test(src) && !src.includes("method:"));
check("battle-import-only", src.includes("lib/battle/") && !src.includes("PovCreature"));

// 8. 스크린샷 4종 + preview
const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const screens = ["idle", "hazard", "battle", "result"];
let shotOk = true;
if (!existsSync(chrome)) {
  shotOk = false;
  console.log("SKIP screenshots — chrome 없음");
} else {
  for (const s of screens) {
    const out = join(shotDir, `hud-${s}.png`);
    try {
      execFileSync(chrome, [
        "--headless=new", "--disable-gpu", "--hide-scrollbars",
        "--window-size=600,600", `--screenshot=${out}`,
        `http://localhost:3000/hud?screen=${s}`,
      ], { timeout: 60000, stdio: "pipe" });
      if (!existsSync(out) || statSync(out).size === 0) shotOk = false;
    } catch (e) { shotOk = false; console.log(`  shot ${s} 오류: ${String(e).slice(0, 120)}`); }
  }
  try {
    execFileSync(chrome, [
      "--headless=new", "--disable-gpu", "--hide-scrollbars",
      "--window-size=600,600", `--screenshot=${join(shotDir, "hud-preview.png")}`,
      "http://localhost:3000/hud?screen=idle&preview=1",
    ], { timeout: 60000, stdio: "pipe" });
  } catch { shotOk = false; }
}
check("screenshots-4", shotOk);

// 9. 켜진 픽셀 ≤15% (PIL), preview는 체크무늬라 높게 나와야 함
let ratios = {};
try {
  const py = `
from PIL import Image
import json, glob, os
r = {}
for p in sorted(glob.glob(r"${shotDir.replace(/\\/g, "\\\\")}/hud-*.png")):
    im = Image.open(p).convert("RGB")
    px = im.load()
    w, h = im.size
    lit = sum(1 for y in range(0, h, 2) for x in range(0, w, 2) if px[x, y] != (0, 0, 0))
    tot = ((w + 1) // 2) * ((h + 1) // 2)
    r[os.path.basename(p)] = [round(100 * lit / tot, 2), w, h]
print(json.dumps(r))
`;
  const out = execFileSync("python", ["-c", py], { encoding: "utf8", timeout: 60000 });
  ratios = JSON.parse(out);
  console.log("  lit%:", JSON.stringify(ratios));
} catch (e) { console.log("  PIL 오류:", String(e).slice(0, 150)); }
let litOk = true;
for (const s of screens) {
  const r = ratios[`hud-${s}.png`];
  if (!r || r[0] > 15) { litOk = false; break; }
}
check("lit-pixels-under-15pct", litOk);
const pv = ratios["hud-preview.png"];
check("preview-checkerboard", !!pv && pv[0] > 30, pv ? `${pv[0]}%` : "없음");

console.log(`\nverify-hud: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
