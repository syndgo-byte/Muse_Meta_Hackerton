// 데이터 출처 어댑터 인터페이스 (§11-1).
// 크롤링 금지: 공식 API·파트너 신호만 쓴다. 호출은 서버에서만 한다.
// 어댑터 데이터는 추천 목록 표시용이다. 적립 계산에 직접 쓰지 않는다.
export type TrendItem = {
  storeName: string;
  category: string;
  score: number;
  sourceTag: string;
};

export type VisitSignal = {
  signalId: string;
  storeName: string;
  visitedAt: string;
};

export type SourceResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "unconfigured" | "not-implemented" | "error"; detail?: string };

export type TrendSource = {
  name: string;
  getTrends(): Promise<SourceResult<TrendItem[]>>;
};

export type VisitSource = {
  name: string;
  getVisits(): Promise<SourceResult<VisitSignal[]>>;
};
