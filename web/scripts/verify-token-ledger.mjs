// TOKEN_WORKORDER §7 검증: 서버 원장 적립·차감·잔량.
// 실행: node scripts/verify-token-ledger.mjs
// lib/token/*.ts를 저장소 typescript로 컴파일해 직접 require한다 (서버 기동 없음).
// 케이스마다 임시 원장 파일(TOKEN_LEDGER_PATH)로 격리한다.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, "scratch", ".build-token");

function compile() {
  rmSync(BUILD, { recursive: true, force: true });
  mkdirSync(BUILD, { recursive: true });
  execFileSync(
    process.execPath,
    [
      join(ROOT, "node_modules", "typescript", "bin", "tsc"),
      "lib/token/ledger.ts",
      "lib/token/sqlite.d.ts",
      "lib/token/config.ts",
      "lib/token/care.ts",
      "lib/status/store.ts",
      "lib/species.ts",
      "lib/status/decay.ts",
      "lib/status/effects.ts",
      "lib/token/sources/index.ts",
      "lib/token/sources/types.ts",
      "lib/token/sources/mockTrend.ts",
      "lib/token/sources/partnerVisit.ts",
      "lib/token/sources/instagramHashtag.ts",
      "lib/token/sources/youtubeSearch.ts",
      "lib/token/sources/tiktok.ts",
      "--outDir",
      BUILD,
      "--module",
      "commonjs",
      "--target",
      "es2020",
      "--moduleResolution",
      "node",
      "--skipLibCheck",
      "--esModuleInterop",
    ],
    { cwd: ROOT, stdio: "inherit" }
  );
}

