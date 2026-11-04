// 7-C/8-A: sim 영상 시간 구간별 인도(걷는 길) 위치 표. 화면 정규 x 0..1.
// 8-A 실측값 (street 60초·cafe 49초, 2초 간격 프레임). 크리처 폭 때문에 0.3~0.7 안으로 제한.
export type SimVideo = "street" | "cafe";

export interface LaneSegment {
  from: number; // 구간 시작 (초)
  to: number; // 구간 끝 (초)
  x0: number; // 인도 왼쪽 끝 (0..1)
  x1: number; // 인도 오른쪽 끝 (0..1)
}

export const SIM_PATHS: Record<SimVideo, LaneSegment[]> = {
  street: [
    { from: 0, to: 12, x0: 0.3, x1: 0.42 },
    { from: 12, to: 25, x0: 0.3, x1: 0.44 },
    { from: 25, to: 35, x0: 0.3, x1: 0.45 },
    { from: 35, to: 48, x0: 0.3, x1: 0.42 },
    { from: 48, to: 60, x0: 0.3, x1: 0.45 },
  ],
  cafe: [
    { from: 0, to: 15, x0: 0.35, x1: 0.55 },
    { from: 15, to: 30, x0: 0.3, x1: 0.45 },
    { from: 30, to: 45, x0: 0.35, x1: 0.55 },
    { from: 45, to: 60, x0: 0.35, x1: 0.55 },
  ],
};

/** 영상 시각 t(초)의 인도 범위. 표 범위를 벗어나면 마지막 구간으로 고정한다. */
export function laneAt(video: SimVideo, t: number): { x0: number; x1: number } {
  const segs = SIM_PATHS[video];
  const tt = Number.isFinite(t) ? Math.max(0, t) : 0;
  const seg = segs.find((s) => tt >= s.from && tt < s.to) ?? segs[segs.length - 1];
  return { x0: seg.x0, x1: seg.x1 };
}
