// scripts/voice-synth.mjs — D8/G보강 공용 절차적 보이스 신스.
// generate-cries.mjs(에셋 생성)와 verify-cries.mjs(속성 검사)가 함께 쓴다.
// 결정적: 같은 (프로필, 감정, 테이크)은 항상 같은 PCM을 낸다 (시드 RNG).
// 합성 순서: 자음 시작음 → 파형(+FM) → 음절별 포먼트 → 변조 → 질감 → 마스터(HP·리버브·코러스·셸프) → 정규화.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

export const SR = 22050;
export const MAX_SEC = 1.6;
export const MIN_SEC = 0.2;

// 감정 리듬 (want·hungry·eat가 재사용. 음정은 0.7~2.0으로 클램프).
// {d:초, a:시작배율, b:끝배율, c?:중간배율, v:볼륨, vib, vibD, gap:뒤쉼}
export const MOODS = {
  meet:   [{ d: 0.16, a: 1.0, b: 1.5, v: 0.8, gap: 0.05 }, { d: 0.22, a: 1.1, b: 1.6, v: 0.8, vib: 7, vibD: 0.04 }],
  happy:  [{ d: 0.12, a: 1.0, b: 1.4, v: 0.8, gap: 0.04 }, { d: 0.12, a: 1.15, b: 1.6, v: 0.8, gap: 0.04 }, { d: 0.18, a: 1.3, b: 1.8, v: 0.85, vib: 8, vibD: 0.05 }],
  want:   [{ d: 0.2, a: 1.3, b: 0.9, v: 0.75, vib: 9, vibD: 0.08, gap: 0.06 }, { d: 0.2, a: 1.35, b: 0.95, v: 0.75, vib: 9, vibD: 0.08, gap: 0.06 }, { d: 0.28, a: 1.4, b: 1.0, v: 0.85, vib: 10, vibD: 0.09 }],
  hungry: [{ d: 0.35, a: 0.8, b: 0.6, v: 0.5, vib: 5, vibD: 0.05, gap: 0.12 }, { d: 0.3, a: 0.75, b: 0.55, v: 0.45, vib: 5, vibD: 0.05 }],
  cry:    [{ d: 0.5, a: 1.2, b: 0.6, v: 0.85, vib: 8, vibD: 0.12, gap: 0.08 }, { d: 0.25, a: 1.0, b: 0.7, v: 0.7, vib: 9, vibD: 0.1 }],
  eat:    [0, 1, 2, 3, 4, 5].map((i) => ({ d: 0.07, a: 1.1 - i * 0.03, b: 0.9, v: 0.8, gap: 0.05 })),
  attack: [{ d: 0.1, a: 0.9, b: 1.5, v: 1.0, gap: 0.03 }, { d: 0.2, a: 1.2, b: 1.7, v: 0.9, vib: 11, vibD: 0.04 }],
  sleep:  [{ d: 0.5, a: 0.6, b: 0.65, v: 0.35, vib: 2, vibD: 0.03, gap: 0.2 }, { d: 0.5, a: 0.58, b: 0.63, v: 0.32, vib: 2, vibD: 0.03 }],
};

export const VOWEL_F = { a: 900, o: 600, u: 400, i: 2200, e: 1700 };

