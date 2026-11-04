import { NextRequest, NextResponse } from "next/server";
import { callMuseImage, museErrorResponse } from "@/lib/muse";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const prompt = String(body.prompt ?? "").slice(0, 1000);
    if (!prompt) {
      return NextResponse.json({ error: "prompt required" }, { status: 400 });
    }
    try {
      // [EXT:meta-image] 외부 호출 — 끊기면: 200 + 대체 결과(fallback:true, 이미지 없음 표시)
      const out = await callMuseImage(prompt);
      return NextResponse.json(out);
    } catch {
      // EX-2: 키 없음·외부 실패 → 200 + 이미지 없음 표시 (클라이언트는 기존 안내 문구).
      return NextResponse.json({
        b64: null,
        url: null,
        model: "offline",
        fallback: true,
        note: "오프라인: 이미지 없음",
      });
    }
  } catch (e) {
    const r = museErrorResponse(e, "api/image"); // SEC-3: 본문은 서버 로그에만
    return NextResponse.json(r.body, { status: r.status });
  }
}
