import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, parseSessionPayload } from "@/lib/oauth";

// GET /api/auth/session — 서명 세션 쿠키 검증 후 TrainerProfile 반환 (실패 시 401).
export async function GET(req: NextRequest) {
  const raw = req.cookies.get(SESSION_COOKIE)?.value ?? "";
  const account = raw ? parseSessionPayload(raw) : null;
  if (!account) return NextResponse.json({ account: null }, { status: 401 });
  return NextResponse.json({ account });
}
