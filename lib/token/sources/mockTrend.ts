// 시연용 고정 핫플 목록 (기본값). SNS API 없이 화면에 추천 목록을 보여준다.
import type { TrendSource } from "./types";

export const mockTrend: TrendSource = {
  name: "mockTrend",
  async getTrends() {
    return {
      ok: true,
      data: [
        { storeName: "성수 베이커리", category: "food", score: 98, sourceTag: "mock" },
        { storeName: "연남 푸드트럭", category: "food", score: 91, sourceTag: "mock" },
        { storeName: "홍대 카페거리", category: "coffee", score: 87, sourceTag: "mock" },
      ],
    };
  },
};
