// 5-2: sim 영상 시간 구간 → 토큰 존 표 + cam GPS 판정 (순수 함수).
// 매장 목록은 lib/token/sources의 partnerVisit·mockTrend와 같은 가게다
// (소스 호출은 서버 전용이라 sim 표에 정적으로 둔다. 화면에 "demo data" 표시).
// 좌표는 데모용 근사치(서울 성수·연남·홍대)다.
export type SimVideo = "street" | "cafe";

export interface TokenZone {
  id: string;
  video: SimVideo;
  from: number; // 구간 시작 (초)
  to: number; // 구간 끝 (초)
  store: string; // 원본 가게명 (sources와 같은 키)
  placeEn: string; // 카드 표시명 (영어)
  partner: boolean; // partnerVisit 제휴 매장
  trending: string[]; // mockTrend SNS (없으면 [])
  amount: number; // 적립 예정 토큰
  distM: number; // 근처 힌트용 거리 표기
  lat: number; // 데모 좌표
  lon: number; // 데모 좌표
}

export const TOKEN_ZONES: TokenZone[] = [
  { id: "street-bakery", video: "street", from: 10, to: 20, store: "성수 베이커리", placeEn: "Seongsu Bakery", partner: true, trending: [], amount: 50, distM: 120, lat: 37.5445, lon: 127.0557 },
  { id: "street-trend", video: "street", from: 30, to: 40, store: "연남 푸드트럭", placeEn: "Yeonnam Food Truck", partner: true, trending: ["Instagram", "X"], amount: 50, distM: 80, lat: 37.5663, lon: 126.921 },
  { id: "cafe-trend", video: "cafe", from: 8, to: 18, store: "홍대 카페거리", placeEn: "Hongdae Cafe Street", partner: false, trending: ["Instagram"], amount: 50, distM: 200, lat: 37.557, lon: 126.925 },
  { id: "cafe-shop", video: "cafe", from: 30, to: 40, store: "성수 베이커리", placeEn: "Seongsu Bakery", partner: true, trending: [], amount: 50, distM: 150, lat: 37.5445, lon: 127.0557 },
];

export const ZONE_RADIUS_M = 50;
export const ZONE_RESHOW_MS = 30000;
export const CARD_SHOW_MS = 4000;

/** sim: 영상 시각의 존. 없으면 null. */
export function zoneAt(video: SimVideo, t: number): TokenZone | null {
  if (!Number.isFinite(t)) return null;
  return TOKEN_ZONES.find((z) => z.video === video && t >= z.from && t < z.to) ?? null;
}

/** 두 지점 거리 (m, haversine). */
export function distM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371000;
  const a = (Math.PI / 180) * (lat2 - lat1);
  const o = (Math.PI / 180) * (lon2 - lon1);
  const s = Math.sin(a / 2) * Math.sin(a / 2)
    + Math.cos((Math.PI / 180) * lat1) * Math.cos((Math.PI / 180) * lat2)
    * Math.sin(o / 2) * Math.sin(o / 2);
  return 2 * r * Math.asin(Math.sqrt(s));
}

/** cam: GPS 반경 50m 안의 존. 없으면 null. */
export function zoneAtGeo(lat: number, lon: number): TokenZone | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const seen = new Set<string>();
  for (const z of TOKEN_ZONES) {
    if (seen.has(z.store)) continue;
    seen.add(z.store);
    if (distM(lat, lon, z.lat, z.lon) <= ZONE_RADIUS_M) return z;
  }
  return null;
}

/** 같은 존 30초 쿨다운. */
export function shouldShow(
  lastShownAt: Record<string, number>,
  zoneId: string,
  nowMs: number,
  cooldownMs = ZONE_RESHOW_MS,
): boolean {
  const last = lastShownAt[zoneId] ?? -Infinity;
  return nowMs - last >= cooldownMs;
}
