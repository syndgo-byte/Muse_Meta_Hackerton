// scripts/compose-bgm.mjs — 7-D-1 필드곡: 직접 작곡 + 실제 악기 샘플 렌더.
// 실행: node scripts/compose-bgm.mjs
//   1) 아래 악보 데이터 → 이벤트 JSON 생성
//   2) headless Chrome OfflineAudioContext로 믹스 → WAV
//   3) lamejs로 mp3 → public/bgm/candidates/field-composed.mp3
// 원곡(포켓몬 1세대 타이틀)의 멜로디·화성을 쓰지 않는다. 아래 선율은 자작이다.
import { spawn } from "node:child_process";
import http from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SR = 44100;
const BPM = 140;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;

// ---------- 악보: [midi, 박, 길이(박), 세기] (C4=60), 마디별 ----------
// 인트로 팡파르 4 + A 8 + A2 8 + B 8 + A' 8(Db) + 아웃트로 4 = 40마디
const TRUMPET = [
  [[60, 0, 0.5, 0.8], [60, 0.5, 0.5, 0.8], [64, 1, 0.5, 0.8], [64, 1.5, 0.5, 0.8], [67, 2, 1, 0.85], [72, 3, 1, 0.9]],
  [[74, 0, 1, 0.85], [72, 1, 0.5, 0.8], [67, 1.5, 0.5, 0.8], [64, 2, 1, 0.8], [67, 3, 1, 0.85]],
  [[69, 0, 1, 0.85], [72, 1, 1, 0.85], [77, 2, 1.5, 0.9], [76, 3.5, 0.5, 0.8]],
  [[74, 0, 1, 0.85], [72, 1, 0.5, 0.8], [74, 1.5, 0.5, 0.8], [76, 2, 2, 0.85]],
  [[72, 0, 1, 0.85], [74, 1, 1, 0.85], [76, 2, 1, 0.85], [79, 3, 1, 0.9]],
  [[81, 0, 2, 0.95], [79, 2, 1, 0.85], [76, 3, 1, 0.85]],
  [[74, 0, 1, 0.85], [76, 1, 1, 0.85], [79, 2, 1, 0.85], [76, 3, 1, 0.85]],
  [[74, 0, 3, 0.9]],
  [[76, 0, 1, 0.85], [77, 1, 1, 0.85], [79, 2, 1, 0.85], [81, 3, 1, 0.9]],
  [[79, 0, 2, 0.9], [76, 2, 1, 0.85], [74, 3, 1, 0.85]],
  [[72, 0, 1, 0.8], [74, 1, 1, 0.8], [76, 2, 2, 0.85]],
  [[72, 0, 3, 0.9]],
  [[64, 0, 0.5, 0.75], [67, 0.5, 0.5, 0.75], [72, 1, 1, 0.85], [76, 2, 1, 0.85], [79, 3, 1, 0.9]],
  [[81, 0, 1.5, 0.95], [79, 1.5, 0.5, 0.8], [76, 2, 1, 0.85], [74, 3, 1, 0.85]],
  [[76, 0, 0.5, 0.8], [79, 0.5, 0.5, 0.8], [81, 1, 1, 0.9], [79, 2, 1, 0.85], [76, 3, 1, 0.85]],
  [[74, 0, 2, 0.85], [76, 2, 1, 0.85], [79, 3, 1, 0.9]],
  [[81, 0, 1, 0.9], [79, 1, 1, 0.85], [76, 2, 1, 0.85], [74, 3, 1, 0.85]],
  [[72, 0, 1.5, 0.85], [74, 1.5, 0.5, 0.8], [76, 2, 1, 0.85], [79, 3, 1, 0.9]],
  [[76, 0, 2, 0.85], [74, 2, 1, 0.8], [72, 3, 1, 0.8]],
  [[76, 0, 1, 0.85], [74, 1, 1, 0.85], [72, 2, 2, 0.85]],
  [[77, 0, 2, 0.9], [81, 2, 1, 0.9], [79, 3, 1, 0.85]],
  [[79, 0, 2, 0.85], [77, 2, 1, 0.85], [74, 3, 1, 0.8]],
  [[72, 0, 1, 0.8], [74, 1, 1, 0.8], [77, 2, 2, 0.85]],
  [[74, 0, 2, 0.85], [72, 2, 2, 0.8]],
  [[77, 0, 1, 0.85], [79, 1, 1, 0.85], [81, 2, 1, 0.9], [84, 3, 1, 0.95]],
  [[82, 0, 2, 0.9], [81, 2, 1, 0.85], [79, 3, 1, 0.85]],
  [[81, 0, 1, 0.85], [79, 1, 1, 0.85], [77, 2, 2, 0.85]],
  [[79, 0, 1, 0.85], [76, 1, 1, 0.8], [77, 2, 2, 0.85]],
  [[73, 0, 1, 0.85], [74, 1, 1, 0.85], [77, 2, 1, 0.85], [80, 3, 1, 0.9]],
  [[82, 0, 2, 0.95], [80, 2, 1, 0.85], [77, 3, 1, 0.85]],
  [[74, 0, 1, 0.85], [77, 1, 1, 0.85], [80, 2, 1, 0.85], [77, 3, 1, 0.85]],
  [[74, 0, 3, 0.9]],
  [[77, 0, 1, 0.85], [78, 1, 1, 0.85], [80, 2, 1, 0.85], [82, 3, 1, 0.9]],
  [[80, 0, 2, 0.9], [77, 2, 1, 0.85], [74, 3, 1, 0.85]],
  [[73, 0, 1, 0.8], [74, 1, 1, 0.8], [77, 2, 2, 0.85]],
  [[73, 0, 3, 0.9]],
  [[82, 0, 1, 0.9], [85, 1, 1, 0.95], [84, 2, 1, 0.85], [82, 3, 1, 0.85]],
  [[80, 0, 2, 0.9], [78, 2, 2, 0.85]],
  [[77, 0, 1, 0.85], [74, 1, 1, 0.8], [73, 2, 2, 0.85]],
  [[73, 0, 4, 0.9]],
];

