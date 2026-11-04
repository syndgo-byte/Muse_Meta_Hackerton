// scripts/verify-battle9b.mjs — 9-B 후속 순수 모션 검증 (lib/motion/battleMotion.ts).
// 실행: node scripts/verify-battle9b.mjs (종료 코드만 본다).
// - 바운스 1.5s 주기(= 3초 검증 그리드 정렬)·접지·단조
// - 공격 돌진: k=0·1 복귀, 상대 쪽 대각선, 좌우 대칭
// - yaw: mine 뒤·오른쪽 / wild 정면·왼쪽, 대칭
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BUILD = mkdtempSync(join(tmpdir(), "verify-battle9b-"));
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

execFileSync(
  process.execPath,
  [
    join(ROOT, "node_modules", "typescript", "bin", "tsc"),
    "--outDir", BUILD,
    "--rootDir", join(ROOT, "lib", "motion"),
    "--module", "commonjs",
    "--target", "es2021",
    "--moduleResolution", "node",
    "--skipLibCheck",
    "--noEmitOnError",
    "lib/motion/battleMotion.ts",
  ],
  { cwd: ROOT, stdio: "inherit" }
);
const bm = req(join(BUILD, "battleMotion.js"));

// ---- 1. 바운스 주기 (3초 그리드 정렬) ----
check("bounce period const 1.5", bm.BATTLE_BOUNCE_PERIOD === 1.5);
check(
  "bounce(t+1.5)==bounce(t)",
  Math.abs(bm.battleBounceY(0.37 + 1.5) - bm.battleBounceY(0.37)) < 1e-9
);
check(
  "bounce(t+3)==bounce(t)",
  Math.abs(bm.battleBounceY(1.1 + 3) - bm.battleBounceY(1.1)) < 1e-9
);
check("bounce(0)==0 grounded", bm.battleBounceY(0) === 0);
{
  let mn = Infinity;
  let mx = -Infinity;
  for (let t = 0; t <= 3; t += 0.05) {
    const y = bm.battleBounceY(t);
    if (y < mn) mn = y;
    if (y > mx) mx = y;
  }
  check("bounce never below ground", mn >= 0, `min=${mn}`);
  check("bounce peak == AMP", mx === bm.BATTLE_BOUNCE_AMP, `max=${mx}`);
}

// ---- 2. 다리 굽힘 (착지에서 굽고 피크에서 핀다) ----
check("crouch(AMP)==0 extended", bm.battleLegCrouch(bm.BATTLE_BOUNCE_AMP) === 0);
check("crouch(0)==0.3 bent", bm.battleLegCrouch(0) === 0.3);
check(
  "crouch monotonic",
  bm.battleLegCrouch(0) > bm.battleLegCrouch(bm.BATTLE_BOUNCE_AMP / 2) &&
    bm.battleLegCrouch(bm.BATTLE_BOUNCE_AMP / 2) > bm.battleLegCrouch(bm.BATTLE_BOUNCE_AMP)
);

// ---- 3. 대각선 마주보기 yaw ----
{
  const ym = bm.battleYaw("mine");
  const yw = bm.battleYaw("wild");
  check("mine yaw faces up-right", Math.sin(ym) > 0 && Math.cos(ym) < 0, `yaw=${ym}`);
  check("wild yaw faces down-left", Math.sin(yw) < 0 && Math.cos(yw) > 0, `yaw=${yw}`);
  check(
    "yaw symmetric 0.42",
    Math.abs(Math.PI - ym - 0.42) < 1e-12 && Math.abs(yw + 0.42) < 1e-12
  );
}

// ---- 4. 공격 돌진 (J-5: 옆·위 짧은 이동, 앞뒤(z) 최소. 튀었다 복귀) ----
{
  const m0 = bm.battleAttackMove(0, "mine");
  const m1 = bm.battleAttackMove(1, "mine");
  check("attack k=0 origin", m0.x === 0 && m0.y === 0 && m0.z === 0);
  check(
    "attack k=1 returns",
    Math.abs(m1.x) < 1e-9 && Math.abs(m1.y) < 1e-9 && Math.abs(m1.z) < 1e-9,
    `${m1.x},${m1.y},${m1.z}`
  );
  const mh = bm.battleAttackMove(0.5, "mine");
  const wh = bm.battleAttackMove(0.5, "wild");
  check("mine hops sideways-up", mh.x > 0 && mh.y > 0, `${mh.x},${mh.y},${mh.z}`);
  check("wild hops sideways-up", wh.x < 0 && wh.y > 0, `${wh.x},${wh.y},${wh.z}`);
  check("lunge z travel tiny", Math.abs(mh.z) <= 0.05 && Math.abs(wh.z) <= 0.05, `${mh.z},${wh.z}`);
  check("lunge mostly lateral-up", Math.abs(mh.z) < Math.abs(mh.x) && Math.abs(wh.z) < Math.abs(wh.x));
  check("lunge symmetric", mh.x === -wh.x && mh.y === wh.y && mh.z === -wh.z);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exitCode = failures > 0 ? 1 : 0;
