// scripts/verify-starter.mjs — ST-1 검증 (빈 저장소 → 지급, 기존 저장소 → 무변경).
// 실행: node scripts/verify-starter.mjs (종료 코드만 본다).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BUILD = mkdtempSync(join(tmpdir(), "verify-starter-"));
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

function stubStore(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    dump: () => Object.fromEntries([...m.entries()].sort()),
  };
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
      "lib/starter.ts",
      "lib/species.ts",
    ],
    { cwd: ROOT, stdio: "pipe" }
  );
  const st = req(join(BUILD, "starter.js"));

  // 1. 빈 저장소 → 지급
  let store = stubStore();
  globalThis.localStorage = store;
  st.ensureStarter();
  const dex = JSON.parse(store.dump()["snapquest-dex"] ?? "[]");
  check("grant-dex", dex.length === 1 && dex[0].id === "fire-01" && dex[0].name === "모카퐁"
    && dex[0].element === "fire" && dex[0].image === "/dex/fire-01.jpg", JSON.stringify(dex));
  check("grant-seen", JSON.parse(store.dump()["snapquest-seen"] ?? "[]").includes("fire-01"));
  check("grant-partner", store.dump()["snapquest_active_partner"] === "fire-01");
  // 2. 멱등: 다시 불러도 동일
  const once = JSON.stringify(store.dump());
  st.ensureStarter();
  check("idempotent", JSON.stringify(store.dump()) === once);
  // 3. 기존 저장소 → 무변경
  const existing = {
    "snapquest-dex": JSON.stringify([{ id: "grass-01", name: "리피몽" }]),
    "snapquest-seen": JSON.stringify(["grass-01"]),
    "snapquest_active_partner": "grass-01",
  };
  store = stubStore(existing);
  globalThis.localStorage = store;
  st.ensureStarter();
  check("existing-untouched", JSON.stringify(store.dump()) === JSON.stringify(Object.fromEntries(Object.entries(existing).sort())));
  delete globalThis.localStorage;

  // 4. 정적: 상수 일치 + 진입점 배선 + camp 전용 지급 삭제 + freshStart 연동
  const starterSrc = readFileSync(join(ROOT, "lib", "starter.ts"), "utf8");
  const slotsSrc = readFileSync(join(ROOT, "lib", "slots.ts"), "utf8");
  const dp = slotsSrc.match(/DEFAULT_PARTNER = "(.*?)"/)?.[1];
  const sid = starterSrc.match(/STARTER_ID = "(.*?)"/)?.[1];
  check("const-match", !!dp && dp === sid, `${sid} vs ${dp}`);
  for (const [nm, p] of [
    ["wire-main", "app/page.tsx"],
    ["wire-pov", "app/pov/page.tsx"],
    ["wire-dex", "app/dex/page.tsx"],
    ["wire-camp", "app/camp/page.tsx"],
    ["wire-hud", "app/hud/page.tsx"],
  ]) {
    check(nm, readFileSync(join(ROOT, ...p.split("/")), "utf8").includes("ensureStarter()"));
  }
  const camp = readFileSync(join(ROOT, "app", "camp", "page.tsx"), "utf8");
  check("camp-hack-removed", !camp.includes('capturedSet.add("fire-01")'));
  check("slots-freshstart", slotsSrc.includes("ensureStarter(); // ST-1"));

  rmSync(BUILD, { recursive: true, force: true });
  console.log(`verify-starter: ${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

await main();
