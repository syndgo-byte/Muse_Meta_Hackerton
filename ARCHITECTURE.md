# OiShi-e! The Ar Muse — ARCHITECTURE.md

> 개발 표준 문서. 향후 모든 개발과 파일 배치는 이 문서의 규격을 따른다.
> 최종 갱신: 2026-10-30, 5항(정리/문서화). 1~4항 적용 상태 반영.

## 1. 개요 · 스택 · 실행

- Next.js 14.2.5 (App Router) + React 18 + three.js. 패키지 `snap-quest@0.1.0`
  (`package.json:1-16`). Git 브랜치 `master`, 커밋 0개(최초 푸시 대기).
- 스크립트(`package.json:5-9`): `dev` = `next dev -p 3000`,
  `build` = `next build`, `start` = `next start -p 3000`.
- `next.config.mjs:4-14`: 전 경로 `no-store` 헤더(BFCache·중간 캐시 방지).
- 실행: 개발 `npm run dev`, 배포 검증 `npm run build` 후 `npm start`.
  3000번 서버의 시작·중지는 소유자(부모)가 담당한다.

## 2. 디렉토리 구조와 단일 책임

```
D:\Meta_hackerton\                  # Next.js 14 + three.js
├── app/                            # 라우트 = 화면. 화면별 단일 책임
│   ├── page.tsx                    # 랜딩 (100vw/100vh full-bleed, start-root)
│   ├── login/page.tsx              # 로그인 (LOGIN_HANDLERS 경유 → /dex 직행, §5)
│   ├── slots/page.tsx              # [레거시] /dex 리다이렉트 스텁 (삭제 금지)
│   ├── dex/page.tsx + layout.tsx   # 크리처 도감 & 파트너 관리 (24종 전시, 춤 전담)
│   ├── camp/page.tsx               # 트레이너 라운지 (page-narrow, 회복/Quota/스탯/일기)
│   ├── pov/page.tsx + layout.tsx   # AR 필드 탐험 (카메라/시뮬레이터, 감정 전담)
│   ├── hero/page.tsx               # [개발용] 외부 3D 변환 리뷰 (sf3d 2종)
│   ├── survey/page.tsx             # [개발용] R2 전수 표정 검증 하네스
│   ├── api/auth/{google,meta,callback/google,session}/route.ts  # OAuth (§5)
│   ├── api/{battle,creature,diary,feed,image,look,voice}/route.ts
│   │                               # Meta API 프록시 + 결정적 폴백 (키 서버 전용)
│   └── layout.tsx / globals.css    # 전역 셸 + 다크 글래스/HUD 디자인 시스템 (§6)
├── components/                     # 재사용 UI/3D (화면 로직 없음)
│   ├── PovCreature.tsx             # AR 3D 액터 (GLB·표정·모션·스냅샷)
│   ├── DexScene.tsx                # 도감 턴테이블 3D 씬
│   ├── HudOverlay.tsx              # AR HUD 오버레이 (presentational, §3.4)
│   └── BattleBox/CaptureBox/DiaryBox/FeedBox.tsx  # [레거시] 구 SnapQuest 박스
├── lib/ (21종)                     # 순수 로직, React 없음, localStorage 영속
│   ├── species.ts                  # 24종 로스터 (id·이름·속성·초상화·프롬프트)
│   ├── facePaint.ts                # UV 텍스처 표정 (눈/입 glyph + TUNE)
│   ├── puppetRig.ts                # 전신 리지드 모션 (감정별 제스처)
│   ├── autoRig.ts                  # CPU 스키닝 본 리그 — 발/스텝 보존 (§4)
│   ├── creatureRig.ts              # [미사용] 절차적 마스코트 팩토리 (예비)
│   ├── progression.ts              # 성장/XP 단일 규격 (상수·헬퍼, §3.3)
│   ├── exp.ts                      # [호환 shim] 구 import 경로 유지, 실체는 progression
│   ├── stats.ts                    # 레벨 곡선·전투 스탯·상성·시뮬레이션 (§3.2)
│   ├── state.ts                    # 크리처 상태 + 컨디션 판정 (§3.1~3.2)
│   ├── tokens.ts                   # MUSE AI Quota + AI 과금 (§3.5)
│   ├── account.ts                  # 트레이너 프로필 + 로그인 핸들러 3종 (§5)
│   ├── oauth.ts                    # [서버 전용] Google OIDC 헬퍼 (§5)
│   ├── muse.ts                     # [서버 전용] Meta Model API 클라이언트
│   ├── slots.ts                    # [레거시] 세이브 슬롯 (우회, 삭제 금지)
│   ├── quest.ts                    # 퀘스트 진행도 (조우→포획→교감→배틀→일기)
│   ├── share.ts                    # SNS 공유 파이프라인 (합성·딥링크)
│   ├── walk.ts                     # 산책 거리 누적 + 속성 기운 한 줄
│   ├── cry.ts / sfx.ts / bgm.ts    # 울음소리 / 효과음 / WebAudio BGM
│   └── format.ts                   # [레거시] 구 박스용 포맷터
├── public/                         # 확정 에셋 (빌드 없이 서빙)
│   ├── models/ 24 .glb + ATTRIBUTION.md  # 크리처 3D (텍스처 내장, 재생성 금지)
│   ├── dex/ 24 .jpg                # 초상화/스캔 카드
│   ├── cries/ 192 .mp3             # 종별 × 8기분 울음소리
│   ├── hdri/ 3 .hdr + ATTRIBUTION.md  # 시뮬레이터 IBL 배경 (CC0)
│   ├── hero/ 2 .glb + 2 .webp      # sf3d 리뷰용 (/hero 전용)
│   ├── dance/ 3종                  # ateez.mp4 + ateez_raw.f136.mp4(중복) +
│   │                               # ateez_raw.f140.m4a (코드 참조 0, §7)
│   └── oishie.mp3 / woni.jpg       # BGM·아트워크 단건
├── scripts/ (15종)                 # 일회성 생성기 (런타임 의존 금지, §7)
│   └── build-creature-models / cast_dance / contact-tex / ext3d-all /
│       ext3d-hero / fetch-3d-creatures / fetch_oishie / fetch_woni /
│       fix-creature-glbs / generate-cries / probe-spaces / shoot-faces /
│       test-muse-connection / trim_voice / verify-models
├── docs/ (5종)                     # GAME_PLAN · CRY_DESIGN · DEMO_SCRIPT ·
│                                   # STAGE1_LIMITS · Snap_Quest_Hackathon_Plan
├── scratch/                        # 조사/실험 격리소 (gitignore, 커밋 금지, 보존)
│   ├── survey1/ · survey2/         # R1 전수 캡처 증거
│   ├── glb-orig/                   # AI 생성 원본 24종 (가공본과 바이트 상이)
│   ├── aiconfirm/                  # 1-5.PNG + hero/ (매니페스트·sf3d 2종·webp 2종)
│   └── *.py · handoff-*.md         # 구 조사 스크립트·인수인계 메모
└── 루트 설정                      # .env(무시) · .env.example(추적) · .gitignore ·
                                    # tsconfig.json · next-env.d.ts ·
                                    # next.config.mjs · package.json(+lock)
```

