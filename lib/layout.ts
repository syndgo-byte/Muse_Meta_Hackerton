// 7-3 21번: 화면 하단 공통 치수. 한 곳에서 정의하고 세 화면이 함께 쓴다.
// CSS의 :root --bottom-gap/--bottom-side와 같은 값으로 유지한다.
export const BOTTOM_GAP = 12; // 하단 버튼에서 화면 아래 끝까지 (px). safe-area는 별도 가산.
export const BOTTOM_SIDE = 12; // 하단 바 좌우 여백 (px).
export const BOTTOM_BTN_H = 46; // 하단 바 버튼 높이 (px). /dex·/camp 바 버튼용.
// /pov의 CAM·MIC 원형 버튼(72px)은 버튼 종류가 달라 크기를 유지하고,
// 하단 간격·좌우 여백만 공통값을 쓴다.