// ---- 결정적 RNG ----
export function hashSeed(str) {
  let h = 2166136261;
  for (const ch of str) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- 파형 ----
export function wavePartials(wave) {
  switch (wave) {
    case "sine": return { ratios: [1], amps: [1], bell: false, dark: false, mellow: false };
    case "tri": return { ratios: [1, 3, 5, 7], amps: [1, -0.111, 0.04, -0.02], bell: false, dark: false, mellow: false };
    case "saw": return { ratios: [1, 2, 3, 4, 5, 6], amps: [1, 0.5, 0.33, 0.25, 0.2, 0.12], bell: false, dark: false, mellow: false };
    case "saw-soft": return { ratios: [1, 2, 3, 4, 5], amps: [1, 0.4, 0.28, 0.18, 0.1], bell: false, dark: false, mellow: false };
    case "saw-dark": return { ratios: [1, 2, 3, 4, 5, 6], amps: [1, 0.5, 0.33, 0.25, 0.2, 0.12], bell: false, dark: true, mellow: false };
    case "square": return { ratios: [1, 3, 5, 7], amps: [1, 0.33, 0.2, 0.14], bell: false, dark: false, mellow: false };
    case "bell": return { ratios: [1, 2.01, 2.74, 3.76, 5.4], amps: [1, 0.5, 0.3, 0.2, 0.1], bell: true, dark: false, mellow: false };
    case "mellow": return { ratios: [1, 2, 3], amps: [1, 0.22, 0.1], bell: false, dark: false, mellow: true };
    default: return { ratios: [1], amps: [1], bell: false, dark: false, mellow: false };
  }
}

// ---- 감정 프로그램 (call 음절 기반, 음정 0.7~2.0) ----
function S(d, a, b, v, gap = 0, extra = {}) {
  return { d, a, b, v, gap, ...extra };
}

function clampPitch(x) {
  return Math.max(0.7, Math.min(2.0, x));
}

// 테이크 변형: 음절 길이 ±12%, 30% 확률로 중간 음절 하나 반복.
function takeVary(prog, rng) {
  const out = prog.map((s) => ({ ...s, d: s.d * (1 + (rng() * 2 - 1) * 0.12) }));
  if (out.length >= 2 && rng() < 0.3) {
    const at = Math.floor(rng() * (out.length - 1));
    out.splice(at + 1, 0, { ...out[at], d: out[at].d * 0.7, gap: 0.03 });
  }
  return out;
}

export function buildProgram(profile, mood, take, rng) {
  const call = profile.call.syl;
  const last = call[call.length - 1];
  const withPhone = (list) => list.map((s, i) => ({ ...s, phone: call[i % call.length] }));
  let prog;
  switch (mood) {
    case "meet": {
      prog = call.map((ph, i) => {
        const isLast = i === call.length - 1;
        return { ...S(isLast ? 0.2 : 0.13, 1.0, isLast ? 1.8 : 1.05, isLast ? 0.9 : 0.8, isLast ? 0 : 0.05), phone: ph };
      });
      break;
    }
    case "happy": {
      const front = call.slice(0, -1);
      const seq = [...front, ...call];
      prog = seq.map((ph, i) => {
        const isLast = i === seq.length - 1;
        return { ...S(isLast ? 0.2 : 0.11, isLast ? 1.1 : 1.0, isLast ? 1.8 : 1.2, isLast ? 0.9 : 0.85, isLast ? 0 : 0.04), phone: ph };
      });
      break;
    }
    case "attack": {
      prog = [{ ...S(0.09, 1.2, 1.5, 1.0), phone: last }];
      break;
    }
    case "cry": {
      prog = call.map((ph, i) => {
        const a = clampPitch(1.2 - i * 0.15);
        return { ...S(0.3, a, clampPitch(a - 0.15), 0.8, 0.08), phone: ph };
      });
      break;
    }
    case "sleep": {
      prog = [{ ...S(0.25, 0.9, 0.7, 0.35), phone: call[0] }];
      break;
    }
    default: {
      // want·hungry·eat: 기존 리듬 + call 음절 순환.
      const base = MOODS[mood] ?? MOODS.want;
      prog = base.map((s, i) => ({
        ...S(s.d, clampPitch(s.a), clampPitch(s.b), s.v, s.gap ?? 0, s.c !== undefined ? { c: clampPitch(s.c) } : {}),
        ...(s.vib ? { vib: s.vib, vibD: s.vibD } : {}),
        phone: call[i % call.length],
      }));
    }
  }
  // 속도 적용 + 테이크 변형.
  const scaled = prog.map((s) => ({ ...s, d: s.d * (profile.rate || 1) }));
  void take;
  return takeVary(scaled, rng);
}

// ---- 필터 (RBJ 바이쿼드) ----
function biquadLP(x, fc, Q = 0.7) {
  const w0 = (2 * Math.PI * fc) / SR;
  const alpha = Math.sin(w0) / (2 * Q);
  const b0 = (1 - Math.cos(w0)) / 2;
  const b1 = 1 - Math.cos(w0);
  const b2 = (1 - Math.cos(w0)) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * Math.cos(w0);
  const a2 = 1 - alpha;
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

function biquadHP(x, fc, Q = 0.7) {
  const w0 = (2 * Math.PI * fc) / SR;
  const alpha = Math.sin(w0) / (2 * Q);
  const b0 = (1 + Math.cos(w0)) / 2;
  const b1 = -(1 + Math.cos(w0));
  const b2 = (1 + Math.cos(w0)) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * Math.cos(w0);
  const a2 = 1 - alpha;
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

function highShelf(x, fc = 6000, db = 2.5) {
  const A = Math.pow(10, db / 40);
  const w0 = (2 * Math.PI * fc) / SR;
  const alpha = Math.sin(w0) / 2 * Math.sqrt(2);
  const cw = Math.cos(w0);
  const b0 = A * (A + 1 + (A - 1) * cw + 2 * Math.sqrt(A) * alpha);
  const b1 = -2 * A * (A - 1 + (A + 1) * cw);
  const b2 = A * (A + 1 + (A - 1) * cw - 2 * Math.sqrt(A) * alpha);
  const a0 = A + 1 - (A - 1) * cw + 2 * Math.sqrt(A) * alpha;
  const a1 = 2 * (A - 1 - (A + 1) * cw);
  const a2 = A + 1 - (A - 1) * cw - 2 * Math.sqrt(A) * alpha;
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

// 구간별 중심이 바뀌는 밴드패스 (상태 이어서 클릭 방지).
function bandpassTracked(x, segs, Q) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  let si = 0;
  let fc = segs[0]?.fc ?? 800;
  const setCoef = () => {
    const w0 = (2 * Math.PI * Math.min(fc, SR * 0.45)) / SR;
    const alpha = Math.sin(w0) / (2 * Q);
    return {
      b0: alpha, b1: 0, b2: -alpha,
      a0: 1 + alpha, a1: -2 * Math.cos(w0), a2: 1 - alpha,
    };
  };
  let c = setCoef();
  for (let i = 0; i < x.length; i++) {
    while (si < segs.length - 1 && i >= segs[si + 1].start) {
      si++;
      fc = segs[si].fc;
      c = setCoef();
    }
    const x0 = x[i];
    const y0 = (c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2) / c.a0;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    y[i] = y0;
  }
  return y;
}

// ---- 자음 시작음 ----
// 파열음: 노이즈 버스트(ms) + 무음. 마찰음: 대역 노이즈. 비음·유음·활음: 허밍·공명.
const PLOSIVE_MS = { p: 5, t: 8, k: 12, b: 4, d: 6, g: 9 };
const VOICED = new Set(["b", "d", "g"]);

function renderOnset(out, pos, on, f0, rng) {
  if (!on) return 0;
  const ms2n = (ms) => Math.floor((ms / 1000) * SR);
  if (PLOSIVE_MS[on] !== undefined) {
    const nb = ms2n(PLOSIVE_MS[on]);
    const soft = VOICED.has(on) ? 0.5 : 1;
    softBurst(out, pos, nb, 0.32 * soft, 1800, rng);
    const gap = ms2n(VOICED.has(on) ? 30 : 20);
    if (VOICED.has(on)) {
      // 유성음: 무음 대신 낮은 허밍.
      for (let i = 0; i < gap && pos + nb + i < out.length; i++) {
        const t = i / SR;
        out[pos + nb + i] += (Math.sin(2 * Math.PI * (f0 / 2) * t) * 0.5 + Math.sin(2 * Math.PI * f0 * t) * 0.3) * 0.3;
      }
    }
    return nb + gap;
  }
  if (on === "s" || on === "sh" || on === "ch" || on === "f" || on === "h") {
    let n = ms2n(on === "sh" || on === "ch" ? 50 : on === "s" || on === "f" ? 40 : 30);
    let start = 0;
    if (on === "ch") {
      // 파찰음: t 버스트 + sh.
      const nb = ms2n(6);
      softBurst(out, pos, nb, 0.28, 2200, rng);
      start = nb;
    }
    const w = new Float32Array(n);
    for (let i = 0; i < n; i++) w[i] = rng() * 2 - 1;
    let y = w;
    if (on === "s") y = biquadHP(w, 4000);
    else if (on === "sh" || on === "ch") y = biquadLP(biquadHP(w, 2500), 6000);
    else if (on === "f") y = biquadLP(biquadHP(w, 1500), 5000);
    else if (on === "h") y = biquadLP(biquadHP(w, 2000), 6000);
    else y = biquadLP(w, 8000);
    const fa = Math.min(n, Math.floor(0.015 * SR));
    for (let i = 0; i < n && pos + start + i < out.length; i++) {
      const atk = i < fa ? 0.5 - 0.5 * Math.cos((Math.PI * i) / Math.max(1, fa)) : 1;
      const env = Math.sin((Math.PI * (i + 1)) / (n + 1)) * atk;
      out[pos + start + i] += y[i] * 0.18 * env;
    }
    return start + n;
  }
  if (on === "m" || on === "n") {
    const n = ms2n(70);
    for (let i = 0; i < n && pos + i < out.length; i++) {
      const t = i / SR;
      const env = Math.min(1, (i + 1) / (n * 0.3));
      out[pos + i] += (Math.sin(2 * Math.PI * f0 * t) * 0.6 + Math.sin(2 * Math.PI * (f0 / 2) * t) * 0.4) * 0.35 * env;
    }
    return n;
  }
  if (on === "l") {
    const n = ms2n(40);
    for (let i = 0; i < n && pos + i < out.length; i++) {
      const t = i / SR;
      out[pos + i] += (Math.sin(2 * Math.PI * f0 * t) * 0.5 + Math.sin(2 * Math.PI * 1500 * t) * 0.2) * 0.3;
    }
    return n;
  }
  if (on === "r") {
    const n = ms2n(45);
    for (let i = 0; i < n && pos + i < out.length; i++) {
      const t = i / SR;
      const tap = 0.5 + 0.5 * Math.sin((2 * Math.PI * 3 * i) / n);
      out[pos + i] += Math.sin(2 * Math.PI * f0 * 0.9 * t) * 0.3 * tap;
    }
    return n;
  }
  if (on === "w" || on === "y") {
    // 활음: 짧은 글라이드 허밍.
    const n = ms2n(40);
    const fStart = on === "w" ? 300 : 1800;
    const fEnd = on === "w" ? 500 : 1200;
    let phase = 0;
    for (let i = 0; i < n && pos + i < out.length; i++) {
      const k = i / n;
      phase += (2 * Math.PI * (fStart + (fEnd - fStart) * k)) / SR;
      out[pos + i] += Math.sin(phase) * 0.25 * Math.sin((Math.PI * i) / n);
    }
    return n;
  }
  return 0;
}

function renderCoda(out, pos, coda, f0) {
  if (!coda) return 0;
  const n = Math.floor(0.04 * SR);
  const low = coda === "ng" ? 0.4 : 0.5;
  for (let i = 0; i < n && pos + i < out.length; i++) {
    const t = i / SR;
    const env = 1 - i / n;
    out[pos + i] += (Math.sin(2 * Math.PI * f0 * 0.9 * t) * 0.5 + Math.sin(2 * Math.PI * f0 * low * t) * 0.4) * 0.3 * env;
  }
  return n;
}

// ---- 음절 렌더 (자음 + 모음 + 끝소리) ----
// G보강 2차: 자음을 모음 어택에 오버랩 (동시조음). 고립 트랜지언트 제거.
function renderSyllable(out, pos, syl, f0, ctx) {
  renderOnset(out, pos, syl.phone?.on ?? "", f0, ctx.rng);
  let p = pos;
  const n = Math.max(16, Math.floor(syl.d * SR));
  const atk = ctx.attack3 ? Math.floor(0.003 * SR) : Math.min(Math.floor(0.01 * SR), Math.floor(n * 0.2));
  const rel = ctx.chop ? Math.floor(0.008 * SR) : Math.min(Math.floor(0.06 * SR), Math.floor(n * 0.3));
  const { ratios, amps, bell } = ctx.partials;
  const phases = ratios.map(() => ctx.rng() * 2 * Math.PI);
  const vibHz = syl.vib ?? ctx.vibHz;
  const vibD = syl.vibD ?? ctx.vibDepth;
  let lfoA = ctx.rng() * 2 - 1, lfoB = ctx.rng() * 2 - 1;
  const lfoN = Math.max(8, Math.floor(SR / Math.max(1, vibHz || 5)));
  for (let i = 0; i < n && p + i < out.length; i++) {
    const k = i / n;
    const fm = syl.c !== undefined
      ? (syl.a * (1 - k) * (1 - k) + 2 * syl.c * (1 - k) * k + syl.b * k * k)
      : syl.a + (syl.b - syl.a) * k;
    let fr = f0 * fm;
    if (vibHz > 0 && vibD > 0) {
      if (ctx.vibIrregular) {
        const li = i % lfoN;
        if (li === 0 && i > 0) { lfoA = lfoB; lfoB = ctx.rng() * 2 - 1; }
        fr *= 1 + vibD * (lfoA + (lfoB - lfoA) * (li / lfoN));
      } else {
        fr *= 1 + vibD * Math.sin((2 * Math.PI * vibHz * i) / SR);
      }
    }
    const t = i / SR;
    let s = 0;
    for (let q = 0; q < ratios.length; q++) {
      phases[q] += (2 * Math.PI * fr * ratios[q]) / SR;
      let a = amps[q];
      if (bell) a *= Math.exp((-t * (2 + q * 3)) / Math.max(0.05, syl.d));
      s += a * Math.sin(phases[q]);
    }
    if (ctx.amHz > 0) s *= 1 - ctx.amDepth * 0.5 * (1 + Math.sin((2 * Math.PI * ctx.amHz * (p + i)) / SR));
    if (ctx.rasp) {
      s *= 1 - 0.5 * 0.5 * (1 + Math.sin((2 * Math.PI * 40 * (p + i)) / SR));
      s += (ctx.rng() * 2 - 1) * 0.04;
    }
    if (ctx.shimmer) {
      const sh = Math.sin((2 * Math.PI * fr * 2.005 * i) / SR + 1.3);
      s += sh * 0.06 * (0.5 + 0.5 * Math.sin((2 * Math.PI * 3 * i) / SR));
    }
    let env = 1;
    if (i < atk) env = 0.5 - 0.5 * Math.cos((Math.PI * i) / Math.max(1, atk));
    else if (i >= n - rel) env = (n - 1 - i) / Math.max(1, rel);
    out[p + i] += s * syl.v * env * 0.5;
  }
  p += n;
  p += renderCoda(out, p, syl.phone?.coda ?? "", f0);
  return p - pos;
}

// ---- 질감 ----
function noiseBed(n, rng, shape, fadeMs = 5) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = rng() * 2 - 1;
  let y = w;
  if (shape.hp) y = biquadHP(y, shape.hp);
  if (shape.lp) y = biquadLP(y, shape.lp);
  if (shape.swellHz) {
    for (let i = 0; i < n; i++) {
      y[i] *= 0.45 + 0.55 * (0.5 + 0.5 * Math.sin((2 * Math.PI * shape.swellHz * i) / SR + 1));
    }
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(y[i]));
  const g = peak > 0 ? shape.level / peak : 0;
  const fe = Math.min(n >> 1, Math.floor((fadeMs / 1000) * SR));
  for (let i = 0; i < n; i++) {
    let f = 1;
    if (i < fe) f = 0.5 - 0.5 * Math.cos((Math.PI * i) / Math.max(1, fe));
    else if (i >= n - fe) f = 0.5 - 0.5 * Math.cos((Math.PI * (n - 1 - i)) / Math.max(1, fe));
    y[i] *= g * f;
  }
  return y;
}

function addPing(out, at, freq, dur, level, rng) {
  const n = Math.floor(dur * SR);
  const ar = Math.min(n, Math.floor(0.002 * SR));
  let phase = 0;
  for (let i = 0; i < n && at + i < out.length; i++) {
    phase += (2 * Math.PI * freq) / SR;
    const atk = i < ar ? 0.5 - 0.5 * Math.cos((Math.PI * i) / Math.max(1, ar)) : 1;
    const env = Math.exp((-i / n) * 6) * atk;
    out[at + i] += Math.sin(phase) * level * env;
  }
}

function addBloop(out, at, f0a, f0b, dur, level) {
  const n = Math.floor(dur * SR);
  let phase = 0;
  for (let i = 0; i < n && at + i < out.length; i++) {
    const k = i / n;
    phase += (2 * Math.PI * (f0a + (f0b - f0a) * k)) / SR;
    const env = Math.sin(Math.PI * Math.min(1, k * 1.1));
    out[at + i] += Math.sin(phase) * level * env;
  }
}

// 부드러운 버스트: LP 노이즈 + raised-cosine 어택 (클릭 방지).
function softBurst(out, pos, n, level, lpFc, rng) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = rng() * 2 - 1;
  const y = biquadLP(w, lpFc);
  const ar = Math.min(n, Math.floor(0.0015 * SR));
  for (let i = 0; i < n && pos + i < out.length; i++) {
    const atk = i < ar ? 0.5 - 0.5 * Math.cos((Math.PI * i) / Math.max(1, ar)) : 1;
    out[pos + i] += y[i] * level * (1 - i / n) * atk;
  }
}

function addClick(out, at, level, rng) {
  const n = Math.floor(0.006 * SR);
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = rng() * 2 - 1;
  const y = biquadLP(w, 1500);
  const ar = Math.min(n, Math.floor(0.002 * SR));
  let phase = 0;
  for (let i = 0; i < n && at + i < out.length; i++) {
    phase += (2 * Math.PI * 700) / SR;
    const atk = i < ar ? 0.5 - 0.5 * Math.cos((Math.PI * i) / Math.max(1, ar)) : 1;
    const env = (1 - i / n) * atk;
    out[at + i] += (Math.sin(phase) * 0.7 + y[i] * 0.5) * level * 0.4 * env;
  }
}

// 7번 개편: 저음 질감은 고역으로 옮기거나 제거. 노이즈 mix ≤ 0.05.
function applyTexture(out, start, end, kind, mix, rng, onsets) {
  if (kind === "none" || mix <= 0) return;
  const level = mix * 2;
  const n = end - start;
  const bed = (shape) => {
    const y = noiseBed(n, rng, { ...shape, level });
    for (let i = 0; i < n; i++) out[start + i] += y[i];
  };
  switch (kind) {
    case "steam": bed({ hp: 4000 }); break;
    case "breath": bed({ lp: 800, swellHz: 0.3 }); break;
    case "softbreath": bed({ lp: 600, swellHz: 0.2 }); break;
    case "whisper": bed({ hp: 2000, lp: 5200 }); break;
    case "wind": bed({ lp: 500, swellHz: 0.15 }); break;
    case "flow": bed({ hp: 400, lp: 1600 }); break;
    case "rain": bed({ hp: 5000 }); break;
    case "crackle-hi": {
      const step = 64;
      for (let i = 0; i < n; i += step) {
        if (rng() < 0.03) addPing(out, start + i, 2600 + rng() * 2500, 0.015, level * 0.25, rng);
      }
      break;
    }
    case "blip-hi":
      for (let b = 0; b < 4; b++) {
        const at = start + Math.floor(rng() * Math.max(1, n - SR * 0.1));
        addBloop(out, at, 800 + rng() * 300, 1400 + rng() * 400, 0.06, level * 0.3);
      }
      break;
    case "tick-hi":
      for (const o of onsets) {
        addPing(out, start + o, 1200, 0.025, level * 0.35, rng);
        addClick(out, start + o, level * 0.25, rng);
      }
      break;
    case "grit-hi":
      for (const o of onsets) {
        const sw = noiseBed(Math.floor(0.06 * SR), rng, { hp: 3000, lp: 7000, level: level * 0.4 });
        for (let i = 0; i < sw.length && start + o + i < out.length; i++) {
          out[start + o + i] += sw[i] * (0.6 + 0.4 * Math.sin((2 * Math.PI * 8 * i) / SR));
        }
      }
      break;
    case "leaves":
      for (const o of onsets) {
        const sw = noiseBed(Math.floor(0.06 * SR), rng, { hp: 1200, lp: 4500, level: level * 0.6 });
        for (let i = 0; i < sw.length && start + o + i < out.length; i++) out[start + o + i] += sw[i];
      }
      break;
    case "paper":
      for (const o of onsets) {
        const sw = noiseBed(Math.floor(0.05 * SR), rng, { hp: 2500, lp: 7000, level: level * 0.6 });
        for (let i = 0; i < sw.length && start + o + i < out.length; i++) out[start + o + i] += sw[i];
      }
      break;
    case "click":
      for (const o of onsets) {
        addClick(out, start + o, level * 0.5, rng);
        addClick(out, start + o + Math.floor(0.03 * SR), level * 0.3, rng);
      }
      break;
    case "drop":
      addBloop(out, start + Math.floor(n * 0.4), 900, 350, 0.05, level * 0.6);
      addBloop(out, start + Math.floor(n * 0.4) + Math.floor(0.05 * SR), 350, 700, 0.05, level * 0.5);
      break;
    case "echo": {
      const D = Math.floor(0.12 * SR);
      for (let i = 0; i + D < out.length && start + i < end; i++) {
        out[start + i + D] += out[start + i] * Math.min(0.5, mix);
      }
      break;
    }
    default: break;
  }
}

// ---- 종 전용 후처리 ----
function applyPost(out, used, post, mood, rng) {
  let end = used;
  const room = out.length - end;
  if (post.includes("pop-end") && room > SR * 0.15) {
    addBloop(out, end, 550, 220, 0.09, 0.5);
    addClick(out, end, 0.2, rng);
    end += Math.floor(0.1 * SR);
  }
  if (post.includes("resonance")) {
    for (const [ms, g] of [[60, 0.25], [120, 0.12]]) {
      const D = Math.floor((ms / 1000) * SR);
      for (let i = 0; i < D && end + i < out.length; i++) {
        out[end + i] += (out[Math.max(0, end - D + i)] || 0) * g;
      }
    }
    end = Math.min(out.length, end + Math.floor(0.12 * SR));
  }
  if (post.includes("sneeze-happy") && mood === "happy" && room > SR * 0.3) {
    addBloop(out, end, 300, 950, 0.12, 0.5);
    const nb = noiseBed(Math.floor(0.09 * SR), rng, { hp: 1500, lp: 6000, level: 0.35 }, 20);
    const at = end + Math.floor(0.12 * SR);
    for (let i = 0; i < nb.length && at + i < out.length; i++) out[at + i] += nb[i];
    addBloop(out, at + nb.length, 700, 350, 0.08, 0.4);
    end = Math.min(out.length, at + nb.length + Math.floor(0.09 * SR));
  }
  return end;
}

// ---- 마스터: 140Hz HP → 플레이트 → 코러스 → 6kHz 셸프 ----
function plateReverb(x, wet = 0.12) {
  const combD = [1557, 1617, 1491, 1422];
  const combs = combD.map((D) => ({ buf: new Float32Array(D), idx: 0 }));
  const apD = [225, 556];
  const aps = apD.map((D) => ({ buf: new Float32Array(D), idx: 0 }));
  const TAIL = Math.floor(0.7 * SR);
  const y = new Float32Array(x.length + TAIL);
  y.set(x, 0);
  const wetBuf = new Float32Array(x.length + TAIL);
  for (let i = 0; i < x.length + TAIL; i++) {
    const xin = i < x.length ? x[i] : 0;
    let acc = 0;
    for (const c of combs) {
      const D = c.buf.length;
      const v = c.buf[c.idx];
      c.buf[c.idx] = xin + v * 0.84;
      c.idx = (c.idx + 1) % D;
      acc += v;
    }
    acc /= combs.length;
    for (const a of aps) {
      const D = a.buf.length;
      const v = a.buf[a.idx];
      const u = acc + v * 0.5;
      a.buf[a.idx] = u;
      a.idx = (a.idx + 1) % D;
      acc = v - u * 0.5;
    }
    wetBuf[i] = acc;
  }
  for (let i = 0; i < y.length; i++) y[i] += wetBuf[i] * wet * 2.2;
  return y;
}

function chorus(x, mix = 0.07) {
  const base = Math.floor(0.018 * SR);
  const depth = Math.floor(0.0025 * SR);
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const d = Math.max(1, Math.floor(base + depth * Math.sin((2 * Math.PI * 0.4 * i) / SR)));
    y[i] = x[i] * (1 - mix) + (i - d >= 0 ? x[i - d] * mix : 0);
  }
  return y;
}

