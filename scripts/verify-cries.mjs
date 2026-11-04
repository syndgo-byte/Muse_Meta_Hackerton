// scripts/verify-cries.mjs — G보강 검증 (1~9).
// 실행: node scripts/verify-cries.mjs (종료 코드만 본다).
// - 576 테이크 + 192 레거시(=_1 바이트 동일)
// - 길이 0.2~1.6초, 피크 -1dBFS 이하, 클리핑 0, 140Hz 아래 에너지 5% 미만
// - 종 사이 centroid 8% 규칙(90% 이상), call 규칙, 프로필 규칙(f0·파형·질감)
// - 4종 meet 파형·스펙트럼 PNG → scratch/cries/
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { MOODS, SR, peakOf, synthCry } from "./voice-synth.mjs";

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

// ---- radix-2 FFT ----
function fft(re, im) {
  const N = re.length;
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j], ui = im[i + j];
        const vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
        const vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ur + vr; im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

function spectrum(pcm, N = 4096) {
  let start = 0;
  if (pcm.length > N) {
    let bestE = -1;
    for (let s = 0; s + N <= pcm.length; s += 512) {
      let e = 0;
      for (let i = 0; i < N; i += 8) e += pcm[s + i] * pcm[s + i];
      if (e > bestE) { bestE = e; start = s; }
    }
  }
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const s = pcm[Math.min(pcm.length - 1, start + i)] || 0;
    re[i] = s * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  }
  fft(re, im);
  const mag = new Float64Array(N / 2);
  for (let k = 0; k < N / 2; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
  return mag;
}

function centroidOf(mag) {
  let num = 0, den = 0;
  for (let k = 1; k < mag.length; k++) {
    num += k * mag[k];
    den += mag[k];
  }
  return den > 0 ? (num / den) * (SR / (mag.length * 2)) : 0;
}

function sub140Of(mag) {
  const N = mag.length * 2;
  const kCut = Math.floor((140 * N) / SR);
  let sub = 0, tot = 0;
  for (let k = 1; k < mag.length; k++) {
    const e = mag[k] * mag[k];
    tot += e;
    if (k <= kCut) sub += e;
  }
  return tot > 0 ? sub / tot : 0;
}

// ---- 최소 PNG 기록 ----
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writePng(path, w, h, px) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      const c = px[y * w + x];
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2];
    }
  }
  const comp = deflateSync(raw);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", comp),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
}

function wavePng(pcm, path) {
  const W = 800, H = 240;
  const px = new Array(W * H).fill(0).map(() => [12, 18, 14]);
  for (let x = 0; x < W; x++) px[Math.floor(H / 2) * W + x] = [40, 60, 44];
  const per = pcm.length / W;
  for (let x = 0; x < W; x++) {
    let pk = 0;
    const s0 = Math.floor(x * per);
    const s1 = Math.max(s0 + 1, Math.floor((x + 1) * per));
    for (let i = s0; i < s1 && i < pcm.length; i++) pk = Math.max(pk, Math.abs(pcm[i]));
    const h = Math.min(H / 2 - 4, pk * (H / 2 - 4));
    for (let y = Math.floor(H / 2 - h); y <= Math.ceil(H / 2 + h); y++) {
      if (y >= 0 && y < H) px[y * W + x] = [159, 232, 112];
    }
  }
  writePng(path, W, H, px);
}

function specPng(mag, path) {
  const W = 800, H = 240;
  const px = new Array(W * H).fill(0).map(() => [12, 18, 14]);
  const N = mag.length * 2;
  const fMin = 100, fMax = SR / 2;
  let maxDb = -120;
  const colDb = new Float64Array(W).fill(-120);
  for (let x = 0; x < W; x++) {
    const f = fMin * Math.pow(fMax / fMin, x / W);
    const k = Math.max(1, Math.round((f * N) / SR));
    const db = 20 * Math.log10(mag[k] + 1e-9);
    colDb[x] = db;
    if (db > maxDb) maxDb = db;
  }
  for (let x = 0; x < W; x++) {
    const h = Math.max(0, Math.min(H - 8, ((colDb[x] - (maxDb - 80)) / 80) * (H - 8)));
    for (let y = H - 1; y >= H - 1 - h; y--) px[y * W + x] = [124, 199, 255];
  }
  writePng(path, W, H, px);
}

// ================= 검사 =================
const profiles = JSON.parse(readFileSync(join(ROOT, "lib", "voice", "profiles.json"), "utf8"));
const MOOD_NAMES = Object.keys(MOODS);
const PEAK_DB1 = Math.pow(10, -1 / 20); // -1dBFS

