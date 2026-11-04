// scripts/verify-voice-ask.mjs — VA-1 검증 (docs/VOICE_ASK_ORDER.md 확인 항목).
// 실행: node scripts/verify-voice-ask.mjs (종료 코드만 본다).
// A) 순수 로직 (tsc 독립 컴파일): 빠른길 4타입·슬롯, 스키마 검증, 장소 필터.
// B) 격리 서버 (.next-ex, TOKEN_LEDGER_PATH·CREATURE_STATUS_PATH 격리):
//    키 없음 대체, 모의 Muse AI(MODEL_API_BASE)로 충전처·인스타·운전잠금·
//    잘못된 JSON·토큰 부족·유튜브-키없음 확인. 키 값은 출력하지 않는다.
import { spawn, execFileSync } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { execFileSync as execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const VADIR = join(ROOT, "scratch", "va");

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createNetServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

async function postJson(base, path, body, timeoutMs = 60000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-json */
    }
    return { status: res.status, json, text: text.slice(0, 300) };
  } finally {
    clearTimeout(t);
  }
}

function baseAsk(text, extra = {}) {
  return {
    text,
    screen: "idle",
    driving: false,
    partner: { speciesId: "fire-01", name: "모카폼", element: "fire", role: "attacker" },
    skills: [
      { slot: 0, name: "몸통박치기", type: "attack" },
      { slot: 1, name: "화염방사", type: "ranged" },
      { slot: 2, name: "불꽃분신", type: "buff" },
      { slot: 3, name: "화염폭발", type: "debuff" },
    ],
    loc: { mode: "sim", env: "street" },
    balance: 100,
    lang: "ko-KR",
    ...extra,
  };
}

// 모의 Muse AI: 요청 속 문장 마커로 모드 선택.
function mockHandler() {
  const enc = (obj) => JSON.stringify({ choices: [{ message: { content: JSON.stringify(obj) } }] });
  return (req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      let text = "";
      try {
        const j = JSON.parse(body);
        const msgs = j.messages ?? [];
        const user = String(msgs[msgs.length - 1]?.content ?? "");
        // 재시도 요청은 JSON 뒤에 지시문이 붙으므로 앞부분만 파싱.
        const inner = JSON.parse(user.slice(0, user.lastIndexOf("}") + 1));
        text = String(inner.text ?? "");
      } catch {
        /* ignore */
      }
      // 그래도 못 읽으면 본문 마커로 (GARBAGE 재시도 경로).
      if (!text) {
        for (const m of ["GARBAGE", "충전처", "인스타", "유튜브", "디버프"]) {
          if (body.includes(m)) {
            text = m;
            break;
          }
        }
      }
      res.setHeader("Content-Type", "application/json");
      if (text.includes("GARBAGE")) {
        res.end(JSON.stringify({ choices: [{ message: { content: "not json at all {{{" } }] }));
      } else if (text.includes("충전처")) {
        res.end(enc({
          intent: "ask_token_spots",
          args: { places: ["연남 푸드트럭", "지어낸 충전소"] },
          reply: "가까운 충전처를 찾았어!",
        }));
      } else if (text.includes("인스타")) {
        res.end(enc({
          intent: "ask_hip_spots",
          args: { platform: "instagram", places: ["연남 벽화골목", "없는 핫플"] },
          reply: "인스타 감성 가득한 곳이야!",
        }));
      } else if (text.includes("유튜브")) {
        res.end(enc({
          intent: "ask_hip_spots",
          args: { platform: "youtube", places: ["성수 팝업스토어", "없는 핫플"] },
          reply: "유튜브에서 핫한 곳이야!",
        }));
      } else if (text.includes("디버프")) {
        res.end(enc({
          intent: "skill", args: { by: "type", type: "debuff" }, reply: "약하게 만들겠어!",
        }));
      } else {
        res.end(enc({ intent: "chat", args: {}, reply: "알겠어!" }));
      }
    });
  };
}

