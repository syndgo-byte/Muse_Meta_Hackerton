// scripts/verify-driving.mjs — BT-2 검증 (운전 중 판정 순수 함수 + 덮개 상수).
// 실행: node scripts/verify-driving.mjs (종료 코드만 본다).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BUILD = mkdtempSync(join(tmpdir(), "verify-driving-"));
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

function tick(d, st, now, speedMps, bonnet) {
  return d.drivingTick(st, { now, speedMps, bonnet });
}

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
      "lib/battle/driving.ts",
    ],
    { cwd: ROOT, stdio: "pipe" }
  );
  const d = req(join(BUILD, "battle", "driving.js"));

  // 상수 한 곳 (BT-2b: driving.ts만; page.tsx 리터럴 금지)
  check("const-speed", d.DRIVING_SPEED_MPS === 5, d.DRIVING_SPEED_MPS);
  check("const-hold", d.DRIVING_SPEED_HOLD_MS === 2000, d.DRIVING_SPEED_HOLD_MS);
  check("const-bonnet-minw", d.DRIVING_BONNET_MIN_W === 0.5, d.DRIVING_BONNET_MIN_W);
  check("const-bonnet-edge", d.DRIVING_BONNET_EDGE_Y === 0.98, d.DRIVING_BONNET_EDGE_Y);
  check("const-bonnet-hold", d.DRIVING_BONNET_HOLD_MS === 5000, d.DRIVING_BONNET_HOLD_MS);
  check("const-walk", d.DRIVING_WALK_MPS === 2.5, d.DRIVING_WALK_MPS);
  check("const-alpha", d.BATTLE_OVERLAY_MAX_ALPHA <= 0.25, d.BATTLE_OVERLAY_MAX_ALPHA);
  check("const-msg", d.DRIVING_MSG === "운전 중에는 배틀할 수 없어요", d.DRIVING_MSG);

  // 속도: 4 m/s 지속 → 운전 아님
  let st = { ...d.EMPTY_DRIVING };
  let r = st;
  for (const t of [0, 1000, 2000, 3000]) r = tick(d, r.state ?? r, t, 4, false);
  check("speed-4", r.driving === false, JSON.stringify(r.driving));
  // 속도: 6 m/s 1초 → 아직 아님
  r = tick(d, { ...d.EMPTY_DRIVING }, 0, 6, false);
  r = tick(d, r.state, 1000, 6, false);
  check("speed-6-short", r.driving === false, JSON.stringify(r.driving));
  // 속도: 6 m/s 2초 → 운전 중
  r = tick(d, r.state, 2000, 6, false);
  check("speed-6-hold", r.driving === true, JSON.stringify(r.driving));
  // 속도: null은 무시 (누적 유지)
  r = tick(d, { ...d.EMPTY_DRIVING }, 0, 6, false);
  r = tick(d, r.state, 1000, 6, false);
  r = tick(d, r.state, 2000, null, false);
  r = tick(d, r.state, 3000, 6, false);
  check("speed-null-ignore", r.driving === true, JSON.stringify(r.driving));
  // 속도: 5 미만이면 리셋
  r = tick(d, { ...d.EMPTY_DRIVING }, 0, 6, false);
  r = tick(d, r.state, 1000, 6, false);
  r = tick(d, r.state, 2000, 4, false);
  r = tick(d, r.state, 3000, 6, false);
  check("speed-reset", r.driving === false, JSON.stringify(r.driving));

  // 차 라벨 (정확 일치, 대소문자 무시)
  check("vehicle-labels",
    d.isVehicleLabel("car") && d.isVehicleLabel("Truck") && d.isVehicleLabel("BUS") &&
    d.isVehicleLabel("motorcycle") && !d.isVehicleLabel("cup") && !d.isVehicleLabel("person"));
  // 보닛형: 길가 주차차(옆·작음·위)는 제외
  check("bonnet-parked-side", d.isBonnetBox({ x0: 0.62, x1: 0.95, y1: 0.95 }) === false);
  check("bonnet-edge-miss", d.isBonnetBox({ x0: 0.3, x1: 0.7, y1: 0.97 }) === false);
  check("bonnet-narrow", d.isBonnetBox({ x0: 0.35, x1: 0.65, y1: 1.0 }) === false);
  check("bonnet-offcenter", d.isBonnetBox({ x0: 0.55, x1: 1.0, y1: 1.0 }) === false);
  check("bonnet-ok", d.isBonnetBox({ x0: 0.2, x1: 0.8, y1: 1.0 }) === true);
  // 보닛 4초 → 아님, 5초 → 운전 중 (1초 틱)
  r = { ...d.EMPTY_DRIVING };
  for (const t of [0, 1000, 2000, 3000, 4000]) r = tick(d, r.state ?? r, t, null, true);
  check("bonnet-4s", r.driving === false, JSON.stringify(r.driving));
  r = tick(d, r.state, 5000, null, true);
  check("bonnet-5s", r.driving === true, JSON.stringify(r.driving));
  // 빗나감 1틱이면 누적 리셋
  r = { ...d.EMPTY_DRIVING };
  for (const t of [0, 1000, 2000, 3000, 4000]) r = tick(d, r.state ?? r, t, null, true);
  r = tick(d, r.state, 5000, null, false);
  r = tick(d, r.state, 6000, null, true);
  check("bonnet-break", r.driving === false, JSON.stringify(r.driving));
  // 걷기 거부: < 2.5 m/s면 보닛 박스와 무관히 운전 아님
  r = { ...d.EMPTY_DRIVING };
  for (const t of [0, 1000, 2000, 3000, 4000, 5000]) r = tick(d, r.state ?? r, t, 1.0, true);
  check("walk-veto", r.driving === false, JSON.stringify(r.driving));
  // null 속도 + 보닛 5초 → 운전 중 (sim 경로, null은 걷기 아님)
  r = { ...d.EMPTY_DRIVING };
  for (const t of [0, 1000, 2000, 3000, 4000, 5000]) r = tick(d, r.state ?? r, t, null, true);
  check("bonnet-null-speed", r.driving === true, JSON.stringify(r.driving));
  // 속도 판정 뒤 걷기면 해제
  r = tick(d, { ...d.EMPTY_DRIVING }, 0, 6, false);
  r = tick(d, r.state, 1000, 6, false);
  r = tick(d, r.state, 2000, 6, false);
  r = tick(d, r.state, 3000, 1.0, false);
  check("walk-release", r.driving === false, JSON.stringify(r.driving));

  // 정적: pov 배선
  const pov = readFileSync(join(ROOT, "app", "pov", "page.tsx"), "utf8");
  const veilOk = pov.includes("BATTLE_OVERLAY_MAX_ALPHA") ||
    (() => {
      const m = pov.match(/battleVeil\s*\{\s*0%\s*\{\s*opacity:\s*0;?\s*\}\s*100%\s*\{\s*opacity:\s*([0-9.]+)/);
      return m !== null && Number(m[1]) <= 0.25;
    })();
  check("pov-veil-alpha", veilOk);
  const coverAlphas = [...pov.matchAll(/hexA\(ELEMENT_FX_COLOR[^,]*,\s*([0-9.]+)\)/g)].map((m) => Number(m[1]));
  const coverOk = pov.includes("BATTLE_OVERLAY_MAX_ALPHA") ||
    (coverAlphas.length > 0 && coverAlphas.every((a) => a <= 0.25));
  check("pov-cover-alpha", coverOk, coverAlphas.join(","));
  check("pov-cover-driving", /coverOn && !driving/.test(pov));
  check("pov-battle-disabled", /disabled=\{driving\}/.test(pov));
  check("pov-queue-msg", pov.includes("DRIVING_MSG"));
  check("pov-moves-disabled", /movesDisabled=\{[^}]*\bdriving\b/.test(pov));
  check("pov-bonnet-wire", pov.includes("isBonnetBox"));
  check("pov-bt2state", pov.includes("__bt2state"));
  check("pov-bt2inject", pov.includes("__bt2inject"));
  // MF-2: sim 배경 유지 (쿼리 → sessionStorage → cafe, 버튼은 replaceState)
  check("mf2-env-persist",
    pov.includes("oishie-sim-env") && pov.includes("setEnvSync") &&
    pov.includes("replaceState") && /get\("env"\)/.test(pov));

  rmSync(BUILD, { recursive: true, force: true });
  console.log(`verify-driving: ${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

await main();
