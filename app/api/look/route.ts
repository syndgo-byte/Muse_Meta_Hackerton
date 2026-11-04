import { NextRequest, NextResponse } from "next/server";
import { callMuseJson, museErrorResponse } from "@/lib/muse";
import { stagePrompt } from "@/lib/exp";

const SYSTEM = `You are the eyes of a virtual pet creature in OiShi-e! (The Ar Muse).
Given a photo and/or description plus the owner's creature dex (friends),
decide what the creature SEES and how it reacts.
Reply with JSON only:
{"seen": one of "food"|"creature"|"other",
 "label": short Korean name of what is seen,
 "friend": true if the seen creature matches a dex friend name, else false,
 "foe": true if the seen creature is unknown and looks hostile, else false,
 "emote": one of "happy"|"attack"|"hurt"|"sleep"|"eat"|"idle",
 "message": one terse Korean AR-glasses caption (under 24 chars), plain and dry, no emoji, no exclamation spam,
 "xpGain": 0-50,
 "confidence": 0-100 match confidence for the label,
 "nutrition": if food, one terse Korean nutrition note (e.g. "열량 320kcal·당 28g"), else ""}
Tone: Meta AR glasses HUD. Short fragments. Never explain, never gush.
Rules: food + hungry creature -> "eat", xpGain 10.
Friendly known creature -> "happy", xpGain 5.
Unknown hostile creature -> "attack", xpGain 20.
Nothing interesting -> "idle", xpGain 0.`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const description = String(body.description ?? "").slice(0, 500);
    const imageDataUrl =
      typeof body.imageDataUrl === "string" &&
      body.imageDataUrl.startsWith("data:image/")
        ? String(body.imageDataUrl).slice(0, 2_000_000)
        : undefined;
    const dex = Array.isArray(body.dex) ? body.dex.slice(0, 30).join(", ") : "";
    const status = body.status ?? {};
    if (!description && !imageDataUrl) {
      return NextResponse.json(
        { error: "description or imageDataUrl required" },
        { status: 400 }
      );
    }
    const model = process.env.MUSE_MODEL_SPARK ?? "muse-spark-1.3";
    const creatureLevel = Math.max(1, Math.min(99, Number(body.creatureLevel ?? 1) || 1));
    try {
      // [EXT:meta-chat] 외부 호출 — 끊기면: 200 + 기본 판정 대체 결과(fallback:true)
      const result = await callMuseJson({
        model,
        system: SYSTEM,
        user:
          `Seen: ${description || "see attached photo"}\n` +
          `Dex friends: ${dex || "none yet"}\n` +
          `Status: fullness ${status.fullness ?? "?"}, energy ${status.energy ?? "?"}\n` +
          stagePrompt(creatureLevel),
        imageDataUrl,
      });
      return NextResponse.json({ result, model });
    } catch {
      // EX-2: 키 없음·외부 실패 → 200 + 미확인 판정 (같은 모양, 게임 흐름 유지).
      return NextResponse.json({
        result: {
          seen: "other",
          label: "미확인",
          friend: false,
          foe: false,
          emote: "idle",
          message: "신호 끊김, 주변 경계 중",
          xpGain: 0,
          confidence: 0,
          nutrition: "",
        },
        model: "offline",
        fallback: true,
      });
    }
  } catch (e) {
    const r = museErrorResponse(e, "api/look"); // SEC-3: 본문은 서버 로그에만
    return NextResponse.json(r.body, { status: r.status });
  }
}
