import { NextRequest, NextResponse } from "next/server";
import { callMuseJson } from "@/lib/muse";
import { LV2_MODEL, resolveLevelup, type Activity } from "@/lib/levelup";
import { isSpeciesId, readCreatureStatus } from "@/lib/status/store";
import type { Role } from "@/lib/battle/roster";

// LV-2 하이브리드 성장 (서버에서만 AI 호출하는 유일한 곳).
// POST {role, level, activity} → {boosts, message, source}.
// 키 없음·실패·3초 초과·불량 응답이면 규칙 값 (source:"rule").
const MODEL = process.env.MUSE_MODEL_SPARK ?? LV2_MODEL;
const ROLES = ["attacker", "tanker", "speed", "supporter", "trick"] as const;

function parseActivity(v: unknown): Activity | null {
  const r = (v ?? {}) as Partial<Record<keyof Activity, unknown>>;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? Math.max(0, x) : null);
  const walkM = num(r.walkM);
  const scans = num(r.scans);
  const dances = num(r.dances);
  if (walkM === null || scans === null || dances === null) return null;
  return { walkM, scans, dances };
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const role = body.role;
  const level = body.level;
  const activity = parseActivity(body.activity);
  const speciesRaw = body.speciesId;
  if (typeof role !== "string" || !(ROLES as readonly string[]).includes(role)) {
    return NextResponse.json({ error: "invalid role" }, { status: 400 });
  }
  // PC-1: speciesId가 있으면 그 크리처의 저장 레벨을 쓴다(단일 원천). 없으면 기존 body.level.
  let levelNum: number;
  if (speciesRaw !== undefined) {
    if (!isSpeciesId(speciesRaw)) {
      return NextResponse.json({ error: "invalid speciesId" }, { status: 400 });
    }
    levelNum = (await readCreatureStatus(speciesRaw as string)).level;
  } else {
    if (typeof level !== "number" || !Number.isFinite(level) || level < 1 || level > 100) {
      return NextResponse.json({ error: "invalid level" }, { status: 400 });
    }
    levelNum = Math.floor(level);
  }
  if (!activity) {
    return NextResponse.json({ error: "invalid activity" }, { status: 400 });
  }
  const input = { role: role as Role, level: levelNum, activity };
  const key = process.env.MODEL_API_KEY;
  const aiCall = async () => {
    if (!key) throw new Error("no-key");
    // [EXT:meta-chat] 외부 호출 — 끊기면: 규칙 성장값(source:"rule", fallback:true)
    return callMuseJson({
      model: MODEL,
      maxTokens: 2500, // LV-2 후속: 400이면 length 절단(content null) → 2500
      system: "너는 게임 크리처 성장 조력자다. JSON 객체 하나만 출력한다.",
      user: JSON.stringify({
        task: "활동 보정 가중치를 조정하라. correction 합계는 pool 이하, 각 항목은 0 이상 정수. hp도 포인트 단위.",
        level: input.level,
        pool: Math.max(0, (input.level - 1) * 2),
        activity: input.activity,
        message: "25자 이내 한글 한 줄 (예: 오늘 많이 걸었더니 발이 빨라졌어)",
        format: { correction: { atk: 0, hp: 0, def: 0, spd: 0 }, message: "" },
      }),
    });
  };
  const r = await resolveLevelup(input, aiCall);
  // EX-2: 규칙 값(source:"rule")이면 대체 결과 표시.
  return NextResponse.json(r.source === "ai" ? r : { ...r, fallback: true });
}
