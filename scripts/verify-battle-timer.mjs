// scripts/verify-battle-timer.mjs — BT-T 검증 (가짜 시계, 종료코드 0 = 전부 통과).
// 실행: node scripts/verify-battle-timer.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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

const BUILD = mkdtempSync(join(tmpdir(), "verify-bt-t-"));
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
      "lib/battle/skills.ts",
      "lib/battle/roster.ts",
      "lib/battle/timer.ts",
      "lib/battle/engine.ts",
    ],
    { cwd: ROOT, stdio: "pipe" }
  );
} catch (e) {
  check("timer-compile", false, String(e).slice(0, 200));
  console.log(`\nverify-battle-timer: ${pass} PASS, ${fail} FAIL`);
  process.exit(1);
}
const T = req(join(BUILD, "battle", "timer.js"));
const E = req(join(BUILD, "battle", "engine.js"));
check("timer-compile", true);

// 상수.
check("const-accept", T.ACCEPT_WAIT_S === 15);
check("const-turn", T.TURN_S === 20);
check("const-maxdouble", T.MAX_DOUBLE_PASS === 3);
check("const-wild-turn", T.WILD_TURN_S === 15);
check("const-wild-idle", T.WILD_IDLE_TURNS === 2);

// PvP: 3턴 양쪽 패스 → 종료 / 한쪽만 패스 → 계속.
let dp = 0;
dp = T.nextDoublePass(dp, true, true);
dp = T.nextDoublePass(dp, true, true);
check("pvp-double-2-continue", dp === 2 && !T.isDoublePassEnd(dp));
dp = T.nextDoublePass(dp, true, true);
check("pvp-double-3-end", dp === 3 && T.isDoublePassEnd(dp));
check("pvp-single-reset", T.nextDoublePass(2, true, false) === 0);
check("pvp-none-reset", T.nextDoublePass(2, false, false) === 0);

// 판정: HP 비율 높은 쪽, 동률 무승부.
check("judge-mine", T.judgeByRatio(80, 100, 30, 100) === "mine");
check("judge-wild", T.judgeByRatio(20, 100, 90, 100) === "wild");
check("judge-draw", T.judgeByRatio(50, 100, 30, 60) === "draw");

// 수락 15초 취소.
check("accept-early", !T.isAcceptExpired(1000, 1000 + 14 * 1000));
check("accept-expired", T.isAcceptExpired(1000, 1000 + 15 * 1000));

// 야생 2턴(30초) 방치 → 달아남 (AF-3/6).
let [r1, p1] = T.wildIdleStep(14 * 1000, 0);
check("wild-early", r1 === "acted" && p1 === 0);
[r1, p1] = T.wildIdleStep(15 * 1000, 0);
check("wild-pass1", r1 === "pass" && p1 === 1);
[r1, p1] = T.wildIdleStep(15 * 1000, p1);
check("wild-fled2", r1 === "fled" && p1 === 2);

// driving 정지: pausedMs만큼 마감 연장.
check("pause-remaining", T.turnRemainingSec(0, 15, 10 * 1000, 20 * 1000) === 5);
check("remaining-full", T.turnRemainingSec(5000, 15, 0, 5000) === 15);
check("remaining-zero", T.turnRemainingSec(0, 15, 0, 16 * 1000) === 0);
check("turn-expired", T.isTurnExpired(0, 20, 20 * 1000) && !T.isTurnExpired(0, 20, 19 * 1000));

// pov 배선: 방치 인터벌·결과 3종·카운트다운 prop 존재.
const pov = readFileSync(join(ROOT, "app", "pov", "page.tsx"), "utf8");
check("pov-idle-interval", pov.includes("wildIdleStep") && pov.includes("finishBattle(\"wildFled\")"));
check("pov-timer-prop", pov.includes("timerSec={battlePhase"));
check("pov-yawn-state", pov.includes("battleYawn") && pov.includes("setBattleYawn(yawnLine)"));
check("pov-yawn-render", pov.includes('data-testid="battle-yawn"') && pov.includes('battlePhase === "fight" && battleYawn'));
check("pov-yawn-clear", (pov.match(/setBattleYawn\(null\)/g) || []).length >= 4);
const brt = readFileSync(join(ROOT, "components", "battle", "BattleResultText.tsx"), "utf8");
check("result-texts", brt.includes("달아났다") && brt.includes("판정승") && brt.includes("무승부"));

// ---- 엔진 패스·시간 종료 (순수 턴) ----
{
  const rng = () => 0.999;
  const fresh = () => E.createBattle("fire-01", "grass-04");
  check("eng-pass-const", E.PASS_SLOT === -1);
  // 한쪽 패스: 상대만 행동, 턴 진행, 카운터 0.
  {
    const s = fresh();
    const r = E.applyTurn(s, 0, E.PASS_SLOT, rng);
    check("eng-single-pass",
      r.state.turn === 2 && !r.state.over && (r.state.doublePass ?? 0) === 0
      && r.state.wild.hp < s.wild.hp && r.state.mine.hp === s.mine.hp
      && r.logs.some((l) => l.includes("쉬었다")) && r.order.join(",") === "mine,wild",
      `turn=${r.state.turn} order=${r.order.join(",")}`);
  }
  // 양쪽 패스 2턴: 계속.
  {
    let s = fresh();
    s = E.applyTurn(s, E.PASS_SLOT, E.PASS_SLOT, rng).state;
    s = E.applyTurn(s, E.PASS_SLOT, E.PASS_SLOT, rng).state;
    check("eng-double-2", !s.over && s.doublePass === 2 && s.turn === 3, `turn=${s.turn} dp=${s.doublePass}`);
  }
  // 양쪽 패스 3턴: 종료 + 동률 무승부.
  {
    let s = fresh();
    let logs = [];
    for (let i = 0; i < 3; i++) {
      const r = E.applyTurn(s, E.PASS_SLOT, E.PASS_SLOT, rng);
      s = r.state;
      logs = r.logs;
    }
    check("eng-double-3-draw",
      s.over === true && s.winner === null && logs.join("").includes("시간 종료 — 무승부"),
      `over=${s.over} winner=${s.winner}`);
  }
  // 한쪽이 앞서면 판정승.
  {
    let s = fresh();
    s = E.applyTurn(s, 0, E.PASS_SLOT, rng).state; // wild만 맞음
    for (let i = 0; i < 3; i++) s = E.applyTurn(s, E.PASS_SLOT, E.PASS_SLOT, rng).state;
    check("eng-judge-mine", s.over === true && s.winner === "mine", `winner=${s.winner}`);
  }
  // 일반 턴에 끼면 카운터 리셋 + 종료 안 함.
  {
    let s = fresh();
    s = E.applyTurn(s, E.PASS_SLOT, E.PASS_SLOT, rng).state;
    s = E.applyTurn(s, E.PASS_SLOT, E.PASS_SLOT, rng).state;
    s = E.applyTurn(s, 0, 0, rng).state;
    check("eng-reset", !s.over && (s.doublePass ?? 0) === 0, `dp=${s.doublePass}`);
  }
  // 패스 없는 전투는 기존 출력 그대로 (doublePass 키 없음).
  {
    const s = fresh();
    const r = E.applyTurn(s, 0, 0, rng);
    check("eng-no-key", !("doublePass" in s) && !("doublePass" in r.state));
  }
}

rmSync(BUILD, { recursive: true, force: true });
console.log(`\nverify-battle-timer: ${pass} PASS, ${fail} FAIL`);
if (fail > 0) process.exitCode = 1;
