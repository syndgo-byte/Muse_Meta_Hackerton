import { NextRequest, NextResponse } from "next/server";
import { callMuseJson, museErrorResponse } from "@/lib/muse";

const SYSTEM = `You are the creature designer for OiShi-e! (The Ar Muse).
Given a real-world object (photo and/or text description), invent an original creature.
Reply with JSON only: {"name":string,"element":one of fire|water|grass|rock|wind,"personality":string,"attack":1-10,"defense":1-10,"flavor":one terse Korean caption under 24 chars}.
Keep it family-friendly and original. No Pokemon names. No emoji.`;

// EX-2: 오프라인 기본 크리처 (설명 해시로 속성만 고정, 나머지는 정해진 값).
const OFFLINE_ELEMENTS = ["fire", "water", "grass", "rock", "wind"] as const;
function offlineCreature(description: string) {
  let h = 0;
  for (const ch of description) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return {
    name: "미지 크리처",
    element: OFFLINE_ELEMENTS[h % OFFLINE_ELEMENTS.length],
    personality: "수줍음",
    attack: 5,
    defense: 5,
    flavor: "신호 끊김, 야생에서 발견",
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // UGC safety gate (Stage 2): user-authored skins must pass Llama Guard
    // (sexual/violent/hate screening) before binding to the modular skill rig.
    // No Guard endpoint is provisioned in this build; the checkpoint lives here.
    const description = String(body.description ?? "").slice(0, 500);
    const imageDataUrl =
      typeof body.imageDataUrl === "string" &&
      body.imageDataUrl.startsWith("data:image/")
        ? String(body.imageDataUrl).slice(0, 2_000_000)
        : undefined;
    if (!description && !imageDataUrl) {
      return NextResponse.json(
        { error: "description or imageDataUrl required" },
        { status: 400 }
      );
    }
    const model = process.env.MUSE_MODEL_SPARK ?? "muse-spark-1.3";
    try {
      // [EXT:meta-chat] 외부 호출 — 끊기면: 200 + 기본 크리처 대체 결과(fallback:true)
      const creature = await callMuseJson({
        model,
        system: SYSTEM,
        user: description ? `Object: ${description}` : "Object: see attached photo",
        imageDataUrl,
      });
      return NextResponse.json({
        creature,
        model,
        sam: "whole-image (SAM 3.1 masking endpoint pending docs)",
      });
    } catch {
      // EX-2: 키 없음·외부 실패 → 200 + 정해진 기본 크리처 (게임 흐름 유지).
      return NextResponse.json({
        creature: offlineCreature(description),
        model: "offline",
        sam: "whole-image (offline)",
        fallback: true,
      });
    }
  } catch (e) {
    const r = museErrorResponse(e, "api/creature"); // SEC-3: 본문은 서버 로그에만
    return NextResponse.json(r.body, { status: r.status });
  }
}
