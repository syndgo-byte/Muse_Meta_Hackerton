// SEC-5: LAN 공개 시 보호. PAIRING_CODE가 비어 있으면 전부 통과(평소 localhost 개발 그대로).
// 코드가 있으면: 루프백은 전부 통과, 그 외는 페어링 쿠키 필요 + AI 속도제한 + 본문 상한.
import { NextRequest, NextResponse } from "next/server";
import {
  AI_RATE_MAX,
  AI_RATE_ROUTES,
  AI_RATE_WINDOW_MS,
  BIG_BODY_MAX,
  BIG_BODY_ROUTES,
  PAIRING_COOKIE,
  PAIR_ATTEMPT_MAX,
  PAIR_ATTEMPT_WINDOW_MS,
  SMALL_BODY_MAX,
  isLoopback,
  underPath,
} from "./lib/pairing";

// 메모리 제한 (프로세스별). 초과면 true.
const hits = new Map<string, number[]>();
function limited(key: string, max: number, winMs: number): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < winMs);
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) hits.delete(hits.keys().next().value as string);
  return arr.length > max;
}

function deny(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}

export function middleware(req: NextRequest) {
  const pair = process.env.PAIRING_CODE || "";
  if (!pair) return NextResponse.next();

  const host = req.headers.get("host") || "";
  const fwd = (req.headers.get("x-forwarded-for") || "").split(",").map((s) => s.trim());
  const ips = [...(req.ip ? [req.ip] : []), ...fwd];
  const ip = ips[0] ?? "";
  if (isLoopback(host, ips)) return NextResponse.next();

  const path = req.nextUrl.pathname;
  // /pair 페어링 화면 + 공개 번들(JS/CSS)은 쿠키 없이 연다. API·다른 화면은 쿠키 필요.
  if (underPath(path, "/pair") && req.method === "GET") return NextResponse.next();
  if (underPath(path, "/_next/static")) return NextResponse.next();
  // 페어링 엔드포인트: POST(시도 제한 있음)와 CORS 프리플라이트만 연다.
  if (underPath(path, "/api/pairing")) {
    if (req.method === "OPTIONS") {
      const res = new NextResponse(null, { status: 204 });
      const origin = req.headers.get("origin");
      if (origin) res.headers.set("Access-Control-Allow-Origin", origin);
      res.headers.set("Access-Control-Allow-Credentials", "true");
      res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.headers.set("Access-Control-Allow-Headers", "Content-Type");
      res.headers.set("Vary", "Origin");
      return res;
    }
    if (req.method === "POST") {
      if (limited(`pair:${ip || "unknown"}`, PAIR_ATTEMPT_MAX, PAIR_ATTEMPT_WINDOW_MS)) {
        return deny(429, "too_many_attempts");
      }
      return NextResponse.next();
    }
    return deny(401, "pairing_required");
  }

  if (req.cookies.get(PAIRING_COOKIE)?.value !== pair) {
    return deny(401, "pairing_required");
  }
  if (
    AI_RATE_ROUTES.some((p) => underPath(path, p)) &&
    limited(`ai:${ip || "unknown"}:${path}`, AI_RATE_MAX, AI_RATE_WINDOW_MS)
  ) {
    return deny(429, "rate_limited");
  }
  const len = Number(req.headers.get("content-length") || 0);
  const cap = BIG_BODY_ROUTES.some((p) => underPath(path, p)) ? BIG_BODY_MAX : SMALL_BODY_MAX;
  if (Number.isFinite(len) && len > cap) {
    return deny(413, "body_too_large");
  }
  return NextResponse.next();
}