// 1. 파일 576 + 레거시 192(=_1).
{
  let takes = 0;
  const missing = [];
  for (const p of profiles) {
    for (const m of MOOD_NAMES) {
      for (let t = 1; t <= 3; t++) {
        if (existsSync(join(ROOT, "public", "cries", `${p.id}_${m}_${t}.mp3`))) takes++;
        else missing.push(`${p.id}_${m}_${t}`);
      }
    }
  }
  check("576 take files", takes === 576 && missing.length === 0, missing.slice(0, 3).join(","));
  let legacyOk = 0;
  for (const p of profiles) {
    for (const m of MOOD_NAMES) {
      const a = join(ROOT, "public", "cries", `${p.id}_${m}.mp3`);
      const b = join(ROOT, "public", "cries", `${p.id}_${m}_1.mp3`);
      if (existsSync(a) && existsSync(b) && readFileSync(a).equals(readFileSync(b))) legacyOk++;
    }
  }
  check("192 legacy == take1 bytes", legacyOk === 192, `${legacyOk}/192`);
}

// 2. 합성 속성 전수 (576).
const pcms = {};
{
  let shortBad = [];
  let longBad = [];
  let peakBad = [];
  let clipN = 0;
  let subBad = [];
  let worstSub = 0;
  let worstSubId = "";
  for (const p of profiles) {
    for (const m of MOOD_NAMES) {
      for (let t = 1; t <= 3; t++) {
        const key = `${p.id}_${m}_${t}`;
        const pcm = synthCry(p, m, t);
        pcms[key] = pcm;
        const sec = pcm.length / SR;
        if (sec < 0.2) shortBad.push(`${key}=${sec.toFixed(2)}`);
        if (sec > 1.6) longBad.push(`${key}=${sec.toFixed(2)}`);
        const pk = peakOf(pcm);
        if (pk > PEAK_DB1 + 1e-6) peakBad.push(`${key}=${pk.toFixed(3)}`);
        for (let i = 0; i < pcm.length; i += 7) {
          if (Math.abs(pcm[i]) >= 1.0) { clipN++; break; }
        }
        const sub = sub140Of(spectrum(pcm));
        if (sub > worstSub) { worstSub = sub; worstSubId = key; }
        if (sub >= 0.05) subBad.push(`${key}=${(sub * 100).toFixed(1)}%`);
      }
    }
  }
  console.log(`worst sub140 ${worstSubId} ${(worstSub * 100).toFixed(2)}%`);
  check("all >= 0.2s", shortBad.length === 0, shortBad.slice(0, 3).join(","));
  check("all <= 1.6s", longBad.length === 0, longBad.slice(0, 3).join(","));
  check("peak <= -1dBFS", peakBad.length === 0, peakBad.slice(0, 3).join(","));
  check("clipping 0", clipN === 0, `${clipN} files`);
  check("sub140 < 5%", subBad.length === 0, subBad.slice(0, 3).join(","));
  // 테이크가 서로 다름.
  let same = 0;
  for (const p of profiles) {
    for (const m of MOOD_NAMES) {
      const a = pcms[`${p.id}_${m}_1`];
      const b = pcms[`${p.id}_${m}_2`];
      const c = pcms[`${p.id}_${m}_3`];
      const eq = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
      if (eq(a, b) || eq(b, c) || eq(a, c)) same++;
    }
  }
  check("takes differ", same === 0, `${same} moods identical`);
}

// 3. centroid 8% 규칙 (take 1 대표).
{
  let total = 0;
  let distinct = 0;
  for (const m of MOOD_NAMES) {
    const cents = profiles.map((p) => centroidOf(spectrum(pcms[`${p.id}_${m}_1`])));
    for (let i = 0; i < cents.length; i++) {
      for (let j = i + 1; j < cents.length; j++) {
        const lo = Math.min(cents[i], cents[j]);
        const hi = Math.max(cents[i], cents[j]);
        total++;
        if (lo > 0 && hi / lo >= 1.08) distinct++;
      }
    }
  }
  const rate = distinct / total;
  console.log(`centroid 8%+: ${distinct}/${total} (${(rate * 100).toFixed(1)}%)`);
  check("centroid 8% in 90%+ pairs", rate >= 0.9, `${(rate * 100).toFixed(1)}%`);
}

