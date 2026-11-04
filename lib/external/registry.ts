// lib/external/registry.ts — EX-1: 외부 호출 레지스트리 (표시용 데이터, 로직 없음).
// 심사 기준: "어디서 외부로 나가는지, 무엇이 나가는지, 끊기면 어떻게 되는지".
// sends는 실제 코드를 읽고 쓴다. 키 값은 절대 쓰지 않는다(이름만).
// VA-1·MC-1 항목은 status "planned"로 미리 두고, 그 작업이 끝날 때 usedBy·sends를 갱신한다.

export type ExternalStatus = "live" | "planned" | "local";

export type ExternalEntry = {
  id: string;
  provider: string;
  purpose: string;
  /** 호스트까지 (로컬/자리표시는 경로 또는 "없음"). */
  endpoint: string;
  envKeys: string[];
  /** 키 발급처 (이름만, 값 금지). */
  keyIssuer: string;
  usedBy: string[];
  /** 밖으로 나가는 데이터. */
  sends: string;
  /** 끊겼을 때 동작. */
  fallback: string;
  status: ExternalStatus;
};

export const EXTERNAL_REGISTRY: ExternalEntry[] = [
  {
    id: "meta-chat",
    provider: "Meta Model API (Muse Spark)",
    purpose: "전투 해설·크리처 생성·일기·먹이 판정·성장·관찰의 두뇌",
    endpoint: "api.meta.ai/v1/chat/completions",
    envKeys: ["MODEL_API_KEY", "MUSE_MODEL_SPARK"],
    keyIssuer: "dev.meta.ai (Meta 개발자 콘솔)",
    usedBy: [
      "lib/muse.ts",
      "app/api/battle/route.ts",
      "app/api/creature/route.ts",
      "app/api/diary/route.ts",
      "app/api/feed/route.ts",
      "app/api/levelup/route.ts",
      "app/api/look/route.ts",
    ],
    sends:
      "텍스트 프롬프트(설명·상태·전투 스펙·일기 로그 등). look/creature는 카메라 프레임 1장 추가(JPEG data URL, 최대 2MB, 저장 안 함)",
    fallback: "키 없음·실패 시 200 + 규칙 기반 대체 결과(fallback:true), 게임 흐름 유지",
    status: "live",
  },
  {
    id: "meta-image",
    provider: "Meta Model API (Muse Image)",
    purpose: "크리처 아트·일기 삽화 생성",
    endpoint: "api.meta.ai/v1/images/generations",
    envKeys: ["MODEL_API_KEY", "MUSE_MODEL_IMAGE"],
    keyIssuer: "dev.meta.ai (Meta 개발자 콘솔)",
    usedBy: ["lib/muse.ts", "app/api/image/route.ts"],
    sends: "텍스트 프롬프트(최대 1000자)",
    fallback: "키 없음·실패 시 200 + 대체 결과(fallback:true, 이미지 없음 표시)",
    status: "live",
  },
  {
    id: "meta-voice",
    provider: "Meta Model API (audio transcription)",
    purpose: "크리처 음성 명령 전사",
    endpoint: "api.meta.ai/v1/audio/transcriptions",
    envKeys: ["MODEL_API_KEY", "MUSE_MODEL_VOICE"],
    keyIssuer: "dev.meta.ai (Meta 개발자 콘솔)",
    usedBy: ["app/api/voice/route.ts", "lib/audio/micSource.ts"],
    sends: "음성 오디오 1건(16kHz 모노 WAV Blob, 저장 안 함) + 모델명",
    fallback: "키 없음·실패 시 200 + 대체 결과(fallback:true, 빈 전사 + 안내)",
    status: "live",
  },
  {
    id: "google-oauth",
    provider: "Google OIDC",
    purpose: "구글 소셜 로그인",
    endpoint: "accounts.google.com / www.googleapis.com",
    envKeys: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"],
    keyIssuer: "Google Cloud Console (OAuth 클라이언트 ID)",
    usedBy: ["lib/oauth.ts", "app/api/auth/google/route.ts", "app/api/auth/callback/google/route.ts"],
    sends: "인가 코드 + client_secret(토큰 교환), access_token(프로필 조회)",
    fallback: "미설정·실패 시 /login?error=… 로 복귀, 게스트 플레이 가능",
    status: "live",
  },
  {
    id: "meta-oauth",
    provider: "Meta OIDC (미연동 자리표시)",
    purpose: "메타 소셜 로그인 (예정)",
    endpoint: "없음",
    envKeys: [],
    keyIssuer: "없음",
    usedBy: ["app/api/auth/meta/route.ts"],
    sends: "없음(미연동 자리표시)",
    fallback: "/login?error=meta_unconfigured 로 복귀",
    status: "planned",
  },
  {
    id: "cdn-draco",
    provider: "로컬 번들 (EX-4에서 CDN 제거)",
    purpose: "GLB draco 압축 해제 디코더",
    endpoint: "로컬 /vendor/draco/ (외부 호출 없음)",
    envKeys: [],
    keyIssuer: "없음",
    usedBy: ["components/PovCreature.tsx"],
    sends: "없음(디코더 JS/wasm 로컬 로드만)",
    fallback: "로컬 번들(외부 호출 없음)",
    status: "local",
  },
  {
    id: "cdn-mediapipe",
    provider: "로컬 번들 (EX-4에서 CDN 제거)",
    purpose: "위험물 감지 ObjectDetector wasm",
    endpoint: "로컬 /vendor/mediapipe/ (외부 호출 없음)",
    envKeys: [],
    keyIssuer: "없음",
    usedBy: ["lib/motion/hazard.ts"],
    sends: "없음(wasm 로컬 로드 + 온디바이스 추론, 카메라 프레임 외부 전송 없음)",
    fallback: "로컬 번들(외부 호출 없음)",
    status: "local",
  },
  {
    id: "share-*",
    provider: "X·Threads·Facebook·Instagram·TikTok (링크 열기만)",
    purpose: "스냅샷·일기 원클릭 공유",
    endpoint: "각 SNS 공유 URL (앱에서 호출 안 함)",
    envKeys: [],
    keyIssuer: "없음",
    usedBy: ["lib/share.ts", "components/DiaryBox.tsx"],
    sends: "없음(링크 열기만, 데이터 전송 없음)",
    fallback: "해당 없음(외부 앱/브라우저에서 열기)",
    status: "live",
  },
  {
    id: "meta-chat(ask)",
    provider: "Meta Model API (Muse Spark)",
    purpose: "음성 질문 이해 (VA-1)",
    endpoint: "api.meta.ai/v1/chat/completions",
    envKeys: ["MODEL_API_KEY"],
    keyIssuer: "dev.meta.ai (Meta 개발자 콘솔)",
    usedBy: ["app/api/muse/ask/route.ts"],
    sends: "받아쓴 질문 텍스트(최대 500자) + 화면 상태·파트너·스킬·위치·잔액(JSON). 문장은 처리 후 버림",
    fallback: "키 없음·실패 시 200 + unknown 대체(fallback:true), 기존 정규식 경로로 동작",
    status: "live",
  },
  {
    id: "youtube-data",
    provider: "YouTube Data API v3",
    purpose: '위치 기반 "유튜브 힙한 곳" (VA-1)',
    endpoint: "www.googleapis.com/youtube/v3/search",
    envKeys: ["YOUTUBE_API_KEY"],
    keyIssuer: "Google Cloud Console (YouTube Data API v3)",
    usedBy: ["lib/places/youtube.ts", "app/api/muse/ask/route.ts"],
    sends: "위치(위경도)·검색어(핫플레이스)·API 키(쿼리). '유튜브/힙한' 언급 때만 호출",
    fallback: "키 없음·실패 시 data/places/hip.json 큐레이션 목록만 사용",
    status: "live",
  },
  {
    id: "instagram",
    provider: "없음 (호출 안 함)",
    purpose: "힙한 곳 태그·공유 (큐레이션만)",
    endpoint: "없음",
    envKeys: [],
    keyIssuer: "없음",
    usedBy: ["data/places/hip.json (VA-1 예정)", "lib/share.ts"],
    sends: "없음(공개 검색 API 없음·스크래핑은 약관 위반 → 큐레이션 + 공유 링크만)",
    fallback: "해당 없음(외부 호출 없음)",
    status: "local",
  },
  {
    id: "ray-ban-mic",
    provider: "없음 (외부 호출 아님)",
    purpose: "Ray-Ban Meta 안경 마이크 입력 (MC-1)",
    endpoint: "없음",
    envKeys: [],
    keyIssuer: "없음",
    usedBy: ["lib/audio/micSource.ts", "components/MicButton.tsx"],
    sends: "없음(휴대폰 블루투스 HFP 입력 장치. 기기 권한: RECORD_AUDIO·BLUETOOTH_CONNECT)",
    fallback: "해당 없음(외부 호출 없음)",
    status: "local",
  },
  {
    id: "vad-local",
    provider: "없음 (로컬 번들)",
    purpose: "말소리 감지 Silero VAD (MC-1)",
    endpoint: "로컬 /vendor/vad/ (외부 호출 없음)",
    envKeys: [],
    keyIssuer: "없음",
    usedBy: ["components/MicButton.tsx", "public/vendor/vad/"],
    sends: "없음(온디바이스 wasm/onnx 추론)",
    fallback: "VAD 로드 실패 시 기존 누르고 말하기(SpeechRecognition)로 대체",
    status: "local",
  },
];
