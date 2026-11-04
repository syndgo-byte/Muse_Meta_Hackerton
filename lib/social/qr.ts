// lib/social/qr.ts — PF-1: 최소 QR 인코더 (byte 모드, ECC-L, 버전 1~6).
// 휴대폰 화면 구석의 피어 코드 표시용. 읽기는 브라우저 기본 BarcodeDetector.
// 버전 7+는 만들지 않는다(피어 페이로드는 134바이트 이하).
// 상대 import만 쓴다(verify-peer 격리 컴파일용).
import type { PeerBeacon } from "./transport";

export type QrMatrix = {
  version: number;
  /** 한 변 모듈 수 (버전 없을 때 quiet zone 제외). */
  size: number;
  /** 고른 마스크 0~7. */
  mask: number;
  /** row-major 0/1, size*size. */
  modules: Uint8Array;
};

const ECC_LEN = [7, 10, 15, 20, 26, 18];
const DATA_LEN = [19, 34, 55, 80, 108, 136];
const BLOCKS = [1, 1, 1, 1, 1, 2];
const ALIGN: number[][] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]];
const REM_BITS = [0, 7, 7, 7, 7, 7];

// ---- GF(256) ----
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGf(): void {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

// ---- Reed-Solomon ----
function rsGenerator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data: number[], degree: number): number[] {
  const gen = rsGenerator(degree);
  const buf = [...data, ...new Array(degree).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const coef = buf[i] ?? 0;
    if (coef !== 0) {
      for (let j = 1; j < gen.length; j++) {
        buf[i + j] ^= gfMul(gen[j] ?? 0, coef);
      }
    }
  }
  return buf.slice(data.length);
}

// ---- 비트 쓰기 ----
function pushBits(out: number[], val: number, len: number): void {
  for (let i = len - 1; i >= 0; i--) out.push((val >>> i) & 1);
}

/** 페이로드를 담는 최소 버전(1~6). 안 들어가면 0. */
export function qrVersionFor(byteLen: number): number {
  for (let v = 1; v <= 6; v++) {
    // mode 4 + count 8 + 데이터. 종료자는 0~4비트라 꽉 차도 된다.
    if (12 + byteLen * 8 <= (DATA_LEN[v - 1] ?? 0) * 8) return v;
  }
  return 0;
}

function dataCodewords(bytes: Uint8Array, version: number): number[] {
  const totalBits = (DATA_LEN[version - 1] ?? 0) * 8;
  const bits: number[] = [];
  pushBits(bits, 0b0100, 4); // byte 모드
  pushBits(bits, bytes.length, 8); // 버전 1~9는 8비트
  for (let i = 0; i < bytes.length; i++) pushBits(bits, bytes[i] ?? 0, 8);
  const term = Math.min(4, totalBits - bits.length);
  for (let i = 0; i < term; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | (bits[i + j] ?? 0);
    out.push(byte);
  }
  const pads = [0xec, 0x11];
  for (let i = 0; out.length < (DATA_LEN[version - 1] ?? 0); i++) {
    out.push(pads[i % 2] ?? 0xec);
  }
  return out;
}

function interleave(data: number[], version: number): number[] {
  const nb = BLOCKS[version - 1] ?? 1;
  if (nb === 1) return [...data, ...rsRemainder(data, ECC_LEN[version - 1] ?? 7)];
  const per = data.length / nb;
  const blocks: number[][] = [];
  for (let b = 0; b < nb; b++) blocks.push(data.slice(b * per, (b + 1) * per));
  const eccs = blocks.map((bl) => rsRemainder(bl, ECC_LEN[version - 1] ?? 18));
  const out: number[] = [];
  for (let i = 0; i < per; i++) for (let b = 0; b < nb; b++) out.push(blocks[b]?.[i] ?? 0);
  for (let i = 0; i < (ECC_LEN[version - 1] ?? 0); i++) {
    for (let b = 0; b < nb; b++) out.push(eccs[b]?.[i] ?? 0);
  }
  return out;
}

// ---- 매트릭스 ----
function maskBit(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2 + (r * c) % 3) === 0;
    case 6: return ((r * c) % 2 + (r * c) % 3) % 2 === 0;
    default: return ((r + c) % 2 + (r * c) % 3) % 2 === 0;
  }
}

function formatBits(mask: number): number {
  const data = (0b01 << 3) | mask; // ECC-L + 마스크
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return (((data << 10) | rem) ^ 0x5412) & 0x7fff;
}

function drawFinder(m: Uint8Array, f: Uint8Array, size: number, cx: number, cy: number): void {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      m[y * size + x] = d !== 2 && d !== 4 ? 1 : 0;
      f[y * size + x] = 1;
    }
  }
}

function drawAlign(m: Uint8Array, f: Uint8Array, size: number, cx: number, cy: number): void {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      m[(cy + dy) * size + (cx + dx)] = d !== 1 ? 1 : 0;
      f[(cy + dy) * size + (cx + dx)] = 1;
    }
  }
}