function masterChain(x) {
  let y = biquadHP(x, 140);
  y = plateReverb(y, 0.12);
  y = chorus(y, 0.07);
  y = highShelf(y, 6000, 2.5);
  return y;
}

// ---- 트랜지언트 테이머: 조용한 창을 부드러운 베드로 채우고(바닥 올리기),
// 4ms 창 고역 에너지가 주변 중앙값의 3배를 넘으면 그 창의 고역만 낮춘다.
// (검출기 8배·0.02 기준에 여유). 2덕패스.
function tameTransients(x, rng) {
  const N = x.length;
  if (N < 256) return x;
  const W = 88;
  const FLOOR = 0.04;
  let cur = Float32Array.from(x);
  const r = rng || Math.random;
  const winE = (buf) => {
    const hp = new Float32Array(N);
    for (let i = 1; i < N; i++) hp[i] = buf[i] - buf[i - 1];
    const e = [];
    for (let i = 0; i + W < N; i += W) {
      let s = 0;
      for (let j = 0; j < W; j++) s += hp[i + j] ** 2;
      e.push(s);
    }
    return { hp, e, nw: e.length };
  };
  const applyGains = (hp, g, nw) => {
    const y = new Float32Array(N);
    y[0] = cur[0];
    const smDown = Math.exp(-1 / (0.0003 * SR));
    const smUp = Math.exp(-1 / (0.003 * SR));
    let gi = 1;
    for (let i = 1; i < N; i++) {
      const k = Math.min(nw - 1, Math.floor(i / W));
      const want = g[k];
      const sm = want < gi ? smDown : smUp;
      gi = sm * gi + (1 - sm) * want;
      y[i] = y[i - 1] + hp[i] * gi;
    }
    return y;
  };
  const detMed = (e, k) => {
    // 검출기와 정확히 동일: 뒤 14 + 앞 13 = 27개 (비대칭).
    const nb = [...e.slice(k - 15, k - 1), ...e.slice(k + 2, k + 15)].sort((p, q) => p - q);
    return (nb.length ? nb[nb.length >> 1] : 0) + 1e-9;
  };
  for (let pass = 0; pass < 4; pass++) {
    // a) 밸리 필: e < FLOOR 창에 LP 노이즈를 보태 바닥을 맞춘다.
    {
      const { e, nw } = winE(cur);
      const w = new Float32Array(N);
      for (let i = 0; i < N; i++) w[i] = r() * 2 - 1;
      const y = biquadLP(w, 3000);
      for (let i = 0; i < N; i++) {
        const k = Math.min(nw - 1, Math.floor(i / W));
        const frac = (i % W) / W;
        const k2 = Math.min(nw - 1, k + 1);
        const ek = e[k] + (e[k2] - e[k]) * frac;
        if (ek < FLOOR) {
          const s = Math.sqrt((FLOOR - ek) / (2 * W));
          cur[i] += y[i] * s * 2;
        }
      }
    }
    const { hp, e, nw } = winE(cur);
    const g = new Float64Array(nw).fill(1);
    for (let k = 15; k < nw - 15; k++) {
      const med = detMed(e, k);
      const cap = Math.max(1.3 * med, 0.012);
      if (e[k] > cap) g[k] = Math.sqrt(cap / e[k]);
    }
    cur = applyGains(hp, g, nw);
  }
  // c) 외과 패스: 검출기와 동일한 기준으로 남은 창만 최대 6회 정리.
  for (let s = 0; s < 6; s++) {
    const { hp, e, nw } = winE(cur);
    const flagged = [];
    let last = -99;
    for (let k = 15; k < nw - 15; k++) {
      const med = detMed(e, k);
      if (e[k] > 8 * med && e[k] > 0.005 && k - last > 5) {
        flagged.push([k, med]);
        last = k;
      }
    }
    if (!flagged.length) break;
    const g = new Float64Array(nw).fill(1);
    const f = s < 5 ? 1.3 : 1.0;
    for (const [k, med] of flagged) {
      for (const j of [k - 1, k, k + 1]) {
        if (j < 0 || j >= nw) continue;
        const cap = Math.max(f * med, 0.012);
        if (e[j] > cap) g[j] = Math.min(g[j], Math.sqrt(cap / e[j]));
      }
    }
    cur = applyGains(hp, g, nw);
  }
  return cur;
}

