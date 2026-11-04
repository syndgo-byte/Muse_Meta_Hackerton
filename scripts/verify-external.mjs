// scripts/verify-external.mjs — EX-2 검증: 키 없이 격리 서버를 띄워 8개 AI 라우트 확인.
// 실행: node scripts/verify-external.mjs (종료 코드만 본다).
// 격리: NEXT_DIST_DIR=.next-ex (저장소 폴더), :3000·.next untouched.
// 키 없이: MODEL_API_KEY="" (빈 값이 .env보다 우선) + 상태 파일도 임시 경로로 격리.
// 서버 로그: scratch/ex/dev-ex.log. 키 값은 절대 출력하지 않는다.
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdirSync, rmSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const EXDIR = join(ROOT, "scratch", "ex");
const SERVER_LOG = join(EXDIR, "dev-ex.log");
const STATUS_PATH = join(EXDIR, "verify-status.json");

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

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function postJson(base, path, body, timeoutMs = 120000) {
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

async function main() {
  mkdirSync(EXDIR, { recursive: true });
  // 격리 서버는 임시 상태 파일을 쓴다 (원본 untouched).
  if (existsSync(STATUS_PATH)) rmSync(STATUS_PATH);
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const nextBin = join(ROOT, "node_modules", "next", "dist", "bin", "next");

  const log = (s) => appendFileSync(SERVER_LOG, s);
  try {
    rmSync(SERVER_LOG);
  } catch {
    /* first run */
  }
  const child = spawn(process.execPath, [nextBin, "dev", "-p", String(port), "--hostname", "127.0.0.1"], {
    cwd: ROOT,
    env: {
      ...process.env,
      NEXT_DIST_DIR: ".next-ex",
      MODEL_API_KEY: "",
      CREATURE_STATUS_PATH: STATUS_PATH,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (d) => log(d.toString()));
  child.stderr.on("data", (d) => log(d.toString()));
  const kill = () => {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    if (process.platform === "win32") {
      try {
        // 트리째 종료 (고아 방지).
        execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } catch {
        /* already dead */
      }
    }
  };
  process.on("SIGINT", () => {
    kill();
    process.exit(130);
  });

  try {
    // 준비 대기: /api/feed가 200 + fallback:true를 줄 때까지 (최대 5분).
    let ready = false;
    const deadline = Date.now() + 300000;
    let lastErr = "not started";
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        lastErr = `server exited: ${child.exitCode} (see scratch/ex/dev-ex.log)`;
        break;
      }
      try {
        const r = await postJson(base, "/api/feed", { food: "probe" }, 30000);
        if (r.status === 200 && r.json?.fallback === true) {
          ready = true;
          break;
        }
        lastErr = `status=${r.status} body=${r.text}`;
      } catch (e) {
        lastErr = e.cause?.code ?? e.message;
        await sleep(2000);
        continue;
      }
      await sleep(2000);
    }
    check("ex2-server-ready", ready, ready ? "" : lastErr);
    if (!ready) {
      console.log(`verify-external: ${passes} passed, ${failures} failed`);
      process.exit(1);
    }

    // 8개 라우트: 모두 200 + fallback:true + 모양 유지.
    const battle = await postJson(base, "/api/battle", {
      mine: "불꽃 리피몬", wild: "풀 리피몬", mineId: "fire-01",
    });
    check("ex2-battle", battle.status === 200 && battle.json?.fallback === true
      && typeof battle.json?.result?.winner === "string"
      && Array.isArray(battle.json?.result?.turns), `status=${battle.status} body=${battle.text}`);

    const creature = await postJson(base, "/api/creature", { description: "probe mug" });
    check("ex2-creature", creature.status === 200 && creature.json?.fallback === true
      && typeof creature.json?.creature?.name === "string", `status=${creature.status} body=${creature.text}`);

    const diary = await postJson(base, "/api/diary", { log: "probe walk" });
    check("ex2-diary", diary.status === 200 && diary.json?.fallback === true
      && typeof diary.json?.diary === "string" && diary.json.diary.includes("QUIZ:"),
      `status=${diary.status} body=${diary.text}`);

    const feed = await postJson(base, "/api/feed", { food: "probe berry" });
    check("ex2-feed", feed.status === 200 && feed.json?.fallback === true
      && feed.json?.result?.food === "probe berry", `status=${feed.status} body=${feed.text}`);

    const image = await postJson(base, "/api/image", { prompt: "probe portrait" });
    check("ex2-image", image.status === 200 && image.json?.fallback === true
      && image.json?.model === "offline", `status=${image.status} body=${image.text}`);

    const levelup = await postJson(base, "/api/levelup", {
      role: "attacker", level: 5, activity: { walkM: 0, scans: 0, dances: 0 },
    });
    check("ex2-levelup", levelup.status === 200 && levelup.json?.fallback === true
      && levelup.json?.source === "rule", `status=${levelup.status} body=${levelup.text}`);

    const look = await postJson(base, "/api/look", { description: "probe street" });
    check("ex2-look", look.status === 200 && look.json?.fallback === true
      && typeof look.json?.result?.message === "string", `status=${look.status} body=${look.text}`);

    // voice는 multipart (오디오 1건).
    const form = new FormData();
    form.append("audio", new Blob(["probe"], { type: "audio/webm" }), "voice.webm");
    const vres = await fetch(`${base}/api/voice`, { method: "POST", body: form });
    const vtext = (await vres.text()).slice(0, 300);
    let vjson = null;
    try {
      vjson = JSON.parse(vtext);
    } catch {
      /* non-json */
    }
    check("ex2-voice", vres.status === 200 && vjson?.fallback === true
      && vjson?.result?.text === "", `status=${vres.status} body=${vtext}`);
  } finally {
    kill();
  }

  console.log(`verify-external: ${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

await main();