function buildBase(version: number): { m: Uint8Array; f: Uint8Array; size: number } {
  const size = 17 + 4 * version;
  const m = new Uint8Array(size * size);
  const f = new Uint8Array(size * size);
  drawFinder(m, f, size, 3, 3);
  drawFinder(m, f, size, size - 4, 3);
  drawFinder(m, f, size, 3, size - 4);
  for (let i = 8; i < size - 8; i++) {
    const v = i % 2 === 0 ? 1 : 0;
    m[6 * size + i] = v;
    f[6 * size + i] = 1;
    m[i * size + 6] = v;
    f[i * size + 6] = 1;
  }
  const centers = ALIGN[version - 1] ?? [];
  for (const cy of centers) {
    for (const cx of centers) {
      // 파인더(분리대 포함)와 겹치면 생략. 버전 2~6은 (last,last) 1개만 남는다.
      const x0 = cx - 2;
      const y0 = cy - 2;
      const overlap =
        (x0 < 8 && y0 < 8) || (x0 + 5 > size - 8 && y0 < 8) || (x0 < 8 && y0 + 5 > size - 8);
      if (overlap) continue;
      drawAlign(m, f, size, cx, cy);
    }
  }
  // 형식 정보 자리 예약 (값은 마스크 확정 뒤에 쓴다). x=열, y=행.
  const mark = (x: number, y: number) => { f[y * size + x] = 1; };
  for (let i = 0; i <= 5; i++) mark(8, i);
  mark(8, 7);
  mark(8, 8);
  mark(7, 8);
  for (let i = 9; i < 15; i++) mark(14 - i, 8);
  for (let i = 0; i < 8; i++) mark(size - 1 - i, 8);
  for (let i = 8; i < 15; i++) mark(8, size - 15 + i);
  // 다크 모듈
  m[(4 * version + 9) * size + 8] = 1;
  f[(4 * version + 9) * size + 8] = 1;
  return { m, f, size };
}

function drawData(m: Uint8Array, f: Uint8Array, size: number, codewords: number[]): void {
  const bits: number[] = [];
  for (const w of codewords) for (let i = 7; i >= 0; i--) bits.push((w >>> i) & 1);
  let bi = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = upward ? size - 1 - vert : vert;
        if (f[y * size + x] === 0 && bi < bits.length) {
          m[y * size + x] = bits[bi++] ?? 0;
        }
      }
    }
  }
}

function drawFormat(m: Uint8Array, size: number, mask: number): void {
  const bits = formatBits(mask);
  const bit = (i: number) => ((bits >>> i) & 1);
  const set = (x: number, y: number, i: number) => { m[y * size + x] = bit(i); };
  // 복사 1: 열 8을 따라 내려가며 b0~b7, 행 8을 따라 왼쪽으로 b8~b14.
  for (let i = 0; i <= 5; i++) set(8, i, i);
  set(8, 7, 6);
  set(8, 8, 7);
  set(7, 8, 8);
  for (let i = 9; i < 15; i++) set(14 - i, 8, i);
  // 복사 2: 행 8 오른쪽을 오른쪽→왼쪽으로 b0~b7, 열 8 아래를 위→아래로 b8~b14.
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, i);
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, i);
}

function penalty(m: Uint8Array, size: number): number {
  let score = 0;
  // N1: 같은 색 5개 이상 줄
  for (let y = 0; y < size; y++) {
    let run = 1;
    for (let x = 1; x < size; x++) {
      if (m[y * size + x] === m[y * size + x - 1]) {
        run++;
        if (run === 5) score += 3;
        else if (run > 5) score += 1;
      } else run = 1;
    }
  }
  for (let x = 0; x < size; x++) {
    let run = 1;
    for (let y = 1; y < size; y++) {
      if (m[y * size + x] === m[(y - 1) * size + x]) {
        run++;
        if (run === 5) score += 3;
        else if (run > 5) score += 1;
      } else run = 1;
    }
  }
  // N2: 2x2 같은 색
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const v = m[y * size + x];
      if (v === m[y * size + x + 1] && v === m[(y + 1) * size + x] && v === m[(y + 1) * size + x + 1]) {
        score += 3;
      }
    }
  }
  // N3: 파인더 닮은꼴
  const p1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const p2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const match = (get: (k: number) => number): boolean => {
    let a = true;
    for (let k = 0; k < 11; k++) {
      if (get(k) !== p1[k]) {
        a = false;
        break;
      }
    }
    if (a) return true;
    for (let k = 0; k < 11; k++) {
      if (get(k) !== p2[k]) return false;
    }
    return true;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x <= size - 11; x++) {
      if (match((k) => m[y * size + x + k] ?? 0)) score += 40;
    }
  }
  for (let x = 0; x < size; x++) {
    for (let y = 0; y <= size - 11; y++) {
      if (match((k) => m[(y + k) * size + x] ?? 0)) score += 40;
    }
  }
  // N4: 검정 비율
  let dark = 0;
  for (let i = 0; i < m.length; i++) dark += m[i] ?? 0;
  const total = size * size;
  score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
  return score;
}