| 디렉토리 | 책임 | 금지 |
|---|---|---|
| `app/` | 라우팅 + 화면 조립. 데이터는 `lib/`에서, 3D는 `components/`에서 | 3D 씬 직접 구축, 수치 공식 하드코딩 |
| `app/api/` | Meta API 프록시 + 결정적 폴백. 키는 서버에만 | 클라이언트에서 직접 Meta API 호출 |
| `components/` | 재사용 렌더 단위. props in → 화면 out | localStorage 직접 접근, 라우팅 |
| `lib/` | 프레임워크 무관 순수 로직 + 영속. 단위 재사용의 유일한 통로 | React/JSX import, DOM 직접 조작(3D 모듈 제외) |
| `public/` | 빌드 없이 서빙되는 확정 에셋 | 조사용 캡처·임시 바이너리 |
| `scripts/` | 일회성 생성기. 실행 전 반드시 주석의 경고 확인 | 프로덕션 코드의 런타임 의존 |
| `docs/`·`scratch/` | 문서·실험 격리. `scratch/`는 커밋 금지 | 프로덕션 코드의 import |

## 3. 데이터 모델

영속은 전부 브라우저 로컬이다. 서버 DB가 없으므로 멀티디바이스·어뷰징
검증은 범위 밖이다.

### 3.1 영속 키 인벤토리

