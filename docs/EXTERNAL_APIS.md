# 외부 API·외부 연결 표 (EX-5 자동 생성)

> 이 파일은 `node scripts/gen-external-table.mjs`로 생성한다. 직접 고치지 말고
> `lib/external/registry.ts`를 고친 뒤 다시 생성한다. 키 값은 절대 쓰지 않는다(이름만).

화면 패널: 캠프 탭 4 '외부 연결' (/camp). 상태 API: `GET /api/health/external`.

| id | 상태 | 목적 | 나가는 데이터 | 필요 env | 키 발급처 | 끊기면 |
|---|---|---|---|---|---|---|
| meta-chat | live | 전투 해설·크리처 생성·일기·먹이 판정·성장·관찰의 두뇌 | 텍스트 프롬프트(설명·상태·전투 스펙·일기 로그 등). look/creature는 카메라 프레임 1장 추가(JPEG data URL, 최대 2MB, 저장 안 함) | MODEL_API_KEY, MUSE_MODEL_SPARK | dev.meta.ai (Meta 개발자 콘솔) | 키 없음·실패 시 200 + 규칙 기반 대체 결과(fallback:true), 게임 흐름 유지 |
| meta-image | live | 크리처 아트·일기 삽화 생성 | 텍스트 프롬프트(최대 1000자) | MODEL_API_KEY, MUSE_MODEL_IMAGE | dev.meta.ai (Meta 개발자 콘솔) | 키 없음·실패 시 200 + 대체 결과(fallback:true, 이미지 없음 표시) |
| meta-voice | live | 크리처 음성 명령 전사 | 음성 오디오 1건(webm Blob, 저장 안 함) + 모델명 | MODEL_API_KEY, MUSE_MODEL_VOICE | dev.meta.ai (Meta 개발자 콘솔) | 키 없음·실패 시 200 + 대체 결과(fallback:true, 빈 전사 + 안내) |
| google-oauth | live | 구글 소셜 로그인 | 인가 코드 + client_secret(토큰 교환), access_token(프로필 조회) | GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI | Google Cloud Console (OAuth 클라이언트 ID) | 미설정·실패 시 /login?error=… 로 복귀, 게스트 플레이 가능 |
| meta-oauth | planned | 메타 소셜 로그인 (예정) | 없음(미연동 자리표시) | 없음 | 없음 | /login?error=meta_unconfigured 로 복귀 |
| cdn-draco | local | GLB draco 압축 해제 디코더 | 없음(디코더 JS/wasm 로컬 로드만) | 없음 | 없음 | 로컬 번들(외부 호출 없음) |
| cdn-mediapipe | local | 위험물 감지 ObjectDetector wasm | 없음(wasm 로컬 로드 + 온디바이스 추론, 카메라 프레임 외부 전송 없음) | 없음 | 없음 | 로컬 번들(외부 호출 없음) |
| share-* | live | 스냅샷·일기 원클릭 공유 | 없음(링크 열기만, 데이터 전송 없음) | 없음 | 없음 | 해당 없음(외부 앱/브라우저에서 열기) |
| meta-chat(ask) | live | 음성 질문 이해 (VA-1) | 받아쓴 질문 텍스트(최대 500자) + 화면 상태·파트너·스킬·위치·잔액(JSON). 문장은 처리 후 버림 | MODEL_API_KEY | dev.meta.ai (Meta 개발자 콘솔) | 키 없음·실패 시 200 + unknown 대체(fallback:true), 기존 정규식 경로로 동작 |
| youtube-data | live | 위치 기반 "유튜브 힙한 곳" (VA-1) | 위치(위경도)·검색어(핫플레이스)·API 키(쿼리). '유튜브/힙한' 언급 때만 호출 | YOUTUBE_API_KEY | Google Cloud Console (YouTube Data API v3) | 키 없음·실패 시 data/places/hip.json 큐레이션 목록만 사용 |
| instagram | local | 힙한 곳 태그·공유 (큐레이션만) | 없음(공개 검색 API 없음·스크래핑은 약관 위반 → 큐레이션 + 공유 링크만) | 없음 | 없음 | 해당 없음(외부 호출 없음) |
| ray-ban-mic | planned | Ray-Ban Meta 안경 마이크 입력 (MC-1 예정) | 없음(휴대폰 블루투스 HFP 입력 장치. 기기 권한: RECORD_AUDIO·BLUETOOTH_CONNECT) | 없음 | 없음 | 해당 없음(외부 호출 없음) |
| vad-local | planned | 말소리 감지 Silero VAD (MC-1 예정) | 없음(온디바이스 wasm/onnx 추론) | 없음 | 없음 | 해당 없음(외부 호출 없음) |

원천: lib/external/registry.ts (13개 항목).