// 마디별 코드: [이름, 베이스 루트, 패드 3화음]
const CHORDS = [
  ["C", 36, [48, 52, 55]], ["C", 36, [48, 52, 55]], ["F", 41, [53, 57, 60]], ["G", 43, [55, 59, 62]],
  ["C", 36, [48, 52, 55]], ["F", 41, [53, 57, 60]], ["G", 43, [55, 59, 62]], ["C", 36, [48, 52, 55]],
  ["Am", 45, [57, 60, 64]], ["F", 41, [53, 57, 60]], ["G", 43, [55, 59, 62]], ["C", 36, [48, 52, 55]],
  ["C", 36, [48, 52, 55]], ["Em", 40, [52, 55, 59]], ["F", 41, [53, 57, 60]], ["C", 36, [48, 52, 55]],
  ["F", 41, [53, 57, 60]], ["G", 43, [55, 59, 62]], ["Am", 45, [57, 60, 64]], ["G", 43, [55, 59, 62]],
  ["F", 41, [53, 57, 60]], ["Dm", 38, [50, 53, 57]], ["Gm", 43, [55, 58, 62]], ["C", 36, [48, 52, 55]],
  ["F", 41, [53, 57, 60]], ["Bb", 46, [58, 62, 65]], ["C", 36, [48, 52, 55]], ["F", 41, [53, 57, 60]],
  ["Db", 37, [49, 53, 56]], ["Gb", 42, [54, 58, 61]], ["Ab", 44, [56, 60, 63]], ["Db", 37, [49, 53, 56]],
  ["Bbm", 46, [58, 61, 65]], ["Gb", 42, [54, 58, 61]], ["Ab", 44, [56, 60, 63]], ["Db", 37, [49, 53, 56]],
  ["Gb", 42, [54, 58, 61]], ["Ab", 44, [56, 60, 63]], ["Db", 37, [49, 53, 56]], ["Db", 37, [49, 53, 56]],
];

const SECTION_END = new Set([3, 11, 19, 27, 35, 38]);
const SECTION_START = new Set([0, 4, 12, 20, 28, 36]);

