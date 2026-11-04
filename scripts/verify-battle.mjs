// scripts/verify-battle.mjs — G1 검증 (BATTLE_DESIGN §11-2 + 작업지시서 파트 M).
// 실행: node scripts/verify-battle.mjs (종료 코드만 본다).
// - 상성 순환 25칸, 단계 배율, 상태 이상 지속·해제, 쿨다운, 피해식 단위 검사
// - 밸런스: Lv10·추천 배분·양쪽 AI, 24×24 쌍마다 200판(시드 고정).
//   종별 평균 승률 35~65% 안에 있어야 PASS.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BUILD = mkdtempSync(join(tmpdir(), "verify-battle-"));
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
      "lib/josa.ts",
      "lib/battle/skills.ts",
      "lib/battle/roster.ts",
      "lib/battle/engine.ts",
      "lib/battle/capture.ts",
    ],
    { cwd: ROOT, stdio: "inherit" }
  );
  const skills = req(join(BUILD, "battle", "skills.js"));
  const roster = req(join(BUILD, "battle", "roster.js"));
  const engine = req(join(BUILD, "battle", "engine.js"));
  const capture = req(join(BUILD, "battle", "capture.js"));
  const { typeEdge, stageMult, accMult, resistMult, calcDamage, moveKind, BODY_SLAM, ROLE_SKILLS } = skills;
  const { SPECIES, SPECIES_IDS, baseStatsForBattle, recommendedBoosts, combatStats, buildMoveset } = roster;
  const {
    createRng, createBattle, applyTurn, applyStatusTo, applyStageTo, applyResistTo,
    isSlotLegal, legalSlots, rollPower, spdOf, defMultOf, atkMultOf, resistOf, effectOf,
    decideAiSlot, simulateGame,
  } = engine;

  const fixedRng = () => 0.999; // 명중·미발동·급소 없음 결정적 RNG

  // ---- A. 상성 순환 25칸 (문서 §1 표 그대로) ----
  const ELS = ["fire", "grass", "rock", "wind", "water"];
  const EXPECT = {
    fire: { fire: 1, grass: 1.5, rock: 1, wind: 1, water: 0.7 },
    grass: { fire: 0.7, grass: 1, rock: 1.5, wind: 1, water: 1 },
    rock: { fire: 1, grass: 0.7, rock: 1, wind: 1.5, water: 1 },
    wind: { fire: 1, grass: 1, rock: 0.7, wind: 1, water: 1.5 },
    water: { fire: 1.5, grass: 1, rock: 1, wind: 0.7, water: 1 },
  };
  let edgeBad = [];
  for (const a of ELS) for (const d of ELS) {
    if (typeEdge(a, d) !== EXPECT[a][d]) edgeBad.push(`${a}>${d}=${typeEdge(a, d)}`);
  }
  check("type chart 25 cells", edgeBad.length === 0, edgeBad.join(","));
  check("body slam typeless", typeEdge("none", "fire") === 1);

  // ---- 9-E: 기술 종류 (ATK/BUFF/DEBUFF) ----
  check("move kind basic",
    moveKind(BODY_SLAM) === "ATK" &&
    moveKind(ROLE_SKILLS.attacker) === "BUFF" &&
    moveKind(ROLE_SKILLS.trick) === "DEBUFF" &&
    buildMoveset("fire-01").every((m) => ["ATK", "BUFF", "DEBUFF"].includes(moveKind(m))));

  // ---- 9-F: 사물 기준 도망 (m 단위, 원점=배틀 시작 위치) ----
  check("flee consts", engine.FLEE_DIST_M === 10 && engine.FLEE_WARN_M === 7);
  check("flee status mapping",
    engine.fleeStatus(0) === "ok" && engine.fleeStatus(6.9) === "ok" &&
    engine.fleeStatus(7) === "warn" && engine.fleeStatus(9.9) === "warn" &&
    engine.fleeStatus(10) === "flee" && engine.fleeStatus(25) === "flee");

  // ---- 9-C: 기술 영어 이름 (24종 × 4칸 전부 nameEn) ----
  {
    const bad = [];
    for (const id of SPECIES_IDS) {
      for (const [i, m] of buildMoveset(id).entries()) {
        if (!m.nameEn || typeof m.nameEn !== "string" || m.nameEn.trim() === "") bad.push(`${id}[${i}]`);
      }
    }
    check("move nameEn 96 slots", bad.length === 0, bad.slice(0, 8).join(","));
  }

  // ---- B. 단계 배율 ----
  check("stage mult", stageMult(-2) === 0.6 && stageMult(-1) === 0.8 && stageMult(0) === 1 &&
    stageMult(1) === 1.25 && stageMult(2) === 1.5);
  check("acc mult", accMult(-2) === 0.5 && accMult(-1) === 0.75 && accMult(0) === 1);
  check("resist 5 stages",
    resistMult(-2) === 1.5 && resistMult(-1) === 1.25 && resistMult(0) === 1 &&
    resistMult(1) === 0.8 && resistMult(2) === 0.6);

  // ---- C. 피해식 단위 (손계산 대조) ----
  const dmgBase = {
    power: 60, atk: 70, atkMult: 1.25, def: 40, defMult: 0.8,
    edge: 1.5, resist: 1, stab: 1.2, cond: 1, rand: 1, crit: false, shieldFactor: 1,
  };
  check("damage formula = 173", calcDamage(dmgBase) === 173, `got ${calcDamage(dmgBase)}`);
  check("damage crit = 268", calcDamage({ ...dmgBase, crit: true }) === 268);
  check("damage shield 0.6 = 104", calcDamage({ ...dmgBase, shieldFactor: 0.6 }) === 104);
  check("damage resist 0.8 = 135", calcDamage({ ...dmgBase, resist: 0.8 }) === 135);
  check("damage resist 1.5 = 268", calcDamage({ ...dmgBase, resist: 1.5 }) === 268);
  check("damage min 1", calcDamage({ ...dmgBase, power: 1, atk: 1, edge: 0.7, rand: 0.9 }) >= 1);

  // ---- D. 상태 이상 지속·해제 ----
  // D1. 그슬림 3턴 + 턴당 6%: 쌍둥이 대조.
  {
    const mk = () => createBattle("rock-01", "rock-01", { level: 50 });
    let a = mk();
    a = { ...a, mine: applyStatusTo(a.mine, "burn").fighter };
    let b = mk();
    for (let t = 0; t < 3; t++) {
      a = applyTurn(a, 0, 0, fixedRng).state;
      b = applyTurn(b, 0, 0, fixedRng).state;
    }
    const tick = Math.round(a.mine.maxHp * 0.06);
    const diff = b.mine.hp - a.mine.hp;
    check("burn 3 turns 6%/turn", a.mine.status === null && diff === tick * 3,
      `status=${a.mine.status} diff=${diff} expect=${tick * 3}`);
  }
  // D2. 덩굴감김 2턴 + 4% 흡수.
  {
    const mk = () => createBattle("rock-01", "rock-01", { level: 50 });
    let a = mk();
    a = { ...a, mine: applyStatusTo(a.mine, "wrap").fighter };
    let b = mk();
    for (let t = 0; t < 2; t++) {
      a = applyTurn(a, 0, 0, fixedRng).state;
      b = applyTurn(b, 0, 0, fixedRng).state;
    }
    const tick = Math.round(a.mine.maxHp * 0.04);
    check("wrap 2 turns 4% drain",
      a.mine.status === null && (b.mine.hp - a.mine.hp) === tick * 2 && a.wild.hp >= b.wild.hp,
      `status=${a.mine.status} diff=${b.mine.hp - a.mine.hp}`);
  }
  // D3. 균열: DEF ×0.8 별도 곱, 3턴. (바위종은 균열 면역이라 풀 탱커 사용)
  {
    let st = createBattle("grass-01", "grass-01", { level: 10 });
    const plain = defMultOf(st.mine);
    st = { ...st, mine: applyStatusTo(st.mine, "crack").fighter };
    const cracked = defMultOf(st.mine);
    for (let t = 0; t < 3; t++) st = applyTurn(st, 0, 0, fixedRng).state;
    check("crack def x0.8 for 3 turns",
      Math.abs(cracked - plain * 0.8) < 1e-9 && st.mine.status === null,
      `${plain} -> ${cracked}, status=${st.mine.status}`);
  }
  // D4. 어지럼 25% 실패 (통계).
  {
    let fails = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      let st = createBattle("rock-01", "rock-01", { level: 50 });
      st = { ...st, mine: applyStatusTo(st.mine, "dizzy").fighter };
      const { logs } = applyTurn(st, 0, 0, createRng(1000 + i));
      if (logs.some((l) => l.includes("어지러워"))) fails += 1;
    }
    const rate = fails / N;
    check("dizzy fail ~25%", rate > 0.2 && rate < 0.3, `rate=${rate.toFixed(3)}`);
  }
  // D5. 흠뻑: SPD ×0.8, 3턴.
  {
    let st = createBattle("fire-01", "fire-01", { level: 10 });
    const plain = spdOf(st.mine);
    st = { ...st, mine: applyStatusTo(st.mine, "soak").fighter };
    const soaked = spdOf(st.mine);
    for (let t = 0; t < 3; t++) st = applyTurn(st, 0, 0, fixedRng).state;
    check("soak spd x0.8 for 3 turns",
      Math.abs(soaked - plain * 0.8) < 1e-9 && st.mine.status === null);
  }
  // D6. 흠뻑 = 불 저항 +1 (실전 경로: 유리알 굴절 적중 → 저항 부여 + 이벤트).
  {
    let st = createBattle("water-03", "grass-01", { level: 50 });
    const r = applyTurn(st, 3, 0, () => 0); // 항상 적중·확정 발동
    const wild = r.state.wild;
    const hasApply = r.events.some((e) => e.type === "status-apply" && e.target === "wild");
    const hasResist = r.events.some((e) => e.type === "resist" && e.target === "wild" && e.element === "fire" && e.delta === 1);
    check("soak grants fire resist +1",
      wild.status === "soak" && wild.resist.fire === 1 && hasApply && hasResist,
      `status=${wild.status} resist=${wild.resist.fire} events=${r.events.map((e) => e.type).join(",")}`);
  }
  // D6b. 불 저항 +1 = 받는 불 피해 ×0.8 (쌍둥이 실전 대조).
  {
    const mk = (soaked) => {
      let st = createBattle("fire-01", "grass-01", { level: 50 });
      if (soaked) {
        st = { ...st, wild: applyResistTo(applyStatusTo(st.wild, "soak").fighter, "fire", 1, 3).fighter };
      }
      return st;
    };
    let a = mk(true);
    let b = mk(false);
    const hitRng = () => 0.5; // 명중 95 적중·추가효과·급소 없음
    a = applyTurn(a, 1, 0, hitRng).state; // mine 불씨 톡톡
    b = applyTurn(b, 1, 0, hitRng).state;
    // 같은 턴·같은 난수: 저항을 가진 흠뻑 쪽 남은 HP가 더 많다.
    check("soaked takes less fire damage", a.wild.hp > b.wild.hp, `${a.wild.hp} vs ${b.wild.hp}`);
  }
  // D6c. 저항 합산·클램프·지속 초기화.
  {
    let st = createBattle("fire-01", "grass-01", { level: 10 });
    let f = applyResistTo(st.mine, "fire", 1, 3).fighter;
    f = applyResistTo(f, "fire", 1, 3).fighter;
    const stacked = f.resist.fire === 2 && f.resistTurns.fire === 3;
    f = applyResistTo(f, "fire", 1, 3).fighter;
    const clamped = f.resist.fire === 2;
    check("resist stack/clamp/reset", stacked && clamped);
  }
  // D7. 동속 면역 + 1개 슬롯.
  {
    let st = createBattle("fire-01", "grass-01", { level: 10 });
    const r1 = applyStatusTo(st.mine, "burn");
    const r2 = applyStatusTo(st.wild, "burn");
    const r3 = applyStatusTo(r2.fighter, "wrap");
    check("same-element immune + single slot",
      r1.applied === false && r1.reason === "immune" && r2.applied === true &&
      r3.applied === false && r3.reason === "occupied");
  }
  // D8. 해제: 응원가(상태), 바위 굳히기(균열), 빗방울 치유(디버프+상태).
  {
    let st = createBattle("fire-05", "grass-01", { level: 50 });
    st = { ...st, mine: applyStatusTo(st.mine, "soak").fighter };
    st = applyTurn(st, 2, 0, fixedRng).state;
    const cheerOk = st.mine.status === null;
    let st2 = createBattle("rock-01", "grass-01", { level: 50 });
    st2 = { ...st2, mine: applyStatusTo(st2.mine, "crack").fighter };
    st2 = applyTurn(st2, 3, 0, fixedRng).state;
    const hardenOk = st2.mine.status === null;
    let st3 = createBattle("water-01", "grass-01", { level: 50 });
    st3 = { ...st3, mine: applyStatusTo(applyStageTo(st3.mine, "atk", -1, 3), "burn").fighter };
    st3 = applyTurn(st3, 3, 0, fixedRng).state;
    const rainOk = st3.mine.status === null && st3.mine.stages.atk === 0;
    check("cleanse cheer/harden/rain", cheerOk && hardenOk && rainOk,
      `cheer=${cheerOk} harden=${hardenOk} rain=${rainOk}`);
  }
  // D9. 단계 합산·클램프·초기화.
  {
    let st = createBattle("fire-01", "grass-01", { level: 10 });
    let f = applyStageTo(st.mine, "atk", 1, 3);
    f = applyStageTo(f, "atk", 1, 3);
    const stacked = f.stages.atk === 2 && f.stageTurns.atk === 3;
    f = applyStageTo(f, "atk", 1, 3);
    const clamped = f.stages.atk === 2;
    let g = applyStageTo(st.mine, "acc", -2, 2);
    g = applyStageTo(g, "acc", -1, 2);
    const accClamped = g.stages.acc === -2;
    check("stage stack/clamp/reset", stacked && clamped && accClamped);
  }

  // ---- E. 쿨다운·콤보·해금 ----
  {
    // 50레벨 + 불에 강한 물 탱커: 3턴 안에 KO 없이 쿨다운만 본다.
    let st = createBattle("fire-01", "water-02", { level: 50 });
    st = applyTurn(st, 3, 0, fixedRng).state; // T1 고유기
    const t2 = isSlotLegal(st.mine, 3);
    st = applyTurn(st, 0, 0, fixedRng).state; // T2
    const t3 = isSlotLegal(st.mine, 3);
    st = applyTurn(st, 0, 0, fixedRng).state; // T3
    const t4 = isSlotLegal(st.mine, 3);
    check("unique cooldown T1->T4", t2 === false && t3 === false && t4 === true);
  }
  {
    let st = createBattle("fire-01", "grass-01", { level: 10 });
    st = applyTurn(st, 2, 0, fixedRng).state; // T1 역할기
    const t2 = isSlotLegal(st.mine, 2);
    st = applyTurn(st, 0, 0, fixedRng).state; // T2
    const t3 = isSlotLegal(st.mine, 2);
    check("role cooldown T1->T3", t2 === false && t3 === true);
  }
  {
    let st = createBattle("rock-03", "grass-01", { level: 50 });
    const p0 = rollPower(st.mine);
    st = applyTurn(st, 3, 0, fixedRng).state;
    const p1 = rollPower(st.mine);
    st = applyTurn(st, 3, 0, fixedRng).state;
    const p2 = rollPower(st.mine);
    st = applyTurn(st, 0, 0, fixedRng).state;
    const pReset = rollPower(st.mine);
    check("roll combo 40/60/80 + reset",
      p0 === 40 && p1 === 60 && p2 === 80 && pReset === 40,
      `${p0}/${p1}/${p2}/reset=${pReset}`);
  }
  {
    const low = createBattle("fire-01", "grass-01", { level: 4 });
    const mid = createBattle("fire-01", "grass-01", { level: 9 });
    const cold = createBattle("fire-01", "grass-01", { level: 10, affection: 10 });
    check("slot locks lv/affection",
      isSlotLegal(low.mine, 2) === false && isSlotLegal(mid.mine, 3) === false &&
      isSlotLegal(cold.mine, 3) === false && isSlotLegal(mid.mine, 2) === true);
  }
  // E5. §9 애정 버팀.
  {
    let st = createBattle("fire-02", "rock-02", { level: 1, affection: 80 });
    // 야생을 강하게: 고레벨 상대와 붙인다.
    st = { ...st, wild: { ...st.wild } };
    let strong = createBattle("fire-02", "rock-02", { level: 1 });
    strong.wild = { ...strong.wild, atk: 500, spd: 500 };
    strong.mine = { ...strong.mine, affection: 80 };
    const r = applyTurn(strong, 0, 0, fixedRng); // 기본기(명중 100)로 확정타
    check("endure at affection>=70",
      r.state.mine.hp === 1 && r.state.mine.endureUsed === true &&
      r.logs.some((l) => l.includes("버텼다")),
      `hp=${r.state.mine.hp} logs=${r.logs.join("|").slice(0, 120)}`);
  }

  // ---- F. 순수성: 입력 불변 ----
  {
    const st = createBattle("fire-01", "grass-01", { level: 10 });
    const before = JSON.stringify(st);
    applyTurn(st, 1, 2, createRng(7));
    check("applyTurn does not mutate input", JSON.stringify(st) === before);
  }

  // ---- G. 종족값 예산 ≈135 ----
  {
    const budgets = SPECIES_IDS.map((id) => {
      const b = baseStatsForBattle(id);
      return { id, v: b.hp + 3 * (b.atk + b.def + b.spd) };
    });
    const min = Math.min(...budgets.map((x) => x.v));
    const max = Math.max(...budgets.map((x) => x.v));
    check("budget ~= 135", min >= 129 && max <= 141,
      `range=${min}..${max} ` + budgets.filter((x) => x.v < 129 || x.v > 141).map((x) => x.id).join(","));
  }

  // ---- H. 기술표 개수 ----
  {
    let ok = SPECIES.length === 24;
    for (const id of SPECIES_IDS) {
      const ms = buildMoveset(id);
      if (ms.length !== 4 || ms[0].id !== "basic" || ms[1].power <= 0) ok = false;
      if (ms[2].cooldown !== 2) ok = false;
      const cd = ms[3].cooldown;
      if (id === "rock-03" ? cd !== 0 : cd !== 3) ok = false;
    }
    check("moveset 4 slots x24", ok);
  }

  // ---- I. 이벤트 로그 정합 (M 보강): HP 합산 + 누락 없음 + 전 종류 관측 ----
  {
    const STATS = ["atk", "def", "spd", "acc"];
    const STAT2LABEL = { atk: "ATK", def: "DEF", spd: "SPD", acc: "ACC" };
    const ELS5 = ["fire", "grass", "water", "rock", "wind"];
    const seen = new Set();
    let turns = 0;
    let hpBad = 0;
    let dropBad = 0;
    let firstBad = "";
    const GAMES = 300;
    for (let g = 0; g < GAMES; g++) {
      const a = SPECIES_IDS[(g * 7) % 24];
      const b = SPECIES_IDS[(g * 13 + 5) % 24];
      const rng = createRng(500000 + g);
      let st = createBattle(a, b, { level: 10 });
      let guard = 0;
      while (!st.over && guard++ < 12) {
        const before = JSON.parse(JSON.stringify({ mine: st.mine, wild: st.wild }));
        const ms = decideAiSlot(st.mine, st.wild, rng);
        const ws = decideAiSlot(st.wild, st.mine, rng);
        const r = applyTurn(st, ms, ws, rng);
        turns++;
        for (const e of r.events) seen.add(e.type);
        // I-1. HP 합산: 시작 −피해 −틱 +회복 = 종료.
        for (const side of ["mine", "wild"]) {
          let expect = before[side].hp;
          for (const e of r.events) {
            if (e.target !== side) continue;
            if (e.type === "damage" || e.type === "status-tick") expect -= e.value;
            if (e.type === "heal") expect += e.value;
          }
          if (expect !== r.state[side].hp) {
            hpBad++;
            if (!firstBad) firstBad = `hp ${a}/${b} g${g} ${side}: ${before[side].hp}->${r.state[side].hp} vs ${expect}`;
          }
        }
        // I-2. 누락 없음: 단계·저항·상태 변화마다 이벤트 존재.
        for (const side of ["mine", "wild"]) {
          const fb = before[side];
          const fa = r.state[side];
          for (const k of STATS) {
            if (fb.stages[k] !== fa.stages[k]) {
              const sum = r.events
                .filter((e) => e.type === "stage" && e.target === side && e.stat === STAT2LABEL[k])
                .reduce((s, e) => s + e.delta, 0);
              if (sum !== fa.stages[k] - fb.stages[k]) {
                dropBad++;
                if (!firstBad) firstBad = `stage ${a}/${b} g${g} ${side}.${k}: ${fb.stages[k]}->${fa.stages[k]} sum=${sum}`;
              }
            }
          }
          for (const el of ELS5) {
            if (fb.resist[el] !== fa.resist[el]) {
              const sum = r.events
                .filter((e) => e.type === "resist" && e.target === side && e.element === el)
                .reduce((s, e) => s + e.delta, 0);
              if (sum !== fa.resist[el] - fb.resist[el]) {
                dropBad++;
                if (!firstBad) firstBad = `resist ${a}/${b} g${g} ${side}.${el}: ${fb.resist[el]}->${fa.resist[el]} sum=${sum}`;
              }
            }
          }
          if (fb.status !== fa.status) {
            const types = new Set(
              r.events.filter((e) => e.target === side).map((e) => e.type)
            );
            // null→X: apply, X→null: end, X→Y: 둘 다 (실제로는 한 번에 하나라 X→Y 없음).
            const needApply = fa.status !== null;
            const needEnd = fb.status !== null;
            const ok = (!needApply || types.has("status-apply")) && (!needEnd || types.has("status-end"));
            if (!ok) {
              dropBad++;
              if (!firstBad) firstBad = `status ${a}/${b} g${g} ${side}: ${fb.status}->${fa.status}`;
            }
          }
          if (fb.hp > 0 && fa.hp === 0) {
            const ok = r.events.some((e) => e.type === "faint" && e.target === side);
            if (!ok) {
              dropBad++;
              if (!firstBad) firstBad = `faint missing ${a}/${b} g${g} ${side}`;
            }
          }
        }
        st = r.state;
      }
    }
    console.log(`events: ${turns} turns, types seen: ${[...seen].sort().join(",")}`);
    check("event HP reconciles", hpBad === 0, firstBad);
    check("no state change dropped", dropBad === 0, firstBad);
    const need = ["damage", "heal", "miss", "stage", "resist", "status-apply", "status-tick", "status-end", "faint"];
    const missing = need.filter((t) => !seen.has(t));
    check("all event types observed", missing.length === 0, missing.join(","));
  }

  // ---- J. 밸런스: 24×24×200, 시드 고정 ----
  {
    const GAMES = 200;
    const wins = Object.fromEntries(SPECIES_IDS.map((id) => [id, 0]));
    const games = Object.fromEntries(SPECIES_IDS.map((id) => [id, 0]));
    const roleWinsSameEl = {}; // 같은 속성 내 역할별 승
    const roleGamesSameEl = {};
    let turnSum = 0;
    let totalGames = 0;
    const t0 = Date.now();
    for (let i = 0; i < 24; i++) {
      for (let j = 0; j < 24; j++) {
        const a = SPECIES_IDS[i];
        const b = SPECIES_IDS[j];
        for (let g = 0; g < GAMES; g++) {
          const seed = (i * 24 + j) * 1000 + g;
          const r = simulateGame(a, b, seed, { level: 10 });
          totalGames += 1;
          turnSum += r.turns;
          games[a] += 1;
          games[b] += 1;
          const winnerId = r.winner === "mine" ? a : b;
          wins[winnerId] += 1;
          if (SPECIES[i].element === SPECIES[j].element) {
            const ra = SPECIES[i].role;
            const rb = SPECIES[j].role;
            roleGamesSameEl[ra] = (roleGamesSameEl[ra] ?? 0) + 1;
            roleGamesSameEl[rb] = (roleGamesSameEl[rb] ?? 0) + 1;
            const rWinner = r.winner === "mine" ? ra : rb;
            roleWinsSameEl[rWinner] = (roleWinsSameEl[rWinner] ?? 0) + 1;
          }
        }
      }
    }
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`--- balance: ${totalGames} games in ${dt}s, avg turns ${(turnSum / totalGames).toFixed(2)} ---`);
    const rows = SPECIES_IDS.map((id) => ({
      id,
      rate: (wins[id] / games[id]) * 100,
    })).sort((x, y) => x.rate - y.rate);
    for (const r of rows) console.log(`rate ${r.id} ${r.rate.toFixed(1)}%`);
    console.log("--- same-element role rates ---");
    for (const role of Object.keys(roleGamesSameEl).sort()) {
      console.log(`role ${role} ${(((roleWinsSameEl[role] ?? 0) / roleGamesSameEl[role]) * 100).toFixed(1)}%`);
    }
    const out = rows.filter((r) => r.rate < 35 || r.rate > 65);
    check("all species win rate 35~65%",
      out.length === 0,
      out.map((r) => `${r.id}=${r.rate.toFixed(1)}%`).join(", "));
  }

  // ---- G4 포획·놓아주기 (§16, §16-2) ----
  {
    const { captureRate, resolveCapture, captureReward, releaseReward } = capture;
    check("capture-rate-range",
      captureRate(1, 0) === 0.25 && captureRate(0, 0) === 0.75 && captureRate(0, 80) === 0.85 &&
      captureRate(0.5, 69) === 0.5 && captureRate(0.5, 70) === 0.6);
    let rr = resolveCapture(0.5, [{ inFrame: true, roll: 0.1 }]);
    check("capture-first-try", rr.caught && rr.used === 1 && !rr.fled);
    rr = resolveCapture(0.5, [{ inFrame: true, roll: 0.9 }, { inFrame: true, roll: 0.8 }, { inFrame: true, roll: 0.1 }]);
    check("capture-third-try", rr.caught && rr.used === 3 && !rr.fled);
    rr = resolveCapture(0.9, [{ inFrame: false, roll: 0.0 }, { inFrame: false, roll: 0.0 }, { inFrame: false, roll: 0.0 }]);
    check("capture-miss-nodice", !rr.caught && rr.used === 3 && rr.fled);
    rr = resolveCapture(0.5, [{ inFrame: true, roll: 0.9 }, { inFrame: true, roll: 0.8 }, { inFrame: true, roll: 0.7 }]);
    check("capture-3fail-flee", !rr.caught && rr.used === 3 && rr.fled);
    const ok = captureReward("grass-04", true);
    const no = captureReward("grass-04", false);
    check("capture-reward", ok.exp === 20 && ok.dexAdd === "grass-04" && no.exp === 0 && no.dexAdd === null);
    const rel = releaseReward();
    check("release-reward", rel.exp === 40 && rel.dexAdd === null);
  }

  // ---- BT-3: 표시용 박자 메타 (order·beatEnds). 계산 무변경, 불변식만.
  {
    const st0 = createBattle("fire-01", "grass-01", { level: 5 });
    const mMoves = buildMoveset(st0.mine.speciesId);
    const wMoves = buildMoveset(st0.wild.speciesId);
    const expFirst = mMoves[0].priority !== wMoves[0].priority
      ? (mMoves[0].priority ? "mine" : "wild")
      : (spdOf(st0.mine) >= spdOf(st0.wild) ? "mine" : "wild");
    const r0 = applyTurn(st0, 0, 0, fixedRng);
    check("bt3-order-shape",
      Array.isArray(r0.order) && r0.order.length <= 2 &&
      Array.isArray(r0.beatEnds) && r0.beatEnds.every((n) => Number.isInteger(n) && n >= 0 && n <= r0.events.length) &&
      r0.beatEnds.every((n, i) => i === 0 || n >= r0.beatEnds[i - 1]),
      JSON.stringify({ order: r0.order, beatEnds: r0.beatEnds, nev: r0.events.length }));
    check("bt3-order-first", r0.beatEnds.length === 2 ? r0.order[0] === expFirst : true,
      JSON.stringify({ order: r0.order, expFirst }));
    // 기절 턴: 후공 박자가 비고 턴 종료 이벤트도 없다.
    let st = st0;
    let overTurn = null;
    for (let t = 0; t < 12 && !st.over; t++) {
      const r = applyTurn(st, 0, 0, fixedRng);
      st = r.state;
      if (st.over) overTurn = r;
    }
    check("bt3-faint-beat", overTurn !== null &&
      (overTurn.beatEnds.length === 1
        ? overTurn.events.length === overTurn.beatEnds[0]
        : overTurn.beatEnds.length === 2),
      overTurn ? JSON.stringify({ beatEnds: overTurn.beatEnds, nev: overTurn.events.length }) : "no-over");
  }

  rmSync(BUILD, { recursive: true, force: true });
  if (failures > 0) {
    console.log(`verify-battle: FAIL (${failures} failed, ${passes} passed)`);
    process.exit(1);
  } else {
    console.log(`verify-battle: PASS (${passes}/${passes})`);
  }
}

main().catch((e) => {
  console.error("verify-battle: ERROR", e);
  try { rmSync(BUILD, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(1);
});
