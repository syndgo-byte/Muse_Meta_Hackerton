// lib/places/hip.ts — VA-1: 힙한 곳 큐레이션 목록 (순수, 클라이언트 안전).
// 인스타는 공개 검색 API가 없고 스크래핑은 약관 위반이라 이 목록+공유 링크만 쓴다.
import data from "@/data/places/hip.json";

export type HipZone = "street" | "cafe";
export type HipTag = "instagram" | "youtube";

export type HipSpot = {
  name: string;
  kind: string;
  zone: HipZone;
  distM: number;
  tags: HipTag[];
  source: string;
};

export const HIP_SPOTS: HipSpot[] = (data as HipSpot[]).filter(
  (s) => s && typeof s.name === "string" && (s.zone === "street" || s.zone === "cafe")
);

// sim 구역 + 플랫폼으로 골라 거리순 최대 n개.
export function pickHipSpots(zone: HipZone | null, platform: "instagram" | "youtube" | "any", n = 3): HipSpot[] {
  return HIP_SPOTS.filter(
    (s) =>
      (zone === null || s.zone === zone) &&
      (platform === "any" || s.tags.includes(platform))
  )
    .sort((a, b) => a.distM - b.distM)
    .slice(0, Math.max(0, n));
}
