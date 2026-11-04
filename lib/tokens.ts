// 화면 표시용 토큰 헬퍼 (D4 이후).
// 잔액의 원본은 서버 원장(data/token-ledger.json)이다. 이 파일은 브라우저에
// 잔액·적립 기록을 두지 않는다. 금액 상수는 lib/token/config.ts 단일 파일에 있다.
export type StatKind = "atk" | "hp" | "def" | "spd";

// 스탯 영구 강화 1회 상승량.
export const UPGRADE_STEPS: Record<StatKind, number> = {
  atk: 2,
  hp: 12,
  def: 2,
  spd: 2,
};

// "12,450 Tokens" 형태.
export function formatCredits(n: number): string {
  return `${Math.max(0, Math.round(n)).toLocaleString("en-US")} Tokens`;
}
