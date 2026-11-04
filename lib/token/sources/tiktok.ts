// TikTok 공식 API 연구용. 자리만 두고 구현은 나중에 한다.
import type { TrendSource } from "./types";

export const tiktok: TrendSource = {
  name: "tiktok",
  async getTrends() {
    return { ok: false, reason: "unconfigured", detail: "research-only placeholder" };
  },
};
