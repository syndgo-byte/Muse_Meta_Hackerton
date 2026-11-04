// 퀘스트 진행 (조우 → 포획 → 교감 → 배틀 → 거울 퀘스트). 기획: docs/GAME_PLAN.md
export type Quest = { met: number; caught: number; fed: number; won: number; diary: number };

export const QUEST_KEY = "snapquest-quest";

export const EMPTY_QUEST: Quest = { met: 0, caught: 0, fed: 0, won: 0, diary: 0 };

export function loadQuestState(): Quest {
  try {
    const raw = localStorage.getItem(QUEST_KEY);
    if (raw) return { ...EMPTY_QUEST, ...(JSON.parse(raw) as Partial<Quest>) };
  } catch {
    /* ignore */
  }
  return { ...EMPTY_QUEST };
}

export function questStep(q: Quest): number {
  if (q.met < 1) return 0;
  if (q.caught < 1) return 1;
  if (q.fed < 1) return 2;
  if (q.won < 1) return 3;
  if (q.diary < 1) return 4;
  return 5;
}
