// scripts/verify-no-ellipsis.mjs — UH-1 검증 (말줄임·title 툴팁 잔존 0 + 조사 + 최장 이름).
// 실행: node scripts/verify-no-ellipsis.mjs (종료코드 0 = 전부 통과)
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const req = createRequire(join(ROOT, "package.json"));

let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`); }
}

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (f === "node_modules" || f.startsWith(".next")) continue;
      walk(p, out);
    } else if (/\.(tsx?|css)$/.test(f)) out.push(p);
  }
  return out;
}

function stripComments(src, isCss) {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, "");
  if (!isCss) s = s.replace(/^\s*\/\/.*$/gm, "");
  return s;
}

async function main() {
  // 1. 말줄임·title 툴팁 잔존 0 (app·components·lib).
  const files = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components")), ...walk(join(ROOT, "lib"))];
  const ellHit = [];
  const titleHit = [];
  for (const f of files) {
    const src = stripComments(readFileSync(f, "utf8"), f.endsWith(".css"));
    if (src.includes("ellipsis")) ellHit.push(f.slice(ROOT.length + 1));
    if (/title\s*=\s*["'{]/.test(src)) titleHit.push(f.slice(ROOT.length + 1));
  }
  check("no-ellipsis", ellHit.length === 0, ellHit.slice(0, 8).join(","));
  check("no-title-attr", titleHit.length === 0, titleHit.slice(0, 8).join(","));
  const josaHit = [];
  for (const f of files) {
    if (/[\\/]lib[\\/]josa\.ts$/.test(f)) continue;
    const src = stripComments(readFileSync(f, "utf8"), f.endsWith(".css"));
    if (/이\(가\)|을\(를\)|은\(는\)|와\(과\)|으로\(로\)|\(으\)로/.test(src)) josaHit.push(f.slice(ROOT.length + 1));
  }
  check("no-josa-literal", josaHit.length === 0, josaHit.slice(0, 8).join(","));

  // 2. 조사 함수 (lib/josa.ts 컴파일 후 단위 검사).
  const BUILD = mkdtempSync(join(tmpdir(), "verify-noell-"));
  try {
    execFileSync(
      process.execPath,
      [
        join(ROOT, "node_modules", "typescript", "bin", "tsc"),
        "--outDir", BUILD,
        "--rootDir", join(ROOT, "lib"),
        "--module", "commonjs",
        "--target", "es2021",
        "--moduleResolution", "node",
        "--esModuleInterop",
        "--skipLibCheck",
        "--noEmitOnError",
        "lib/josa.ts",
      ],
      { cwd: ROOT, stdio: "pipe" }
    );
    const josa = req(join(BUILD, "josa.js"));
    const T = [
      ["모카퐁", "이가", "모카퐁이"], ["물방울이", "이가", "물방울이가"],
      ["연날이", "이가", "연날이가"], ["콩나물이", "을를", "콩나물이를"],
      ["돌멩이", "을를", "돌멩이를"], ["선풍기", "은는", "선풍기는"],
      ["구름빵", "은는", "구름빵은"], ["모카퐁", "와과", "모카퐁과"],
      ["선풍기", "와과", "선풍기와"], ["모카퐁", "으로", "모카퐁으로"],
      ["선풍기", "으로", "선풍기로"], ["서울", "으로", "서울로"],
      ["Pikachu", "이가", "Pikachu가"],
    ];
    let jok = true;
    for (const [w, k, want] of T) {
      const got = josa.josa(w, k);
      if (got !== want) { jok = false; console.log(`  josa ${w}+${k} = ${got} (want ${want})`); }
    }
    check("josa-cases", jok);
    check("josa-empty", josa.josa("", "이가") === "이가");
  } catch (e) {
    check("josa-compile", false, String(e).slice(0, 160));
  } finally {
    rmSync(BUILD, { recursive: true, force: true });
  }

  // 3. 최장 이름 목록 + 스킬 버튼 수용 (정적 용량 검사, 렌더 증명은 캡처).
  const rosterSrc = readFileSync(join(ROOT, "lib", "battle", "roster.ts"), "utf8");
  const skillsSrc = readFileSync(join(ROOT, "lib", "battle", "skills.ts"), "utf8");
  const spNames = [...rosterSrc.matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]);
  const uniqNames = [...rosterSrc.matchAll(/uniq\("[^"]+",\s*"([^"]+)"/g)].map((m) => m[1]);
  const moveNames = [...skillsSrc.matchAll(/base\("[^"]+",\s*"([^"]+)"/g)].map((m) => m[1]);
  const allMoves = [...new Set([...uniqNames, ...moveNames])];
  const longest = (arr) => arr.reduce((a, b) => (b.length > a.length ? b : a), "");
  const lSp = longest(spNames);
  const lMv = longest(allMoves);
  console.log(`  longest-species: ${lSp} (${lSp.length}자, ${spNames.length}종)`);
  console.log(`  longest-move: ${lMv} (${lMv.length}자, ${allMoves.length}종)`);
  check("names-found", spNames.length >= 24 && allMoves.length >= 10, `${spNames.length}/${allMoves.length}`);
  // 스킬 버튼: 2줄·최소 10px로 최장 이름 수용 (한글 1자 ≈ 1em).
  const skSrc = readFileSync(join(ROOT, "components", "battle", "SkillButtons.tsx"), "utf8");
  const wM = skSrc.match(/SKILL_BTN_W\s*=\s*(\d+)/);
  const fsM = skSrc.match(/SKILL_NAME_MIN\s*=\s*(\d+)/);
  const linesM = skSrc.match(/SKILL_NAME_LINES\s*=\s*(\d+)/);
  if (wM && fsM && linesM) {
    const cap = Math.floor((Number(wM[1]) - 12) / Number(fsM[1])) * Number(linesM[1]);
    check("skill-capacity", cap >= lMv.length, `cap=${cap}자 < ${lMv.length}자(${lMv})`);
  } else {
    check("skill-capacity", false, "SKILL_BTN_W/SKILL_NAME_MIN/SKILL_NAME_LINES 상수 없음");
  }

  console.log(`\nverify-no-ellipsis: ${pass} PASS, ${fail} FAIL`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exitCode = 1;
});