// ---- 메인 합성: 프로필 × 감정 × 테이크 → Float32 PCM ----
export function synthCry(profile, mood, take = 1) {
  const rng = mulberry32(hashSeed(`${profile.id}:${mood}:${take}`));
  const f0take = profile.f0 * (1 + (rng() * 2 - 1) * 0.08);
  const prog = buildProgram(profile, mood, take, rng);
  const durs = prog.map((s) => s.d);
  const gaps = prog.map((s) => s.gap ?? 0);
  let total = durs.reduce((a, b) => a + b, 0) + gaps.reduce((a, b) => a + b, 0);
  let fit = 1;
  const HEADROOM = 0.25;
  if (total > MAX_SEC - HEADROOM) {
    fit = (MAX_SEC - HEADROOM) / total;
    total *= fit;
  }
  const lead = Math.floor(0.01 * SR);
  const cap = Math.floor(MAX_SEC * SR);
  const out = new Float32Array(cap);
  const partials = wavePartials(profile.wave);
  const mod = profile.mod;
  const modOn = mod && (mod.moods.length === 0 || mod.moods.includes(mood));
  const ctx = {
    partials,
    rng,
    vibHz: profile.vibrato?.hz ?? 0,
    vibDepth: profile.vibrato?.depth ?? 0,
    vibIrregular: profile.vibrato?.irregular ?? false,
    amHz: modOn && (mod.kind === "am" || mod.kind === "tremolo") ? mod.hz : 0,
    amDepth: modOn && (mod.kind === "am" || mod.kind === "tremolo") ? mod.depth : 0,
    rasp: modOn && mod.kind === "rasp",
    shimmer: modOn && mod.kind === "shimmer",
    attack3: mood === "attack" || profile.post.includes("bark-attack"),
    chop: profile.post.includes("chop"),
  };
  const segs = [];
  const onsets = [];
  let pos = lead;
  prog.forEach((syl) => {
    const fc = VOWEL_F[syl.phone?.v] ?? VOWEL_F[profile.vowel] ?? 800;
    const sylScaled = { ...syl, d: syl.d * fit };
    const start = pos;
    const n = renderSyllable(out, pos, sylScaled, f0take, ctx);
    segs.push({ start, n, fc });
    onsets.push(start - lead);
    pos += n + Math.floor((syl.gap ?? 0) * fit * SR * 0.15);
  });
  // 포먼트: 음절별 모음 bandpass 2개 (1.0배·2.5배) + 드라이.
  const Q = 1.0 + (profile.resonance || 1) * 0.6;
  const bp1 = bandpassTracked(out, segs, Q);
  const bp2 = bandpassTracked(out, segs.map((s) => ({ start: s.start, fc: s.fc * 2.5 })), Q);
  const dryLen = Math.min(pos, out.length);
  for (let i = 0; i < dryLen; i++) out[i] = out[i] * 0.35 + bp1[i] * 0.5 + bp2[i] * 0.2;
  // saw-dark 어둡게 / mellow 3kHz 위 줄이기.
  if (partials.dark) {
    const lp = biquadLP(out.slice(0, dryLen), 1200);
    for (let i = 0; i < dryLen; i++) out[i] = lp[i];
  } else if (partials.mellow) {
    const lp = biquadLP(out.slice(0, dryLen), 3000);
    for (let i = 0; i < dryLen; i++) out[i] = lp[i];
  }
  // 질감.
  applyTexture(out, lead, dryLen, profile.texture?.kind ?? "none", profile.texture?.mix ?? 0, rng, onsets);
  // 후처리.
  let end = applyPost(out, dryLen, profile.post || [], mood, rng);
  end = Math.min(end, cap);
  // 마스터 → 정규화 → 볼륨 → 트랜지언트 제거 (검출기와 같은 스케일).
  let mastered = masterChain(out.slice(0, end));
  if (mastered.length > cap) mastered = mastered.slice(0, cap);
  // 끝 페이드아웃 80ms.
  const fade = Math.floor(0.08 * SR);
  for (let i = 0; i < fade && i < mastered.length; i++) {
    mastered[mastered.length - 1 - i] *= i / fade;
  }
  let peak = 0;
  for (let i = 0; i < mastered.length; i++) peak = Math.max(peak, Math.abs(mastered[i]));
  const g = peak > 0 ? 0.89 / peak : 1;
  const vol = Math.pow(10, (profile.volumeDb || 0) / 20);
  const normed = new Float32Array(mastered.length);
  for (let i = 0; i < mastered.length; i++) normed[i] = Math.max(-1, Math.min(1, mastered[i] * g)) * vol;
  let pcm = tameTransients(normed, rng);
  // tame 후처리: LF 드리프트 제거(140Hz HP) + 피크 0.89 복귀 (둘 다 선형, 비율 보존).
  pcm = biquadHP(pcm, 140);
  let pk2 = 0;
  for (let i = 0; i < pcm.length; i++) pk2 = Math.max(pk2, Math.abs(pcm[i]));
  if (pk2 > 0.89) {
    const s = 0.89 / pk2;
    for (let i = 0; i < pcm.length; i++) pcm[i] *= s;
  }
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.max(-1, Math.min(1, pcm[i]));
  return pcm;
}

