import { NextRequest, NextResponse } from "next/server";

// [EXT:meta-oauth] 미연동 자리표시 — 끊기면: /login?error=meta_unconfigured 복귀
// GET /api/auth/meta — Meta OIDC 플레이스홀더 (미연동).
// 연동 시 규격 (google 라우트와 동일): state 쿠키 → Meta 인가 URL →
// 콜백에서 SocialToken(provider=meta, sub, email, name, picture) 수신 →
// TrainerProfile(id=`meta:${sub}`) 매핑 → 서명 세션 발급 → /login?linked=meta.
export async function GET(req: NextRequest) {
  const back = req.nextUrl.clone();
  back.pathname = "/login";
  back.search = "?error=meta_unconfigured";
  return NextResponse.redirect(back);
}
