import { NextRequest, NextResponse } from "next/server";
import { callMuseChat, museErrorResponse } from "@/lib/muse";

const SYSTEM = `You are a small creature writing a one-paragraph diary in Korean about its day.
Write the diary FIRST, then on a new line write "QUIZ: <one question about where it went or what it ate>".
Do not reveal the answer in the diary directly. Keep it plain and short, no emoji.`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const log = String(body.log ?? "").slice(0, 800);
    if (!log) {
      return NextResponse.json({ error: "log required" }, { status: 400 });
    }
    const model = process.env.MUSE_MODEL_SPARK ?? "muse-spark-1.3";
    try {
      // [EXT:meta-chat] 외부 호출 — 끊기면: 200 + 정해진 일기 대체 결과(fallback:true)
      const text = await callMuseChat({
        model,
        system: SYSTEM,
        user: `Today the owner did: ${log}`,
        maxTokens: 2000,
      });
      return NextResponse.json({ diary: text, model });
    } catch {
      // EX-2: 키 없음·외부 실패 → 200 + 정해진 일기 (같은 형식: 일기 + QUIZ 한 줄).
      return NextResponse.json({
        diary: `오늘은 ${log.slice(0, 100)} 하루였다. AI가 쉬는 중이라 짧게 적는다.\nQUIZ: 오늘 주인은 무엇을 했을까?`,
        model: "offline",
        fallback: true,
      });
    }
  } catch (e) {
    const r = museErrorResponse(e, "api/diary"); // SEC-3: 본문은 서버 로그에만
    return NextResponse.json(r.body, { status: r.status });
  }
}
