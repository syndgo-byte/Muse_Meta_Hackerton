// SEC-5: LAN 페어링. GET은 루프백에서만 코드 표시(PC 허브 칩용).
// POST {code}가 맞으면 HttpOnly 쿠키를 준다. APK 런처(capacitor://)에서 부르므로 CORS 허용.
import { NextRequest, NextResponse } from "next/server";
import { PAIRING_COOKIE, isLoopbackHost } from "@/lib/pairing";

function withCors(res: NextResponse, req: NextRequest): NextResponse {
  const origin = req.headers.get("origin");
  if (origin) res.headers.set("Access-Control-Allow-Origin", origin);
  res.headers.set("Access-Control-Allow-Credentials", "true");
  res.headers.set("Vary", "Origin");
  return res;
}

export async function OPTIONS(req: NextRequest) {
  const res = new NextResponse(null, { status: 204 });
  res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return withCors(res, req);
}

export async function GET(req: NextRequest) {
  const pair = process.env.PAIRING_CODE || "";
  if (!pair) return NextResponse.json({ pairing: false });
  const host = req.headers.get("host") || "";
  if (!isLoopbackHost(host)) {
    return NextResponse.json({ error: "forbidden" }, { status: 401 });
  }
  return NextResponse.json({ pairing: true, code: pair });
}

export async function POST(req: NextRequest) {
  const pair = process.env.PAIRING_CODE || "";
  if (!pair) {
    return withCors(NextResponse.json({ error: "pairing_disabled" }, { status: 400 }), req);
  }
  let code = "";
  try {
    const body = (await req.json()) as { code?: unknown };
    code = typeof body.code === "string" ? body.code.trim() : "";
  } catch {
    return withCors(NextResponse.json({ error: "bad_request" }, { status: 400 }), req);
  }
  if (code !== pair) {
    return withCors(NextResponse.json({ error: "bad_code" }, { status: 401 }), req);
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PAIRING_COOKIE, pair, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
  return withCors(res, req);
}
