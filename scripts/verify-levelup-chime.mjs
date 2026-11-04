// scripts/verify-levelup-chime.mjs — 레벨업 차임 스펙 검증 (lib/levelup-chime.ts).
// 실행: node scripts/verify-levelup-chime.mjs (종료 코드만 본다).
// - 길이 1초 이내, 피크 약 -18dB 이하, 기본음 880Hz 이하 (날카로운 고음 금지)
// - 음소거(bgmPref off)면 재생 없이 "muted"
// - AudioContext 없음(node) → "blocked" (조용히 스킵)
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BUILD = mkdtempSync(join(tmpdir(), "verify-lvchime-"));
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

execFileSync(
  process.execPath,
  [
    join(ROOT, "node_modules", "typescript", "bin", "tsc"),
    "--outDir", BUILD,
    "--rootDir", join(ROOT, "lib"),
    "--module", "commonjs",
    "--target", "es2021",
    "--moduleResolution", "node",
    "--skipLibCheck",
    "--noEmitOnError",
    "lib/levelup-chime.ts",
    "lib/bgm.ts",
  ],
  { cwd: ROOT, stdio: "inherit" }
);
const chime = req(join(BUILD, "levelup-chime.js"));

// ---- 스펙 상수 ----
check("total under 1s", chime.CHIME_TOTAL < 1.0, `${chime.CHIME_TOTAL}`);
check("peak at most -18dB", chime.CHIME_PEAK <= 0.126, `${chime.CHIME_PEAK}`);
{
  const top = Math.max(...chime.CHIME_NOTES.map((n) => n.freq));
  check("fundamentals mellow", top <= 880, `${top}`);
  const end = Math.max(...chime.CHIME_NOTES.map((n) => n.at + n.dur));
  check("notes fit total", end <= chime.CHIME_TOTAL, `${end}`);
}

// ---- 음소거/차단 경로 (node: AudioContext 없음) ----
{
  const store = { "snapquest-bgm": "off" };
  globalThis.localStorage = { getItem: (k) => store[k] ?? null };
  globalThis.window = { localStorage: globalThis.localStorage };
  check("muted when pref off", chime.playLevelupChime() === "muted");
  store["snapquest-bgm"] = "on";
  check("blocked without AudioContext", chime.playLevelupChime() === "blocked");
  delete globalThis.window;
  delete globalThis.localStorage;
}

// ---- 합성 스케줄 (가짜 AudioContext로 played 경로 검증) ----
{
  const played = [];
  const fakeParam = () => ({
    value: 0,
    events: [],
    setValueAtTime(v, t) { this.value = v; this.events.push(["set", v, t]); },
    exponentialRampToValueAtTime(v, t) { this.events.push(["ramp", v, t]); },
  });
  const fakeCtx = {
    state: "running",
    currentTime: 10,
    destination: {},
    createOscillator() {
      const o = {
        type: "", frequency: fakeParam(), started: -1, stopped: -1,
        connect() { return o; },
        start(t) { o.started = t; },
        stop(t) { o.stopped = t; },
      };
      played.push(o);
      return o;
    },
    createGain() {
      const g = { gain: fakeParam(), connect() { return g; } };
      played.push(g);
      return g;
    },
  };
  globalThis.localStorage = { getItem: () => "on" };
  globalThis.window = { AudioContext: function () { return fakeCtx; } };
  check("played with running context", chime.playLevelupChime() === "played");
  const oscs = played.filter((n) => n.frequency);
  check("4 partials (2 dings x 2)", oscs.length === 4, `${oscs.length}`);
  check(
    "sine only",
    oscs.every((o) => o.type === "sine")
  );
  check(
    "no shrill partial",
    Math.max(...oscs.map((o) => o.frequency.value)) < 2000
  );
  check(
    "stops within 1s",
    Math.max(...oscs.map((o) => o.stopped)) - fakeCtx.currentTime < 1.0
  );
  const peaks = played
    .filter((n) => n.gain)
    .flatMap((g) => g.gain.events.filter((e) => e[0] === "ramp").map((e) => e[1]));
  check("peak gain capped", Math.max(...peaks) <= 0.126, `${Math.max(...peaks)}`);
  delete globalThis.window;
  delete globalThis.localStorage;
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exitCode = failures > 0 ? 1 : 0;
