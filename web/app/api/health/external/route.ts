import { NextResponse } from "next/server";
import { EXTERNAL_REGISTRY, type ExternalEntry } from "@/lib/external/registry";
import { getExternalStats } from "@/lib/external/stats";
import { GOOGLE_AUTHORIZE_URL, isOAuthConfigured } from "@/lib/oauth";

// GET /api/health/external — EX-3: 레지스트리 항목별 연결 상태.
// 값은 절대 내보내지 않는다(있다/없다·횟수·지연만).
export type ExternalHealthStatus = "ready" | "not_configured" | "unreachable" | "fallback";

export type ExternalHealthItem = {
  id: string;
  configured: boolean;
  status: ExternalHealthStatus;
  lastLatencyMs: number | null;
  calls: number;
  fallbacks: number;
};

// 최근 fallback 판정 창 (10분).
const FALLBACK_WINDOW_MS = 10 * 60 * 1000;
// 실제 핑 60초 캐시, 타임아웃 3초. 과금 호출 금지.
const PING_CACHE_MS = 60 * 1000;
const PING_TIMEOUT_MS = 3000;

let pingCache: { at: number; ok: boolean } | null = null;

// 무료 도달 확인: 구글 인가 페이지 HEAD (로그인 없이, 과금 없음).
// Meta Model API는 무료 확인용 엔드포인트가 없어 핑 없이 최근 호출 결과만 쓴다.
async function pingGoogle(): Promise<boolean> {
  const now = Date.now();
  if (pingCache && now - pingCache.at < PING_CACHE_MS) return pingCache.ok;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), PING_TIMEOUT_MS);
  try {
    const res = await fetch(GOOGLE_AUTHORIZE_URL, { method: "HEAD", signal: ctl.signal });
    pingCache = { at: now, ok: res.status < 500 };
    return pingCache.ok;
  } catch {
    pingCache = { at: now, ok: false };
    return false;
  } finally {
    clearTimeout(t);
  }
}

function configuredOf(entry: ExternalEntry): boolean {
  // google-oauth는 실제 로그인 가능 기준(isOAuthConfigured)과 맞춘다.
  if (entry.id === "google-oauth") return isOAuthConfigured();
  if (entry.status === "planned") return false;
  if (entry.envKeys.length === 0) return true;
  return entry.envKeys.every((k) => (process.env[k] ?? "") !== "");
}

export async function GET() {
  const stats = getExternalStats();
  const now = Date.now();
  // 핑은 설정된 google-oauth가 있을 때만 (불필요한 외부 호출 금지).
  const needPing = EXTERNAL_REGISTRY.some(
    (e) => e.id === "google-oauth" && configuredOf(e)
  );
  const googleOk = needPing ? await pingGoogle() : true;

  const items: ExternalHealthItem[] = EXTERNAL_REGISTRY.map((entry) => {
    const configured = configuredOf(entry);
    const s = stats[entry.id];
    let status: ExternalHealthStatus;
    if (entry.status === "local" || entry.id === "share-*") {
      status = "ready"; // 외부 호출 없음.
    } else if (entry.status === "planned") {
      status = "not_configured"; // VA-1·MC-1·meta-oauth 예정.
    } else if (!configured) {
      status = "not_configured";
    } else if (entry.id === "google-oauth" && !googleOk) {
      status = "unreachable";
    } else if (s && s.lastResult === "failed" && now - s.lastAt < FALLBACK_WINDOW_MS) {
      status = "fallback"; // 최근 대체 동작.
    } else {
      status = "ready";
    }
    return {
      id: entry.id,
      configured,
      status,
      lastLatencyMs: s?.lastLatencyMs ?? null,
      calls: s?.calls ?? 0,
      fallbacks: s?.fallbacks ?? 0,
    };
  });
  return NextResponse.json({ items });
}
