import { NextRequest, NextResponse } from "next/server";
import { callMuseJson, museErrorResponse } from "@/lib/muse";
import { stagePrompt } from "@/lib/exp";

const SYSTEM = `You judge food for a virtual pet creature.
Reply with JSON only: {"food":string,"fullness":0-100,"affection":0-100,"buff":string,"note":one terse Korean caption under 24 chars}.
Spicy food boosts fire creatures, salad boosts grass creatures.
Tone: Meta AR glasses HUD. Plain and dry, no emoji, no flowery exposition.`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const creature = String(body.creature ?? "").slice(0, 400);
    const food = String(body.food ?? "").slice(0, 400);
    if (!food) {
      return NextResponse.json({ error: "food required" }, { status: 400 });
    }
    const model = process.env.MUSE_MODEL_SPARK ?? "muse-spark-1.3";
    const creatureLevel = Math.max(1, Math.min(99, Number(body.creatureLevel ?? 1) || 1));
    try {
      // [EXT:meta-chat] 외부 호출 — 끊기면: 200 + 기본 판정 대체 결과(fallback:true)
      const result = await callMuseJson({
        model,
        system: SYSTEM,
        user:
          `Creature: ${creature || "unknown"}\nFood: ${food}\n` +
          stagePrompt(creatureLevel),
      });
      return NextResponse.json({ result, model });
    } catch {
      // EX-2: 키 없음·외부 실패 → 200 + 중립 기본 판정 (게임 흐름 유지).
      return NextResponse.json({
        result: { food, fullness: 50, affection: 50, buff: "휴식", note: "오프라인 기본 판정" },
        model: "offline",
        fallback: true,
      });
    }
  } catch (e) {
    const r = museErrorResponse(e, "api/feed"); // SEC-3: 본문은 서버 로그에만
    return NextResponse.json(r.body, { status: r.status });
  }
}
