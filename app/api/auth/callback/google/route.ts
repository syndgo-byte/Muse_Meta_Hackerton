import { NextRequest, NextResponse } from "next/server";
import {
  STATE_COOKIE,
  clearStateCookie,
  exchangeCode,
  fetchProfile,
  isOAuthConfigured,
  sessionCookie,
} from "@/lib/oauth";
import type { TrainerProfile } from "@/lib/account";

function backTo(req: NextRequest, search: string): URL {
  const u = req.nextUrl.clone();
  u.pathname = "/login";
  u.search = search;
  return u;
}

function fail(req: NextRequest, code: string): NextResponse {
  const res = NextResponse.redirect(backTo(req, `?error=${code}`));
  res.headers.append("Set-Cookie", clearStateCookie());
  return res;
}

// GET /api/auth/callback/google — 인가 코드 수신 → 토큰 교환 → 프로필 조회
// → 서명 세션 쿠키 저장 → /login?linked=google (자동 /dex 직행).
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  if (q.get("error")) return fail(req, "access_denied");
  const code = q.get("code") ?? "";
  const state = q.get("state") ?? "";
  const expect = req.cookies.get(STATE_COOKIE)?.value ?? "";
  if (!isOAuthConfigured() || !code || !state || !expect || state !== expect) {
    return fail(req, "state_mismatch");
  }
  let token: string;
  try {
    token = await exchangeCode(code);
  } catch {
    return fail(req, "token_failed");
  }
  let profile: { sub: string; email: string; name: string; picture: string };
  try {
    profile = await fetchProfile(token);
  } catch {
    return fail(req, "userinfo_failed");
  }
  const fallback = profile.email.split("@")[0] || "트레이너";
  const name = (profile.name || fallback).trim().slice(0, 12) || "트레이너";
  const account: TrainerProfile = {
    id: `google:${profile.sub}`,
    provider: "google",
    name,
    email: profile.email,
    avatarUrl: profile.picture,
  };
  const payload = Buffer.from(JSON.stringify(account)).toString("base64url");
  const res = NextResponse.redirect(backTo(req, "?linked=google"));
  res.headers.append("Set-Cookie", clearStateCookie());
  res.headers.append("Set-Cookie", sessionCookie(payload));
  return res;
}