| 키 | 소유자 | 형태 |
|---|---|---|
| `snapquest-status` | `state.ts:19` | `Status{fullness,energy,affection,xp,level}`. 기본 `50/80/20/0/1`(`state.ts:11-17`) |
| `snapquest-seen` | `state.ts:80` | 조우 id 배열, 최근 100개 |
| `oishie-account` | `account.ts:16` | `TrainerProfile` (§5) |
| `oishie-tokens` | `tokens.ts:5` | Quota 잔액 number |
| `oishie-walk-claim` | `progression.ts:52` | `WalkClaim{day,claimedM,dayExp}` 산책 정산 상태 |
| `snapquest-walk` | `walk.ts:2` | 누적 이동거리(m) number |
| `oishie-stat-boosts` | `stats.ts:65` | 종별 `{atk,hp}` 업그레이드 기록 |
| `snapquest-quest` | `quest.ts:4` | `Quest{met,caught,fed,won,diary}` 카운터 |
| `snapquest-slots/-trainer/-dex` | `slots.ts:5-9` | [레거시] 슬롯·트레이너명·도감 |
| `snapquest-bgm` | `bgm.ts:4` | BGM 설정 |
| 쿠키 `oishie-oauth-state` | `oauth.ts:10` | CSRF state, 10분(`oauth.ts:12`) |
| 쿠키 `oishie-session` | `oauth.ts:11` | HMAC 서명 세션, 30일(`oauth.ts:13`) |

일기(`api/diary`)는 별도 키 없이 API 호출로만 생성된다.

### 3.2 크리처 스탯 (`lib/stats.ts` + `lib/state.ts`)

- 종 id는 `<element>-<nn>` 형식. `elementOf()`가 id에서 속성을 파싱하고
  (`stats.ts:127-131`), 속성 베이스는 `ELEMENT_BASE` 5종
  (`stats.ts:40-46`). `baseStatsFor()`가 도감 번호 분산을 더한다
  (`stats.ts:48-59`).
- 전투 스탯(`battleStats()`, `stats.ts:90-110`):
  `HP = Base + Lv*15 + 포만*0.2 + boost.hp`,
  `ATK = Base + Lv*4.5 + 애정*0.1 + boost.atk`,
  `DEF = Base + Lv*3.5`, `SPD = Base + Lv*2.0`.
- 컨디션 보정 `conditionMult()` = 평균(포만·활력·애정) → 0.85~1.15 배율
  (`stats.ts:133-137`).
- 상성 `typeEdge()` (`stats.ts:121-125`): 유리 ×1.5 / 불리 ×0.7 / 그 외 ×1.
  상성표는 `STRONG` (`stats.ts:113-119`).
- `simulateBattle()` 3턴 결정적 시뮬레이션: LLM 실패 시 폴백 + 수치 검증용
  (`stats.ts:146-171`). 빠른 쪽 선공(`stats.ts:161`).
- 컨디션 판정(`getCreatureCondition()`, `state.ts:66-78`):
  배고픔(포만<30) · 졸림(활력<25) · 단짝(애정≥70) · 지침(스트레스≥61),
  해당 없음 → 쾌적. `stressOf()`는 3수치 평균의 역수(`state.ts:52-55`).
- `applyLook()`이 탐지 결과(먹이/동족/적대)에 따라 포만·활력·애정·XP를
  일괄 갱신한다(`state.ts:104-134`).

### 3.3 EXP · 성장 기준 (`lib/progression.ts`, 단일 규격)

레벨 공식은 `stats.ts` 단일 기준(`stats.ts:11-14`):
`Required_EXP = floor(100 * Level^1.35)`.
`levelForXpTotal()`·`xpThreshold()`로 역산한다(`stats.ts:17-35`).
`progression.ts:6`이 re-export하고, `lib/exp.ts`는 구 import 호환 shim이다.

