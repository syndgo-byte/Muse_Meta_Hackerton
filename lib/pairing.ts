// SEC-5: LAN 페어링 상수 + 순수 판정 함수.
// edge 런타임(middleware)에서도 import하므로 node 전용 API 금지.

export const PAIRING_COOKIE = "oishie_pair";
export const PAIRING_CODE_LEN = 6;

// AI 호출 라우트: IP당 분당 20회 (주문서 지정 7개).
export const AI_RATE_ROUTES = [
  "/api/look",
  "/api/image",
  "/api/voice",
  "/api/levelup",
  "/api/creature",
  "/api/encounter",
  "/api/diary",
];
export const AI_RATE_MAX = 20;
export const AI_RATE_WINDOW_MS = 60_000;

// 페어링 시도: IP당 분당 10회 (6자리 추측 방지).
export const PAIR_ATTEMPT_MAX = 10;
export const PAIR_ATTEMPT_WINDOW_MS = 60_000;

// 본문 상한: 미디어 받는 라우트 8MB, 나머지 64KB.
// look·creature(imageDataUrl ≤2MB 수신), voice(음성 폼), image(주문서 지정).
export const BIG_BODY_ROUTES = ["/api/image", "/api/look", "/api/creature", "/api/voice"];
export const BIG_BODY_MAX = 8 * 1024 * 1024;
export const SMALL_BODY_MAX = 64 * 1024;

export function underPath(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + "/");
}

function hostOnly(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(1, h.indexOf("]") === -1 ? undefined : h.indexOf("]"));
  const i = h.lastIndexOf(":");
  // :가 2개 이상이면 포트 없는 IPv6 리터럴로 본다.
  if (i !== -1 && h.indexOf(":") === i) return h.slice(0, i);
  return h;
}

export function isLoopbackHost(host: string): boolean {
  const h = hostOnly(host);
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

export function isLoopbackIp(ip: string): boolean {
  const v = ip.trim().toLowerCase();
  return v === "127.0.0.1" || v === "::1" || v === "::ffff:127.0.0.1";
}

// fail-closed: IP 단서가 하나라도 비루프백이면 외부로 본다(Host 위조 무력화).
// IP 단서가 전혀 없을 때만 Host로 판단한다.
export function isLoopback(host: string, ips: string[]): boolean {
  const known = ips.map((s) => s.trim()).filter((s) => s !== "");
  if (known.length === 0) return isLoopbackHost(host);
  return known.every(isLoopbackIp);
}