// 4. call 규칙.
{
  const firsts = profiles.map((p) => `${p.call.syl[0].on}|${p.call.syl[0].v}`);
  check("24 first syllables unique", new Set(firsts).size === 24);
  const badLen = profiles.filter((p) => p.call.syl.length < 2 || p.call.syl.length > 3);
  check("call 2~3 syllables", badLen.length === 0, badLen.map((p) => p.id).join(","));
  const badCoda = [];
  for (const p of profiles) {
    for (const s of p.call.syl) {
      if (s.coda !== undefined && !["n", "ng", "m"].includes(s.coda)) badCoda.push(`${p.id}:${s.coda}`);
    }
  }
  check("coda n/ng/m only", badCoda.length === 0, badCoda.join(","));
  const tense = profiles.filter((p) => /(gg|dd|bb|ss|jj|zz)/.test(p.call.rom.replace(/ng/g, "")));
  check("no tense consonants", tense.length === 0, tense.map((p) => p.id).join(","));
}

// 5. 프로필 규칙 (7번).
{
  const lowF0 = profiles.filter((p) => p.f0 < 240);
  check("f0 >= 240Hz", lowF0.length === 0, lowF0.map((p) => `${p.id}=${p.f0}`).join(","));
  const rough = profiles.filter((p) => ["square", "saw", "saw-dark"].includes(p.wave));
  check("no rough waves", rough.length === 0, rough.map((p) => `${p.id}=${p.wave}`).join(","));
  const NOISE = new Set(["steam", "breath", "softbreath", "whisper", "wind", "flow", "rain", "leaves", "paper", "click", "drop", "crackle-hi", "blip-hi", "tick-hi", "grit-hi"]);
  const loud = profiles.filter((p) => NOISE.has(p.texture.kind) && p.texture.mix > 0.05);
  check("noise texture <= 0.05", loud.length === 0, loud.map((p) => p.id).join(","));
  const lowTex = profiles.filter((p) =>
    ["knock-wood", "knock-stone", "gravel", "rattle", "bubble", "bubburst", "puff-start", "crackle", "motor"].includes(p.texture.kind));
  check("no low textures", lowTex.length === 0, lowTex.map((p) => `${p.id}=${p.texture.kind}`).join(","));
}

// 6. cry.ts 재생 규격 (소스 검사).
{
  const src = readFileSync(join(ROOT, "lib", "cry.ts"), "utf8");
  check("cry takes+rate+volume+10k",
    src.includes("_${pickTake()}") && src.includes("playbackRate") &&
    src.includes("preservesPitch") && src.includes("0.6") &&
    src.includes("10000") && !src.includes("5000") && !src.includes("2400"));
}

// 6b. G보강 2차 클릭 회귀 (scratch/voice-clicks.mjs와 동일 검출기, take 1).
{
  const W = Math.floor(0.002 * 44100);
  const clicks = (pcm) => {
    const hp = new Float32Array(pcm.length);
    for (let i = 1; i < pcm.length; i++) hp[i] = pcm[i] - pcm[i - 1];
    const e = [];
    for (let i = 0; i + W < hp.length; i += W) { let s = 0; for (let j = 0; j < W; j++) s += hp[i + j] ** 2; e.push(s); }
    let c = 0, last = -99;
    for (let k = 15; k < e.length - 15; k++) {
      const nb = [...e.slice(k - 15, k - 1), ...e.slice(k + 2, k + 15)].sort((a, b) => a - b);
      const med = nb[nb.length >> 1] + 1e-9;
      if (e[k] > 8 * med && e[k] > 0.02 && k - last > 5) { c++; last = k; }
    }
    return c;
  };
  let nonAttack = 0, attackBad = 0, total = 0;
  for (const p of profiles) {
    for (const m of MOOD_NAMES) {
      const n = clicks(pcms[`${p.id}_${m}_1`]);
      total += n;
      if (m === "attack") { if (n > 1) attackBad++; }
      else nonAttack += n;
    }
  }
  check("clicks non-attack 0", nonAttack === 0, String(nonAttack));
  check("clicks attack<=1", attackBad === 0, String(attackBad));
  check("clicks total<=24", total <= 24, String(total));
}

// 7. PNG 8장.
{
  const dir = join(ROOT, "scratch", "cries");
  mkdirSync(dir, { recursive: true });
  for (const id of ["fire-01", "grass-04", "water-05", "rock-01"]) {
    const pcm = pcms[`${id}_meet_1`];
    wavePng(pcm, join(dir, `${id}_meet_wave.png`));
    specPng(spectrum(pcm), join(dir, `${id}_meet_spec.png`));
  }
  check("8 png written", ["fire-01", "grass-04", "water-05", "rock-01"].every((id) =>
    existsSync(join(dir, `${id}_meet_wave.png`)) && existsSync(join(dir, `${id}_meet_spec.png`))));
}

if (failures > 0) {
  console.log(`verify-cries: FAIL (${failures} failed, ${passes} passed)`);
  process.exit(1);
} else {
  console.log(`verify-cries: PASS (${passes}/${passes})`);
}