| 파이프라인 | 지급량 | 출처 |
|---|---|---|
| 미식 탐험 | 50~100 가변 `dineExp()` | `progression.ts:9-10,35-37` |
| 산책 | 15/100m, 일 상한 300 `claimWalkExp()` | `progression.ts:11-12,70-91` |
| 음성 교감 | 10~20 가변 `voiceExp()` | `progression.ts:13-14,40-42` |
| 배틀 승리 | 40 고정 `EXP_BATTLE_WIN` | `progression.ts:15` |
| SNS 공유 | 80 고정 `EXP_SHARE` (AR 외 보상) | `progression.ts:16` |
| 먹이 주기 | 10 고정 `EXP_FEED` | `progression.ts:18` |
| LLM 판정(look) | 0~50 클램프 `clampLookGain()` | `progression.ts:22-23,45-48` |

- `EXP_CARE`는 deprecated 별칭이다(`progression.ts:20`).
- 캠프(간식/놀이/낮잠)는 회복 전용으로 XP가 없다. XP 원천은 AR 4종
  (미식·산책·음성·배틀, `ARAction`, `progression.ts:26-32`) + 공유/먹이다.
- 성장 단계(`growthStage()`, `progression.ts:95-99`):
  Lv.1~4 유년기 → Lv.5~9 성장기 → Lv.10+ 완전체.
- `DANCE_UNLOCKS` 3종 밈 댄스 해금(`progression.ts:106-110`),
  `STAGE_UNLOCKS` 능력/언락/AR/배틀 문구(`progression.ts:122-150`),
  `stagePrompt()` AI 대사 지능(`progression.ts:156-159`).
- 규칙: 화면은 `addXp()`(`state.ts:47-50`)로만 적립하고, 수치는
  `progression.ts` 상수·헬퍼로만 다룬다. 하드코딩 금지.

### 3.4 HUD 구조 (`components/HudOverlay.tsx` + `.hud-*`)

- Presentational only. 탐지 로직 없음. 호출자가 `phase`만 전달한다
  (`HudOverlay.tsx:1-3`).
- Props: `phase: HudPhase | null`, `shop: string`, `amount: number`
  (`HudOverlay.tsx:10-18`). `HudPhase = "target" | "charge"`
  (`HudOverlay.tsx:6`). `phase=null`이면 렌더 없음.
- `target`상(`HudOverlay.tsx:22-28`): `.hud-ring` 스캔 링 +
  `.hud-lock` 코너 브래킷 + `.hud-cross` 크로스 +
  `.hud-tag` `[F&B 제휴 감지: {shop}]`.
- `charge`상(`HudOverlay.tsx:29-49`): `.hud-ring.charge` 역방향 고속 회전 +
  `.hud-burst` 14점 흡수 파티클(`--a`/`--d` 커스텀 속성) +
  `.hud-tag.hud-charge` `+{amount} AI Quota Charged` (동적 표기).
- 래퍼 `.hud-layer`는 `aria-hidden` 장식 레이어(`HudOverlay.tsx:21`).
- 흐름 소유자: POV(탐지 결과 전달), 캠프 매장인증
  (`target` 1.4s → `charge` 2.6s 락온 시퀀스). 충전량 표기는
  `SHOP_CHARGE=500`을 그대로 렌더한다(`tokens.ts:8`).
- 공용 클래스(`globals.css`): `.hud-panel`·`.hud-btn`·`.hud-btn-primary`
  (반투명 다크 + 시안 액센트). 화면은 원색 버튼 대신 이 클래스를 쓴다.

### 3.5 MUSE AI Quota (`lib/tokens.ts` + `lib/account.ts`)

- MUSE AI Quota = **Muse AI 모델 사용량**. 게임 머니가 아니다.
- 충전: F&B 제휴 결제 인증 +500 (`SHOP_CHARGE`, `tokens.ts:8`).
  소비: 스탯 업그레이드 300 (`UPGRADE_COST`, `tokens.ts:11`),
  AI 호출 과금 look 5 / feed 3 / battle 8 / diary 3 / portrait 20 / voice 2
  (`AI_CALL_COSTS`, `tokens.ts:16-23`).