// ---------- 반주 생성 (코드 → 이벤트) ----------
// 이벤트: {t(초), inst, midi(유음정) | drum(타악기), dur(초), vel}
const BARS = Number(process.env.BGM_BARS || 40);

function buildEvents() {
  const ev = [];
  for (let bar = 0; bar < BARS; bar++) {
    const t0 = bar * BAR;
    const [, root, triad] = CHORDS[bar];
    // 트럼펫 멜로디
    for (const [midi, beat, dur, vel] of TRUMPET[bar]) {
      ev.push({ t: t0 + beat * BEAT, inst: "trumpet", midi, dur: dur * BEAT, vel });
    }
    // 호른: 3·5음 온음표 패드 + 루트 펀치
    for (const midi of [triad[1], triad[2]]) {
      ev.push({ t: t0, inst: "french-horn", midi, dur: BAR, vel: 0.3 });
    }
    ev.push({ t: t0, inst: "french-horn", midi: root + 12, dur: BEAT * 0.4, vel: 0.45 });
    // 바이올린: 팡파르·A'에서는 멜로디 더블, 나머지는 패드
    if (bar < 4 || (bar >= 28 && bar < 36)) {
      for (const [midi, beat, dur, vel] of TRUMPET[bar]) {
        const dbl = midi + 12 <= 84 ? midi + 12 : midi;
        ev.push({ t: t0 + beat * BEAT, inst: "violin", midi: dbl, dur: dur * BEAT, vel: vel * 0.55 });
      }
    } else {
      for (const b of [0, 2]) {
        ev.push({ t: t0 + b * BEAT, inst: "violin", midi: triad[0] + 12, dur: BAR / 2, vel: 0.28 });
        ev.push({ t: t0 + b * BEAT, inst: "violin", midi: triad[1] + 12, dur: BAR / 2, vel: 0.25 });
      }
    }
    // 첼로: 인트로 2분음표, 나머지는 루트·5도 행진
    if (bar < 4) {
      for (const b of [0, 2]) ev.push({ t: t0 + b * BEAT, inst: "cello", midi: root, dur: BAR / 2, vel: 0.5 });
    } else if (bar === 39) {
      ev.push({ t: t0, inst: "cello", midi: root, dur: BAR, vel: 0.5 });
    } else {
      const pat = [[0, root, 0.5], [1, root + 7, 0.38], [2, root, 0.48], [3, root + 7, 0.4]];
      for (const [b, midi, vel] of pat) ev.push({ t: t0 + b * BEAT, inst: "cello", midi, dur: BEAT * 0.9, vel });
    }
    // 스네어: 행진 8분음표 + 구간 끝 롤
    if (bar === 39) {
      ev.push({ t: t0, drum: "snare", dur: 0.3, vel: 0.7 });
    } else if (SECTION_END.has(bar)) {
      for (let i = 0; i < 4; i++) ev.push({ t: t0 + i * BEAT / 2, drum: "snare", dur: 0.2, vel: i % 2 === 0 ? 0.55 : 0.32 });
      for (let i = 0; i < 8; i++) ev.push({ t: t0 + 2 * BEAT + i * BEAT / 4, drum: "snare", dur: 0.15, vel: 0.3 + 0.05 * i });
    } else {
      for (let i = 0; i < 8; i++) ev.push({ t: t0 + i * BEAT / 2, drum: "snare", dur: 0.2, vel: i % 2 === 0 ? 0.55 : 0.3 });
    }
    // 팀파니: 1·3박 + 구간 끝 롤 (C 샘플을 피치 이동)
    if (bar !== 39) {
      ev.push({ t: t0, drum: "timpani", midi: root, dur: 0.8, vel: 0.6 });
      if (SECTION_END.has(bar)) {
        for (let i = 0; i < 4; i++) ev.push({ t: t0 + 2 * BEAT + i * BEAT / 2, drum: "timpani", midi: root, dur: 0.5, vel: 0.45 + 0.05 * i });
      } else {
        ev.push({ t: t0 + 2 * BEAT, drum: "timpani", midi: root + 7, dur: 0.8, vel: 0.5 });
      }
    } else {
      ev.push({ t: t0, drum: "timpani", midi: root, dur: 1.5, vel: 0.7 });
    }
    // 심벌: 구간 시작 + 마지막
    if (SECTION_START.has(bar) || bar === 39) {
      ev.push({ t: t0, drum: "cymbal", dur: 2.0, vel: bar === 39 ? 0.65 : 0.5 });
    }
  }
  ev.sort((a, b) => a.t - b.t);
  return ev;
}

