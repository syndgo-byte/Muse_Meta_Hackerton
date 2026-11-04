// scripts/verify-walk-plan.mjs — 7-C 검증 (멈춤·뒤돌아보기·차 존·친밀도 분기).
// 실행: node scripts/verify-walk-plan.mjs (종료 코드만 본다).
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BUILD = mkdtempSync(join(tmpdir(), "verify-walk-"));
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

const base = {
  now: 100,
  mode: "sim",
  video: "street",
  videoTime: 5,
  userMoving: true,
  laneX: 0.36,
  cars: [],
  blocks: [],
  affection: 20,
  fullness: 80,
  dangerRecently: false,
  nextLookBackAt: 1000,
  lookBackUntil: 0,
  rand: 0.5,
};

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
      "lib/motion/simPath.ts",
      "lib/motion/walkPlan.ts",
    ],
    { cwd: ROOT, stdio: "inherit" },
  );
  const { laneAt } = req(join(BUILD, "motion", "simPath.js"));
  const { planWalk } = req(join(BUILD, "motion", "walkPlan.js"));

  // 1. sim 인도 중앙으로 걷기 (street 0~12초 실측: 0.3~0.42 → 0.36).
  {
    const o = planWalk({ ...base });
    check("sim lane center", !o.stopped && o.walkLane.speed === 1
      && Math.abs(o.walkLane.x - 0.36) < 1e-9 && o.reason === "walking",
      JSON.stringify(o.walkLane));
  }
  // 2. 사용자 정지 → 멈춤, 제자리.
  {
    const o = planWalk({ ...base, userMoving: false });
    check("user stop", o.stopped && o.walkLane.speed === 0
      && o.walkLane.x === 0.36 && o.reason === "user-stopped",
      JSON.stringify(o.walkLane));
  }
  // 3. 차 존: 멈춤 + 경고, 뒤돌아보기 금지(예정 시각이 지나도).
  {
    const car = { x0: 0.3, y0: 0.5, x1: 0.42, y1: 0.9 };
    const o = planWalk({ ...base, cars: [car], nextLookBackAt: 50 });
    check("car zone stops", o.stopped && o.reason === "car"
      && o.balloon === "조심! 앞에 차가 있어요" && o.lookBack === false,
      JSON.stringify({ b: o.balloon, lb: o.lookBack }));
  }
  // 4. 앞막힘: 멈춤 + idle.
  {
    const blk = { x0: 0.3, y0: 0.3, x1: 0.42, y1: 0.8 };
    const o = planWalk({ ...base, blocks: [blk] });
    check("blocked stops", o.stopped && o.reason === "blocked" && o.emote === "idle",
      JSON.stringify({ e: o.emote, r: o.reason }));
  }
  // 5. 뒤돌아보기 간격: 예정 시각 도래 시 15~25초 뒤로 재예약.
  {
    const o0 = planWalk({ ...base, now: 200, nextLookBackAt: 200, rand: 0 });
    const o1 = planWalk({ ...base, now: 200, nextLookBackAt: 200, rand: 1 });
    check("lookback fires when due", o0.lookBack === true && o1.lookBack === true);
    check("lookback gap 15..25",
      o0.nextLookBackAt === 200 + 1.5 + 15 && o1.nextLookBackAt === 200 + 1.5 + 25,
      `${o0.nextLookBackAt}/${o1.nextLookBackAt}`);
    const early = planWalk({ ...base, now: 100, nextLookBackAt: 200 });
    check("no early lookback", early.lookBack === false
      && early.nextLookBackAt === 200);
  }
  // 6. 친밀도·상태 분기.
  {
    const due = { ...base, now: 300, nextLookBackAt: 300 };
    const oStop = planWalk({ ...due, userMoving: false });
    check("stopped user -> Coming?", oStop.balloon === "올래?" && oStop.emote === "greet",
      JSON.stringify({ b: oStop.balloon, e: oStop.emote }));
    const oWarm = planWalk({ ...due, affection: 60 });
    check("warm -> Here!", oWarm.balloon === "여기야!" && oWarm.emote === "happy",
      JSON.stringify({ b: oWarm.balloon, e: oWarm.emote }));
    const oDanger = planWalk({ ...due, dangerRecently: true });
    check("after danger -> Let's go!", oDanger.balloon === "가자!" && oDanger.emote === "happy",
      JSON.stringify({ b: oDanger.balloon, e: oDanger.emote }));
    const oHungry = planWalk({ ...due, fullness: 20 });
    check("hungry -> Hungry…", oHungry.balloon === "배고파…" && oHungry.emote === "hungry",
      JSON.stringify({ b: oHungry.balloon, e: oHungry.emote }));
  }
  // 7. cam: 차 반대쪽으로 붙기.
  {
    const left = { x0: 0.05, y0: 0.4, x1: 0.2, y1: 0.8 };
    const oL = planWalk({ ...base, mode: "cam", laneX: 0.5, cars: [left] });
    const right = { x0: 0.8, y0: 0.4, x1: 0.95, y1: 0.8 };
    const oR = planWalk({ ...base, mode: "cam", laneX: 0.5, cars: [right] });
    check("cam away from cars",
      Math.abs(oL.walkLane.x - 0.72) < 1e-9 && Math.abs(oR.walkLane.x - 0.28) < 1e-9,
      `${oL.walkLane.x}/${oR.walkLane.x}`);
    const oNone = planWalk({ ...base, mode: "cam", laneX: 0.5 });
    check("cam no cars -> center", Math.abs(oNone.walkLane.x - 0.5) < 1e-9);
  }
  // 8. 목표점 회피: 블록과 겹치면 옆으로 이동.
  {
    const blk = { x0: 0.3, y0: 0.0, x1: 0.42, y1: 0.3 }; // y1 낮음 = 앞막힘 아님
    const o = planWalk({ ...base, blocks: [blk] });
    check("avoid target overlap", !o.stopped && Math.abs(o.walkLane.x - 0.36) > 0.01,
      JSON.stringify(o.walkLane));
  }
  // 9. laneAt: 구간 경계·범위 밖 고정 (8-A 실측값).
  {
    const a = laneAt("street", 5);
    const b = laneAt("cafe", 20);
    const c = laneAt("street", 9999);
    check("laneAt segments", a.x0 === 0.3 && a.x1 === 0.42 && b.x0 === 0.3 && b.x1 === 0.45
      && c.x0 === 0.3 && c.x1 === 0.45, JSON.stringify({ a, b, c }));
    const allIn = [0, 5, 12, 20, 30, 40, 50, 59].every((t) => {
        const s = laneAt("street", t);
        const f = laneAt("cafe", t);
        return s.x0 >= 0.3 && s.x1 <= 0.7 && f.x0 >= 0.3 && f.x1 <= 0.7;
      });
    check("lanes within 0.3..0.7", allIn);
  }

  console.log(`verify-walk-plan: ${failures === 0 ? "PASS" : "FAIL"} (${passes}/${passes + failures})`);
  if (failures > 0) process.exitCode = 1;
}

await main();