- 과금은 `meterUsage()`로만. 잔액 부족 시에도 데모는 차단하지 않는다
  (무료 통과, `tokens.ts:64-75`).
- 표기 규격: `MUSE AI Quota: 12,450 Tokens (상태: 원활)`
  (`formatCredits()` `tokens.ts:83-85`, `creditStatus()` 원활≥500/
  낮음≥100/부족 `tokens.ts:88-92`).
  `N MUSE`·`토큰 +N` 같은 게임식 표기는 금지.

### 3.6 대표 흐름

- AR 한 컷: `pov` → `PovCreature.emote()` → 표정/모션/SFX →
  `snapshot()` → `share.ts` 합성 → 네이티브 시트/딥링크 (+80 EXP).
- 미식: 탐지(`look`/시뮬레이터) → HUD target → `dessertSequence`
  (fetch→beg→chomp→happy) → HUD charge → +500 Quota + 미식 EXP.
- 로그인: `login` → 표준 핸들러(`account.ts`) → `/dex` 직행.
  `/slots`는 우회된 레거시(삭제 금지, 스텁 유지).

## 4. 크리처 Rig 파이프라인

- `PovCreature.tsx`가 GLB 로드 → `puppetRig`(전신 제스처) +
  `autoRig`(본 스키닝) + `facePaint`(UV 표정)를 조립한다.
  감정 입력은 `Emote` 14종 단일 채널.
- **발/걷기 스텝은 `autoRig`의 `walkAmp/walkPhase` 교대 스텝으로 고정.
  수정 금지.**
- 이동은 바닥 XZ + `-Z` 깊이 전진. 화면 Y 엘리베이터 이동 금지.

## 5. OAuth · 계정 연동 가이드

### 5.1 프로바이더와 프로필

- `Provider = "google" | "meta" | "guest"` (`account.ts:3`).
  Google 실 OIDC, Meta 플레이스홀더, 게스트 로컬.
- `TrainerProfile(id, provider, name, email, avatarUrl)` (`account.ts:5-11`).
  OAuth id는 `google:<sub>` / `meta:<sub>`, 로컬 id는
  `<provider>:local:<name>` 평문(`account.ts:55`). 이름은 12자 절삭.
- `normalizeProfile()`이 형태를 검증한다(`account.ts:27-40`).
  구 지갑 레코드는 검증 실패 → null → 재로그인 (마이그레이션 없음).
- `LOGIN_HANDLERS` 3종(`account.ts:82-87`):
  `kind=oauth`는 `oauthUrl`로 진입, `kind=local`은 `signIn` 즉시 연결.
  Google `oauthUrl=/api/auth/google`, Meta `/api/auth/meta`.

### 5.2 Google OIDC 4단계

1. 시작 `GET /api/auth/google` (`app/api/auth/google/route.ts:6-17`):
   미설정 시 `/login?error=oauth_unconfigured`. 정상 시 32바이트 state
   (`oauth.ts:31-33`)를 state 쿠키(10분, HttpOnly, SameSite=Lax,
   `oauth.ts:53-55`)에 저장 후 인가 URL로 리디렉트.
   인가 파라미터: `scope=openid email profile`, `access_type=offline`
   (`oauth.ts:35-46`).
2. 콜백 `GET /api/auth/callback/google`
   (`app/api/auth/callback/google/route.ts:27-60`):
   state 대조 → `exchangeCode()` 토큰 교환 → `fetchProfile()` 프로필 조회
   (`oauth.ts:107-120`) → `TrainerProfile` 매핑
   (`id=google:<sub>`, `picture→avatarUrl`, `route.ts:50-56`) →
   HMAC-SHA256 서명 세션 쿠키 발급(`oauth.ts:87-89`,
   키 = `SESSION_SECRET` 우선·`GOOGLE_CLIENT_SECRET` 대체,
   `oauth.ts:61-64`) → `/login?linked=google`.
   실패 코드: `access_denied`·`state_mismatch`·`token_failed`·
   `userinfo_failed` (각각 state 쿠키 제거 후 `/login?error=`).
