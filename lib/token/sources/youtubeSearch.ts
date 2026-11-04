// YouTube Data API 검색 (어댑터만).
// 키가 없으면 "미설정"을 반환한다. 키는 .env*에서 읽지 않는다.
import type { TrendSource } from "./types";

export function youtubeSearch(opts?: { key?: string }): TrendSource {
  return {
    name: "youtubeSearch",
    async getTrends() {
      if (!opts?.key) return { ok: false, reason: "unconfigured" };
      return { ok: false, reason: "not-implemented", detail: "key wiring is future work" };
    },
  };
}
