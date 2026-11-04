import { NextRequest, NextResponse } from "next/server";
import { buildAuthorizeUrl, isOAuthConfigured, newState, stateCookie } from "@/lib/oauth";

// GET /api/auth/google — Google OIDC 로그인 시작.
// state 쿠키(10분, SameSite=Lax) 저장 후 구글 인가 URL로 리디렉트.
export async function GET(req: NextRequest) {
  if (!isOAuthConfigured()) {
    const back = req.nextUrl.clone();
    back.pathname = "/login";
    back.search = "?error=oauth_unconfigured";
    return NextResponse.redirect(back);
  }
  const state = newState();
  const res = NextResponse.redirect(buildAuthorizeUrl(state));
  res.headers.append("Set-Cookie", stateCookie(state));
  return res;
}