3. 세션 `GET /api/auth/session`
   (`app/api/auth/session/route.ts:5-10`):
   `parseSessionPayload()` 검증 + 파싱 (`oauth.ts:92-103`,
   `timingSafeEqual` 서명 대조 + `google|meta`만 인정) →
   `{account}` 또는 401 `{account:null}`.
4. 연결 `/login?linked=google|meta` (`app/login/page.tsx:35-53`):
   `/api/auth/session` 조회 → `saveRemoteAccount()` 저장 →
   `setTrainer()` → `/dex` 직행. 에러 코드는 `ERROR_KO` 한글 안내
   (`app/login/page.tsx:10-17`).

### 5.3 Meta 연동 (플레이스홀더)

- `GET /api/auth/meta`는 현재 `/login?error=meta_unconfigured`로
  리디렉트한다(`app/api/auth/meta/route.ts:7-12`).
- 연동 규격(라우트 주석, `meta/route.ts:3-6`): google과 동일한 서명 세션
  형식으로 `TrainerProfile(id=meta:<sub>)` 매핑 후 `/login?linked=meta`.
  로그인 화면은 이미 `linked=meta`를 처리한다(`app/login/page.tsx:36`).

### 5.4 환경변수와 보안 규칙

- `GOOGLE_CLIENT_ID`·`GOOGLE_CLIENT_SECRET`·`GOOGLE_REDIRECT_URI`
  (`oauth.ts:15-23`, 기본 콜백 `http://localhost:3000/api/auth/callback/google`).
  `META_*`는 주석 플레이스홀더, `SESSION_SECRET`은 권장(미설정 시 대체).
  (`.env.example:14-26` 참조, 값은 `.env.local`에 직접 입력.)
- Google Cloud Console의 승인된 리디렉션 URI에 `GOOGLE_REDIRECT_URI`
  값을 등록해야 한다(`.env.example:15`).
- `lib/oauth.ts`·`lib/muse.ts`(`MODEL_API_KEY`, `muse.ts:12-13`)는
  서버 전용이다. 클라이언트 번들에 포함 금지.
- `.env` 커밋 금지. 게스트/로컬 폴백이 있어 미설정 상태에서도
  데모는 차단되지 않는다.

## 6. 디자인 시스템 (`app/globals.css`)

- 다크 글래스모피즘 단일 테마. 네온-시안 액센트(`#00f2fe`),
  얇은 메탈릭 테두리, 미니멀 타이포.
- 공용 클래스: `.glass-panel`·`.glass-btn`·`.glass-chip`·`.glass-toast`,
  HUD 전용 `.hud-*` + `.hud-panel`·`.hud-btn`·`.hud-btn-primary`.
  새 화면은 인라인 원색 버튼 대신 이 클래스를 사용한다.
- 레이아웃: 전역 `main` 폭 제한 없음. 좁은 폼 화면은
  `main.page-narrow` 스코프 클래스(camp/login/slots 적용), 첫 화면은
  `start-root` 100vw/100vh full-bleed.
- 금지: 원색 젤리 버튼, `N MUSE` 표기, 이모지 아이콘, hover scale,
  `prefers-reduced-motion`을 무시하는 모션. radius는 14/12/10/8 차등.

## 7. 에셋 · 스크립트 운영

- `public/models/` 24종은 텍스처 내장 가공본이다. `scratch/glb-orig/`
  24종은 AI 생성 원본으로 바이트가 상이하다. 모델 재생성은 금지.
- `public/hero/` 4종(2 glb + 2 webp)은 `/hero` 리뷰 전용.
  `public/hdri/` CC0 3종 + ATTRIBUTION.
- `scripts/` 15종 중 위험 2종:
  `build-creature-models.mjs`(무텍스처 GLB가 `public/models/` 덮어씀),
  `ext3d-all.mjs`(`public/models` 직접 기록).
  실행 전 주석 경고를 반드시 확인할 것.
- 구 `aiconfirm/` 경로 하드코딩 4종은 수리 대상이지 삭제 대상이 아니다:
  `probe-spaces.mjs:5-6`, `ext3d-all.mjs:15`, `ext3d-hero.mjs:16`,
  `cast_dance.ps1:1,6` (루트 `aiconfirm/` 참조가 남아 있어
  `.gitignore`의 `aiconfirm/` 패턴은 live guard로 유지).
