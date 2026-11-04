// lib/places/youtube.ts — VA-1: YouTube Data API v3 위치 검색 (서버 전용).
// 키가 없으면 호출하지 않고 큐레이션 목록만 쓴다. 키 값은 로그에 남기지 않는다.
import { recordExternal } from "../external/stats";

export type YoutubeSpot = {
  name: string;
  kind: "youtube";
  distM: number | null;
  videoId: string;
  source: string;
};

export async function searchYoutubeSpots(opts: {
  key: string;
  lat: number;
  lon: number;
  query: string;
}): Promise<YoutubeSpot[]> {
  // [EXT:youtube-data] 외부 호출 — 끊기면: 큐레이션 목록만 사용
  const t0 = Date.now();
  try {
    const url =
      "https://www.googleapis.com/youtube/v3/search" +
      `?part=snippet&type=video&maxResults=5&location=${opts.lat},${opts.lon}` +
      `&locationRadius=5km&q=${encodeURIComponent(opts.query)}&key=${encodeURIComponent(opts.key)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`youtube ${res.status}`);
    const data = (await res.json()) as { items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string } }> };
    recordExternal("youtube-data", true, Date.now() - t0);
    const out: YoutubeSpot[] = [];
    for (const it of data.items ?? []) {
      const title = (it.snippet?.title ?? "").trim().slice(0, 40);
      const videoId = it.id?.videoId ?? "";
      if (!title || !videoId) continue;
      out.push({ name: title, kind: "youtube", distM: null, videoId, source: "YouTube Data API v3" });
    }
    return out;
  } catch (e) {
    recordExternal("youtube-data", false, Date.now() - t0);
    throw e;
  }
}
