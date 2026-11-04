// CALM-1: 필드 크리처 차분 조절 상수 (한 곳).
// 숫자만 바꿔 조절. 데모 훅·BT-2·LV-2와 무관.
// 단위: _S = 초, _SCALE = 배율.
export const CALM_EMOTE_MIN_GAP_S = 20; // 자율 감정 발동 사이 최소 간격
export const CALM_RANDOM_PER_MIN = 1; // 이유 없는 랜덤 감정: 1분에 최대 N회
export const CALM_RANDOM_WINDOW_S = 60; // 랜덤 제한 윈도우
export const CALM_ROAM_MIN_GAP_S = 15; // 목표 없는 배회(이동) 최소 간격
export const CALM_BUBBLE_MIN_GAP_S = 15; // 말풍선 최소 간격 (동시 1개는 say 구조상 보장)
export const CALM_ROAM_RANGE_SCALE = 0.5; // 배회 이동 범위 배율 (절반 이하)
