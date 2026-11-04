// scripts/bgm-render.mjs — lib/bgm.ts 스코어를 오프라인 렌더링해 WAV로.
// verify-bgm.mjs가 import해서 쓰고, 직접 실행해도 scratch/bgm/*.wav를 만든다.
// node scripts/bgm-render.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SR = 22050;

export function loadBgm() {
  const build = mkdtempSync(join(tmpdir(), "bgm-"));
  const req = createRequire(join(ROOT, "package.json"));
  execFileSync(
    process.execPath,
    [
      join(ROOT, "node_modules", "typescript", "bin", "tsc"),
      "--outDir", build,
      "--rootDir", join(ROOT, "lib"),
      "--module", "commonjs",
      "--target", "es2021",
      "--moduleResolution", "node",
      "--skipLibCheck",
      "lib/bgm.ts",
    ],
    { cwd: ROOT, stdio: "inherit" }
  );
  const mod = req(join(build, "bgm.js"));
  return { mod, cleanup: () => rmSync(build, { recursive: true, force: true }) };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 간단 바이쿼드 (렌더 전용).
function biquad(x, type, fc, Q = 1) {
  const w0 = (2 * Math.PI * fc) / SR;
  const alpha = Math.sin(w0) / (2 * Q);
  const cw = Math.cos(w0);
  let b0, b1, b2, a0, a1, a2;
  if (type === "lowpass") {
    b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2;
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  } else if (type === "highpass") {
    b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2;
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  } else {
    b0 = alpha; b1 = 0; b2 = -alpha;
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  }
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i];
    const y0 = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    y[i] = y0;
  }
  return y;
}

function renderScore(score, seconds, seed) {
  const out = new Float32Array(Math.floor(seconds * SR));
  const rng = mulberry32(seed);
  const add = (at, buf) => {
    const s0 = Math.floor(at * SR);
    for (let i = 0; i < buf.length && s0 + i < out.length; i++) out[s0 + i] += buf[i];
  };
  const loop = score.seconds;
  for (let rep = 0; rep * loop < seconds; rep++) {
    const off = rep * loop;
    for (const ev of score.events) {
      const t = off + ev.t;
      if (t >= seconds) continue;
      if (ev.kind === "kick") {
        const n = Math.floor(0.14 * SR);
        const b = new Float32Array(n);
        let ph = 0;
        for (let i = 0; i < n; i++) {
          const k = i / SR;
          const f = 150 * Math.pow(50 / 150, Math.min(1, k / 0.12));
          ph += (2 * Math.PI * f) / SR;
          const env = Math.exp(-k * 30) * Math.min(1, k / 0.004);
          b[i] = Math.sin(ph) * env * 1.0;
        }
        add(t, b);
      } else if (ev.kind === "snare" || ev.kind === "hat") {
        const dur = ev.kind === "snare" ? 0.1 : 0.03;
        const n = Math.floor((dur + 0.02) * SR);
        const w = new Float32Array(n);
        for (let i = 0; i < n; i++) w[i] = rng() * 2 - 1;
        const f = ev.kind === "snare"
          ? biquad(w, "bandpass", 1800, 1)
          : biquad(w, "highpass", 7000, 0.7);
        const peak = ev.kind === "snare" ? 0.5 : ev.accent ? 0.28 : 0.2;
        for (let i = 0; i < n; i++) {
          const k = i / SR;
          f[i] *= peak * Math.exp(-k * (ev.kind === "snare" ? 45 : 150)) * Math.min(1, k / 0.002);
        }
        add(t, f);
      } else if (ev.kind === "bass" || ev.kind === "arp" || ev.kind === "hook") {
        const n = Math.floor((ev.dur + 0.02) * SR);
        const b = new Float32Array(n);
        if (ev.kind === "bass") {
          let ph = 0;
          for (let i = 0; i < n; i++) {
            ph += (2 * Math.PI * ev.f) / SR;
            b[i] = (ph % (2 * Math.PI)) < Math.PI ? 1 : -1;
          }
          const lp = biquad(b, "lowpass", 600, 0.7);
          for (let i = 0; i < n; i++) {
            const k = i / SR;
            b[i] = lp[i] * 0.6 * Math.exp(-k * 3) * Math.min(1, k / 0.008);
          }
        } else if (ev.kind === "arp") {
          let ph = 0;
          for (let i = 0; i < n; i++) {
            ph += (2 * Math.PI * ev.f) / SR;
            b[i] = (ph % (2 * Math.PI)) < Math.PI * 0.5 ? 1 : -1; // 25% 펄스
          }
          const lp = biquad(b, "lowpass", 3000, 0.7);
          for (let i = 0; i < n; i++) {
            const k = i / SR;
            b[i] = lp[i] * 0.35 * Math.exp(-k * 12) * Math.min(1, k / 0.005);
          }
        } else {
          for (let i = 0; i < n; i++) {
            const k = i / SR;
            const tri = 2 * Math.abs(2 * ((ev.f * k) % 1) - 1) - 1;
            b[i] = (Math.sin(2 * Math.PI * ev.f * k) * 0.3 + tri * 0.2) *
              Math.exp(-k * 4) * Math.min(1, k / 0.01);
          }
        }
        add(t, b);
      } else if (ev.kind === "pad") {
        const n = Math.floor((ev.dur + 0.05) * SR);
        const b = new Float32Array(n);
        for (const f of ev.freqs) {
          for (let i = 0; i < n; i++) {
            const k = i / SR;
            const tri = 2 * Math.abs(2 * ((f * k) % 1) - 1) - 1;
            b[i] += tri;
          }
        }
        const lp = biquad(b, "lowpass", 900, 0.7);
        const atk = Math.min(1.2, ev.dur / 2);
        for (let i = 0; i < n; i++) {
          const k = i / SR;
          const a = Math.min(1, k / atk);
          const r = k > ev.dur ? Math.max(0, 1 - (k - ev.dur) / 0.05) : 1;
          b[i] = lp[i] * 0.3 * a * r;
        }
        add(t, b);
      }
    }
  }
  // master 0.05 (정규화 없음 — 마스킹 비교용 정직 레벨) + 끝 페이드.
  for (let i = 0; i < out.length; i++) out[i] *= 0.05;
  const fade = Math.floor(0.3 * SR);
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  let peak = 0, sum = 0, cnt = 0;
  for (let i = Math.floor(4 * SR); i < Math.floor(12 * SR) && i < out.length; i++) {
    peak = Math.max(peak, Math.abs(out[i]));
    sum += out[i] * out[i];
    cnt++;
  }
  return { pcm: out, peak, rms: Math.sqrt(sum / Math.max(1, cnt)) };
}

function writeWav(path, pcm) {
  const n = pcm.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    buf.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7fff, 44 + i * 2);
  }
  writeFileSync(path, buf);
}

export function renderAll() {
  const { mod, cleanup } = loadBgm();
  try {
    const dir = join(ROOT, "scratch", "bgm");
    mkdirSync(dir, { recursive: true });
    const main = renderScore(mod.buildScore("main"), 16.0, 11);
    const ar = renderScore(mod.buildScore("ar"), 16.0, 22);
    writeWav(join(dir, "main.wav"), main.pcm);
    writeWav(join(dir, "ar.wav"), ar.pcm);
    console.log(`bgm main peak=${main.peak.toFixed(4)} rms=${main.rms.toFixed(5)}`);
    console.log(`bgm ar peak=${ar.peak.toFixed(4)} rms=${ar.rms.toFixed(5)}`);
    return { main, ar };
  } finally {
    cleanup();
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) renderAll();
