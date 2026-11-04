// 출처 집계 (서버 전용). SOURCES_ENABLED에 든 구현체만 호출한다.
import { SOURCES_ENABLED, type SourceName } from "../config";
import { instagramHashtag } from "./instagramHashtag";
import { mockTrend } from "./mockTrend";
import { partnerVisit } from "./partnerVisit";
import { tiktok } from "./tiktok";
import type { TrendItem, VisitSignal } from "./types";
import { youtubeSearch } from "./youtubeSearch";

export type SourcesSnapshot = {
  trends: TrendItem[];
  visits: VisitSignal[];
  unconfigured: SourceName[];
};

export async function getSourcesSnapshot(): Promise<SourcesSnapshot> {
  const trends: TrendItem[] = [];
  const visits: VisitSignal[] = [];
  const unconfigured: SourceName[] = [];
  const enabled = new Set<SourceName>(SOURCES_ENABLED);
  if (enabled.has("mockTrend")) {
    const r = await mockTrend.getTrends();
    if (r.ok) trends.push(...r.data);
    else unconfigured.push("mockTrend");
  }
  if (enabled.has("instagramHashtag")) {
    const r = await instagramHashtag().getTrends();
    if (r.ok) trends.push(...r.data);
    else unconfigured.push("instagramHashtag");
  }
  if (enabled.has("youtubeSearch")) {
    const r = await youtubeSearch().getTrends();
    if (r.ok) trends.push(...r.data);
    else unconfigured.push("youtubeSearch");
  }
  if (enabled.has("tiktok")) {
    const r = await tiktok.getTrends();
    if (r.ok) trends.push(...r.data);
    else unconfigured.push("tiktok");
  }
  if (enabled.has("partnerVisit")) {
    const r = await partnerVisit.getVisits();
    if (r.ok) visits.push(...r.data);
    else unconfigured.push("partnerVisit");
  }
  return { trends, visits, unconfigured };
}
