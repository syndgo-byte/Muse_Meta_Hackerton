// Google OIDC 서버 헬퍼 (서버 전용: API 라우트에서만 import).
// 클라이언트 번들에 포함 금지 (node:crypto 사용).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { normalizeProfile, type TrainerProfile } from "./account";
import { recordExternal } from "./external/stats";

// [EXT:google-oauth] 외부 호출 — 끊기면: 로그인 실패 → /login?error 복귀, 게스트 플레이
export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://www.googleapis.com/oauth2/v4/token";
export const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

export const STATE_COOKIE = "oishie-oauth-state";
export const SESSION_COOKIE = "oishie-session";
const STATE_TTL_SEC = 600;
const SESSION_TTL_SEC = 60 * 60 * 24 * 30;

export function oauthConfig() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI ??
      "http://localhost:3000/api/auth/callback/google",
  };
}

export function isOAuthConfigured(): boolean {
  const c = oauthConfig();
  return Boolean(c.clientId && c.clientSecret);
}

// CSRF 방어용 32바이트 난수 state.
export function newState(): string {
  return randomBytes(32).toString("base64url");
}

export function buildAuthorizeUrl(state: string): string {
  const c = oauthConfig();
  const q = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "offline",
  });
  return `${GOOGLE_AUTHORIZE_URL}?${q.toString()}`;
}

function cookieAttrs(maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function stateCookie(state: string): string {
  return `${STATE_COOKIE}=${state}; ${cookieAttrs(STATE_TTL_SEC)}`;
}

export function clearStateCookie(): string {
  return `${STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// 세션 서명 (HMAC-SHA256, 키 = SESSION_SECRET, 미설정 시 GOOGLE_CLIENT_SECRET 대체).
// SEC-2: 둘 다 없으면 빈 문자열 대신 프로세스별 난수 키(재시작 시 로그인 풀림).
let fallbackKey: string | null = null;
function hmacKey(): string {
  const env = process.env.SESSION_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  if (env) return env;
  if (!fallbackKey) fallbackKey = randomBytes(32).toString("base64url");
  return fallbackKey;
}

export function signSession(payloadB64: string): string {
  return createHmac("sha256", hmacKey()).update(payloadB64).digest("base64url");
}

// 서명 검증 성공 시 payload(base64url JSON) 반환, 실패 시 null.
export function verifySession(value: string): string | null {
  const i = value.lastIndexOf(".");
  if (i <= 0) return null;
  const payload = value.slice(0, i);
  const sig = value.slice(i + 1);
  const good = signSession(payload);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(good);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return payload;
}

export function sessionCookie(payloadB64: string): string {
  return `${SESSION_COOKIE}=${payloadB64}.${signSession(payloadB64)}; ${cookieAttrs(SESSION_TTL_SEC)}`;
}

// 세션 쿠키값 검증 + TrainerProfile 파싱. 서버 세션은 OAuth 발급분(google|meta)만 인정.
export function parseSessionPayload(cookieValue: string): TrainerProfile | null {
  const payload = verifySession(cookieValue);
  if (!payload) return null;
  try {
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const acc = normalizeProfile(JSON.parse(json));
    if (!acc || (acc.provider !== "google" && acc.provider !== "meta")) return null;
    return acc;
  } catch {
    return null;
  }
}

export type GoogleProfile = { sub: string; email: string; name: string; picture: string };

export async function exchangeCode(code: string): Promise<string> {
  const t0 = Date.now();
  try {
    return await exchangeCodeInner(code);
  } catch (e) {
    recordExternal("google-oauth", false, Date.now() - t0);
    throw e;
  }
}

async function exchangeCodeInner(code: string): Promise<string> {
  const t0 = Date.now();
  const c = oauthConfig();
  const body = new URLSearchParams({
    code,
    client_id: c.clientId,
    client_secret: c.clientSecret,
    redirect_uri: c.redirectUri,
    grant_type: "authorization_code",
  });
  // [EXT:google-oauth] 외부 호출 — 끊기면: /login?error=token_failed 복귀
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("token exchange failed: no access_token");
  recordExternal("google-oauth", true, Date.now() - t0);
  return data.access_token;
}

export async function fetchProfile(accessToken: string): Promise<GoogleProfile> {
  const t0 = Date.now();
  try {
    return await fetchProfileInner(accessToken);
  } catch (e) {
    recordExternal("google-oauth", false, Date.now() - t0);
    throw e;
  }
}

async function fetchProfileInner(accessToken: string): Promise<GoogleProfile> {
  const t0 = Date.now();
  // [EXT:google-oauth] 외부 호출 — 끊기면: /login?error=userinfo_failed 복귀
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`userinfo failed: ${res.status}`);
  const d = (await res.json()) as Partial<GoogleProfile>;
  if (!d.sub) throw new Error("userinfo failed: no sub");
  recordExternal("google-oauth", true, Date.now() - t0);
  return { sub: d.sub, email: d.email ?? "", name: d.name ?? "", picture: d.picture ?? "" };
}
