// 조우 판정 상태 서버 저장 (BATTLE_DESIGN §15-1a).
// data/encounter-state.json에 pity·쿨다운·오늘 횟수·EXP 횟수. localStorage 금지.
// Node 전용. 독립 tsc 컴파일을 위해 상대 import만 쓴다.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { exclusive } from "../token/ledger";
import { MSG_LOW_CONFIDENCE, MSG_NO_MATCH } from "./config";
import {
  EMPTY_ENCOUNTER_STATE,
  decideEncounter,
  recordEncounterEnd,
  type DecideResult,
  type EncounterState,
} from "./decide";
import { matchLabel } from "./table";

export function encounterStatePath(): string {
  const override = process.env.ENCOUNTER_STATE_PATH;
  if (override && override.length > 0) return override;
  return join(process.cwd(), "data", "encounter-state.json");
}

function loadState(): EncounterState {
  try {
    const raw = readFileSync(encounterStatePath(), "utf8");
    return { ...EMPTY_ENCOUNTER_STATE, ...(JSON.parse(raw) as Partial<EncounterState>) };
  } catch {
    return { ...EMPTY_ENCOUNTER_STATE, speciesCooldownUntil: {}, expCounts: {} };
  }
}

function saveState(st: EncounterState): void {
  const p = encounterStatePath();
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(st));
  renameSync(tmp, p);
}

export interface ScanInput {
  label: string;
  confidence: number;
  caughtIds: string[];
  fainted: boolean;
  demo?: boolean;
}

export type ScanResult =
  | DecideResult
  | { kind: "none"; reason: "low-confidence" | "no-match"; message: string; state: EncounterState };

// 스캔 1회 판정 + 상태 저장. 매칭 실패는 저장하지 않는다.
export async function decideScan(input: ScanInput): Promise<ScanResult> {
  const m = matchLabel(input.label, input.confidence);
  if (m.speciesId === null && "reason" in m) {
    const message = m.reason === "low-confidence" ? MSG_LOW_CONFIDENCE : MSG_NO_MATCH;
    return { kind: "none", reason: m.reason, message, state: { ...EMPTY_ENCOUNTER_STATE } };
  }
  if (m.speciesId === null) {
    return { kind: "none", reason: "no-match" as const, message: MSG_NO_MATCH, state: { ...EMPTY_ENCOUNTER_STATE } };
  }
  return exclusive(() => {
    const st = loadState();
    const r = decideEncounter({
      speciesId: m.speciesId,
      caughtIds: input.caughtIds,
      fainted: input.fainted,
      demo: input.demo,
      now: Date.now(),
      roll: Math.random(),
      state: st,
    });
    saveState(r.state);
    return r;
  });
}

// 조우 종료 기록 (배틀 종료·도주·패배). G4 화면에서 호출한다.
export async function endEncounter(
  speciesId: string,
  result: "win" | "lose" | "flee"
): Promise<EncounterState> {
  return exclusive(() => {
    const st = recordEncounterEnd(loadState(), speciesId, result, Date.now());
    saveState(st);
    return st;
  });
}
