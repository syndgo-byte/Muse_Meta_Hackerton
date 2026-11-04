// D4-3 검증: 상태 감소·회복·기절·05시 리셋 (CREATURE_STATUS §2-2·§2-3).
// 실행: node scripts/verify-status-decay.mjs (종료 코드만 본다).
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BUILD = mkdtempSync(join(tmpdir(), "verify-status-decay-"));
const req = createRequire(join(ROOT, "package.json"));

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}
function cleanup(paths) {
  for (const p of paths) rmSync(p, { force: true });
}

// KST wall-clock → ms. kst(2026, 10, 2, 10, 0) = 11-02 10:00 KST (월).
function kst(y, mo, d, h, mi = 0) {
  return Date.UTC(y, mo - 1, d, h - 9, mi, 0);
}
function close(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
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
      "lib/status/decay.ts",
      "lib/status/store.ts",
      "lib/species.ts",
      "lib/token/ledger.ts",
      "lib/token/sqlite.d.ts",
      "lib/token/config.ts",
    ],
    { cwd: ROOT, stdio: "inherit" }
  );
  const decay = req(join(BUILD, "status", "decay.js"));
  const store = req(join(BUILD, "status", "store.js"));
  const ledger = req(join(BUILD, "token", "ledger.js"));
  const { applyTick, kstDay5am, isFainted, FAINTED_MESSAGE } = decay;
  const { readCreatureStatus, writeCreatureStatus, tickStatus, touchCareAt, healToMax } = store;
  const used = [];
  const freshStatus = () => {
    const p = join(tmpdir(), `verify-status-${process.pid}-${used.length}.json`);
    rmSync(p, { force: true });
    used.push(p);
    process.env.CREATURE_STATUS_PATH = p;
    return p;
  };

  // 1. 05시 경계 단위.
  check("kstDay5am 04:59 -> 전날", kstDay5am(kst(2026, 11, 2, 4, 59)) === "2026-11-01");
  check("kstDay5am 05:00 -> 당일", kstDay5am(kst(2026, 11, 2, 5, 0)) === "2026-11-02");

  // 2. 접속 4시간(1분 tick × 240) → 포만감 -16, 활력 -20.
  {
    const t0 = kst(2026, 11, 2, 10, 0);
    let s = {
      fullness: 100, energy: 100, affection: 50,
      lastTickAt: t0, lastCareAt: t0, lastResetDay: kstDay5am(t0),
    };
    for (let i = 1; i <= 240; i++) s = applyTick(s, t0 + i * 60_000);
    check(
      "4h connected decay",
      close(s.fullness, 84) && close(s.energy, 80) && s.affection === 50,
      `fullness=${s.fullness} energy=${s.energy} affection=${s.affection}`
    );
  }

  // 3. 공백 3분 → 감소 없음 (lastTickAt만 갱신).
  {
    const t0 = kst(2026, 11, 2, 10, 0);
    const s = applyTick(
      { fullness: 60, energy: 70, affection: 50, lastTickAt: t0, lastCareAt: t0, lastResetDay: kstDay5am(t0) },
      t0 + 180_000
    );
    check(
      "3min gap no decay",
      s.fullness === 60 && s.energy === 70 && s.lastTickAt === t0 + 180_000,
      JSON.stringify(s)
    );
  }

  // 4. 교감 없이 24시간 → 친밀도 -10, 하루 1회.
  {
    const t0 = kst(2026, 11, 2, 10, 0);
    const base = { fullness: 100, energy: 100, affection: 50, lastTickAt: t0, lastCareAt: t0, lastResetDay: kstDay5am(t0) };
    const cut1 = applyTick({ ...base }, t0 + 24 * 3600_000);
    const cut2 = applyTick({ ...cut1, lastTickAt: t0 + 24 * 3600_000 }, t0 + 25 * 3600_000);
    const cut3 = applyTick({ ...cut2, lastTickAt: t0 + 25 * 3600_000 }, t0 + 49 * 3600_000);
    check(
      "affection -10 after 24h once per day",
      cut1.affection === 40 && cut2.affection === 40 && cut3.affection === 30,
      `${cut1.affection}/${cut2.affection}/${cut3.affection}`
    );
  }

  // 5. 05시 통과 → 포만감·활력 100, 친밀도 그대로.
  {
    const s = applyTick(
      { fullness: 40, energy: 30, affection: 55, lastTickAt: kst(2026, 11, 2, 10, 0), lastCareAt: kst(2026, 11, 2, 10, 0), lastResetDay: "2026-11-02" },
      kst(2026, 11, 3, 6, 0)
    );
    check(
      "05:00 reset fills body not affection",
      s.fullness === 100 && s.energy === 100 && s.affection === 55 && s.lastResetDay === "2026-11-03",
      JSON.stringify(s)
    );
  }

  // 6. 3일 미접속 → 리셋 1회 (100으로 1번만, 누적 없음).
  {
    const s = applyTick(
      { fullness: 10, energy: 5, affection: 55, lastTickAt: kst(2026, 11, 1, 10, 0), lastCareAt: kst(2026, 11, 1, 10, 0), lastResetDay: "2026-11-01" },
      kst(2026, 11, 4, 10, 0)
    );
    check(
      "3 days away single reset",
      s.fullness === 100 && s.energy === 100 && s.lastResetDay === "2026-11-04",
      JSON.stringify(s)
    );
  }

  // 7. 기존 파일 호환: 5개 필드만 있어도 읽히고, 첫 tick에 처벌 없음.
  {
    freshStatus();
    const p = process.env.CREATURE_STATUS_PATH;
    writeFileSync(p, JSON.stringify({ fullness: 50, energy: 80, affection: 20, xp: 0, level: 1 }));
    const rd = await readCreatureStatus();
    const t = kst(2026, 11, 2, 10, 0);
    const nx = await tickStatus(t);
    check(
      "legacy file adopted without cut/reset",
      rd.lastTickAt === 0 && nx.fullness === 50 && nx.energy === 80 && nx.affection === 20 &&
        nx.lastTickAt === t && nx.lastCareAt === t && nx.lastResetDay === "2026-11-02",
      JSON.stringify(nx)
    );
  }

  // 8. 쓰기 병합: 5개 수치만 보내도 타이머·hp 유지. 새 필드 검증.
  {
    freshStatus();
    await writeCreatureStatus({ fullness: 50, energy: 80, affection: 20, xp: 0, level: 1, hp: 90, lastTickAt: 1000, lastCareAt: 2000, lastResetDay: "2026-11-02" });
    const r1 = await writeCreatureStatus({ fullness: 10, energy: 10, affection: 10, xp: 0, level: 1 });
    const rd = await readCreatureStatus();
    const bad1 = await writeCreatureStatus({ fullness: -1, energy: 0, affection: 0, xp: 0, level: 1 });
    const bad2 = await writeCreatureStatus({ fullness: 0, energy: 0, affection: 0, xp: 0, level: 1, hp: -5 });
    check(
      "write merges timers/hp, rejects invalid",
      r1.ok && rd.fullness === 10 && rd.hp === 90 && rd.lastTickAt === 1000 && !bad1.ok && !bad2.ok,
      JSON.stringify(rd)
    );
  }

  // 9. touchCareAt: lastCareAt만 갱신.
  {
    freshStatus();
    await writeCreatureStatus({ fullness: 50, energy: 80, affection: 20, xp: 0, level: 1 });
    const t = kst(2026, 11, 2, 12, 0);
    const nx = await touchCareAt(t);
    check("touchCareAt updates lastCareAt", nx.lastCareAt === t && nx.fullness === 50, JSON.stringify(nx.lastCareAt));
  }

  // 10. 기절 판정 + 메시지.
  check("isFainted", isFainted(0) === true && isFainted(undefined) === false && isFainted(50) === false);
  check("fainted message", FAINTED_MESSAGE === "기절했어요. 제휴처를 들르면 깨어납니다.", FAINTED_MESSAGE);

  // 11. 충전 1회 → hp 최대치. 같은 signalId 재전송 → 회복 없음 (duplicate면 heal 호출 안 함).
  {
    freshStatus();
    const lp = join(tmpdir(), `verify-status-ledger-${process.pid}.sqlite`);
    rmSync(lp, { force: true });
    used.push(lp);
    process.env.TOKEN_LEDGER_PATH = lp;
    await writeCreatureStatus({ fullness: 50, energy: 80, affection: 20, xp: 0, level: 1, hp: 5 });
    const c1 = await ledger.credit({ signalId: "heal-sig-1", storeName: "s", category: "coffee", amountKrw: 5000 });
    if (c1.ok && !c1.duplicate) await healToMax(120);
    const afterHeal = await readCreatureStatus();
    await writeCreatureStatus({ ...(await readCreatureStatus()), hp: 5 });
    const c2 = await ledger.credit({ signalId: "heal-sig-1", storeName: "s", category: "coffee", amountKrw: 5000 });
    if (c2.ok && !c2.duplicate) await healToMax(120);
    const afterDup = await readCreatureStatus();
    check(
      "credit heals once, duplicate does not",
      c1.ok && afterHeal.hp === 120 && c2.ok && c2.duplicate === true && afterDup.hp === 5,
      `heal=${afterHeal.hp} dup=${afterDup.hp}`
    );
    delete process.env.TOKEN_LEDGER_PATH;
  }

  cleanup(used);
  rmSync(BUILD, { recursive: true, force: true });
  if (failures > 0) {
    console.log(`verify-status-decay: FAIL (${failures} failed)`);
    process.exit(1);
  } else {
    console.log("verify-status-decay: PASS (13/13)");
  }
}

main().catch((e) => {
  console.error("verify-status-decay: ERROR", e);
  process.exit(1);
});