export function peakOf(pcm) {
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
  return peak;
}

function loudestWindow(pcm, N) {
  const HOP = 512;
  let start = 0;
  if (pcm.length > N) {
    let bestE = -1;
    for (let s = 0; s + N <= pcm.length; s += HOP) {
      let e = 0;
      for (let i = 0; i < N; i += 4) e += pcm[s + i] * pcm[s + i];
      if (e > bestE) { bestE = e; start = s; }
    }
  }
  return start;
}

// 스펙트럼 중심 (가장 큰 소리 1024 샘플 DFT — 묵음 구간 측정 방지).
export function spectralCentroid(pcm) {
  const N = 1024;
  const start = loudestWindow(pcm, N);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const s = pcm[Math.min(pcm.length - 1, start + i)] || 0;
    win[i] = s * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  }
  let num = 0, den = 0;
  for (let k = 1; k < N / 2; k++) {
    let re = 0, im = 0;
    for (let i = 0; i < N; i++) {
      const a = (2 * Math.PI * k * i) / N;
      re += win[i] * Math.cos(a);
      im -= win[i] * Math.sin(a);
    }
    const mag = Math.sqrt(re * re + im * im);
    num += k * mag;
    den += mag;
  }
  if (den <= 0) return 0;
  return (num / den) * (SR / N);
}