// 샘플 파일 → midi 매핑 (파일명 음이름 기준)
const NOTE_MIDI = {
  trumpet: { F3: 53, C4: 60, Ds4: 63, G4: 67, D5: 74, F5: 77, A5: 81, C6: 84 },
  "french-horn": { G2: 43, D3: 50, F3: 53, A3: 57, C4: 60, D5: 74 },
  violin: { G3: 55, C4: 60, E4: 64, G4: 67, C5: 72, E5: 76, G5: 79, C6: 84 },
  cello: { C2: 36, E2: 40, G2: 43, C3: 48, E3: 52, G3: 55, C4: 60 },
};

function fileUrl(p) {
  return "file:///" + p.replace(/\\/g, "/").replace(/ /g, "%20");
}

async function main() {
  const work = mkdtempSync(join(tmpdir(), "bgm-"));
  const events = buildEvents();
  const totalDur = BARS * BAR + 2.0;
  console.log(`events: ${events.length}, duration: ${totalDur.toFixed(1)}s`);

  // 샘플 URL 표
  const samples = {};
  for (const [inst, notes] of Object.entries(NOTE_MIDI)) {
    samples[inst] = Object.entries(notes).map(([name, midi]) => ({
      midi,
      url: fileUrl(join(ROOT, "public", "bgm", "samples", inst, `${name}.mp3`)),
    }));
  }
  const drums = {
    snare: fileUrl(join(ROOT, "public", "bgm", "samples", "percussion", "snare.wav")),
    timpani: fileUrl(join(ROOT, "public", "bgm", "samples", "percussion", "timpani.wav")),
    cymbal: fileUrl(join(ROOT, "public", "bgm", "samples", "percussion", "cymbal.ogg")),
  };
  const score = { sr: SR, duration: totalDur, events, samples, drums, timpaniMidi: 47 };

  // 렌더 페이지 생성 (악보 내장)
  const tpl = readFileSync(join(ROOT, "scripts", "render-bgm.html"), "utf8");
  const page = tpl.replace("__SCORE_JSON__", JSON.stringify(score).replace(/</g, "\\u003c"));
  const pagePath = join(work, "render.html");
  writeFileSync(pagePath, page);

  // headless Chrome 렌더 (CDP로 완료까지 대기; virtual-time은 오디오 디코드를 멈춘다)
  const b64 = await renderViaCDP(fileUrl(pagePath), 10 * 60 * 1000);
  if (!b64 || b64.length < 1000) throw new Error("render failed: empty output");
  const wav = Buffer.from(b64, "base64");
  console.log(`wav bytes: ${wav.length}`);

  // WAV 파싱 → 정규화 → mp3
  const wavPath = join(work, "field.wav");
  writeFileSync(wavPath, wav);
  const pcm = decodeWav(wav);
  let peak = 0;
  for (const ch of pcm) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  const g = peak > 0 ? 0.89 / peak : 1;
  console.log(`peak: ${peak.toFixed(3)}, norm gain: ${g.toFixed(3)}`);
  const left = new Int16Array(pcm[0].length);
  const right = new Int16Array(pcm[1].length);
  for (let i = 0; i < left.length; i++) {
    const a = Math.max(-1, Math.min(1, pcm[0][i] * g));
    const b = Math.max(-1, Math.min(1, pcm[1][i] * g));
    left[i] = a < 0 ? a * 0x8000 : a * 0x7fff;
    right[i] = b < 0 ? b * 0x8000 : b * 0x7fff;
  }
  const require = createRequire(import.meta.url);
  const lameBundle = require.resolve("lamejs/lame.all.js");
  vm.runInThisContext(readFileSync(lameBundle, "utf8"), { filename: lameBundle });
  const enc = new globalThis.lamejs.Mp3Encoder(2, SR, 128);
  const chunks = [];
  const FRAME = 1152;
  for (let i = 0; i < left.length; i += FRAME) {
    const data = enc.encodeBuffer(left.subarray(i, i + FRAME), right.subarray(i, i + FRAME));
    if (data.length) chunks.push(Buffer.from(data));
  }
  const end = enc.flush();
  if (end.length) chunks.push(Buffer.from(end));
  const mp3 = Buffer.concat(chunks);
  const mp3Path = join(ROOT, "public", "bgm", "candidates", "field-composed.mp3");
  writeFileSync(mp3Path, mp3);
  console.log(`mp3: ${mp3Path} (${mp3.length} bytes)`);
  // 검증: 길이 60~90초, 크기 5MB 이하
  const durOk = BARS < 40 || (totalDur >= 60 && totalDur <= 92);
  const sizeOk = mp3.length <= 5 * 1024 * 1024;
  console.log(`verify: duration ${totalDur.toFixed(1)}s ${durOk ? "OK" : "FAIL"}, size ${sizeOk ? "OK" : "FAIL"}`);
  if (!durOk || !sizeOk) process.exitCode = 1;
}

