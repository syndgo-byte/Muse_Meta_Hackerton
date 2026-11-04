// scripts/verify-per-creature.mjs — PC-1 크리처별 성장 검증 (docs/PER_CREATURE_ORDER.md).
// 실행: node scripts/verify-per-creature.mjs (서버 불필요, 격리 임시 파일만 사용).
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BUILD = mkdtempSync(join(tmpdir(), "verify-per-creature-"));
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
      "lib/status/store.ts",
      "lib/status/decay.ts",
      "lib/species.ts",
      "lib/token/ledger.ts",
      "lib/token/sqlite.d.ts",
      "lib/token/config.ts",
      "--outDir", BUILD,
      "--rootDir", join(ROOT, "lib"),
      "--module", "commonjs",
      "--target", "es2021",
      "--moduleResolution", "node",
      "--esModuleInterop",
      "--skipLibCheck",
      "--noEmitOnError",
    ],
    { cwd: ROOT, stdio: "inherit" }
  );
  const store = req(join(BUILD, "status", "store.js"));
  const { readCreatureStatus, writeCreatureStatus } = store;
  const used = [];
  const fresh = () => {
    const p = join(tmpdir(), `verify-per-creature-${process.pid}-${used.length}.json`);
    rmSync(p, { force: true });
    rmSync(p.replace(/\.json$/, ".bak.json"), { force: true });
    used.push(p);
    process.env.CREATURE_STATUS_PATH = p;
    return p;
  };

  // 1. A 배틀 승리 → A만 xp·level 증가, B는 그대로.
  {
    fresh();
    const w = await writeCreatureStatus({ speciesId: "fire-01", xp: 500, level: 5, hp: 40 });
    const a = await readCreatureStatus("fire-01");
    const b = await readCreatureStatus("grass-01");
    const raw = JSON.parse(readFileSync(process.env.CREATURE_STATUS_PATH, "utf8"));
    check(
      "battle-win-a-only",
      w.ok && a.xp === 500 && a.level === 5 && a.hp === 40 && a.speciesId === "fire-01" &&
        b.xp === 0 && b.level === 1 && b.hp === undefined && raw.growth["grass-01"] === undefined,
      `a=${a.xp}/${a.level} b=${b.xp}/${b.level}`
    );
  }

  // 2. A 스탯 배분 → B 스탯 그대로.
  {
    fresh();
    await writeCreatureStatus({
      speciesId: "fire-01", statPoints: 3,
      statBoosts: { atk: 1, hp: 5, def: 0, spd: 0 },
      statUpgrades: 0, statRespecs: 0, statGrantedLevel: 2,
    });
    const a = await readCreatureStatus("fire-01");
    const b = await readCreatureStatus("grass-01");
    check(
      "stat-distribute-a-only",
      a.statPoints === 3 && a.statBoosts.hp === 5 && a.statGrantedLevel === 2 &&
        b.statPoints === undefined && b.statBoosts === undefined,
      `a=${JSON.stringify(a.statBoosts)} b=${JSON.stringify(b.statBoosts)}`
    );
  }

  // 3. 옛 단일 파일 → 마이그레이션 (대표만 옛 레벨, 백업 생성).
  {
    const p = fresh();
    const legacy = {
      fullness: 60, energy: 70, affection: 30, xp: 900, level: 9, hp: 40,
      lastTickAt: 1000, lastCareAt: 2000, lastResetDay: "2026-11-02",
      statPoints: 4, statBoosts: { "fire-01": { atk: 2, hp: 10, def: 0, spd: 0 }, "grass-01": { atk: 0, hp: 5, def: 1, spd: 0 } },
      statUpgrades: 2, statRespecs: 0, statGrantedLevel: 9,
    };
    writeFileSync(p, JSON.stringify(legacy));
    const a = await readCreatureStatus("fire-01");
    const b = await readCreatureStatus("grass-01");
    const bak = p.replace(/\.json$/, ".bak.json");
    const bakOk = existsSync(bak) && readFileSync(bak, "utf8") === JSON.stringify(legacy);
    const raw = JSON.parse(readFileSync(p, "utf8"));
    check(
      "legacy-migration",
      a.xp === 900 && a.level === 9 && a.hp === 40 && a.statPoints === 4 && a.statBoosts.hp === 10 &&
        a.statUpgrades === 2 && b.level === 1 && b.xp === 0 && raw.partnerId === "fire-01" &&
        typeof raw.growth === "object",
      `a=${a.xp}/${a.level} b=${b.xp}/${b.level}`
    );
    check("legacy-boosts-kept", b.statBoosts !== undefined && b.statBoosts.hp === 5, JSON.stringify(b.statBoosts));
    check("legacy-backup", bakOk);
  }

  // 4. 없는 크리처 → 쓰기 거부·읽기 거부.
  {
    fresh();
    const w = await writeCreatureStatus({ speciesId: "nope-99", xp: 1 });
    let threw = false;
    try {
      await readCreatureStatus("nope-99");
    } catch {
      threw = true;
    }
    check("bad-species-rejected", w.ok === false && threw === true);
  }

  // 5. 스타터 명시 생성 → Lv.1 기본.
  {
    fresh();
    const w = await writeCreatureStatus({ speciesId: "fire-01" });
    const a = await readCreatureStatus("fire-01");
    check("starter-defaults", w.ok && a.xp === 0 && a.level === 1, `a=${a.xp}/${a.level}`);
  }

  for (const p of used) {
    rmSync(p, { force: true });
    rmSync(p.replace(/\.json$/, ".bak.json"), { force: true });
  }
  delete process.env.CREATURE_STATUS_PATH;
  rmSync(BUILD, { recursive: true, force: true });
  console.log(`\nverify-per-creature: ${passes} PASS, ${failures} FAIL`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exitCode = 1;
});
