import { NextRequest, NextResponse } from "next/server";
import { callMuseJson, museErrorResponse } from "@/lib/muse";
import {
  battleStats,
  elementOf,
  simulateBattle,
  typeEdge,
} from "@/lib/stats";
import { FAINTED_MESSAGE, isFainted } from "@/lib/status/decay";
import { isSpeciesId, readCreatureStatus } from "@/lib/status/store";

const SYSTEM = `You run a 3-turn wild creature battle for OiShi-e! (The Ar Muse).
Elements: fire > grass > water > fire, rock > wind > fire.
Reply with JSON only: {"turns":[string,string,string],"winner":"mine"|"wild","comment":one terse Korean caption under 24 chars}.
Each turn string is one dry Korean commentary fragment.
Tone: Meta AR glasses HUD. No emoji, no hype, no explanation.`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const mine = String(body.mine ?? "").slice(0, 500);
    const wild = String(body.wild ?? "").slice(0, 500);
    if (!mine || !wild) {
      return NextResponse.json(
        { error: "mine and wild required" },
        { status: 400 }
      );
    }
    // PC-1: 싸우는 크리처의 저장 성장값으로 판정한다.
    const mineIdRaw = String(body.mineId ?? "fire-01").slice(0, 32);
    if (!isSpeciesId(mineIdRaw)) {
      return NextResponse.json({ error: "invalid mineId" }, { status: 400 });
    }
    const mineId = mineIdRaw;
    const cur = await readCreatureStatus(mineId);
    // D4-3: 체력 0 (기절) → 배틀 시작 불가.
    if (isFainted(cur.hp)) {
      return NextResponse.json({ error: FAINTED_MESSAGE }, { status: 409 });
    }
    // 수치 체계: 아군은 저장값, 야생은 클라이언트 스펙으로 확정.
    const wildId = String(body.wildId ?? "rock-01").slice(0, 32);
    const mineLevel = cur.level;
    const wildLevel = Math.max(1, Math.min(99, Number(body.wildLevel ?? mineLevel) || mineLevel));
    const mineEl = elementOf(mineId);
    const wildEl = elementOf(wildId);
    const rawBoosts = (body.boosts as { atk?: unknown; hp?: unknown; def?: unknown; spd?: unknown } | undefined)
      ?? cur.statBoosts;
    const clampBoost = (v: unknown, cap: number) =>
      typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(cap, Math.floor(v))) : 0;
    const boosts =
      rawBoosts && typeof rawBoosts === "object"
        ? {
            atk: clampBoost(rawBoosts.atk, 99),
            hp: clampBoost(rawBoosts.hp, 999),
            def: clampBoost(rawBoosts.def, 99),
            spd: clampBoost(rawBoosts.spd, 99),
          }
        : undefined;
    const clampPct = (v: unknown) =>
      Math.max(0, Math.min(100, typeof v === "number" ? v : 0));
    const mineStats = battleStats(mineId, mineLevel, boosts, {
      fullness: clampPct(body.mineFull),
      affection: clampPct(body.mineAff),
      energy: typeof body.mineEnergy === "number" ? clampPct(body.mineEnergy) : undefined,
    });
    const wildStats = battleStats(wildId, wildLevel);
    const cond = typeof body.condMult === "number" ? body.condMult : 1;
    const edge = typeEdge(mineEl, wildEl);
    const statsBlock = {
      mine: mineStats,
      wild: wildStats,
      mineEdge: edge,
      wildEdge: typeEdge(wildEl, mineEl),
      condMult: Math.round(cond * 100) / 100,
    };
    // 결정적 시뮬레이션: LLM 실패 시 폴백 + 수치 검증 기준.
    const sim = simulateBattle(mine, mineStats, mineEl, cond, wild, wildStats, wildEl);
    try {
      const model = process.env.MUSE_MODEL_SPARK ?? "muse-spark-1.3";
      // [EXT:meta-chat] 외부 호출 — 끊기면: 수치 시뮬레이션 대체 결과(fallback:true)
      const result = await callMuseJson({
        model,
        system: SYSTEM,
        user:
          `My creature: ${mine} (Lv.${mineLevel} ${mineEl} HP${mineStats.hp} ATK${mineStats.atk} DEF${mineStats.def} SPD${mineStats.spd} edge x${edge} cond x${cond.toFixed(2)})\n` +
          `Wild creature: ${wild} (Lv.${wildLevel} ${wildEl} HP${wildStats.hp} ATK${wildStats.atk} DEF${wildStats.def} SPD${wildStats.spd} edge x${typeEdge(wildEl, mineEl)})\n` +
          `Stat-sim reference: winner=${sim.winner}. Respect it unless the matchup clearly says otherwise.`,
      });
      return NextResponse.json({ result, model, stats: statsBlock });
    } catch {
      // LLM 불가 시 결정적 수치 배틀로 그대로 진행 (시연 무중단).
      // EX-2: 대체 결과 표시 플래그.
      return NextResponse.json({
        result: {
          turns: sim.turns.slice(0, 3),
          winner: sim.winner,
          comment: `수치 배틀 ${sim.winner === "mine" ? "승리" : "패배"} (HP ${sim.mineHp}:${sim.wildHp})`,
        },
        model: "stat-sim",
        stats: statsBlock,
        fallback: true,
      });
    }
  } catch (e) {
    const r = museErrorResponse(e, "api/battle"); // SEC-3: 본문은 서버 로그에만
    return NextResponse.json(r.body, { status: r.status });
  }
}
