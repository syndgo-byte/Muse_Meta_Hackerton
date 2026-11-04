// 매장 등록 + 파트너 방문 신호 (웹훅). 시연은 흉내 신호를 돌려준다.
// 적립은 이 방문 신호로만 한다 (SNS 데이터는 표시용). 적립 연결은 별도 단계.
import type { VisitSource } from "./types";

export const partnerVisit: VisitSource = {
  name: "partnerVisit",
  async getVisits() {
    const now = new Date().toISOString();
    return {
      ok: true,
      data: [
        { signalId: "partner-visit-001", storeName: "성수 베이커리", visitedAt: now },
        { signalId: "partner-visit-002", storeName: "연남 푸드트럭", visitedAt: now },
      ],
    };
  },
};