async function main() {
  // ---------- A) 순수 로직 ----------
  const BUILD = mkdtempSync(join(tmpdir(), "verify-ask-"));
  execSync(
    process.execPath,
    [
      join(ROOT, "node_modules", "typescript", "bin", "tsc"),
      join(ROOT, "lib", "ask", "intents.ts"),
      "--outDir", BUILD,
      "--module", "nodenext",
      "--target", "es2021",
      "--moduleResolution", "nodenext",
      "--skipLibCheck",
    ],
    { stdio: "pipe" }
  );
  const ask = await import(pathToFileURL(join(BUILD, "intents.js")).href);
  rmSync(BUILD, { recursive: true, force: true });

  const skills = [
    { slot: 0, name: "몸통박치기", type: "attack" },
    { slot: 1, name: "화염방사", type: "ranged" },
    { slot: 2, name: "불꽃분신", type: "buff" },
    { slot: 3, name: "화염폭발", type: "debuff" },
  ];
  check("va-fast-attack", JSON.stringify(ask.fastSkill("공격해!", skills)) === JSON.stringify({ by: "type", type: "attack" }));
  check("va-fast-ranged", JSON.stringify(ask.fastSkill("원거리 공격!", skills)) === JSON.stringify({ by: "type", type: "ranged" }));
  check("va-fast-buff", JSON.stringify(ask.fastSkill("버프 걸어!", skills)) === JSON.stringify({ by: "type", type: "buff" }));
  check("va-fast-debuff", JSON.stringify(ask.fastSkill("디버프로 약화시켜!", skills)) === JSON.stringify({ by: "type", type: "debuff" }));
  check("va-fast-slot", JSON.stringify(ask.fastSkill("공격 2", skills)) === JSON.stringify({ by: "slot", slot: 1 }));
  check("va-fast-slot-ko", JSON.stringify(ask.fastSkill("세 번째 기술 써!", skills)) === JSON.stringify({ by: "slot", slot: 2 }));
  check("va-fast-name", JSON.stringify(ask.fastSkill("화염방사 발사!", skills)) === JSON.stringify({ by: "name", name: "화염방사" }));
  check("va-fast-none", ask.fastSkill("근처 충전처 어디야?", skills) === null);

  check("va-schema-ok", ask.validateAskJson({ intent: "skill", args: { by: "slot", slot: 1 }, reply: "가라!" }) !== null);
  check("va-schema-bad-intent", ask.validateAskJson({ intent: "fly", args: {}, reply: "x" }) === null);
  check("va-schema-garbage", ask.validateAskJson("not json") === null && ask.validateAskJson(null) === null && ask.validateAskJson({}) === null);
  check("va-schema-bad-slot", ask.validateAskJson({ intent: "skill", args: { by: "slot", slot: 9 }, reply: "x" }) === null);
  check("va-schema-3sent", ask.validateAskJson({ intent: "chat", args: {}, reply: "하나. 둘. 셋." })?.reply === "하나. 둘.");
  check("va-filter", JSON.stringify(ask.filterPlaces(["연남 푸드트럭", "지어낸 곳"], ["연남 푸드트럭"])) === JSON.stringify(["연남 푸드트럭"]));

  // ---------- B) 격리 서버 ----------
  mkdirSync(VADIR, { recursive: true });
  const mockPort = await freePort();
  const mock = createHttpServer(mockHandler());
  await new Promise((resolve) => mock.listen(mockPort, "127.0.0.1", resolve));
  const mockBase = `http://127.0.0.1:${mockPort}`;

  const nextBin = join(ROOT, "node_modules", "next", "dist", "bin", "next");
  const statusPath = join(VADIR, "verify-status.json");
  const ledgerPath = join(VADIR, "verify-ledger.sqlite");
  for (const f of [statusPath, ledgerPath]) {
    try {
      if (existsSync(f)) rmSync(f);
    } catch {
      /* ignore */
    }
  }
  const logPath = join(VADIR, "dev-va.log");
  try {
    rmSync(logPath);
  } catch {
    /* first run */
  }
  const { appendFileSync } = await import("node:fs");
  const kills = [];
  process.on("SIGINT", () => {
    for (const k of kills) k();
    mock.close();
    process.exit(130);
  });

  async function startServer(extraEnv, readyProbe) {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, [nextBin, "dev", "-p", String(port), "--hostname", "127.0.0.1"], {
      cwd: ROOT,
      env: {
        ...process.env,
        NEXT_DIST_DIR: ".next-ex",
        CREATURE_STATUS_PATH: statusPath,
        TOKEN_LEDGER_PATH: ledgerPath,
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout.on("data", (d) => appendFileSync(logPath, d.toString()));
    child.stderr.on("data", (d) => appendFileSync(logPath, d.toString()));
    const kill = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      try {
        execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } catch {
        /* already dead */
      }
    };
    kills.push(kill);
    const deadline = Date.now() + 300000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) break;
      try {
        if (await readyProbe(base)) return { base, kill };
      } catch {
        /* booting */
      }
      await sleep(2000);
    }
    return { base, kill, failed: true };
  }

  // --- 부팅 1: 키 없음 → 200 + fallback:true ---
  {
    const s1 = await startServer(
      { MODEL_API_KEY: "", YOUTUBE_API_KEY: "" },
      async (base) => {
        const r = await postJson(base, "/api/muse/ask", baseAsk("키 없음 확인"), 30000);
        return r.status === 200 && r.json?.fallback === true;
      }
    );
    try {
      check("va-server-ready-nokey", !s1.failed);
      if (!s1.failed) {
        const r = await postJson(s1.base, "/api/muse/ask", baseAsk("키 없음 확인"));
        check("va-srv-nokey", r.status === 200 && r.json?.fallback === true && r.json?.intent === "unknown",
          `status=${r.status} body=${r.text}`);
      }
    } finally {
      s1.kill();
    }
    if (s1.failed) {
      console.log(`verify-voice-ask: ${passes} passed, ${failures} failed`);
      process.exit(1);
    }
  }

  // --- 부팅 2: 모의 Muse AI ---
  const srv = await startServer(
    { MODEL_API_KEY: "test-key", MODEL_API_BASE: mockBase, YOUTUBE_API_KEY: "" },
    async (base) => {
      const r = await postJson(base, "/api/muse/ask", baseAsk("준비 확인"), 30000);
      return r.status === 200 && r.json?.intent === "chat";
    }
  );
  const base = srv.base;
  const kill = srv.kill;
  try {
    check("va-server-ready", !srv.failed);
    if (srv.failed) {
      console.log(`verify-voice-ask: ${passes} passed, ${failures} failed`);
      process.exit(1);
    }

    // 모의 AI: 디버프 → skill/type/debuff.
    const sk = await postJson(base, "/api/muse/ask", baseAsk("디버프 걸어!"));
    check("va-srv-skill", sk.status === 200 && sk.json?.intent === "skill"
      && sk.json?.args?.type === "debuff", `status=${sk.status} body=${sk.text}`);

    // 충전처 → 목록 안의 이름만 (지어낸 곳 제거).
    const tk = await postJson(base, "/api/muse/ask", baseAsk("근처 토큰 충전처 어디야?"));
    const tkNames = (tk.json?.spots ?? []).map((s) => s.name);
    check("va-srv-token", tk.status === 200 && tk.json?.intent === "ask_token_spots"
      && tkNames.includes("연남 푸드트럭") && !tkNames.includes("지어낸 충전소"),
      `status=${tk.status} body=${tk.text}`);

    // 인스타 → 큐레이션만 (지어낸 곳 제거, 유튜브 종류 없음).
    const hip = await postJson(base, "/api/muse/ask", baseAsk("인스타 힙한 곳 어디야?"));
    const hipSpots = hip.json?.spots ?? [];
    const hipNames = hipSpots.map((s) => s.name);
    const hipJson = JSON.parse(readFileSync(join(ROOT, "data", "places", "hip.json"), "utf8")).map((s) => s.name);
    check("va-srv-hip", hip.status === 200 && hip.json?.intent === "ask_hip_spots"
      && hipNames.includes("연남 벽화골목") && !hipNames.includes("없는 핫플")
      && hipSpots.every((s) => s.kind !== "youtube")
      && hipNames.every((n) => hipJson.includes(n)), `status=${hip.status} body=${hip.text}`);

    // 유튜브인데 키 없음 → 큐레이션만 (kind youtube 없음).
    const yt = await postJson(base, "/api/muse/ask", baseAsk("유튜브 힙한 곳 어디야?"));
    const ytSpots = yt.json?.spots ?? [];
    check("va-srv-youtube-nokey", yt.status === 200 && yt.json?.intent === "ask_hip_spots"
      && ytSpots.length > 0 && ytSpots.every((s) => s.kind !== "youtube"),
      `status=${yt.status} body=${yt.text}`);

    // 운전 잠금 → 배틀 행동 거부.
    const drv = await postJson(base, "/api/muse/ask", baseAsk("디버프 걸어!", { driving: true }));
    check("va-srv-driving", drv.status === 200 && drv.json?.intent === "unknown"
      && drv.json?.reply === "운전 중엔 안 돼!", `status=${drv.status} body=${drv.text}`);

    // 잘못된 JSON → unknown + fallback.
    const bad = await postJson(base, "/api/muse/ask", baseAsk("GARBAGE 쓰레기"));
    check("va-srv-garbage", bad.status === 200 && bad.json?.intent === "unknown"
      && bad.json?.fallback === true, `status=${bad.status} body=${bad.text}`);

    // 토큰 부족 → 409 (클라 spendRemote가 ok:false로 받음).
    const sp = await postJson(base, "/api/token/spend", { amount: 99999999, reason: "va-probe" });
    check("va-srv-insufficient", sp.status === 409, `status=${sp.status} body=${sp.text}`);
  } finally {
    kill();
    mock.close();
  }

  console.log(`verify-voice-ask: ${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

await main();
