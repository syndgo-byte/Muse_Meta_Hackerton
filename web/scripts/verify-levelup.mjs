// scripts/verify-levelup.mjs — LV-2 검증 (하이브리드 성장 규칙 + AI 폴백).
// 실행: node scripts/verify-levelup.mjs (종료 코드만 본다).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BUILD = mkdtempSync(join(tmpdir(), "verify-levelup-"));
const req = createRequire(join(ROOT, "package.json"));

let failures = 0;
let passes = 0;
function check(name, cond, detail = "") {
  if (cond) {
    passes += 1;
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOACT = { walkM: 0, scans: 0, dances: 0 };

async function main() {
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
      "lib/levelup.ts",
      "lib/battle/roster.ts",
      "lib/battle/skills.ts",
      "lib/activity.ts",
      "lib/walk.ts",
    ],
    { cwd: ROOT, stdio: "pipe" }
  );
  const lv = req(join(BUILD, "levelup.js"));
  const act = req(join(BUILD, "activity.js"));

  // 상수
  check("const-cap", lv.LV2_CORRECTION_PER_LEVEL === 2, lv.LV2_CORRECTION_PER_LEVEL);
  check("const-timeout", lv.LV2_AI_TIMEOUT_MS === 10000, lv.LV2_AI_TIMEOUT_MS);
  check("const-model", lv.LV2_MODEL === "muse-spark-1.3", lv.LV2_MODEL);

  // 규칙 표 구조 (레벨 1·5·10)
  const r1 = lv.ruleBoosts("attacker", 1, NOACT);
  check("rule-L1-zero", r1.atk === 0 && r1.hp === 0 && r1.def === 0 && r1.spd === 0, JSON.stringify(r1));
  const r5 = lv.ruleBoosts("attacker", 5, NOACT);
  const pts5 = r5.atk + r5.def + r5.spd + r5.hp / 5;
  check("rule-L5-points", pts5 === 12, JSON.stringify(r5));
  check("rule-L5-cap", r5.atk <= 6 && r5.def <= 6 && r5.spd <= 6 && r5.hp / 5 <= 6, JSON.stringify(r5));
  const r10 = lv.ruleBoosts("tanker", 10, NOACT);
  const pts10 = r10.atk + r10.def + r10.spd + r10.hp / 5;
  check("rule-L10-points", pts10 === 27, JSON.stringify(r10));
  check("rule-L10-cap", r10.atk <= 13 && r10.def <= 13 && r10.spd <= 13 && r10.hp / 5 <= 13, JSON.stringify(r10));

  // 활동 보정 (L5 풀=8점, 단일 우세 몰아주기)
  const w5 = lv.activityCorrection({ walkM: 10000, scans: 0, dances: 0 }, 5);
  check("act-walk", w5.spd === 8 && w5.atk === 0 && w5.hp === 0 && w5.def === 0, JSON.stringify(w5));
  const s5 = lv.activityCorrection({ walkM: 0, scans: 100, dances: 0 }, 5);
  check("act-scan", s5.hp === 8 && s5.atk === 0 && s5.spd === 0 && s5.def === 0, JSON.stringify(s5));
  const d5 = lv.activityCorrection({ walkM: 0, scans: 0, dances: 100 }, 5);
  check("act-dance", d5.atk === 8 && d5.hp === 0 && d5.spd === 0 && d5.def === 0, JSON.stringify(d5));
  const n5 = lv.activityCorrection(NOACT, 5);
  check("act-none", n5.atk === 0 && n5.hp === 0 && n5.def === 0 && n5.spd === 0, JSON.stringify(n5));
  const t5 = lv.activityCorrection({ walkM: 10, scans: 1, dances: 0 }, 5);
  check("act-threshold", t5.atk === 0 && t5.hp === 0 && t5.def === 0 && t5.spd === 0, JSON.stringify(t5));
  // hp 포인트는 boosts에서 ×5
  const h5 = lv.ruleBoosts("supporter", 5, { walkM: 0, scans: 100, dances: 0 });
  check("act-hp-x5", h5.hp % 5 === 0 && h5.hp >= 40, JSON.stringify(h5));

  // AI 검증 (초과·불량 → null)
  check("val-over", lv.validateAiCorrection({ atk: 9, hp: 0, def: 0, spd: 0 }, 5) === null);
  check("val-neg", lv.validateAiCorrection({ atk: -1, hp: 0, def: 0, spd: 0 }, 5) === null);
  check("val-nan", lv.validateAiCorrection({ atk: "x", hp: 0, def: 0, spd: 0 }, 5) === null);
  const vv = lv.validateAiCorrection({ atk: 3, hp: 2, def: 1, spd: 2 }, 5);
  check("val-ok", vv !== null && vv.atk === 3 && vv.hp === 2 && vv.def === 1 && vv.spd === 2, JSON.stringify(vv));

  // AI 실패(모킹) → 규칙 값
  const inp = { role: "attacker", level: 5, activity: { walkM: 10000, scans: 0, dances: 0 } };
  const rules = lv.ruleBoosts("attacker", 5, inp.activity);
  const same = (b) => b.atk === rules.atk && b.hp === rules.hp && b.def === rules.def && b.spd === rules.spd;
  let r = await lv.resolveLevelup(inp, () => Promise.reject(new Error("boom")));
  check("mock-throw", r.source === "rule" && same(r.boosts), JSON.stringify(r.source));
  r = await lv.resolveLevelup(inp, () => sleep(200).then(() => ({ correction: { atk: 8, hp: 0, def: 0, spd: 0 } })), 50);
  check("mock-timeout", r.source === "rule" && same(r.boosts), JSON.stringify(r.source));
  r = await lv.resolveLevelup(inp, () => Promise.resolve({ correction: { atk: 99, hp: 0, def: 0, spd: 0 } }));
  check("mock-over", r.source === "rule" && same(r.boosts), JSON.stringify(r.source));
  r = await lv.resolveLevelup(inp, () => Promise.resolve({ nope: 1 }));
  check("mock-garbage", r.source === "rule" && same(r.boosts), JSON.stringify(r.source));
  r = await lv.resolveLevelup(inp, () => Promise.resolve({ correction: { atk: 4, hp: 0, def: 0, spd: 4 }, message: "AI 한 줄" }));
  check("mock-valid", r.source === "ai" && r.boosts.atk === rules.atk + 4 && r.boosts.spd === rules.spd - 4 && r.message === "AI 한 줄", JSON.stringify(r));
  r = await lv.resolveLevelup(inp, () => Promise.resolve({ correction: { atk: 8, hp: 0, def: 0, spd: 0 } }));
  check("mock-nomsg", r.source === "ai" && typeof r.message === "string" && r.message.length > 0, JSON.stringify(r.message));

  // 토스트 문구
  check("toast-fmt", lv.formatToast(5, { atk: 0, hp: 3, def: 0, spd: 2 }) === "레벨 5! 체력 +3, 속도 +2", lv.formatToast(5, { atk: 0, hp: 3, def: 0, spd: 2 }));
  check("toast-line", lv.levelupLine(5, { atk: 0, hp: 0, def: 0, spd: 8 }, "오늘 많이 걸었더니 발이 빨라졌어") === "레벨 5! 속도 +8 · 오늘 많이 걸었더니 발이 빨라졌어");
  check("toast-line-nogain", lv.levelupLine(2, { atk: 0, hp: 0, def: 0, spd: 0 }, "쑥쑥 자랐어") === "레벨 2! · 쑥쑥 자랐어");

  // 정적: 서버 한 곳에서만 AI 호출, 키는 .env
  const route = readFileSync(join(ROOT, "app", "api", "levelup", "route.ts"), "utf8");
  check("route-muse", route.includes("@/lib/muse") && route.includes("callMuseJson"));
  check("route-model", route.includes("MUSE_MODEL_SPARK ?? LV2_MODEL"));
  check("route-timeout", route.includes("LV2_AI_TIMEOUT_MS") || route.includes("resolveLevelup"));
  const pov = readFileSync(join(ROOT, "app", "pov", "page.tsx"), "utf8");
  check("no-client-muse", !pov.includes("lib/muse"));
  const gi = readFileSync(join(ROOT, ".gitignore"), "utf8");
  check("env-ignored", gi.split("\n").some((l) => l.trim() === ".env" || l.trim() === ".env*"));
  const toastWin = pov.match(/data-testid="lv-toast"[\s\S]{0,600}?pointerEvents: "none"/);
  check("toast-ui", toastWin !== null);
  check("trigger", pov.includes("handleLevelup(partner.id, out.levelup.level)"));
  // MF-1: 내부 danceId를 화면에 내보내지 않음
  const lufx = readFileSync(join(ROOT, "components", "LevelUpFx.tsx"), "utf8");
  check("mf1-no-danceid", !lufx.includes("danceId") && !pov.includes("새 춤 해금"));

  // LV-2 춤 기록: 카운터 + 연타 방지 가드
  {
    const store = {};
    globalThis.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    };
    act.recordActivityDance();
    act.recordActivityDance();
    check("dance-counts", act.loadActivityCounts().dances === 2, JSON.stringify(store));
    delete globalThis.localStorage;
  }
  {
    const g = act.shouldRecordDanceEnd;
    check("dedupe-first", g("ateez", "", 0, 10000) === true);
    check("dedupe-repeat-fast", g("ateez", "ateez", 10000, 12000) === false);
    check("dedupe-repeat-late", g("ateez", "ateez", 10000, 14000) === true);
    check("dedupe-other-dance", g("a2o", "ateez", 10000, 11000) === true);
    check("dedupe-test-excluded", g("test", "", 0, 10000) === false);
    check("dedupe-null-excluded", g(null, "", 0, 10000) === false);
  }
  // DexScene 종료 지점 배선 (정적)
  {
    const dex = readFileSync(join(ROOT, "components", "DexScene.tsx"), "utf8");
    check("dex-imports-recorder", dex.includes("recordActivityDance"));
    check("dex-uses-guard", dex.includes("shouldRecordDanceEnd"));
  }

  rmSync(BUILD, { recursive: true, force: true });
  console.log(`verify-levelup: ${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

await main();