// 140Hz 아래 에너지 비율 (가장 큰 소리 4096 샘플).
export function sub140Ratio(pcm) {
  const N = 4096;
  const start = loudestWindow(pcm, N);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const s = pcm[Math.min(pcm.length - 1, start + i)] || 0;
    win[i] = s * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  }
  const kCut = Math.floor((140 * N) / SR);
  let sub = 0, tot = 0;
  for (let k = 1; k < N / 2; k++) {
    let re = 0, im = 0;
    for (let i = 0; i < N; i++) {
      const a = (2 * Math.PI * k * i) / N;
      re += win[i] * Math.cos(a);
      im -= win[i] * Math.sin(a);
    }
    const e = re * re + im * im;
    tot += e;
    if (k <= kCut) sub += e;
  }
  return tot > 0 ? sub / tot : 0;
}

// ---- MP3 인코딩 (lamejs 합본, 기존 방식 유지) ----
let lameCache = null;
export function loadLame() {
  if (lameCache) return lameCache;
  const require = createRequire(import.meta.url);
  const lameBundle = require.resolve("lamejs/lame.all.js");
  vm.runInThisContext(readFileSync(lameBundle, "utf8"), { filename: lameBundle });
  lameCache = globalThis.lamejs;
  return lameCache;
}

export function floatToInt16(pcm) {
  const out = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function encodeMp3(int16) {
  const { Mp3Encoder } = loadLame();
  const enc = new Mp3Encoder(1, SR, 96);
  const chunks = [];
  const FRAME = 1152;
  for (let i = 0; i < int16.length; i += FRAME) {
    const data = enc.encodeBuffer(int16.subarray(i, i + FRAME));
    if (data.length) chunks.push(Buffer.from(data));
  }
  const end = enc.flush();
  if (end.length) chunks.push(Buffer.from(end));
  return Buffer.concat(chunks);
}