let failures = 0;
let checks = 0;
function check(name, cond, detail = "") {
  checks += 1;
  if (cond) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

let caseNo = 0;
function freshLedger() {
  caseNo += 1;
  const p = join(tmpdir(), `token-ledger-verify-${process.pid}-${caseNo}.sqlite`);
  rmSync(p, { force: true });
  rmSync(`${p}.care.json`, { force: true });
  process.env.TOKEN_LEDGER_PATH = p;
  process.env.CARE_QUOTA_PATH = `${p}.care.json`;
  process.env.CREATURE_STATUS_PATH = `${p}.status.json`;
  delete process.env.CARE_TEST_TODAY;
  return p;
}
function cleanup(paths) {
  for (const p of paths) {
    rmSync(p, { force: true });
    rmSync(`${p}.care.json`, { force: true });
    rmSync(`${p}.status.json`, { force: true });
  }
  delete process.env.TOKEN_LEDGER_PATH;
  delete process.env.CARE_QUOTA_PATH;
  delete process.env.CREATURE_STATUS_PATH;
  delete process.env.CARE_TEST_TODAY;
  rmSync(BUILD, { recursive: true, force: true });
}

async function main() {
  compile();
  const req = createRequire(import.meta.url);
  const ledger = req(join(BUILD, "token", "ledger.js"));
  const config = req(join(BUILD, "token", "config.js"));
  const care = req(join(BUILD, "token", "care.js"));
  const store = req(join(BUILD, "status", "store.js"));
  const effects = req(join(BUILD, "status", "effects.js"));
  const sources = req(join(BUILD, "token", "sources", "index.js"));
  const { credit, spend, balance, entries, sumEntries, readHistory } = ledger;
  const { useCare, careStatus } = care;
  const { readCreatureStatus, writeCreatureStatus } = store;
  const { applyCareAction } = effects;
  const { getSourcesSnapshot } = sources;
  const ig = req(join(BUILD, "token", "sources", "instagramHashtag.js"));
  const yt = req(join(BUILD, "token", "sources", "youtubeSearch.js"));
  const tt = req(join(BUILD, "token", "sources", "tiktok.js"));
  const mock = req(join(BUILD, "token", "sources", "mockTrend.js"));
  const pv = req(join(BUILD, "token", "sources", "partnerVisit.js"));
  const { COST_UPGRADE, COST_DANCE, COST_MOTION_GEN, COST_CARE_EXTRA, COST_DIARY_IMAGE, SOURCES_ENABLED } = config;
  const used = [];
  const sig = (n) => `sig-${n}`;

  // 1. 적립 계산: 5,000원 → 150, 4,500원 → 135, 카테고리 무관 동일 비율.
  {
    const p = freshLedger();
    used.push(p);
    const r1 = await credit({ signalId: sig("a1"), storeName: "카페", category: "coffee", amountKrw: 5000 });
    check("credit 5000 -> 150", r1.ok && r1.tokens === 150 && r1.balance === 150, JSON.stringify(r1));
    const r2 = await credit({ signalId: sig("a2"), storeName: "식당", category: "food", amountKrw: 4500 });
    check("credit 4500 -> 135", r2.ok && r2.tokens === 135 && r2.balance === 285, JSON.stringify(r2));
    const r3 = await credit({ signalId: sig("a3"), storeName: "주점", category: "alcohol", amountKrw: 5000 });
    const r4 = await credit({ signalId: sig("a4"), storeName: "기타", category: "other", amountKrw: 5000 });
    check(
      "same rate coffee/food/alcohol/other",
      r3.ok && r3.tokens === 150 && r4.ok && r4.tokens === 150,
      JSON.stringify([r3, r4])
    );
  }

  // 2. 금액 0 이하·숫자 아님·카테고리 오류 → 거부.
  {
    const p = freshLedger();
    used.push(p);
    const bad = [
      await credit({ signalId: sig("b1"), storeName: "s", category: "coffee", amountKrw: 0 }),
      await credit({ signalId: sig("b2"), storeName: "s", category: "coffee", amountKrw: -100 }),
      await credit({ signalId: sig("b3"), storeName: "s", category: "coffee", amountKrw: NaN }),
      await credit({ signalId: sig("b4"), storeName: "s", category: "coffee", amountKrw: "5000" }),
      await credit({ signalId: sig("b5"), storeName: "s", category: "mart", amountKrw: 5000 }),
      await credit({ signalId: "", storeName: "s", category: "coffee", amountKrw: 5000 }),
    ];
    check(
      "invalid credit rejected",
      bad.every((r) => !r.ok) && (await balance()) === 0,
      JSON.stringify(bad)
    );
  }

  // 3. 같은 signalId 두 번 → 두 번째 적립 안 됨, 잔량 불변.
  {
    const p = freshLedger();
    used.push(p);
    const first = await credit({ signalId: sig("c1"), storeName: "s", category: "coffee", amountKrw: 5000 });
    const n1 = (await entries()).length;
    const second = await credit({ signalId: sig("c1"), storeName: "s", category: "coffee", amountKrw: 5000 });
    const n2 = (await entries()).length;
    check(
      "duplicate signalId no-credit",
      first.ok && second.ok && second.duplicate === true && second.tokens === 0 &&
        second.balance === 150 && n1 === 1 && n2 === 1,
      JSON.stringify([first, second, n1, n2])
    );
  }

  // 4. 잔량 100, 차감 150 → 거부, 100 유지. (3333원 → round(99.99) = 100)
  {
    const p = freshLedger();
    used.push(p);
    await credit({ signalId: sig("d1"), storeName: "s", category: "coffee", amountKrw: 3333 });
    const r = await spend(150, "test:over");
    check(
      "spend over balance rejected",
      !r.ok && r.error === "insufficient" && r.balance === 100 && (await balance()) === 100,
      JSON.stringify(r)
    );
  }

  // 5. 잔량 100, 차감 60 → 성공, 40.
  {
    const p = freshLedger();
    used.push(p);
    await credit({ signalId: sig("e1"), storeName: "s", category: "coffee", amountKrw: 3333 });
    const r = await spend(60, "test:ok");
    check("spend 60 of 100 -> 40", r.ok && r.balance === 40 && (await balance()) === 40, JSON.stringify(r));
  }

  // 6. 동시 차감 두 건(각 60, 잔량 100) → 하나만 성공, 40.
  {
    const p = freshLedger();
    used.push(p);
    await credit({ signalId: sig("f1"), storeName: "s", category: "coffee", amountKrw: 3333 });
    const [r1, r2] = await Promise.all([spend(60, "test:race1"), spend(60, "test:race2")]);
    const wins = [r1, r2].filter((r) => r.ok).length;
    check(
      "concurrent spend one-wins",
      wins === 1 && (await balance()) === 40,
      JSON.stringify([r1, r2])
    );
  }

  // 7. 잔량 0 → 소비처 3종 거부. 충전 경로는 영향 없음(0에서 적립 성공).
  // ("기본 교감 API는 영향 없음" 대응: 차감이 아닌 읽기·충전 동작이 0잔량에서도 정상.)
  {
    const p = freshLedger();
    used.push(p);
    const s1 = await spend(COST_UPGRADE, "upgrade:atk");
    const s2 = await spend(COST_DANCE, "dance:test");
    const s3 = await spend(COST_MOTION_GEN, "motion-gen:test");
    check(
      "zero balance all 3 sinks rejected",
      !s1.ok && !s2.ok && !s3.ok && (await balance()) === 0,
      JSON.stringify([s1, s2, s3])
    );
    const c = await credit({ signalId: sig("g1"), storeName: "s", category: "coffee", amountKrw: 5000 });
    const b = await balance();
    check("credit works at zero", c.ok && c.tokens === 150 && b === 150, JSON.stringify([c, b]));
  }

  // 8. 원장 합계와 조회 잔량 일치.
  {
    const p = freshLedger();
    used.push(p);
    await credit({ signalId: sig("h1"), storeName: "s", category: "coffee", amountKrw: 5000 });
    await credit({ signalId: sig("h2"), storeName: "s", category: "food", amountKrw: 4500 });
    await spend(60, "test:sum");
    const es = await entries();
    const b = await balance();
    check("ledger sum equals balance", sumEntries(es) === b && b === 225, `sum=${sumEntries(es)} balance=${b}`);
  }

  // 9. §10 교감: 초기 무료 3/3/3, feed 3회 무료 소진, 잔량 불변.
  {
    const p = freshLedger();
    used.push(p);
    const st0 = await careStatus();
    check(
      "care status fresh 3/3/3",
      st0.remaining.feed === 3 && st0.remaining.play === 3 && st0.remaining.sleep === 3 && st0.balance === 0,
      JSON.stringify(st0)
    );
    const u1 = await useCare("feed");
    const u2 = await useCare("feed");
    const u3 = await useCare("feed");
    check(
      "care feed x3 free",
      u1.ok && u1.free && u1.remainingFree === 2 &&
        u2.ok && u2.free && u2.remainingFree === 1 &&
        u3.ok && u3.free && u3.remainingFree === 0 && (await balance()) === 0,
      JSON.stringify([u1, u2, u3])
    );
  }

  // 10. §10 무료 소진 + 잔량 0 → 잠금. 원장 항목 추가 없음.
  {
    const p = freshLedger();
    used.push(p);
    await useCare("feed");
    await useCare("feed");
    await useCare("feed");
    const n1 = (await entries()).length;
    const r = await useCare("feed");
    const n2 = (await entries()).length;
    check(
      "care exhausted + zero locked",
      !r.ok && r.error === "insufficient" && r.locked === true && r.balance === 0 && n1 === 0 && n2 === 0,
      JSON.stringify([r, n1, n2])
    );
  }

  // 11. §10 무료 소진 후 추가 1회 = COST_CARE_EXTRA 차감, 행동별 독립.
  {
    const p = freshLedger();
    used.push(p);
    await credit({ signalId: sig("k1"), storeName: "s", category: "coffee", amountKrw: 5000 });
    await useCare("feed");
    await useCare("feed");
    await useCare("feed");
    const r = await useCare("feed");
    const es = await entries();
    const lastSpend = es.filter((e) => e.type === "spend").at(-1);
    check(
      "care extra purchase spends COST_CARE_EXTRA",
      r.ok && r.free === false && r.balance === 150 - COST_CARE_EXTRA &&
        lastSpend && lastSpend.amount === COST_CARE_EXTRA,
      JSON.stringify([r, lastSpend])
    );
    const st = await careStatus();
    const pl = await useCare("play");
    check(
      "care actions independent",
      st.remaining.play === 3 && pl.ok && pl.free === true,
      JSON.stringify([st, pl])
    );
  }

  // 12. §10 날짜 변경 → 무료 횟수 리셋 (서버 시각 기준).
  {
    const p = freshLedger();
    used.push(p);
    process.env.CARE_TEST_TODAY = "2026-10-31";
    await useCare("feed");
    await useCare("feed");
    await useCare("feed");
    const locked = await useCare("feed");
    process.env.CARE_TEST_TODAY = "2026-11-01";
    const st = await careStatus();
    const r = await useCare("feed");
    check(
      "care free reset on date change",
      !locked.ok && st.remaining.feed === 3 && r.ok && r.free === true && r.remainingFree === 2,
      JSON.stringify([locked, st, r])
    );
  }

  // 13. §10 잘못된 행동 거부 + 유료 동시 요청 원자성 (잔량 10, 2건 → 1건만).
  {
    const p = freshLedger();
    used.push(p);
    const bad = await useCare("dance");
    check("care invalid action rejected", !bad.ok && bad.locked === false, JSON.stringify(bad));
    await credit({ signalId: sig("m1"), storeName: "s", category: "coffee", amountKrw: 333 });
    const funded = await balance();
    await useCare("sleep");
    await useCare("sleep");
    await useCare("sleep");
    const [r1, r2] = await Promise.all([useCare("sleep"), useCare("sleep")]);
    const wins = [r1, r2].filter((r) => r.ok).length;
    check(
      "care paid race one-wins",
      funded === 10 && wins === 1 && (await balance()) === 0,
      JSON.stringify([funded, r1, r2])
    );
  }

  // 14. §14 항목 4: 수치 저장 읽기·쓰기 (HP 없음, 5개 필드만).
  {
    const p = freshLedger();
    used.push(p);
    const fresh = await readCreatureStatus();
    check(
      "status read fresh defaults",
      fresh.fullness === 50 && fresh.energy === 80 && fresh.affection === 20 &&
        fresh.xp === 0 && fresh.level === 1 && !("hp" in fresh),
      JSON.stringify(fresh)
    );
    const w = await writeCreatureStatus({ fullness: 75, energy: 65, affection: 40, xp: 120, level: 2 });
    const back = await readCreatureStatus();
    check(
      "status write then read",
      w.ok && back.fullness === 75 && back.energy === 65 && back.affection === 40 &&
        back.xp === 120 && back.level === 2,
      JSON.stringify([w, back])
    );
    const bad = await writeCreatureStatus({ fullness: -1, energy: 80, affection: 20, xp: 0, level: 1 });
    const bad2 = await writeCreatureStatus({ fullness: 50, energy: 80, affection: 20, xp: 0, level: 0 });
    check("status invalid write rejected", !bad.ok && !bad2.ok, JSON.stringify([bad, bad2]));
  }

  // 15. §14 항목 4: 행동별 수치 변화 (현재 코드 값 그대로).
  {
    const base = { fullness: 50, energy: 80, affection: 20, xp: 0, level: 1 };
    const f = applyCareAction(base, "feed");
    const pl = applyCareAction(base, "play");
    const sl = applyCareAction(base, "sleep");
    check(
      "care effects deltas",
      f.fullness === 75 && f.affection === 25 && f.energy === 80 &&
        pl.energy === 65 && pl.affection === 40 && pl.fullness === 42 &&
        sl.energy === 100 && sl.fullness === 45 && sl.affection === 20,
      JSON.stringify([f, pl, sl])
    );
    const edge = applyCareAction({ fullness: 95, energy: 10, affection: 95, xp: 0, level: 1 }, "feed");
    const edge2 = applyCareAction({ fullness: 5, energy: 10, affection: 10, xp: 0, level: 1 }, "play");
    check(
      "care effects clamp 0-100",
      edge.fullness === 100 && edge.affection === 100 && edge2.energy === 0 && edge2.fullness === 0,
      JSON.stringify([edge, edge2])
    );
  }

  // 16. §14 항목 5: 어댑터 미설정 반환 + 기본 켜짐 목록.
  {
    const r1 = await ig.instagramHashtag().getTrends();
    const r2 = await yt.youtubeSearch().getTrends();
    const r3 = await tt.tiktok.getTrends();
    check(
      "adapters unconfigured without key",
      !r1.ok && r1.reason === "unconfigured" &&
        !r2.ok && r2.reason === "unconfigured" &&
        !r3.ok && r3.reason === "unconfigured",
      JSON.stringify([r1, r2, r3])
    );
    const m = await mock.mockTrend.getTrends();
    const v = await pv.partnerVisit.getVisits();
    check(
      "mock adapters return data",
      m.ok && m.data.length === 3 && v.ok && v.data.length === 2 && typeof v.data[0].signalId === "string",
      JSON.stringify([m, v])
    );
    const snap = await getSourcesSnapshot();
    check(
      "SOURCES_ENABLED default partnerVisit+mockTrend",
      JSON.stringify(SOURCES_ENABLED) === JSON.stringify(["partnerVisit", "mockTrend"]) &&
        snap.trends.length === 3 && snap.visits.length === 2 && snap.unconfigured.length === 0,
      JSON.stringify([SOURCES_ENABLED, snap])
    );
  }

  // 17. §14 항목 6: 그림일기 이미지 차감·잠금.
  {
    const p = freshLedger();
    used.push(p);
    check("COST_DIARY_IMAGE is 20", COST_DIARY_IMAGE === 20, String(COST_DIARY_IMAGE));
    const locked = await spend(COST_DIARY_IMAGE, "diary-image:test");
    check(
      "diary image locked at zero",
      !locked.ok && locked.error === "insufficient" && locked.balance === 0,
      JSON.stringify(locked)
    );
    await credit({ signalId: sig("q1"), storeName: "s", category: "coffee", amountKrw: 5000 });
    const ok = await spend(COST_DIARY_IMAGE, "diary-image:test");
    check("diary image spend ok", ok.ok && ok.balance === 150 - 20, JSON.stringify(ok));
  }

  // 18. 7-3 항목 7: 토큰 부족 메시지에 행동명·필요량·잔량 실값이 들어간다.
  {
    const src = readFileSync(join(ROOT, "lib", "token", "client.ts"), "utf8");
    const m = src.match(/export function insufficientMsg\(action: string, cost: number, balance: number\): string \{([\s\S]*?)\n\}/);
    check("insufficientMsg signature", m !== null, m ? "ok" : "missing");
    const body = m ? m[1] : "";
    check(
      "insufficientMsg uses real action/cost/balance",
      body.includes("${action}") && body.includes("${cost}") && body.includes("${balance}"),
      body.trim()
    );
    for (const page of ["app/dex/page.tsx", "app/camp/page.tsx"]) {
      const psrc = readFileSync(join(ROOT, page), "utf8");
      check(
        `${page} no bare INSUFFICIENT_MSG call`,
        !/showFeedback\(INSUFFICIENT_MSG|showCareMsg\("[a-z]+", INSUFFICIENT_MSG/.test(psrc),
        page
      );
    }
  }

  // 19. §2-1 내역 조회: 적립 후 1건 증가, 최신순, limit 준수, 차감 type spend.
  {
    const p = freshLedger();
    used.push(p);
    const h0 = await readHistory(5);
    check("history empty at start", Array.isArray(h0) && h0.length === 0, JSON.stringify(h0));
    await credit({ signalId: sig("h1"), storeName: "카페", category: "coffee", amountKrw: 5000 });
    const h1 = await readHistory(5);
    check(
      "history +1 after credit",
      h1.length === 1 && h1[0].type === "credit" && h1[0].amount === 150 && typeof h1[0].id === "string" && typeof h1[0].ts === "number",
      JSON.stringify(h1)
    );
    await credit({ signalId: sig("h2"), storeName: "식당", category: "food", amountKrw: 5000 });
    await spend(60, "upgrade:atk");
    const h3 = await readHistory(5);
    check(
      "history newest first",
      h3.length === 3 && h3[0].ts >= h3[1].ts && h3[1].ts >= h3[2].ts && h3[0].reason === "upgrade:atk",
      JSON.stringify(h3.map((e) => e.reason))
    );
    const h1lim = await readHistory(1);
    check("history limit 1", h1lim.length === 1 && h1lim[0].reason === "upgrade:atk", JSON.stringify(h1lim));
    const over = await readHistory(999);
    check("history limit clamped to entries", over.length === 3, String(over.length));
    const spendRow = h3.find((e) => e.reason === "upgrade:atk");
    check("spend entry type spend", spendRow !== undefined && spendRow.type === "spend" && spendRow.amount === 60, JSON.stringify(spendRow));
  }

  // 20. §2-1 3/20 전환: 기본 3개 최신순, 20 요청 시 전체(최대 20).
  {
    const p = freshLedger();
    used.push(p);
    for (let i = 0; i < 5; i += 1) {
      await credit({ signalId: sig(`t${i}`), storeName: "카페", category: "coffee", amountKrw: 1000 });
    }
    const h3 = await readHistory(3);
    check(
      "history default 3 newest",
      h3.length === 3 && h3[0].signalId === sig("t4") && h3[2].signalId === sig("t2"),
      JSON.stringify(h3.map((e) => e.signalId))
    );
    const h20 = await readHistory(20);
    check(
      "history expanded 20",
      h20.length === 5 && h20[0].signalId === sig("t4") && h20[4].signalId === sig("t0"),
      JSON.stringify(h20.map((e) => e.signalId))
    );
    const back = await readHistory(3);
    check("history back to 3", back.length === 3 && back[0].signalId === sig("t4"), String(back.length));
  }

  // 21. §2-1a 쓰기→재시작→읽기: 모듈을 새로 로드해도 파일 내용이 유지된다.
  {
    const p = freshLedger();
    used.push(p);
    await credit({ signalId: sig("u1"), storeName: "s", category: "coffee", amountKrw: 5000 });
    await spend(60, "test:restart");
    const lp = join(BUILD, "token", "ledger.js");
    delete req.cache[req.resolve(lp)];
    const ledger2 = req(lp);
    const b = await ledger2.balance();
    const es = await ledger2.entries();
    check(
      "sqlite persists across reload",
      b === 90 && es.length === 2 && es[0].type === "credit" && es[1].reason === "test:restart",
      `balance=${b} len=${es.length}`
    );
  }

  // 22. §2-1a DESC 순서: 같은 ms에 써도 삽입 역순으로 나온다.
  {
    const p = freshLedger();
    used.push(p);
    await credit({ signalId: sig("v1"), storeName: "s", category: "coffee", amountKrw: 5000 });
    await spend(10, "test:ord1");
    await spend(10, "test:ord2");
    const h = await readHistory(5);
    const es = await entries();
    check(
      "history desc matches reverse insertion",
      h.length === 3 && h[0].reason === "test:ord2" && h[2].type === "credit" &&
        h.map((e) => e.id).join() === es.map((e) => e.id).reverse().join(),
      JSON.stringify(h.map((e) => e.reason))
    );
  }

  // 23. §2-1a 스키마: signalId UNIQUE, ts 인덱스, source 값 범위.
  {
    const p = freshLedger();
    used.push(p);
    await credit({ signalId: sig("w1"), storeName: "s", category: "coffee", amountKrw: 5000 });
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(p);
    let ddl = "";
    let idx = "";
    try {
      const t = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'ledger'").get();
      ddl = t ? String(t.sql) : "";
      const ix = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_ledger_ts'").get();
      idx = ix ? String(ix.name) : "";
    } finally {
      db.close();
    }
    check(
      "schema has UNIQUE signalId + ts index",
      ddl.includes("signalId TEXT UNIQUE") && idx === "idx_ledger_ts",
      ddl
    );
    // UNIQUE 위반 시도는 중복 적립으로 흡수되고 항목이 늘지 않는다.
    const n1 = (await entries()).length;
    const dup = await credit({ signalId: sig("w1"), storeName: "s", category: "coffee", amountKrw: 5000 });
    const n2 = (await entries()).length;
    check(
      "duplicate signalId rejected at db level",
      dup.ok && dup.duplicate === true && n1 === 1 && n2 === 1,
      JSON.stringify([dup, n1, n2])
    );
  }

  // 24. §2-1a 동시 차감 10건(각 60, 잔량 100) → 1건만 성공, 음수 불가.
  {
    const p = freshLedger();
    used.push(p);
    await credit({ signalId: sig("x1"), storeName: "s", category: "coffee", amountKrw: 3333 });
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => spend(60, `test:race10-${i}`)));
    const wins = rs.filter((r) => r.ok).length;
    const b = await balance();
    check("10-way race one-wins no-negative", wins === 1 && b === 40, `wins=${wins} balance=${b}`);
  }

  // 25. §2-1a 이관 2회 실행 → 중복 없음, 원본은 .bak으로.
  {
    caseNo += 1;
    const j = join(tmpdir(), `token-ledger-mig-${process.pid}-${caseNo}.json`);
    const s = join(tmpdir(), `token-ledger-mig-${process.pid}-${caseNo}.sqlite`);
    rmSync(j, { force: true });
    rmSync(s, { force: true });
    rmSync(`${j}.bak`, { force: true });
    const { writeFileSync, existsSync } = await import("node:fs");
    writeFileSync(
      j,
      JSON.stringify([
        { id: "mig-1", type: "credit", amount: 150, reason: "카페 ○○ coffee 5000원", signalId: "mig-sig-1", ts: 1000 },
        { id: "mig-2", type: "credit", amount: 135, reason: "식당 food 4500원", signalId: "mig-sig-2", ts: 2000 },
        { id: "mig-3", type: "spend", amount: 60, reason: "upgrade:atk", ts: 3000 },
      ])
    );
    const env = { ...process.env, TOKEN_LEDGER_JSON: j, TOKEN_LEDGER_PATH: s };
    execFileSync(process.execPath, [join(ROOT, "scripts", "migrate-ledger.mjs")], { env, stdio: "pipe" });
    execFileSync(process.execPath, [join(ROOT, "scripts", "migrate-ledger.mjs")], { env, stdio: "pipe" });
    process.env.TOKEN_LEDGER_PATH = s;
    const es = await entries();
    const b = await balance();
    check(
      "migrate twice no dup",
      es.length === 3 && b === 225 && es[0].id === "mig-1" && !existsSync(j) && existsSync(`${j}.bak`),
      `len=${es.length} balance=${b}`
    );
    rmSync(j, { force: true });
    rmSync(s, { force: true });
    rmSync(`${j}.bak`, { force: true });
    delete process.env.TOKEN_LEDGER_PATH;
  }

  cleanup(used);
  console.log(failures === 0 ? `verify-token-ledger: PASS (${checks}/${checks})` : `verify-token-ledger: FAIL (${failures}/${checks})`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(`verify-token-ledger: ERROR ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
});
