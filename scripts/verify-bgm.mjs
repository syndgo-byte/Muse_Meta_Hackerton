// scripts/verify-bgm.mjs — D9 검증 (BGM_DESIGN §4).
// 실행: node scripts/verify-bgm.mjs (종료 코드만 본다).
// - 16스텝/마디, pitched ≤1.5kHz, 템포 120/132, 8마디 16초/14.5초
// - master·lookahead·visibility·드럼 스펙 소스 확인, WAV 렌더 + 울음 마스킹 비교
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBgm, renderAll } from "./bgm-render.mjs";
import { synthCry } from "./voice-synth.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

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

const { mod, cleanup } = loadBgm();
try {
  const { BGM_THEMES, buildScore } = mod;
  const main = buildScore("main");
  const ar = buildScore("ar");

  // 1. 16스텝/마디: 8화음, 이벤트가 루프 안에.
  check("8 chords each", BGM_THEMES.main.chords.length === 8 && BGM_THEMES.ar.chords.length === 8);
  {
    const bad = [];
    for (const [name, sc] of [["main", main], ["ar", ar]]) {
      const stepDur = 60 / sc.bpm / 4;
      for (const e of sc.events) {
        const pos = e.t / stepDur;
        if (e.t < 0 || e.t >= sc.seconds || Math.abs(pos - Math.round(pos)) > 0.01) {
          bad.push(`${name}@${e.t.toFixed(3)}`);
          break;
        }
      }
    }
    check("events on 16-step grid in loop", bad.length === 0, bad.join(","));
    console.log(`score events: main=${main.events.length} ar=${ar.events.length}`);
  }

  // 2. pitched ≤ 1.5kHz.
  {
    let maxF = 0;
    let maxId = "";
    for (const [name, sc] of [["main", main], ["ar", ar]]) {
      for (const e of sc.events) {
        const fs = e.kind === "pad" ? e.freqs : e.f !== undefined ? [e.f] : [];
        for (const f of fs) {
          if (f > maxF) { maxF = f; maxId = `${name}/${e.kind}=${f}`; }
        }
      }
    }
    console.log(`max pitched ${maxId}`);
    check("pitched <= 1.5kHz", maxF <= 1500, maxId);
  }

  // 3. 템포.
  check("tempo 120/132", main.bpm === 120 && ar.bpm === 132, `${main.bpm}/${ar.bpm}`);

  // 4. 8마디 길이.
  console.log(`loop seconds: main=${main.seconds.toFixed(3)} ar=${ar.seconds.toFixed(3)}`);
  check("main 8 bars = 16s", Math.abs(main.seconds - 16.0) < 0.01, String(main.seconds));
  check("ar 8 bars = 14.5s", Math.abs(ar.seconds - 14.545) < 0.02, String(ar.seconds));

  // 5. 소스 규격 (8-D: 합성 → field.mp3 루프).
  {
    const src = readFileSync(join(ROOT, "lib", "bgm.ts"), "utf8");
    check("field.mp3 loop", src.includes('FIELD_URL = "/bgm/field.mp3"'));
    check("volume <= 0.25", src.includes("FIELD_VOLUME = 0.25"));
    check("scene fade 1s", src.includes("FADE_SCENE_MS = 1000"));
    check("loop seam 2s/0.5s", src.includes("LOOP_FADEOUT_S = 2.0") && src.includes("LOOP_FADEIN_MS = 500"));
    check("visibility handler", src.includes("visibilitychange") && src.includes("document.hidden"));
    check("no synth voices", !src.includes("createOscillator") && !src.includes("createPeriodicWave"));
    check("7 exports kept",
      ["startBgm", "startArBgm", "stopBgm", "toggleBgm", "isBgmOn", "bgmPref", "clearBgmLock"]
        .every((f) => src.includes(`export function ${f}`)));
    const fp = join(ROOT, "public", "bgm", "field.mp3");
    const fstat = existsSync(fp) ? statSync(fp) : null;
    check("field.mp3 exists <=5MB", !!fstat && fstat.size > 1000000 && fstat.size <= 5 * 1024 * 1024,
      fstat ? String(fstat.size) : "missing");
  }
} finally {
  cleanup();
}

// 6. WAV 렌더 + 길이.
const { main: mainWav } = renderAll();
{
  const ok = ["main.wav", "ar.wav"].every((f) => existsSync(join(ROOT, "scratch", "bgm", f)));
  check("wavs rendered", ok);
  let secsOk = true;
  for (const f of ["main.wav", "ar.wav"]) {
    const st = statSync(join(ROOT, "scratch", "bgm", f));
    const secs = (st.size - 44) / 2 / 22050;
    if (Math.abs(secs - 16.0) > 0.1) secsOk = false;
  }
  check("wavs 16.0s", secsOk);
}

