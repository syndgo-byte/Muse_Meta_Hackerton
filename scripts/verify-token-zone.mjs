// scripts/verify-token-zone.mjs — 5-2 검증 (존 판정·쿨다운).
// 실행: node scripts/verify-token-zone.mjs (종료 코드만 본다).
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BUILD = mkdtempSync(join(tmpdir(), "verify-zone-"));
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
      "--outDir", BUILD,
      "--rootDir", join(ROOT, "lib"),
      "--module", "commonjs",
      "--target", "es2021",
      "--moduleResolution", "node",
      "--esModuleInterop",
      "--skipLibCheck",
      "--noEmitOnError",
      "lib/token/simZones.ts",
    ],
    { cwd: ROOT, stdio: "inherit" },
  );
  const z = req(join(BUILD, "token", "simZones.js"));

  // 1. sim 구간 판정.
  check("street 15s bakery", z.zoneAt("street", 15)?.id === "street-bakery");
  check("street 35s trend", z.zoneAt("street", 35)?.id === "street-trend");
  check("street 25s none", z.zoneAt("street", 25) === null);
  check("cafe 10s trend", z.zoneAt("cafe", 10)?.id === "cafe-trend");
  check("cafe 35s shop", z.zoneAt("cafe", 35)?.id === "cafe-shop");
  check("boundary from-inclusive", z.zoneAt("street", 10)?.id === "street-bakery");
  check("boundary to-exclusive", z.zoneAt("street", 20) === null);
  // 2. cam GPS 판정.
  check("geo inside 50m", z.zoneAtGeo(37.5445, 127.0557)?.store === "성수 베이커리");
  check("geo outside", z.zoneAtGeo(37.5, 127.0) === null);
  check("geo invalid", z.zoneAtGeo(NaN, 0) === null);
  // 3. 쿨다운.
  check("first show", z.shouldShow({}, "a", 1000) === true);
  check("respects 30s", z.shouldShow({ a: 1000 }, "a", 20000) === false);
  check("re-show after 30s", z.shouldShow({ a: 1000 }, "a", 31000) === true);
  check("other zone unaffected", z.shouldShow({ a: 1000 }, "b", 20000) === true);
  // 4. 카드 내용 규칙.
  const t = z.zoneAt("street", 35);
  check("trending list", Array.isArray(t.trending) && t.trending.length === 2);
  check("amount 50", z.TOKEN_ZONES.every((x) => x.amount === 50));

  console.log(`verify-token-zone: ${failures === 0 ? "PASS" : "FAIL"} (${passes}/${passes + failures})`);
  if (failures > 0) process.exitCode = 1;
}

await main();