- `public/dance/`: `ateez.mp4`와 `ateez_raw.f136.mp4`는 SHA256 바이트동일
  중복, `ateez_raw.f140.m4a`는 별도 오디오. 코드 참조 0건이나 안무
  레퍼런스 가능 + 제3자 영상 권리 미확인 → 소유자 결정 전까지 유지.

## 8. 금지 · 주의 목록 (위반 시 리뷰 반려)

1. `scripts/build-creature-models.mjs` 실행 금지 — 무텍스처 GLB가
   `public/models/`를 덮어쓰면 24종 표정이 전부 사망한다.
2. `scripts/ext3d-all.mjs` 무확인 실행 금지 — `public/models` 직접 기록.
3. `autoRig` 걷기 스텝·발 모델링 수정 금지.
4. `app/api` 비밀키 클라이언트 노출 금지. `.env` 커밋 금지.
5. `public/`에 조사 캡처·임시 파일 금지. 임시물은 `scratch/`(커밋 금지).
6. `TODO(survey-temp)` 4종(`pov:147`·`survey:2`·`facePaint:755`·
   `PovCreature:190`)은 R2 검증 완료 후 제거한다.

## 9. 레거시 · 임시 인벤토리

- 레거시(동작 유지, 본선 미사용): `app/slots/`, `lib/slots.ts`,
  `components/{BattleBox,CaptureBox,DiaryBox,FeedBox}.tsx`, `lib/format.ts`,
  `app/api/{creature,voice}/` (호출자 없음), `lib/creatureRig.ts` (미사용).
- 개발용(유지): `app/survey/`, `app/hero/`, `public/hero/`.
- 정리됨(2026-10-30, 5항): `tsconfig.tsbuildinfo`(증분 캐시, 재생성),
  `scratch/aiconfirm/cast`(빈 디렉터리).
  이전 정리: 루트 조사 PNG 150여종, `verify/`, `backup-antigravity/`,
  `Snap_Quest_Hackathon_Plan.md` → `docs/` 이동,
  `survey1/`·`survey2/`·`.glb-orig/`·`aiconfirm/`·구 `*.py`·
  `handoff-*.md` → `scratch/` 격리(보존).
- 보류(삭제 금지): `server.1030.log`(146B)+`server.1030.err.log`(0B) —
  gitignore 차단됨, 3000번 서버 소유자가 정지 후 수동 삭제.
  `public/dance/` 중복 1종 — 소유자 결정 후 별도 처리.
  `scratch/` 전체(약 64MB: R1/R2 증거·원본·인수인계) — 보존.

## 10a. Unity 이식 (`unity/OishieUnity/`)

- 웹이 단일 기준, Unity는 수치·식 1:1 포트. 상세는
  `unity/README_UNITY_HANDOFF.md`.
- 플로우: 로컬(`StorageKeys`) → 로그인(`LoginManager`) →
  저장소(`StorageBox`) → 대기(`LoungeManager`, XP 없음) →
  AR-Cam / AR-Sim / Dex (`ArModeController`·`DexSceneController`).
- 24종 리그: `AutoRigPose`(7본 팔/다리/허리) + `PuppetMotion`(리지드) +
  `FaceTable`(눈/입) + `CryPlayer`(8무드). 걷기 스텝·발 가중치 수정 금지(§4).
- 웹 세이브 이식: `lib/unityBridge.ts` `exportSaveForUnity()` →
  `oishie_save.json` → `StorageKeys.ImportSave()`.
- `public/models/*.glb` 재생성 금지(§8)는 Unity에서도 유효 —
  `Oishie/Validate Assets`는 검증만 수행.

## 10. GitHub 푸시 체크리스트

- [ ] `.gitignore`가 빌드물·키·임시물을 차단하는지 확인 (§9 무단 포함 금지)
- [ ] `npm run build` 통과 (클라이언트-only 3D는 `ssr:false` 유지)
- [ ] `public/models/*.glb` 24종 + `ATTRIBUTION.md` 포함 확인
- [ ] `.env` 미포함, `.env.example` 최신화 확인