export type EncodeQrOpts = { mask?: number };

/**
 * 문자열을 QR 매트릭스로 인코딩한다. 버전 1~6 자동 선택, ECC-L.
 * mask 지정 시 그 마스크로 고정(테스트용). 너무 길면 Error("pf-qr-too-long").
 */
export function encodeQr(payload: string, opts?: EncodeQrOpts): QrMatrix {
  const bytes = new TextEncoder().encode(payload);
  const version = qrVersionFor(bytes.length);
  if (version === 0) throw new Error("pf-qr-too-long");
  const codewords = interleave(dataCodewords(bytes, version), version);
  const { m, f, size } = buildBase(version);
  drawData(m, f, size, codewords);
  const masks = opts?.mask !== undefined ? [opts.mask] : [0, 1, 2, 3, 4, 5, 6, 7];
  let best = masks[0] ?? 0;
  let bestScore = Number.POSITIVE_INFINITY;
  const trial = new Uint8Array(m.length);
  for (const mask of masks) {
    trial.set(m);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (f[y * size + x] === 0 && maskBit(mask, y, x)) {
          trial[y * size + x] ^= 1;
        }
      }
    }
    const s = penalty(trial, size);
    if (s < bestScore) {
      bestScore = s;
      best = mask;
    }
  }
  const modules = new Uint8Array(m.length);
  modules.set(m);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (f[y * size + x] === 0 && maskBit(best, y, x)) {
        modules[y * size + x] ^= 1;
      }
    }
  }
  drawFormat(modules, size, best);
  return { version, size, mask: best, modules };
}

// ---- 피어 페이로드 ----
const NICK_MAX = 12;

/** 전송용 페이로드 JSON. 별명은 12자로 자른다. */
export function peerPayload(b: PeerBeacon): string {
  const nick = Array.from(b.nickname ?? "").slice(0, NICK_MAX).join("");
  return JSON.stringify({ v: 1, p: b.peerId, n: nick, s: b.speciesId, l: b.level });
}

const CODE_RE = /^[A-Za-z0-9-]{1,32}$/;

/** 페이로드 파싱. 모양이 다르면 null. */
export function parsePeerPayload(s: string): PeerBeacon | null {
  try {
    const v: unknown = JSON.parse(s);
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const r = v as Record<string, unknown>;
    if (r.v !== 1) return null;
    if (typeof r.p !== "string" || r.p.length === 0 || r.p.length > 64) return null;
    if (typeof r.n !== "string" || r.n.length === 0 || Array.from(r.n).length > NICK_MAX) return null;
    if (typeof r.s !== "string" || !CODE_RE.test(r.s)) return null;
    if (typeof r.l !== "number" || !Number.isInteger(r.l) || r.l < 1 || r.l > 999) return null;
    return { peerId: r.p, nickname: r.n, speciesId: r.s, level: r.l };
  } catch {
    return null;
  }
}

type DetectorLike = { detect(src: ImageBitmapSource): Promise<{ rawValue?: string }[]> };

function getDetector(): DetectorLike | null {
  try {
    const BD = (globalThis as unknown as { BarcodeDetector?: new (o: unknown) => DetectorLike })
      .BarcodeDetector;
    if (!BD) return null;
    return new BD({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

/**
 * 이미지(카메라 프레임·캔버스)에서 피어 QR을 읽는다.
 * API가 없으면 Error("pf-qr-unsupported"). 못 읽으면 null.
 */
export async function detectPeerFromImage(src: ImageBitmapSource): Promise<PeerBeacon | null> {
  const det = getDetector();
  if (!det) throw new Error("pf-qr-unsupported");
  let found: { rawValue?: string }[];
  try {
    found = await det.detect(src);
  } catch {
    return null;
  }
  for (const b of found) {
    if (typeof b.rawValue === "string") {
      const p = parsePeerPayload(b.rawValue);
      if (p) return p;
    }
  }
  return null;
}

/** 8자리 16진 피어 ID. */
export function randomPeerId(): string {
  try {
    const g = globalThis.crypto?.getRandomValues?.bind(globalThis.crypto);
    if (g) {
      const b = new Uint8Array(4);
      g(b);
      return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    /* ignore */
  }
  return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
}

// ---- 렌더 ----
export type QrPixels = { width: number; height: number; rgba: Uint8ClampedArray };

/** 캔버스 putImageData용 픽셀. quiet=4 모듈 권장. */
export function renderQrPixels(qr: QrMatrix, scale = 4, quiet = 4): QrPixels {
  const side = qr.size + quiet * 2;
  const width = side * scale;
  const height = side * scale;
  const rgba = new Uint8ClampedArray(width * height * 4);
  rgba.fill(255);
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.modules[y * qr.size + x] !== 1) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = (x + quiet) * scale + dx;
          const py = (y + quiet) * scale + dy;
          const o = (py * width + px) * 4;
          rgba[o] = 0;
          rgba[o + 1] = 0;
          rgba[o + 2] = 0;
          rgba[o + 3] = 255;
        }
      }
    }
  }
  return { width, height, rgba };
}
