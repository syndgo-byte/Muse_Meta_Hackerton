// 뮤즈 AI 토큰 금액 상수 단일 파일 (TOKEN_WORKORDER §1·§3).
// 적립률·단위·소비처 비용·AI 과금은 여기만 둔다. 다른 곳에 숫자를 직접 적지 않는다.
export const CREDIT_RATE = 0.03;

// 1 토큰 = KRW_PER_TOKEN원. 임시값이다. 단가는 Meta가 정하는 대로 나중에
// 이 값 하나만 바꾸면 전체가 따라간다.
export const KRW_PER_TOKEN = 1;

// 소비처 비용 (Tokens).
export const COST_UPGRADE = 300;
export const COST_DANCE = 500;
export const COST_MOTION_GEN = 800;

// 기본 교감 하루 무료 횟수 (임시값, 검토자가 조정). 날짜가 바뀌면 초기화.
export const FREE_FEED_PER_DAY = 3;
export const FREE_PLAY_PER_DAY = 3;
export const FREE_SLEEP_PER_DAY = 3;
// 무료 소진 후 추가 1회 비용 (Tokens, 세 행동 공통).
export const COST_CARE_EXTRA = 10;
// 그림일기 이미지 생성 1회 비용 (Tokens, §12).
export const COST_DIARY_IMAGE = 20;
// 핫플 방문 1회 적립 (Tokens, §11 임시값. D4-2에서는 안내 표시용, 적립 미연결).
export const CREDIT_VISIT = 50;

// 매장 결제 신호 카테고리.
export const TOKEN_CATEGORIES = ["coffee", "food", "alcohol", "other"] as const;
export type TokenCategory = (typeof TOKEN_CATEGORIES)[number];

// 데이터 출처 어댑터 (§11-1). 어느 구현체를 켤지는 여기 한 곳에서 정한다.
// 크롤링 금지: 공식 API·파트너 신호만. 키는 .env*에서 읽지 않는다.
export type SourceName =
  | "partnerVisit"
  | "mockTrend"
  | "instagramHashtag"
  | "youtubeSearch"
  | "tiktok";
export const SOURCES_ENABLED: readonly SourceName[] = ["partnerVisit", "mockTrend"];

// AI 호출 1회당 연산 과금 (Tokens). 잔량 부족 시 데모는 무료 통과.
export type AiCallKind = "look" | "feed" | "battle" | "diary" | "portrait" | "voice" | "ask";
export const AI_CALL_COSTS: Record<AiCallKind, number> = {
  look: 5,
  feed: 3,
  battle: 8,
  diary: 3,
  portrait: 20,
  voice: 2,
  ask: 5, // VA-1: 음성 질문 1회
};