// 8. 9-C BGM 규칙 (0항): 곡별 볼륨, battle 대체 제거, pov 무음.
{
  const src = readFileSync(join(ROOT, "lib", "bgm.ts"), "utf8");
  check("battle vol const 0.12", src.includes("BATTLE_VOLUME = 0.12"));
  check("no field fallback", !src.includes("fallback to field") && !src.includes("keep field"));
  check("battle missing silent", src.includes("battle missing, silent"));
  check("stop battle stays silent", !/stopBattleBgm[\s\S]{0,600}playField\(\)/.test(src));
  const pov = readFileSync(join(ROOT, "app", "pov", "page.tsx"), "utf8");
  check("pov calls no ArBgm", !pov.includes("startArBgm"));
  // Preupload §3: 원곡은 public/에 없게, 로컬 scratch/bgm-dev에 보관.
  const bp = join(ROOT, "public", "bgm", "battle.mp3");
  const moved = join(ROOT, "scratch", "bgm-dev", "battle-original.mp3");
  const mstat = existsSync(moved) ? statSync(moved) : null;
  check("battle.mp3 out of public", !existsSync(bp));
  check("battle original kept local", !!mstat && mstat.size > 100000,
    mstat ? String(mstat.size) : "missing");
}

// 7. 울음 마스킹: 대표 울음 RMS가 BGM보다 6dB 이상 크면 통과.
//    (못 넘으면 BGM master를 낮춘다. 울음은 올리지 않는다.)
{
  const profiles = JSON.parse(readFileSync(join(ROOT, "lib", "voice", "profiles.json"), "utf8"));
  const pick = ["fire-01", "grass-04", "water-05", "rock-01"];
  let sum = 0, cnt = 0;
  for (const id of pick) {
    const p = profiles.find((x) => x.id === id);
    const pcm = synthCry(p, "meet", 1);
    for (let i = 0; i < pcm.length; i++) { sum += pcm[i] * pcm[i]; cnt++; }
  }
  const cryRms = Math.sqrt(sum / cnt);
  const db = 20 * Math.log10(cryRms / mainWav.rms);
  console.log(`cry rms=${cryRms.toFixed(4)} bgm rms=${mainWav.rms.toFixed(5)} diff=+${db.toFixed(1)}dB`);
  check("cries 6dB above bgm", db >= 6, `+${db.toFixed(1)}dB`);
}

// 9. BGM-1 배틀 10곡 랜덤 (원곡 battle.mp3 미참조).
{
  const src = readFileSync(join(ROOT, "lib", "bgm.ts"), "utf8");
  check("no battle.mp3 code ref", !src.includes('"/bgm/battle.mp3"') && !src.includes("BATTLE_URL"));
  check("battle vol still 0.12", src.includes("BATTLE_VOLUME = 0.12") && src.includes("FIELD_VOLUME = 0.25"));
  const oneTrack = /export function startBattleBgm[\s\S]{0,400}bgmMode === "battle" && playing && !a\.paused\) return;/;
  check("one track per battle", oneTrack.test(src) && (src.match(/pickBattleTrack\(lastBattleTrack\)/g) || []).length === 1);
}
{
  const { mod: bgm, cleanup: cleanupBgm } = loadBgm();
  try {
    const tracks = bgm.BATTLE_TRACKS;
    check("battle tracks = 10", Array.isArray(tracks) && tracks.length === 10, String(tracks && tracks.length));
    const missing = [];
    for (const t of tracks || []) {
      const fp = join(ROOT, "public", t.replace(/^\//, ""));
      const st = existsSync(fp) ? statSync(fp) : null;
      if (!st || st.size < 100000 || st.size > 3 * 1024 * 1024) missing.push(`${t}:${st ? st.size : "missing"}`);
    }
    check("battle tracks exist <=3MB", missing.length === 0, missing.join(","));
    const dups = new Set(tracks || []).size !== (tracks || []).length;
    check("battle tracks unique", !dups);
    let repeat = 0;
    for (let prev = -1; prev < 10; prev++) {
      for (let i = 0; i < 200; i++) {
        if (bgm.pickBattleTrack(prev) === prev && prev >= 0) repeat++;
      }
    }
    check("no immediate repeat", repeat === 0, String(repeat));
    const seen = new Set();
    for (let i = 0; i < 500; i++) seen.add(bgm.pickBattleTrack(0));
    check("covers other 9", seen.size === 9 && !seen.has(0), [...seen].sort().join(","));
  } finally {
    cleanupBgm();
  }
}

if (failures > 0) {
  console.log(`verify-bgm: FAIL (${failures} failed, ${passes} passed)`);
  process.exit(1);
} else {
  console.log(`verify-bgm: PASS (${passes}/${passes})`);
}
