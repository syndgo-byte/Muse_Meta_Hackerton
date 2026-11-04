// scripts/verify-statpoints.mjs — G3 스탯 포인트 검증 (BATTLE_DESIGN §7).
// 실행: node scripts/verify-statpoints.mjs (dev 서버 3000 사용, 끄지 않음).
// - 순수 로직: 상수·변환·상한·추천 배분 (tsc 단독 컴파일)
// - 라이브 API: G3 필드 저장·검증·복원 (기존 상태는 저장 후 복원)
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BUILD = mkdtempSync(join(tmpdir(), "verify-statpoints-"));
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

async function main() {
  execFileSync(
    process.execPath,
    [
      join(ROOT, "node_modules", "typescript", "bin", "tsc"),
      join(ROOT, "lib", "status", "statpoints.ts"),
      join(ROOT, "lib", "status", "barColor.ts"),
      "--outDir", BUILD,
      "--module", "commonjs",
      "--target", "es2021",
      "--moduleResolution", "node",
      "--esModuleInterop",
      "--skipLibCheck",
    ],
    { stdio: "pipe" }
  );
  const sp = req(join(BUILD, "statpoints.js"));
  const bc = req(join(BUILD, "barColor.js"));
  // 7-3 22번: 상태 바 색
  check("bar-base", bc.barColor("hp", 80, 100) === "#9fe870" && bc.barColor("fullness", 80, 100) === "#e8a13c" && bc.barColor("energy", 80, 100) === "#38bdf8" && bc.barColor("affection", 80, 100) === "#ff8fb2");
  check("bar-warn", bc.barColor("hp", 50, 100) === "#f59e0b" && bc.barColor("energy", 30, 100) === "#f59e0b");
  check("bar-danger", bc.barColor("hp", 10, 100) === "#ff5a5a" && bc.barColor("affection", 5, 100) === "#ff5a5a");
  check("bar-faint", bc.barColor("hp", 0, 111) === "#ff5a5a");

  // 상수
  check("consts", sp.POINTS_PER_LEVEL === 3 && sp.POINTS_PER_UPGRADE === 2 && sp.HP_PER_POINT === 5);
  // 변환
  check("hp-to-points", JSON.stringify(sp.boostsToPoints({ atk: 0, hp: 10, def: 0, spd: 0 })) === JSON.stringify({ atk: 0, hp: 2, def: 0, spd: 0 }));
  check("spent", sp.spentPoints({ atk: 2, hp: 5, def: 1, spd: 0 }) === 4);
  check("points-to-boosts", JSON.stringify(sp.pointsToBoosts({ atk: 1, hp: 2, def: 0, spd: 1 })) === JSON.stringify({ atk: 1, hp: 10, def: 0, spd: 1 }));
  check("sanitize", JSON.stringify(sp.sanitizeBoosts({ atk: -3, hp: 12, def: 1.9 })) === JSON.stringify({ atk: 0, hp: 10, def: 1, spd: 0 }));
  check("total", sp.totalSpent({ a: { atk: 1, hp: 0, def: 0, spd: 0 }, b: { atk: 0, hp: 5, def: 0, spd: 2 } }) === 4);
  // 상한
  check("cap", sp.statCap(0) === 1 && sp.statCap(1) === 1 && sp.statCap(2) === 1 && sp.statCap(3) === 1 && sp.statCap(4) === 2 && sp.statCap(10) === 5);
  // 추천 배분
  const r1 = sp.recommend("attacker", 3, { atk: 0, hp: 0, def: 0, spd: 0 }, 3);
  check("rec-attacker-3", r1.used === 3 && r1.add.atk === 1 && r1.add.spd === 1 && r1.add.hp === 1, JSON.stringify(r1));
  const r2 = sp.recommend("tanker", 6, { atk: 0, hp: 0, def: 0, spd: 0 }, 6);
  check("rec-tanker-6", r2.used === 6 && r2.add.def === 3 && r2.add.hp === 3, JSON.stringify(r2));
  const r3 = sp.recommend("supporter", 2, { atk: 0, hp: 0, def: 0, spd: 0 }, 2);
  check("rec-supporter-2", r3.used === 2 && r3.add.hp === 1 && r3.add.def === 1, JSON.stringify(r3));
  const r4 = sp.recommend("speed", 9, { atk: 0, hp: 0, def: 0, spd: 0 }, 9);
  const mx = Math.max(r4.add.atk, r4.add.hp, r4.add.def, r4.add.spd);
  check("rec-cap-respected", r4.used === 9 && mx <= 4, JSON.stringify(r4));
  const r5 = sp.recommend("trick", 3, { atk: 19, hp: 19, def: 19, spd: 19 }, 38);
  check("rec-full-uses-zero", r5.used === 0, JSON.stringify(r5));
  check("role-fallback", sp.asRoleKey("nope") === "attacker" && sp.asRoleKey("trick") === "trick");

  // 라이브 API (저장 후 복원). PC-1: 크리처별 slice로 갱신 (단일 statBoosts + speciesId).
  // VERIFY_STATUS_BASE로 격리 서버를 가리킬 수 있다 (기본 :3000).
  const base = `${process.env.VERIFY_STATUS_BASE ?? "http://localhost:3000"}/api/status`;
  const saved = await (await fetch(base, { cache: "no-store" })).json();
  const sliceOf = (v) => JSON.stringify([v.xp, v.level, v.hp ?? null, v.statPoints ?? null, v.statBoosts ?? null, v.statUpgrades ?? null, v.statRespecs ?? null, v.statGrantedLevel ?? null]);
  const bBefore = sliceOf(await (await fetch(`${base}?speciesId=grass-01`, { cache: "no-store" })).json());
  try {
    // 유효 저장 (A 크리처)
    let r = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ speciesId: "fire-01", statPoints: 5, statBoosts: { atk: 1, hp: 5, def: 0, spd: 1 }, statUpgrades: 1, statRespecs: 0, statGrantedLevel: 2 }),
    });
    const j = await r.json();
    check("api-save", r.ok && j.statPoints === 5 && j.statBoosts.hp === 5 && j.speciesId === "fire-01", `status=${r.status}`);
    // 다른 크리처는 그대로
    const bAfter = sliceOf(await (await fetch(`${base}?speciesId=grass-01`, { cache: "no-store" })).json());
    check("api-other-untouched", bBefore === bAfter, `${bBefore} vs ${bAfter}`);
    // 강화 상한 초과 → 400
    r = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ speciesId: "fire-01", statUpgrades: 999 }),
    });
    check("api-upgrade-cap", r.status === 400, `status=${r.status}`);
    // hp 5단위 위반 → 400
    r = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ speciesId: "fire-01", statBoosts: { atk: 0, hp: 3, def: 0, spd: 0 } }),
    });
    check("api-hp-step", r.status === 400, `status=${r.status}`);
    // 음수 → 400
    r = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ speciesId: "fire-01", statPoints: -1 }),
    });
    check("api-negative", r.status === 400, `status=${r.status}`);
    // 없는 크리처 → 400
    r = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ speciesId: "nope-99", statPoints: 1 }),
    });
    check("api-bad-species", r.status === 400, `status=${r.status}`);
  } finally {
    // 저장해 둔 GET 응답 그대로 복원 (growth 전체 + 공용 필드).
    await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(saved),
    });
  }

  rmSync(BUILD, { recursive: true, force: true });
  console.log(`\nverify-statpoints: ${passes} PASS, ${failures} FAIL`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exitCode = 1;
});
