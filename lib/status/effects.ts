// 교감 행동의 수치 변화 (순수 함수, CREATURE_STATUS §1·§2).
// 변화량은 현재 코드 값을 그대로 둔다. 이번 단계에서 바꾸지 않는다.
// 독립 tsc 컴파일을 위해 @/ import 없이 구조적 타입만 쓴다.
export type StatusLike = {
  fullness: number;
  energy: number;
  affection: number;
  xp: number;
  level: number;
};

export type CareActionName = "feed" | "play" | "sleep";

const clamp100 = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function applyCareAction(prev: StatusLike, action: CareActionName): StatusLike {
  if (action === "feed") {
    return {
      ...prev,
      fullness: clamp100(prev.fullness + 25),
      affection: clamp100(prev.affection + 5),
    };
  }
  if (action === "play") {
    return {
      ...prev,
      energy: clamp100(prev.energy - 15),
      affection: clamp100(prev.affection + 20),
      fullness: clamp100(prev.fullness - 8),
    };
  }
  return {
    ...prev,
    energy: clamp100(prev.energy + 35),
    fullness: clamp100(prev.fullness - 5),
  };
}
