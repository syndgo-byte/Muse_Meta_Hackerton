// 호환 shim: 성장/XP 단일 규격은 lib/progression.ts. 기존 import 경로 유지.
// NOTE: 서버(API 라우트)에서도 import하므로 최상위 브라우저 접근 금지.
export {
  EXP_DINE_MIN,
  EXP_DINE_MAX,
  EXP_WALK_PER_100M,
  WALK_DAY_CAP,
  EXP_SHARE,
  EXP_CARE,
  EXP_BATTLE_WIN,
  dineExp,
  claimWalkExp,
  growthStage,
  danceTier,
  DANCE_UNLOCKS,
  stagePrompt,
} from "@/lib/progression";
export type { GrowthStage, DanceSkill } from "@/lib/progression";
