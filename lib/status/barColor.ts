// lib/status/barColor.ts — 상태 바 색 통일 (PLATFORM_WORKORDER 7-3 22번).
// 기본색은 /camp 기준. 비율 50% 이하 주황, 10% 이하 빨강, 기절(체력 0) 빨강.
// 의존성 없음.

export type BarKind = "hp" | "fullness" | "energy" | "affection";

export const BAR_BASE: Record<BarKind, string> = {
  hp: "#9fe870",
  fullness: "#e8a13c",
  energy: "#38bdf8",
  affection: "#ff8fb2",
};

export const BAR_WARN = "#f59e0b";
export const BAR_DANGER = "#ff5a5a";

export function barColor(kind: BarKind, value: number, max: number): string {
  const v = Number.isFinite(value) ? value : 0;
  const m = Number.isFinite(max) && max > 0 ? max : 0;
  if (kind === "hp" && v <= 0) return BAR_DANGER;
  const ratio = m > 0 ? v / m : 0;
  if (ratio <= 0.1) return BAR_DANGER;
  if (ratio <= 0.5) return BAR_WARN;
  return BAR_BASE[kind];
}