// CDP로 headless Chrome을 몰아 렌더 완료까지 대기한다.
function httpReq(url, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method }, (res) => {
      let s = "";
      res.on("data", (c) => { s += c; });
      res.on("end", () => resolve(s));
    });
    req.on("error", reject);
    req.end();
  });
}
const httpGet = (url) => httpReq(url, "GET");

async function renderViaCDP(pageUrl, timeoutMs) {
  const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const profile = mkdtempSync(join(tmpdir(), "bgm-prof-"));
  const port = 19222;
  const child = spawn(chrome, [
    "--headless", "--no-sandbox", "--disable-gpu",
    "--allow-file-access-from-files",
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    "about:blank",
  ], { stdio: "ignore", windowsHide: true });
  try {
    let ok = false;
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 300));
      try {
        await httpGet(`http://127.0.0.1:${port}/json/version`);
        ok = true;
        break;
      } catch { /* 아직 기동 중 */ }
    }
    if (!ok) throw new Error("cdp endpoint timeout");
    const target = JSON.parse(await httpReq(`http://127.0.0.1:${port}/json/new?${pageUrl}`, "PUT"));
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error("cdp ws failed"));
    });
    let id = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data.toString());
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
      }
    };
    const send = (method, params = {}) => new Promise((resolve) => {
      const i = ++id;
      pending.set(i, resolve);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
    const js = async (expr) => {
      const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
      if (r.result?.exceptionDetails) {
        throw new Error(`js error: ${JSON.stringify(r.result.exceptionDetails).slice(0, 400)}`);
      }
      return r.result?.result?.value;
    };
    const t0 = Date.now();
    let prog = "";
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      prog = await js(`document.getElementById("prog").textContent`);
      if (prog === "done") break;
      if (Date.now() - t0 > timeoutMs) {
        const err = await js(`document.getElementById("err").textContent`);
        throw new Error(`render timeout prog=${prog} err=${err}`);
      }
    }
    const out = await js(`document.getElementById("out").textContent`);
    ws.close();
    return out;
  } finally {
    child.kill();
  }
}

// 16-bit PCM WAV 디코더 (우리 렌더러 출력 전용)
function decodeWav(buf) {
  const nCh = buf.readUInt16LE(22);
  const bits = buf.readUInt16LE(34);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || bits !== 16) throw new Error("bad wav");
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const sz = buf.readUInt32LE(pos + 4);
    if (id === "data") break;
    pos += 8 + sz;
  }
  pos += 8;
  const n = Math.floor((buf.length - pos) / (2 * nCh));
  const chs = Array.from({ length: nCh }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nCh; c++) {
      chs[c][i] = buf.readInt16LE(pos) / 0x8000;
      pos += 2;
    }
  }
  while (chs.length < 2) chs.push(chs[0]);
  return [chs[0], chs[1]];
}

await main();
