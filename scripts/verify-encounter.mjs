// scripts/verify-encounter.mjs — G0 검증 (BATTLE_DESIGN §15-1a·§15-4).
// 실행: node scripts/verify-encounter.mjs (종료 코드만 본다).
// - 24종 매칭·최장 키워드·confidence, pity·쿨다운·하루 상한·EXP·기절·demo
// - 힌트 타이머·env 우선·3연속, 상태 파일 저장, 라이브 API 스모크
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BUILD = mkdtempSync(join(tmpdir(), "verify-encounter-"));
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
      "lib/encounter/table.ts",
      "lib/encounter/config.ts",
      "lib/encounter/decide.ts",
      "lib/encounter/hints.ts",
      "lib/encounter/store.ts",
      "lib/encounter/snapshots.ts",
      "lib/token/ledger.ts",
      "lib/token/config.ts",
      "lib/token/sqlite.d.ts",
    ],
    { cwd: ROOT, stdio: "inherit" }
  );
  const table = req(join(BUILD, "encounter", "table.js"));
  const decide = req(join(BUILD, "encounter", "decide.js"));
  const snaps = req(join(BUILD, "encounter", "snapshots.js"));
  const hints = req(join(BUILD, "encounter", "hints.js"));
  const store = req(join(BUILD, "encounter", "store.js"));
  const { ENCOUNTER_TABLE, matchLabel } = table;
  const { EMPTY_ENCOUNTER_STATE, decideEncounter, recordEncounterEnd, kstDayKey } = decide;
  const fresh = () => JSON.parse(JSON.stringify(EMPTY_ENCOUNTER_STATE));
  const T0 = Date.UTC(2026, 10, 1, 0, 0, 0); // KST 11-01 09:00

  // 1. 매칭.
  check("24 rows", ENCOUNTER_TABLE.length === 24, String(ENCOUNTER_TABLE.length));
  {
    const bad = [];
    for (const row of ENCOUNTER_TABLE) {
      const m = matchLabel(`우리집 ${row.keywords[0]} 사진`, 80);
      if (m.speciesId !== row.speciesId) bad.push(row.speciesId);
    }
    check("each first keyword matches", bad.length === 0, bad.join(","));
  }
  {
    const m = matchLabel("아이스 아메리카노", 80);
    check("longest wins (americano)", m.speciesId === "fire-01", JSON.stringify(m));
    const m2 = matchLabel("다육식물", 80);
    check("longest wins (dayuk)", m2.speciesId === "grass-05", JSON.stringify(m2));
    const m3 = matchLabel("커피", 59);
    check("confidence 59 -> low", m3.speciesId === null && m3.reason === "low-confidence", JSON.stringify(m3));
    const m4 = matchLabel("우주선", 90);
    check("unknown -> no-match", m4.speciesId === null && m4.reason === "no-match", JSON.stringify(m4));
    const m5 = matchLabel("커피", 80);
    const m6 = matchLabel("커피", 80);
    check("same label same species", m5.speciesId === m6.speciesId && m5.speciesId === "fire-01");
    const oneChar = ENCOUNTER_TABLE.flatMap((r) => r.keywords).filter((k) => k.length < 2);
    check("no 1-char keywords", oneChar.length === 0, oneChar.join(","));
  }

  // 2. pity: 난수 0.99 고정 → 3번째 매칭 확정.
  {
    let st = fresh();
    const r1 = decideEncounter({ speciesId: "fire-01", caughtIds: [], fainted: false, now: T0, roll: 0.99, state: st });
    const r2 = decideEncounter({ speciesId: "fire-01", caughtIds: [], fainted: false, now: T0 + 1000, roll: 0.99, state: r1.state });
    const r3 = decideEncounter({ speciesId: "fire-01", caughtIds: [], fainted: false, now: T0 + 2000, roll: 0.99, state: r2.state });
    check("pity 3rd guaranteed",
      r1.kind === "none" && r2.kind === "none" && r3.kind === "encounter" && r3.state.pity === 0,
      `${r1.kind}/${r2.kind}/${r3.kind}`);
  }

  // 3. 전체 쿨다운 3분: 조우 없음·pity 불변.
  {
    let st = fresh();
    st = decideEncounter({ speciesId: "fire-01", caughtIds: [], fainted: false, now: T0, roll: 0, state: st }).state;
    const pityBefore = st.pity;
    const r = decideEncounter({ speciesId: "grass-01", caughtIds: [], fainted: false, now: T0 + 60000, roll: 0, state: st });
    check("global cd 3min blocks, pity kept",
      r.kind === "none" && r.reason === "cooldown" && r.state.pity === pityBefore,
      `${r.kind}/${r.reason} pity=${r.state.pity}`);
    const r2 = decideEncounter({ speciesId: "grass-01", caughtIds: [], fainted: false, now: T0 + 3 * 60000 + 1, roll: 0, state: st });
    check("global cd expires", r2.kind === "encounter", r2.kind);
  }

  // 4. 종 쿨다운 10분.
  {
    let st = recordEncounterEnd(fresh(), "fire-01", "flee", T0);
    // 전체 쿨다운(3분)은 지났고 종 쿨다운(10분) 안.
    const rLate = decideEncounter({ speciesId: "fire-01", caughtIds: [], fainted: false, now: T0 + 4 * 60000, roll: 0, state: st });
    check("species cd 10min", rLate.kind === "none" && rLate.reason === "species-cooldown",
      `${rLate.kind}/${rLate.reason}`);
    const rOk = decideEncounter({ speciesId: "fire-01", caughtIds: [], fainted: false, now: T0 + 10 * 60000 + 1, roll: 0, state: st });
    check("species cd expires", rOk.kind === "encounter", rOk.kind);
  }

  // 5. 하루 8회 + 05시 리셋.
  {
    check("kst day boundary",
      kstDayKey(Date.UTC(2026, 10, 1, 19, 59)) === "2026-11-01" &&
      kstDayKey(Date.UTC(2026, 10, 1, 20, 0)) === "2026-11-02");
    let st = fresh();
    for (let i = 0; i < 8; i++) {
      const r = decideEncounter({ speciesId: "fire-01", caughtIds: [], fainted: false, now: T0 + i * 4 * 60000, roll: 0, state: st });
      st = r.state;
      if (r.kind !== "encounter") break;
    }
    const r9 = decideEncounter({ speciesId: "fire-01", caughtIds: [], fainted: false, now: T0 + 8 * 4 * 60000, roll: 0, state: st });
    check("daily cap 8", st.todayCount === 8 && r9.kind === "none" && r9.reason === "daily",
      `count=${st.todayCount} ${r9.kind}/${r9.reason}`);
    const nextDay = Date.UTC(2026, 10, 1, 21, 0); // KST 11-02 06:00
    const rNew = decideEncounter({ speciesId: "fire-01", caughtIds: [], fainted: false, now: nextDay, roll: 0, state: st });
    check("daily resets", rNew.kind === "encounter" && rNew.state.todayCount === 1,
      `${rNew.kind} count=${rNew.state.todayCount}`);
  }

  // 6. 포획 종 EXP +10 ×3, 4번째 0.
  {
    let st = fresh();
    const outs = [];
    for (let i = 0; i < 4; i++) {
      const r = decideEncounter({ speciesId: "fire-01", caughtIds: ["fire-01"], fainted: false, now: T0 + i * 1000, roll: 0, state: st });
      st = r.state;
      outs.push(r.kind === "exp" ? r.exp : r.reason);
    }
    check("caught exp 10x3 then capped",
      outs[0] === 10 && outs[1] === 10 && outs[2] === 10 && outs[3] === "exp-capped",
      outs.join(","));
  }

  // 7. 기절 → 조우 없음·상태 불변 (날짜 롤오버 제외).
  {
    const st = fresh();
    st.day = kstDayKey(T0);
    st.expDay = st.day;
    const before = JSON.stringify(st);
    const r = decideEncounter({ speciesId: "fire-01", caughtIds: [], fainted: true, now: T0, roll: 0, state: st });
    check("fainted blocks, state kept",
      r.kind === "none" && r.reason === "fainted" && JSON.stringify(r.state) === before,
      r.kind);
  }

  // 8. demo=1 → 확정.
  {
    let st = fresh();
    st = decideEncounter({ speciesId: "fire-01", caughtIds: [], fainted: false, now: T0, roll: 0, state: st }).state;
    const r = decideEncounter({ speciesId: "fire-01", caughtIds: [], fainted: false, demo: true, now: T0 + 1000, roll: 0.99, state: st });
    check("demo forces encounter", r.kind === "encounter", r.kind);
  }

  // 9. 힌트.
  {
    const allCaught = ENCOUNTER_TABLE.map((r) => r.speciesId);
    const h1 = hints.pickTimedHint({ caughtIds: [], env: "cafe", idleMs: 61000, sinceLastHintMs: null });
    check("timed hint after 60s", h1 !== null && h1.hint.length > 0, JSON.stringify(h1));
    const hEarly = hints.pickTimedHint({ caughtIds: [], env: "cafe", idleMs: 59000, sinceLastHintMs: null });
    check("no hint before 60s", hEarly === null);
    const hGap = hints.pickTimedHint({ caughtIds: [], env: "cafe", idleMs: 200000, sinceLastHintMs: 120000 });
    check("180s gap", hGap === null);
    const hGapOk = hints.pickTimedHint({ caughtIds: [], env: "cafe", idleMs: 200000, sinceLastHintMs: 181000 });
    check("hint after 180s gap", hGapOk !== null);
    const hEnv = hints.pickTimedHint({ caughtIds: allCaught.filter((id) => id !== "fire-01" && id !== "rock-01"), env: "cafe", idleMs: 61000, sinceLastHintMs: null });
    check("env priority", hEnv !== null && hEnv.speciesId === "fire-01", JSON.stringify(hEnv));
    const hMiss = hints.pickMissHint({ consecutiveMisses: 3, caughtIds: [], env: "room" });
    const hMiss2 = hints.pickMissHint({ consecutiveMisses: 2, caughtIds: [], env: "room" });
    check("3 misses instant", hMiss !== null && hMiss2 === null);
    const hAll = hints.pickTimedHint({ caughtIds: allCaught, env: "cafe", idleMs: 61000, sinceLastHintMs: null });
    check("all caught -> no hint", hAll === null);
    const noObjName = ENCOUNTER_TABLE.every((r) => !r.keywords.some((k) => r.hint.includes(k)));
    check("hints hide object names", noObjName);
    // 7-A: env 일치 + 영어 힌트.
    const envOf = (id) => (ENCOUNTER_TABLE.find((r) => r.speciesId === id) || {}).env;
    check("timed hint matches env", h1 !== null && envOf(h1.speciesId) === "cafe", JSON.stringify(h1));
    check("miss hint matches env", hMiss !== null && envOf(hMiss.speciesId) === "room", JSON.stringify(hMiss));
    const cafeCaught = ENCOUNTER_TABLE.filter((r) => r.env === "cafe").map((r) => r.speciesId);
    const hNoCafe = hints.pickTimedHint({ caughtIds: cafeCaught, env: "cafe", idleMs: 61000, sinceLastHintMs: null });
    check("no cross-env fallback (timed)", hNoCafe === null, JSON.stringify(hNoCafe));
    const hNoCafeMiss = hints.pickMissHint({ consecutiveMisses: 5, caughtIds: cafeCaught, env: "cafe" });
    check("no cross-env fallback (miss)", hNoCafeMiss === null, JSON.stringify(hNoCafeMiss));
    const hintEnOk = ENCOUNTER_TABLE.every((r) => typeof r.hintEn === "string" && r.hintEn.length > 0 && /^[\x20-\x7E]+$/.test(r.hintEn));
    check("hintEn english 24/24", hintEnOk);
    const hintEnNoObj = ENCOUNTER_TABLE.every((r) => !r.keywords.some((k) => r.hintEn.includes(k)));
    check("hintEn hides object names", hintEnNoObj);
  }

  // 10. 상태 파일 저장 (격리 경로).
  {
    const tmp = join(BUILD, "enc-state.json");
    process.env.ENCOUNTER_STATE_PATH = tmp;
    const r1 = await store.decideScan({ label: "커피", confidence: 80, caughtIds: [], fainted: false });
    const r2 = await store.decideScan({ label: "커피", confidence: 80, caughtIds: [], fainted: false });
    const saved = JSON.parse(readFileSync(tmp, "utf8"));
    const shapeOk = typeof saved.pity === "number" && typeof saved.todayCount === "number" &&
      typeof saved.day === "string" && typeof saved.expCounts === "object";
    check("store persists pity/encounter",
      (r1.kind === "encounter" || r1.state.pity === 1) && r2.state !== undefined && shapeOk,
      `${r1.kind}/${r2.kind}`);
    delete process.env.ENCOUNTER_STATE_PATH;
  }

  // 11. 라이브 API 스모크 (매칭 실패 → 저장 없음).
  {
    const res = await fetch("http://127.0.0.1:3000/api/encounter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "우주선", confidence: 90, caughtIds: [], fainted: false }),
    });
    const j = await res.json();
    check("live api no-match", res.ok && j.kind === "none" && j.reason === "no-match", JSON.stringify(j).slice(0, 100));
  }

  // ---- G4 (§15-2·§15-3·§16): 포획종 조우 금지 + 시연 스냅샷 ----
  {
    const r = decideEncounter({
      speciesId: "fire-01",
      caughtIds: ["fire-01"],
      fainted: false,
      demo: false,
      now: T0,
      roll: 0.01,
      state: fresh(),
    });
    check("caught-never-encounters", r.kind !== "encounter", r.kind);
    const list = snaps.RIVAL_SNAPSHOTS;
    check("snapshots-5", Array.isArray(list) && list.length === 5, String(list?.length));
    const allowed = new Set(["nickname", "speciesId", "level", "boosts", "note"]);
    const badKeys = [];
    const ids = new Set();
    for (const s of list) {
      for (const k of Object.keys(s)) if (!allowed.has(k)) badKeys.push(k);
      ids.add(s.speciesId);
      if (s.note !== "시연용 상대") badKeys.push("note-missing");
    }
    check("snapshots-no-personal", badKeys.length === 0, badKeys.join(","));
    check("snapshots-distinct", ids.size === 5, String(ids.size));
  }

  rmSync(BUILD, { recursive: true, force: true });
  if (failures > 0) {
    console.log(`verify-encounter: FAIL (${failures} failed, ${passes} passed)`);
    process.exit(1);
  } else {
    console.log(`verify-encounter: PASS (${passes}/${passes})`);
  }
}

main().catch((e) => {
  console.error("verify-encounter: ERROR", e);
  try { rmSync(BUILD, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(1);
});
