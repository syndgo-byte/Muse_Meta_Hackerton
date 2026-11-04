"use client";
import nextDynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BattleAction, Emote, PovHandle } from "@/components/PovCreature";
import { ROSTER } from "@/lib/species";
import { AFFECTION_HIGH, AFFECTION_LOW, ENERGY_HIGH, ENERGY_LOW, FULLNESS_HIGH, FULLNESS_LOW, HUNGRY_FOOD_LINE, SLEEPY_LINE, addXp, applyLook, getCreatureCondition, loadStatus, markSeen, saveStatus, type Status } from "@/lib/state";
import { playCry, unlockAudio, type CryMood } from "@/lib/cry";
import { addWalkM, guessElementLine, loadWalkM } from "@/lib/walk";
import { INSUFFICIENT_MSG, fetchBalance, meterRemote, spendRemote, useCareRemote } from "@/lib/token/client";
import { AI_CALL_COSTS, COST_CARE_EXTRA } from "@/lib/token/config";
import { ASK_ENABLED, askSkillType, fastSkill, type SkillArgs, type SkillInfo } from "@/lib/ask/intents";
import { fetchStatus } from "@/lib/status/client";
import { startStatusHeartbeat } from "@/lib/status/heartbeat";
import { battleStats, nextExpFor, xpThreshold } from "@/lib/stats";
import TopBar from "@/components/TopBar";
import { EXP_BATTLE_WIN, EXP_FEED, EXP_SHARE, claimWalkExp, clampLookGain, dineExp, voiceExp } from "@/lib/progression";
import HudOverlay, { type HudPhase } from "@/components/HudOverlay";
import { sfxPop } from "@/lib/sfx";
import {
  SHARE_TAGS,
  buildShareTargets,
  composeShareFile,
  copyCaption,
  downloadFile,
  shareCaption,
  shopTag,
  systemShare,
  type ShareTarget,
} from "@/lib/share";
import { startBattleBgm, startBgm, stopBattleBgm, stopBgm } from "@/lib/bgm";
import { EMPTY_QUEST, QUEST_KEY, loadQuestState, type Quest } from "@/lib/quest";
import { speciesHasMouth } from "@/lib/facePaint";
import { BOTTOM_GAP, BOTTOM_SIDE } from "@/lib/layout";
import { decide, initialMemory, type BehaviorMemory, type DangerZone } from "@/lib/motion/behavior";
import {
  confirmedZones, createDetector, parseSimHazard, toWorldZones, trackZones,
  type HazardDetector, type TrackedZone,
} from "@/lib/motion/hazard";
import { hintEnFor, hintFor, pickMissHint, pickTimedHint, pickUncaught, type HintPick } from "@/lib/encounter/hints";
import { autoScanTick, cocoToLabel, EMPTY_AUTO_SCAN, type AutoScanState } from "@/lib/battle/scan";
import { BATTLE_OVERLAY_MAX_ALPHA, DRIVING_MSG, drivingTick, EMPTY_DRIVING, isBonnetBox, isVehicleLabel, type DrivingState } from "@/lib/battle/driving";
import { defaultMessage, levelupLine, ruleBoosts } from "@/lib/levelup";
import { CALM_BUBBLE_MIN_GAP_S, CALM_EMOTE_MIN_GAP_S, CALM_RANDOM_PER_MIN, CALM_RANDOM_WINDOW_S, CALM_ROAM_MIN_GAP_S } from "@/lib/calm";
import { loadActivity, recordActivityScan } from "@/lib/activity";
import { loadBoosts, saveBoosts, type Boosts as StatBoosts } from "@/lib/stats";
import { ensureStarter } from "@/lib/starter";
import ScanReveal, { freshBox, pickScanTarget, type RecentBox, type RevealBox } from "@/components/battle/ScanReveal";
import { applyTurn, createBattle, createRng, decideAiSlot, isSlotLegal, STAT_LABEL, type BattleEvent, type BattleState, type Fighter, type Rng, type StatKey } from "@/lib/battle/engine";
import { ACCEPT_WAIT_S, isDoublePassEnd, turnRemainingSec, wildIdleStep, WILD_IDLE_TURNS, WILD_TURN_S } from "@/lib/battle/timer";
import { buildMoveset, speciesOf } from "@/lib/battle/roster";
import { moveKind } from "@/lib/battle/skills";
import { josa } from "@/lib/josa";
import { captureReward } from "@/lib/battle/capture";
import { ELEMENT_FX_COLOR, ELEMENT_KO } from "@/components/battle/fx";
import BattleStage, { type FighterView } from "@/components/battle/BattleStage";
import BattleResultText from "@/components/battle/BattleResultText";
import type { MoveView } from "@/components/battle/SkillButtons";
import CaptureShutter from "@/components/battle/CaptureShutter";
import LevelUpFx from "@/components/LevelUpFx";
import OfflineChip from "@/components/OfflineChip";
import MicButton from "@/components/MicButton";
import { nativeListenOnce } from "@/lib/audio/nativeVoice";
import PeerEncounter from "@/components/PeerEncounter"; // PF-1: 근처 트레이너 (CLI1 작업 중: 이 줄 + 마운트 1줄만)
import { motion } from "motion/react"; // UH-1: 조우 카드·버튼 스프링 (MIT)
import { matchLabel } from "@/lib/encounter/table";
import { barColor, type BarKind } from "@/lib/status/barColor";
import { LOOKBACK_HOLD_S, planWalk } from "@/lib/motion/walkPlan";
import { CARD_SHOW_MS, distM as geoDistM, shouldShow, TOKEN_ZONES, zoneAt, zoneAtGeo, type TokenZone } from "@/lib/token/simZones";

const PovCreature = nextDynamic(() => import("@/components/PovCreature"), { ssr: false });
// 9-B 후속: 야생 onStatus 안정 참조 (인라인 클로저가 매 렌더 씬 리마운트 → 모델 점멸 유발).
const noopBattleStatus = () => {};
// 9-E: 덮개 그라데이션용 hex → rgba.
function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// 세션 기반 AR: 절대 정적 캐시하지 않는다.
export const dynamic = "force-dynamic";

// 실제 AR 비전 파이프라인용 1인칭 보행 배경 영상 (sim 모드).
// 기대 에셋이 트리에 없으면 HDRI 배경 + 플레이스홀더 폴백으로 동작한다.
const SIM_WALK_SRC: Record<"cafe" | "street", string> = {
  cafe: "/videos/cafe_walk.mp4",
  street: "/videos/street_walk.mp4",
};
// MF-2: 배경 유지 (쿼리 → sessionStorage → cafe). 클라이언트에서만 호출.
const SIM_ENV_KEY = "oishie-sim-env";
function readSimEnv(): "cafe" | "street" {
  try {
    const q = new URLSearchParams(window.location.search).get("env");
    if (q === "cafe" || q === "street") return q;
    const s = sessionStorage.getItem(SIM_ENV_KEY);
    if (s === "cafe" || s === "street") return s;
  } catch {
    /* ignore */
  }
  return "cafe";
}
const VISION_PERIOD_MS = 12000; // 조준선 스캔 주기
const VISION_LOCK_COOLDOWN_MS = 45000; // 락온 후 재탐지 쿨다운
const BEHAVIOR_PERIOD_MS = 1000; // J 행동 결정 + K 위험 추적 주기
// BT-3: 턴 연출 타이밍·뷰 합성 (표시만, 엔진 계산 무변경). 상수는 여기 한 곳.
const BT3_BEAT_BASE_MS = 1000;
const BT3_BEAT_PER_EVENT_MS = 250;
const BT3_BEAT_MAX_MS = 2200;
const BT3_PAUSE_MS = 700; // 선공→후공 쉼 (0.6~0.8초)
const BT3_TAIL_MS = 800; // 턴 종료 틱 표시
const BT3_UNLOCK_BUFFER_MS = 300;
// UI-3 수정: 결과 연출 2.5초(등장 0.3+유지 1.8+아웃 0.4) 후 자동 복귀. 상수는 여기 한 곳.
const UI3_RESULT_MS = 2500;
const UI3_CAPTURE_DONE_MS = 1500;
// UI-4 수정: 배틀 안전 문구 (상수 하나, sim·cam 공통).
const BATTLE_SAFETY_LINE = "안전을 위해 배틀 중에는 걸음을 멈추고 주변을 살펴 주세요.";
// UH-1: 조우 카드 배틀 버튼 원소 그라데이션 (밝음→어두움).
const UH1_WILD_GRAD: Record<string, [string, string]> = {
  fire: ["#ff7a3d", "#c2410c"],
  grass: ["#4ade80", "#15803d"],
  water: ["#38bdf8", "#0369a1"],
  rock: ["#c4a777", "#8a6d4b"],
  wind: ["#a5f3fc", "#0e7490"],
};
// BP-3: 타격감 타이밍·세기 (표시만, 엔진 무변경). 상수는 여기 한 곳.
const BP3_WINDUP_MS = 150; // 공격 전 움츠림
const BP3_HITSTOP_MS = 80; // 명중 정지 (치명타는 150)
const BP3_HITSTOP_CRIT_MS = 150;
const BP3_SHAKE_MIN = 2; // 흔들림 최소 px
const BP3_SHAKE_MAX = 8; // 흔들림 최대 px
const BP3_SHAKE_REF = 60; // 이 피해량에서 최대 흔들림
const BP3_VIB_MS = 30; // 명중 진동
const BP3_CLEAR_MS = 250; // 연출 클래스 제거 시점
function bt3BeatMs(n: number): number {
  return Math.min(BT3_BEAT_MAX_MS, BT3_BEAT_BASE_MS + BT3_BEAT_PER_EVENT_MS * Math.max(0, n - 1));
}
// BP-3: 박자 내 명중 집계 (최대 피해·치명타·중격 대상). 표시용, 엔진 무변경.
function bp3SliceHit(slice: BattleEvent[]): { maxDmg: number; crit: boolean; side: "mine" | "wild" | null } {
  let maxDmg = 0;
  let crit = false;
  let side: "mine" | "wild" | null = null;
  for (const e of slice) {
    if (e.type !== "damage") continue;
    const v = Math.max(0, Math.floor(e.value ?? 0));
    if (v > maxDmg) {
      maxDmg = v;
      side = e.target === "mine" ? "mine" : "wild";
    }
    if (e.crit) crit = true;
  }
  return { maxDmg, crit, side };
}
// BP-3: 차분 모드 (OS 손쉬운 사용). 흔들림·번쩍임·줌·진동만 끈다.
function bp3Calm(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
// 이전 표시 뷰에 이벤트 조각의 HP·단계·저항·상태 변화를 앞방향 적용 (표시 전용).
// damage/heal/status-tick value는 엔진의 실제 변화량이라 합산이 정확하다.
function applyBeatView(
  prev: { mine: FighterView; wild: FighterView },
  evts: BattleEvent[],
): { mine: FighterView; wild: FighterView } {
  const next = {
    mine: { ...prev.mine, stages: { ...prev.mine.stages }, resists: { ...prev.mine.resists } },
    wild: { ...prev.wild, stages: { ...prev.wild.stages }, resists: { ...prev.wild.resists } },
  };
  for (const e of evts) {
    const t = next[e.target];
    if (e.type === "damage" || e.type === "status-tick") t.hp = Math.max(0, t.hp - e.value);
    else if (e.type === "heal") t.hp = Math.min(t.maxHp, t.hp + e.value);
    else if (e.type === "faint") t.hp = 0;
    else if (e.type === "stage") {
      const v = (t.stages[e.stat] ?? 0) + e.delta;
      if (v === 0) delete t.stages[e.stat];
      else t.stages[e.stat] = v;
    } else if (e.type === "resist") {
      const v = (t.resists[e.element] ?? 0) + e.delta;
      if (v === 0) delete t.resists[e.element];
      else t.resists[e.element] = v;
    } else if (e.type === "status-apply") t.status = e.status;
    else if (e.type === "status-end") t.status = null;
  }
  return next;
}
// 화면(0..1) → 바닥 월드XZ 투영. 카메라 내부 파라미터가 오기 전까지의
// 근사식: 좌우 ±2m, 화면 아래=가까움(z=+1) · 위=먼 곳(z=-5).
function projectScreenToFloor(x: number, y: number): { x: number; z: number } {
  return { x: (x - 0.5) * 4, z: 1 - (1 - y) * 6 };
}
// Q 힌트 입력: 포획한 종 id 목록 (snapquest-dex, 구형 이름-only 항목도 ROSTER로 역매핑).
function loadCaughtIds(): string[] {
  try {
    const raw = localStorage.getItem("snapquest-dex");
    const arr = (raw ? JSON.parse(raw) : []) as Array<{ id?: string; name?: string }>;
    const ids: string[] = [];
    for (const e of arr) {
      const id = e.id ?? ROSTER.find((s) => s.name === e.name)?.id;
      if (id && !ids.includes(id)) ids.push(id);
    }
    return ids;
  } catch {
    return [];
  }
}

// 9-A3: 엔진 Fighter → BattleStage 뷰.
function fighterView(f: Fighter): FighterView {
  const stages: Partial<Record<string, number>> = {};
  (Object.keys(STAT_LABEL) as StatKey[]).forEach((k) => {
    const v = f.stages[k];
    if (v !== 0) stages[STAT_LABEL[k]] = v;
  });
  const resists: Partial<Record<string, number>> = {};
  (Object.keys(f.resist) as Array<keyof typeof f.resist>).forEach((el) => {
    const v = f.resist[el];
    if (v !== 0) resists[el] = v;
  });
  return {
    id: f.speciesId,
    name: f.name,
    level: f.level,
    hp: Math.max(0, f.hp),
    maxHp: f.maxHp,
    element: f.element,
    status: f.status,
    stages,
    resists,
  };
}

// 시연 모드 대본: 화면 녹화하면 그대로 데모 영상이 된다.
const DEMO: Array<{
  act: string;
  cap: string;
  input: { description: string; dexOverride?: string[]; showPortrait?: string; roam?: boolean };
}> = [
  {
    act: "1막 · 식당",
    cap: "테이블 위 떡볶이를 발견!",
    input: { description: "식당 테이블 위 매운 떡볶이 한 그릇" },
  },
  {
    act: "2막 · 친구 조우",
    cap: "친구의 리피몽이다! 달려나가 친밀 표현!",
    input: {
      description: "친구의 리피몽이 다가온다",
      dexOverride: ["리피몽", "모카퐁"],
      showPortrait: "/dex/grass-01.jpg",
    },
  },
  {
    act: "3막 · 야생 조우",
    cap: "으르렁거리는 바위 골렘 — 배틀!",
    input: { description: "으르렁거리는 야생 바위 골렘" },
  },
  {
    act: "4막 · 거리 산책",
    cap: "크리처와 함께 거리를 걷는다!",
    input: { description: "햇살 비치는 거리 풍경", roam: true },
  },
];

export default function PovPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const simVideoRef = useRef<HTMLVideoElement>(null);
  const [simVideoOk, setSimVideoOk] = useState(true);
  // 7-B: sim 영상 멈춤 감시 상태 (t=마지막 전진 시각의 currentTime, at=그때 wall clock).
  const simWatchRef = useRef({ t: -1, at: 0, recovers: 0 });
  const povRef = useRef<PovHandle>(null);
  const [camOn, setCamOn] = useState(false);
  const camOnRef = useRef(camOn); // CI-1: 1초 타이머 클로저용 미러
  camOnRef.current = camOn;
  const [wildIdx, setWildIdx] = useState(0);
  const [msg, setMsg] = useState("POV 연결. 앞에 야생 크리처.");
  // EX-2: AI 결과 메시지의 대체 여부. 다른 setMsg가 덮어쓰면 칩 자동 숨김.
  const [msgOffline, setMsgOffline] = useState(false);
  const aiMsgRef = useRef("");
  // VA-1: 기존 음성 경로 (voiceCapture 안에서 정의, ref로 공유).
  const legacyVoiceRef = useRef<(said: string) => void>(() => {});
  // VA-1: 장소 추천 메시지 표시 ("추천" 칩).
  const [msgRec, setMsgRec] = useState(false);
  const recMsgRef = useRef("");
  function setRecMsg(text: string) {
    recMsgRef.current = text;
    aiMsgRef.current = text;
    setMsgRec(true);
    setMsgOffline(false);
    setMsg(text);
  }
  function setAiMsg(text: string, fallback: boolean) {
    aiMsgRef.current = text;
    setMsgOffline(fallback);
    setMsgRec(false);
    setMsg(text);
  }
  const [portrait, setPortrait] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 비전 스캔 루프용 busy 미러: 인터벌 클로저가 최신 값을 보게 한다.
  const busyMirrorRef = useRef(false);
  busyMirrorRef.current = busy;
  // --- J 행동 / K 위험 배선 상태 (1초 루프가 소유) ---
  // 크리처 실측 포즈·이동 적용은 PovCreature 소유 모듈에 요청 필요:
  // move/face 출력은 무시하고(시각 이동 없음) emote/balloon/scanDue/levelup만 쓴다.
  const behaviorMemRef = useRef<BehaviorMemory | null>(null);
  const zonesRef = useRef<TrackedZone[]>([]);
  const dangerRef = useRef<DangerZone[]>([]);
  const scanRef = useRef<{ x: number; z: number; visible: boolean; event: boolean; at: number } | null>(null);
  const lastScanRef = useRef(0);
  const emoteDoneRef = useRef(true);
  const detectorRef = useRef<HazardDetector | null>(null);
  const detectorFailAtRef = useRef(0);
  const detectorPendingRef = useRef(false);
  const [hazardView, setHazardView] = useState<TrackedZone[]>([]);
  // --- 7-C 2차 걷기 배선 상태 (ref가 진실, state는 props 반영용) ---
  const [laneX, setLaneX] = useState(0.36);
  const [walking, setWalking] = useState(false);
  const [faceBack, setFaceBack] = useState(false);
  const laneXRef = useRef(0.36);
  const walkingRef = useRef(false);
  const faceBackRef = useRef(false);
  const nextLookBackRef = useRef(0);
  const lookBackUntilRef = useRef(0);
  const prevLookBackRef = useRef(false);
  const lastWalkEmoteRef = useRef<string | null>(null);
  const lastWalkBalloonRef = useRef<string | null>(null);
  const lastDetsRef = useRef<Array<{ label: string; score: number; box: { x0: number; y0: number; x1: number; y1: number } }>>([]);
  const carNowRef = useRef(false);
  const dangerUntilRef = useRef(0);
  const lastWalkMRef = useRef(0);
  const walkInitRef = useRef(false);
  // --- Q 힌트 배선 상태 ---
  const [arHint, setArHint] = useState<HintPick | null>(null);
  const [wildHint, setWildHint] = useState<HintPick | null>(null);
  const [hintSeq, setHintSeq] = useState(0); // 9-C: 조우 팝업 연출 리플레이용
  const lastHintAtRef = useRef(0);
  const lastHitRef = useRef(0); // 마지막 유효 스캔(음식 락온·표 매칭) 시각
  const hintOffsetRef = useRef(0);
  const missStreakRef = useRef(0);
  const wildTimerRef = useRef<number | null>(null);
  // AF-3/8: 조우 카드 응답 제한 마감 + 남은 초 (운전 중 정지).
  const wildDeadlineRef = useRef(0);
  const [wildHintSec, setWildHintSec] = useState<number | null>(null);
  // LV-2: 성장 토스트 (자동 닫힘, 선택 없음).
  const [lvToast, setLvToast] = useState<{ text: string; key: number } | null>(null);
  const lvTimerRef = useRef<number | null>(null);
  const lvSeqRef = useRef(0);
  // --- 9-A AR 배틀 오버레이 상태 ---
  type BattlePhase = "none" | "cover" | "fight" | "result";
  const [battlePhase, setBattlePhase] = useState<BattlePhase>("none");
  const [battleWildId, setBattleWildId] = useState<string | null>(null);
  const [battleState, setBattleState] = useState<BattleState | null>(null);
  // BT-3: 표시용 뷰 (엔진 진실은 battleState에 즉시, 화면은 박자별로).
  const [battleView, setBattleView] = useState<{ mine: FighterView; wild: FighterView } | null>(null);
  const [battleEvents, setBattleEvents] = useState<BattleEvent[]>([]);
  const [battleFxKey, setBattleFxKey] = useState(0);
  const [battleLocked, setBattleLocked] = useState(false);
  // BP-3: 타격감 연출 상태 (움츠림·흔들림·줌·히트스톱·넉백·번쩍).
  const [bp3, setBp3] = useState<{ windup: "mine" | "wild" | null; shakePx: number; zoom: boolean; hold: boolean; knock: "mine" | "wild" | null; flash: "mine" | "wild" | null }>(
    { windup: null, shakePx: 0, zoom: false, hold: false, knock: null, flash: null }
  );
  const [battleDistance, setBattleDistance] = useState(0); // 9-F: 원점(배틀 시작 위치)부터 m
  // BT-T: 야생 방치 {마지막 행동, 연속 패스, 야생 이름} + 카운트다운 표시 초 + 진동 1회 키.
  const wildIdleRef = useRef({ lastActMs: 0, passes: 0, wildName: "야생 크리처" });
  const [battleIdleSec, setBattleIdleSec] = useState<number | null>(null);
  const [battleYawn, setBattleYawn] = useState<string | null>(null); // AF-3/6: fight 중 하품 경고 (pov-msg는 배틀 중 숨김이라 별도 표시).
  const vibRef = useRef(-1);
  const wildIdleSeq = useRef(0); // BT-T: HMR/이중 마운트 시 구 인터벌 무력화 토큰
  const [battleFled, setBattleFled] = useState(false);
  // 9-F: 배틀 시작 시점의 원점 스냅샷 (사물=스캔 위치 기준).
  const battleOriginRef = useRef<{ walk: number; lat: number | null; lon: number | null }>({ walk: 0, lat: null, lon: null });
  const scanOriginRef = useRef<{ walk: number; lat: number | null; lon: number | null } | null>(null); // AF-2/4: 스캔 지점 (거리 원점)
  const [battleResult, setBattleResult] = useState<"won" | "lost" | "fled" | "wildFled" | "timeWin" | "timeDraw" | null>(null);
  const [coverOn, setCoverOn] = useState(false);
  const [coverFade, setCoverFade] = useState(false);
  const battleRngRef = useRef<Rng>(Math.random);
  const battleTimersRef = useRef<number[]>([]);
  const battleActionTimersRef = useRef<number[]>([]); // BT-3: 박자별 액션 복귀 타이머
  const wildPovRef = useRef<PovHandle>(null);
  const [captureDone, setCaptureDone] = useState(false);
  const [captureMsg, setCaptureMsg] = useState<string | null>(null);
  const battleActive = battlePhase !== "none";
  const battleDemo = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("battle") === "demo";
  // D-2: level-up fanfare overlay state + ?levelup=N demo hook (display only).
  const [levelupFx, setLevelupFx] = useState<{ level: number; key: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const levelupDemoQ = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("levelup") : null;
  const levelupDemo = levelupDemoQ !== null && /^\d+$/.test(levelupDemoQ) ? parseInt(levelupDemoQ, 10) : null;

  // 9-B 후속: 턴 이벤트 → 크리처 액션 (CLI 1 배선). faint만 유지, 나머지는 복귀.
  const [mineAction, setMineAction] = useState<BattleAction>("idle");
  const [wildAction, setWildAction] = useState<BattleAction>("idle");
  useEffect(() => {
    if (battlePhase === "none") {
      setMineAction("idle");
      setWildAction("idle");
      return;
    }
    if (battlePhase !== "fight") return; // cover/result는 유지
    // BT-3: 박자마다 이전 복귀 타이머 취소 (전 박자 복귀가 이번 박자를 덮지 않게).
    for (const t of battleActionTimersRef.current) window.clearTimeout(t);
    battleActionTimersRef.current = [];
    // BT-3: 빈 박자(이벤트 없음)는 idle로 (기절 유지 제외 — 기절 뒤 박자는 스케줄 안 됨).
    if (battleEvents.length === 0) {
      setMineAction((a) => (a === "faint" ? a : "idle"));
      setWildAction((a) => (a === "faint" ? a : "idle"));
      return;
    }
    // BT-3: 박자별 표시 (해당 박자 이벤트만) faint > attack/shoot(휘두름/발사) > hurt(맞음) > buff(강화/회복) > idle.
    const sideAction = (side: "mine" | "wild"): BattleAction => {
      const foe: "mine" | "wild" = side === "mine" ? "wild" : "mine";
      if (battleEvents.some((e) => e.type === "faint" && e.target === side)) return "faint";
      const swungEv = battleEvents.find(
        (e) => (e.type === "damage" || e.type === "miss") && e.target === foe
      );
      // BP-2: 근접은 돌진(attack), 원거리는 제자리 발사(shoot).
      if (swungEv) return (swungEv as { kind?: string }).kind === "ranged" ? "shoot" : "attack";
      if (battleEvents.some((e) => e.type === "damage" && e.target === side && e.value > 0)) return "hurt";
      const boosted =
        battleEvents.some((e) => e.type === "stage" && e.target === side && e.delta > 0) ||
        battleEvents.some((e) => e.type === "heal" && e.target === side && e.value > 0);
      if (boosted) return "buff";
      return "idle";
    };
    const m = sideAction("mine");
    const w = sideAction("wild");
    setMineAction(m);
    setWildAction(w);
    if (m === "idle" && w === "idle") return;
    // 액션 종료 시점에 맞춰 idle 복귀 (attack 1.1/hurt 1.3/buff 1.8s + 여유 0.05). faint 유지.
    const actDur = (a: BattleAction) => (a === "attack" || a === "shoot" ? 1150 : a === "hurt" ? 1350 : a === "buff" ? 1850 : 0);
    const revertMs = Math.max(actDur(m), actDur(w));
    if (revertMs <= 0) return;
    battleActionTimersRef.current.push(
      window.setTimeout(() => {
        setMineAction((a) => (a === "faint" ? a : "idle"));
        setWildAction((a) => (a === "faint" ? a : "idle"));
      }, revertMs)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battleFxKey]);
  useEffect(() => {
    if (battlePhase !== "result") return;
    if (battleResult === "won") {
      setWildAction("faint");
      setMineAction("idle");
    } else if (battleResult === "lost") {
      setMineAction("faint");
      setWildAction("idle");
    } else {
      setMineAction("idle");
      setWildAction("idle");
    }
  }, [battlePhase, battleResult]);
  // --- 5-2 토큰 존 HUD 상태 ---
  const [zoneCard, setZoneCard] = useState<TokenZone | null>(null);
  const [nearbyHint, setNearbyHint] = useState<string | null>(null);
  const lastZoneShownRef = useRef<Record<string, number>>({});
  const curZoneRef = useRef<string | null>(null);
  const lastZoneRef = useRef<TokenZone | null>(null);
  const zoneTimerRef = useRef<number | null>(null);
  const geoRef = useRef<{ lat: number; lon: number; speedMps: number | null } | null>(null);
  const [listening, setListening] = useState(false);
  // 7-5: 새 메시지는 이전 메시지를 대체하고(단일 문자열 상태) 5초 뒤 사라진다.
  // 3-3: 만료 시점에 메시지가 바뀌어 있으면 지우지 않는다 (느린 기기에서 묵은 타이머가 새 상태 문구를 지우지 않게).
  // 3-3: 듣는 중에는 Listening 안내를 지우지 않는다 (결과·오류 메시지가 오면 그때 5초 타이머가 돈다).
  useEffect(() => {
    if (msg === "" || listening) return;
    const snapshot = msg;
    const t = window.setTimeout(() => {
      setMsg((cur) => (cur === snapshot ? "" : cur));
    }, 5000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msg, listening]);
  const [scene3d, setScene3d] = useState("3d-loading");
  const [demoIdx, setDemoIdx] = useState<number | null>(null);
  const [st, setSt] = useState<Status>({ fullness: 50, energy: 80, affection: 20, xp: 0, level: 1 });
  // AR 렌즈: 동행은 오직 대표 파트너 한 마리. 야생 조우는 텍스트 이벤트로만.
  const [mode, setMode] = useState<"cam" | "sim">("cam");
  const [partnerId, setPartnerId] = useState("fire-01");
  const partner = ROSTER.find((s) => s.id === partnerId) ?? ROSTER[0];
  // 9-A3: 내 기술 4칸 뷰 (쿨다운·사용 가능은 엔진 상태 반영).
  const battleMoves: MoveView[] = battleState
    ? buildMoveset(partner.id).map((m, i) => ({
        name: m.name, // UI-2: 한글 기술명
        element: m.element,
        kind: moveKind(m),
        cdLeft: battleState.mine.cooldowns[i] ?? 0,
        disabled: !isSlotLegal(battleState.mine, i),
      }))
    : [];
  // 9-C: 조우 카드용 야생 종 정보.
  const wildSp = wildHint ? ROSTER.find((s) => s.id === wildHint.speciesId) ?? null : null;
  // KO-1b: 속성명은 공용 ELEMENT_KO 하나로 통일 (fire "불꽃" 별도 표기 폐지).
  // UI-5: 야생 레벨 (배틀 투입식과 같은 분포, 카드마다 1회 고정).
  const wildLv = useMemo(() => Math.max(1, st.level + (Math.random() < 0.3 ? 1 : 0)), [hintSeq]);
  // 시뮬레이터 환경: HDRI 실사 배경 (카페/거리 직접 선택). MF-2: 선택 유지.
  const [env, setEnv] = useState<"cafe" | "street">(
    () => (typeof window === "undefined" ? "cafe" : readSimEnv())
  );
  const setEnvSync = (v: "cafe" | "street") => {
    setEnv(v);
    try {
      sessionStorage.setItem(SIM_ENV_KEY, v);
      const u = new URL(window.location.href);
      u.searchParams.set("env", v);
      window.history.replaceState(null, "", u.toString());
    } catch {
      /* ignore */
    }
  };
  const ENV_LABEL = { cafe: "카페", street: "거리" } as const;
  // 배경 전환 시 보행 영상 폴백 상태를 리셋 (video는 key로 리마운트).
  useEffect(() => {
    setSimVideoOk(true);
  }, [env]);
  const wild = ROSTER[wildIdx % ROSTER.length];
  // 초상화는 작은 스캔 카드용 (동행 파트너 기준).
  const scanCard = portrait ?? partner.image ?? null;
  const btn: React.CSSProperties = { minWidth: 0, fontSize: 12, padding: "10px 8px" };
  // 레이벤 모드에서는 카메라 켜기 단계를 숨긴다 (E 단계에서 적용, ?hud=rayban).
  // 3-3: 첫 렌더는 서버와 같게(false) 두고 마운트 뒤에 판별한다 (하이드레이션 불일치 방지).
  const [isRayban, setIsRayban] = useState(false);
  useEffect(() => {
    setIsRayban(new URLSearchParams(window.location.search).get("hud") === "rayban");
  }, []);
  // 7-3 20번 검증용: ?pose=near|far → z 고정. 없으면 null (기존 동작).
  const poseQ = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("pose") : null;
  const poseLock = poseQ === "near" || poseQ === "far" ? poseQ : null;
  // 7-C 2차: ?lane/?walk/?back/?backlate 검증 쿼리 제거, 실제 planWalk 배선으로 대체.
  // 크리처 카드 상태 막대 (값은 /api/status에서 읽은 st. 체력은 저장 안 함).
  const maxHp = battleStats(partner.id, st.level).maxHp;
  const expBase = xpThreshold(st.level);
  const expNext = nextExpFor(st.level);
  const expCur = Math.max(0, st.xp - expBase);
  // I 잔여: camp와 같은 barColor로 바 색 통일. EXP는 BarKind에 없어 기존 초록 유지.
  const statBar = (label: string, kind: BarKind | null, pct: number, text: string) => (
    <div style={{ marginTop: 3 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, opacity: 0.9 }}>
        <span>{label}</span>
        <span className="stat-num">{text}</span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: "rgba(255,255,255,0.15)", marginTop: 1 }}>
        <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: "100%", borderRadius: 3, background: kind ? barColor(kind, pct, 100) : "#9fe870" }} />
      </div>
    </div>
  );

  // 게임 퀘스트: 조우 → 포획 → 교감 → 배틀 → 거울 퀘스트
  const [quest, setQuest] = useState<Quest>({ ...EMPTY_QUEST });
  const [walkM, setWalkM] = useState(0);
  const [tokenN, setTokenN] = useState(0);
  // 1초 행동 루프용 미러 (인터벌 클로저가 최신 값을 보게 한다).
  const stMirrorRef = useRef(st);
  stMirrorRef.current = st;
  const walkMirrorRef = useRef(walkM);
  walkMirrorRef.current = walkM;
  const demoMirrorRef = useRef(demoIdx);
  demoMirrorRef.current = demoIdx;
  const envMirrorRef = useRef(env);
  envMirrorRef.current = env;
  // VF-2: 자동스캔 인터벌([] 고정)에서도 최신 모드를 보게 한다 (초기값 cam 잔류 방지).
  const modeMirrorRef = useRef(mode);
  modeMirrorRef.current = mode;
  // 9-A1: 시연용 강제 조우 (?battle=demo → 3초 뒤 조우 팝업).
  // 팝업이 닫히고 배틀 중이 아니면 3초마다 다시 띄운다 (시연 재시도용).
  const wildHintRef = useRef<HintPick | null>(null);
  wildHintRef.current = wildHint;
  const battlePhaseRef = useRef(battlePhase);
  battlePhaseRef.current = battlePhase;
  // UI-2 보완: 전 경로 조우 연출 상태 (뷰파인더→Scanned→등장→??? 카드). pick 전체를 들고 onDone에서 그대로 적용.
  const [scanReveal, setScanReveal] = useState<{ label: string; pick: HintPick; box: RevealBox | null; target: string | null } | null>(null);
  const scanRevealRef = useRef(scanReveal);
  scanRevealRef.current = scanReveal;
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("battle") !== "demo") return;
    const t = window.setInterval(() => {
      if (battlePhaseRef.current !== "none" || wildHintRef.current) return;
      if (Date.now() - lastHintAtRef.current < 18000) return; // 만료(15s) 관측용 여유
      // 시연은 승리→포획 풀플로우를 보여준다: 첫 미포획 풀 타입 (없으면 첫 미포획).
      const caught = loadCaughtIds();
      const envNow = envMirrorRef.current;
      let pick = null as ReturnType<typeof pickUncaught>;
      for (let o = 0; o < 24; o++) {
        const c = pickUncaught(caught, envNow, o);
        if (!c) continue;
        if (!pick) pick = c;
        try {
          if (speciesOf(c.speciesId).element === "grass") {
            pick = c;
            break;
          }
        } catch {
          /* ignore */
        }
      }
      if (pick) revealHint(pick, "데모");
    }, 3000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // AR 레벨 추적 (토큰 적립 없음: 충전은 매장 결제 신호로만).
  const prevLevelRef = useRef<number | null>(null);
  useEffect(() => {
    if (prevLevelRef.current === null) {
      prevLevelRef.current = st.level;
      return;
    }
    prevLevelRef.current = st.level;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.level]);
  function hush() {
    povRef.current?.stopDance();
  }
  const [bubble, setBubble] = useState<string | null>(null);
  const [hud, setHud] = useState<{ phase: HudPhase; shop: string; amount: number } | null>(null);
  const [ambientTick, setAmbientTick] = useState(0);
  // CALM-1: 자율 감정·배회·랜덤·말풍선 마지막 발동 시각(초). 0 = 아직 없음.
  const lastAmbientEmoteAtRef = useRef(0);
  const lastAmbientMoveAtRef = useRef(0);
  const lastRandomAtRef = useRef(0);
  const lastBubbleAtRef = useRef(0);
  const bubbleTimer = useRef<number | null>(null);
  // 말풍선 앵커: 크리처 머리 위 화면 좌표 (7-5 §4). 화면 밖이면 안으로 클램프.
  // 크리처가 움직여도 붙어 있도록 표시 중에는 매 프레임 좌표를 갱신한다.
  const [bubblePos, setBubblePos] = useState<{ x: number; y: number } | null>(null);
  const bubbleRaf = useRef<number>(0);
  function trackBubble() {
    cancelAnimationFrame(bubbleRaf.current);
    const step = () => {
      const q = povRef.current?.headScreen?.() ?? null;
      if (q) {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        setBubblePos({
          x: Math.min(Math.max(Math.round(q.x), 70), Math.max(70, vw - 70)),
          y: Math.min(Math.max(Math.round(q.y), 70), Math.max(70, vh - 70)),
        });
      }
      bubbleRaf.current = requestAnimationFrame(step);
    };
    bubbleRaf.current = requestAnimationFrame(step);
  }
  // CALM-1b: interactive=true면 게이트를 건너뛴다 (표시 시각은 기록, 교체로 동시 1개 유지).
  function say(text: string, opts?: { interactive?: boolean; sticky?: boolean }) {
    // 9-B 후속: 배틀 중 말풍선은 숨김이므로 상태 churn(리렌더 폭증) 방지.
    if (battleActive) return;
    // CALM-1: 말풍선 최소 간격 (동시 1개는 단일 bubble 상태로 보장).
    const nowS = Date.now() / 1000;
    if (!opts?.interactive && nowS - lastBubbleAtRef.current < CALM_BUBBLE_MIN_GAP_S) return;
    lastBubbleAtRef.current = nowS;
    setBubble(text);
    if (bubbleTimer.current) window.clearTimeout(bubbleTimer.current);
    // VA-2: sticky(생각 중)는 서버 타임아웃(10초) 너머까지 유지, 답이 오면 교체.
    bubbleTimer.current = window.setTimeout(() => {
      setBubble(null);
      cancelAnimationFrame(bubbleRaf.current);
    }, opts?.sticky ? 12000 : 3000);
    trackBubble();
  }
  // 감정 모션 + 보이스 동기화: 파트너의 목소리(/cries/<id>_<mood>.mp3)로 재생.
  function voice(mood: CryMood) {
    playCry(partner.id, mood);
  }
  // Q/7-A 2차 + 9-A1: 힌트 적용 (??? 카드에 표시, 15초 뒤 자동 해제).
  function applyHint(pick: HintPick) {
    lastHintAtRef.current = Date.now();
    setArHint(pick);
    setWildHint(pick);
    setHintSeq((n) => n + 1);
    if (!wildHintRef.current) {
      try {
        playCry(pick.speciesId, "meet"); // 9-C: 조우 울음 1회 (재적용 시 생략)
      } catch {
        /* ignore */
      }
    }
    try {
      const s = ((window as unknown as Record<string, { hints?: string[] }>).__povStats ??= {});
      (s.hints ??= []).push(pick.speciesId);
    } catch { /* ignore */ }
    if (wildTimerRef.current) window.clearInterval(wildTimerRef.current);
    // AF-3/8: 응답 제한 ACCEPT_WAIT_S (PF-1b와 같은 상수). 만료·진행 표시는 아래 effect.
    wildDeadlineRef.current = Date.now() + ACCEPT_WAIT_S * 1000;
    setWildHintSec(ACCEPT_WAIT_S);
  }
  function closeWildHint() {
    if (wildTimerRef.current) window.clearInterval(wildTimerRef.current);
    wildTimerRef.current = null;
    setWildHint(null);
    setWildHintSec(null);
  }
  // AF-3/8: 조우 카드 응답 제한 타이머. 안에 안 누르면 "○○이(가) 가 버렸다" + 닫기. 운전 중 정지.
  useEffect(() => {
    if (!wildHint) return;
    const id = window.setInterval(() => {
      if (drivingRef.current) {
        wildDeadlineRef.current += 250;
        return;
      }
      const remainMs = wildDeadlineRef.current - Date.now();
      setWildHintSec(Math.max(0, Math.ceil(remainMs / 1000)));
      if (remainMs <= 0) {
        const sp = ROSTER.find((s) => s.id === wildHintRef.current?.speciesId);
        setMsg(`${josa(sp?.name ?? "야생 크리처", "이가")} 가 버렸다.`);
        closeWildHint();
      }
    }, 250);
    wildTimerRef.current = id;
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wildHint]);
  // LV-2: 레벨업 하이브리드 성장 (트리거당 1회). 규칙 즉시 적용+토스트, AI는 비동기 보정.
  function subBoosts(a: StatBoosts, b: StatBoosts): StatBoosts {
    return {
      atk: Math.max(0, a.atk - b.atk), hp: Math.max(0, a.hp - b.hp),
      def: Math.max(0, a.def - b.def), spd: Math.max(0, a.spd - b.spd),
    };
  }
  function normBoosts(v: unknown): StatBoosts {
    const r = (v ?? {}) as Partial<Record<keyof StatBoosts, unknown>>;
    const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? Math.max(0, Math.floor(x)) : 0);
    return { atk: num(r.atk), hp: num(r.hp), def: num(r.def), spd: num(r.spd) };
  }
  function flashLvToast(text: string) {
    if (lvTimerRef.current) window.clearTimeout(lvTimerRef.current);
    setLvToast({ text, key: Date.now() });
    lvTimerRef.current = window.setTimeout(() => setLvToast(null), 5000);
  }
  function handleLevelup(speciesId: string, level: number) {
    const seq = ++lvSeqRef.current;
    const role = speciesOf(speciesId).role;
    const activity = loadActivity();
    const before = loadBoosts(speciesId);
    const rules = ruleBoosts(role, level, activity);
    saveBoosts(speciesId, rules);
    flashLvToast(levelupLine(level, subBoosts(rules, before), defaultMessage(activity)));
    void fetch("/api/levelup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, level, activity, speciesId }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((d: { boosts?: StatBoosts; message?: string; source?: string } | null) => {
        if (!d || d.source !== "ai" || !d.boosts || seq !== lvSeqRef.current) return;
        const b = normBoosts(d.boosts);
        saveBoosts(speciesId, b);
        const msg = typeof d.message === "string" ? d.message : "";
        flashLvToast(levelupLine(level, subBoosts(b, before), msg));
      })
      .catch(() => { /* 규칙 값 유지 */ });
  }
  // UI-2 보완: 야생 등장 전 경로의 단일 진입점. 같은 ScanReveal·같은 타이밍으로 ??? 카드를 연다.
  function revealHint(pick: HintPick, label: string, box: RevealBox | null = null) {
    if (battlePhaseRef.current !== "none" || wildHintRef.current || scanRevealRef.current) return;
    // BT-2: 운전 중 발견은 대기시키고 한 줄만 띄운다 (운전 종료 시 재알림).
    if (drivingRef.current) {
      if (!driveQueueRef.current) driveQueueRef.current = { pick, label, box };
      setMsg(DRIVING_MSG);
      return;
    }
    revealTrackRef.current = null;
    revealSimT0Ref.current = 0;
    revealSimRef.current = false;
    // VF-4: box 없음 → 실감지에서 대상 1개 고정 (매핑 최고점, 없으면 점수×면적).
    const det = box ? { label, box } : pickScanTarget(lastDetsRef.current ?? [], (l) => cocoToLabel(l) !== null);
    setScanReveal({ label, pick, box: det ? det.box : null, target: det ? det.label : null });
    // AF-2/4: 스캔 지점을 거리 원점으로 기록 (배틀 시작 위치가 아님).
    scanOriginRef.current = {
      walk: walkMirrorRef.current,
      lat: geoRef.current?.lat ?? null,
      lon: geoRef.current?.lon ?? null,
    };
  }
  // --- 9-A2: 배틀 시작 (색 덮개 + HUD 숨김 + 2마리 배치) ---
  function clearBattleTimers() {
    for (const t of battleTimersRef.current) window.clearTimeout(t);
    battleTimersRef.current = [];
    for (const t of battleActionTimersRef.current) window.clearTimeout(t);
    battleActionTimersRef.current = [];
  }
  function startBattle(speciesId: string) {
    if (battlePhase !== "none" || busy) return;
    if (drivingRef.current) {
      setMsg(DRIVING_MSG);
      return;
    }
    if (st.energy < ENERGY_LOW) {
      doEmote("drowsy");
      say(SLEEPY_LINE, { interactive: true });
      setMsg(`${josa(partner.name, "이가")} 너무 졸려 배틀할 수 없어요. 트레이너 라운지에서 휴식시키세요. (출전 시 ATK/SPD 50%)`);
      return;
    }
    closeWildHint();
    hush();
    say("으르렁!", { interactive: true });
    try {
      playCry(partner.id, "attack");
    } catch {
      /* ignore */
    }
    battleRngRef.current = createRng((Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0);
    const bs0 = createBattle(partner.id, speciesId, { level: st.level });
    setBattleState(bs0);
    setBattleView({ mine: fighterView(bs0.mine), wild: fighterView(bs0.wild) });
    setBattleEvents([]);
    setBattleFxKey(0);
    setBattleLocked(false);
    setBattleDistance(0);
    // BT-T: 방치 시계 시작.
    wildIdleRef.current = {
      lastActMs: Date.now(),
      passes: 0,
      wildName: ROSTER.find((s) => s.id === speciesId)?.name ?? "야생 크리처",
    };
    vibRef.current = -1;
    setBattleIdleSec(WILD_TURN_S);
    // AF-2/4: 거리 원점은 스캔 지점. 스캔 기록이 없으면(드문 경로) 현재 위치.
    battleOriginRef.current = scanOriginRef.current ?? {
      walk: walkMirrorRef.current,
      lat: geoRef.current?.lat ?? null,
      lon: geoRef.current?.lon ?? null,
    };
    setBattleFled(false);
    setBattleResult(null);
    setBattleYawn(null);
    setBattleWildId(speciesId);
    setCoverOn(true);
    setCoverFade(false);
    setBattlePhase("cover");
    startBattleBgm();
    // 시연(?battle=demo): 커버를 유지하다가 탭/__arCoverRelease 때 진행 (15초 뒤 자동).
    // 평소: 80ms 뒤 페이드 → 650ms 뒤 fight → 1300ms 뒤 제거.
    const demoHold = new URLSearchParams(window.location.search).get("battle") === "demo";
    if (demoHold) {
      const w = window as unknown as { __arCoverRelease?: boolean };
      w.__arCoverRelease = false;
      const waitRelease = () => {
        if (w.__arCoverRelease) {
          setCoverFade(true);
          battleTimersRef.current.push(window.setTimeout(() => setBattlePhase("fight"), 550));
          battleTimersRef.current.push(window.setTimeout(() => setCoverOn(false), 1200));
        } else {
          battleTimersRef.current.push(window.setTimeout(waitRelease, 200));
        }
      };
      battleTimersRef.current.push(window.setTimeout(waitRelease, 200));
      battleTimersRef.current.push(
        window.setTimeout(() => {
          w.__arCoverRelease = true;
        }, 15000)
      );
    } else {
      battleTimersRef.current.push(window.setTimeout(() => setCoverFade(true), 80));
      battleTimersRef.current.push(window.setTimeout(() => setBattlePhase("fight"), 650));
      battleTimersRef.current.push(window.setTimeout(() => setCoverOn(false), 1300));
    }
  }
  function endBattle() {
    clearBattleTimers();
    stopBattleBgm();
    setBattlePhase("none");
    setBattleState(null);
    setBattleView(null);
    setBattleWildId(null);
    setBattleResult(null);
    setBattleEvents([]);
    setCaptureDone(false);
    setCaptureMsg(null);
    setCoverOn(false);
    setBattleIdleSec(null);
    setBattleYawn(null);
  }
  // --- BT-3: 턴 연출 (선공→쉼→후공→틱, 엔진 결과는 그대로 박자별로만) ---
  function pickBattleMove(i: number) {
    const s = battleState;
    if (!s || s.over || battleLocked || battlePhase !== "fight" || drivingRef.current) return;
    setBattleLocked(true);
    // BT-T: 행동했으니 방치 리셋.
    wildIdleRef.current.lastActMs = Date.now();
    wildIdleRef.current.passes = 0;
    setBattleYawn(null);
    const rng = battleRngRef.current;
    const ws = decideAiSlot(s.wild, s.mine, rng);
    const { state, events, beatEnds, order } = applyTurn(s, i, ws, rng);
    // BP-2: 연출용 kind 스탬프 (엔진 무변경 — 때린 쪽 슬롯→kind, 반사 피해는 상대 kind로 찍힘).
    {
      const slotKind = (moves: Array<{ power: number }>, slot: number): "melee" | "ranged" | undefined => {
        if (slot === 0) return "melee";
        if (slot === 1) return "ranged";
        const m = moves[slot];
        return m && m.power > 0 ? "ranged" : undefined;
      };
      const mineKind = slotKind(buildMoveset(partner.id), i);
      const wildKind = battleWildId ? slotKind(buildMoveset(battleWildId), ws) : undefined;
      for (const e of events) {
        if (e.type !== "damage" && e.type !== "miss") continue;
        const k = e.target === "wild" ? mineKind : wildKind;
        if (k) (e as { kind?: "melee" | "ranged" }).kind = k;
      }
    }
    setBattleState(state); // 엔진 진실은 즉시 (다음 턴 입력용). 화면은 아래 박자별로.
    const end1 = beatEnds[0] ?? 0;
    const end2 = beatEnds[1] ?? end1;
    const b1 = events.slice(0, end1);
    const b2 = events.slice(end1, end2);
    const tail = events.slice(end2);
    const v0: { mine: FighterView; wild: FighterView } = {
      mine: fighterView(s.mine),
      wild: fighterView(s.wild),
    };
    const v1 = applyBeatView(v0, b1);
    const v2 = applyBeatView(v1, b2);
    const vF = { mine: fighterView(state.mine), wild: fighterView(state.wild) };
    const wid = battleWildId;
    const cryFor = (slice: BattleEvent[]) => {
      if (slice.some((e) => e.type === "damage" && e.target === "wild") && wid) {
        try {
          playCry(wid, "cry");
        } catch {
          /* ignore */
        }
      }
      if (slice.some((e) => e.type === "faint" && e.target === "mine")) {
        try {
          playCry(partner.id, "cry");
        } catch {
          /* ignore */
        }
      }
    };
    const beatSide = (idx: number): "mine" | "wild" | null =>
      order[idx] === "mine" || order[idx] === "wild" ? order[idx] : null;
    const hsFor = (slice: BattleEvent[]): number => {
      const h = bp3SliceHit(slice);
      if (!h.side) return 0;
      return h.crit ? BP3_HITSTOP_CRIT_MS : BP3_HITSTOP_MS;
    };
    // BP-3: 박자 = 움츠림 150ms → 타격(뷰·연출·진동·히트스톱).
    const showBeat = (view: { mine: FighterView; wild: FighterView }, slice: BattleEvent[], atk: "mine" | "wild" | null) => {
      const calm = bp3Calm();
      const fire = () => {
        setBattleView(view);
        setBattleEvents(slice);
        setBattleFxKey((k) => k + 1);
        cryFor(slice);
        const hit = bp3SliceHit(slice);
        if (!hit.side) {
          setBp3((p) => ({ ...p, windup: null }));
          return;
        }
        if (!calm) {
          try {
            if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(BP3_VIB_MS);
          } catch {
            /* ignore */
          }
        }
        const px = hit.maxDmg > 0 && !calm
          ? BP3_SHAKE_MIN + (BP3_SHAKE_MAX - BP3_SHAKE_MIN) * Math.min(1, hit.maxDmg / BP3_SHAKE_REF)
          : 0;
        setBp3((p) => ({ ...p, windup: null, shakePx: px, zoom: !calm && hit.crit, hold: true, knock: hit.side, flash: !calm ? hit.side : null }));
        timers.push(window.setTimeout(() => setBp3((p) => ({ ...p, hold: false })), hit.crit ? BP3_HITSTOP_CRIT_MS : BP3_HITSTOP_MS));
        timers.push(window.setTimeout(() => setBp3((p) => ({ ...p, shakePx: 0, zoom: false, knock: null, flash: null })), BP3_CLEAR_MS));
      };
      if (atk) {
        if (!calm) setBp3((p) => ({ ...p, windup: atk }));
        timers.push(window.setTimeout(fire, BP3_WINDUP_MS));
      } else {
        fire();
      }
    };
    // 박자 스케줄: 선공 → 쉼 → 후공(없으면 생략) → 틱(없으면 생략·최종 확정) → 잠금 해제+결과.
    const timers = battleTimersRef.current;
    showBeat(v1, b1, beatSide(0));
    let at = (beatSide(0) ? BP3_WINDUP_MS : 0) + bt3BeatMs(b1.length) + hsFor(b1);
    if (b2.length > 0) {
      at += BT3_PAUSE_MS;
      const t2 = at;
      timers.push(window.setTimeout(() => showBeat(v2, b2, beatSide(1)), t2));
      at += (beatSide(1) ? BP3_WINDUP_MS : 0) + bt3BeatMs(b2.length) + hsFor(b2);
    }
    if (tail.length > 0) {
      const t3 = at;
      timers.push(window.setTimeout(() => showBeat(vF, tail, null), t3));
      at += BT3_TAIL_MS + hsFor(tail);
    } else {
      // 틱이 없으면 마지막 박자 끝에서 엔진 기준 최종 뷰로 확정 (HP 최종값 일치 보장).
      const t3 = at;
      const lastSlice = b2.length > 0 ? b2 : b1;
      timers.push(
        window.setTimeout(() => {
          setBattleView(vF);
          setBattleEvents(lastSlice);
        }, t3)
      );
    }
    at += BT3_UNLOCK_BUFFER_MS;
    timers.push(
      window.setTimeout(() => {
        setBattleLocked(false);
        if (state.over) {
          // BT-T: 양쪽 패스 종료면 판정 결과로 (무승부 winner=null).
          if (state.winner === null) finishBattle("timeDraw");
          else if (state.winner === "mine" && isDoublePassEnd(state.doublePass ?? 0)) finishBattle("timeWin");
          else finishBattle(state.winner === "mine" ? "won" : "lost");
        }
      }, at)
    );
  }
  // --- 9-F: 원점부터 거리 갱신 (1초, fight 중에만. cam=GPS 변위, sim=산책계 변위) ---
  useEffect(() => {
    if (battlePhase !== "fight") return;
    const id = window.setInterval(() => {
      const q = new URLSearchParams(window.location.search);
      if (q.get("battle") === "demo") {
        const ov = Number(q.get("distM"));
        if (Number.isFinite(ov) && ov >= 0) {
          setBattleDistance(ov);
          return;
        }
      }
      if (mode === "cam") {
        const o = battleOriginRef.current;
        const g = geoRef.current;
        setBattleDistance(o.lat !== null && o.lon !== null && g ? geoDistM(o.lat, o.lon, g.lat, g.lon) : 0);
      } else {
        setBattleDistance(Math.abs(walkMirrorRef.current - battleOriginRef.current.walk));
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [battlePhase, mode]);
  // --- BT-T: 야생 방치 패스 (1초, fight 중에만. driving 중 정지) ---
  useEffect(() => {
    if (battlePhase !== "fight") return;
    wildIdleSeq.current += 1;
    const mySeq = wildIdleSeq.current;
    const id = window.setInterval(() => {
      if (mySeq !== wildIdleSeq.current) return; // 구 인터벌이면 정지
      if (drivingRef.current) return; // 정지: 카운트다운 동결
      const now = Date.now();
      const idle = wildIdleRef.current;
      const remain = turnRemainingSec(idle.lastActMs, WILD_TURN_S, 0, now);
      setBattleIdleSec(remain);
      // 마지막 5초 작은 진동 1회 (차분 모드면 없음).
      if (remain <= 5 && remain > 0 && vibRef.current !== idle.passes) {
        vibRef.current = idle.passes;
        try {
          const calm = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          if (!calm && typeof navigator.vibrate === "function") navigator.vibrate(40);
        } catch { /* ignore */ }
      }
      const [res, next] = wildIdleStep(now - idle.lastActMs, idle.passes);
      if (res === "acted") return;
      idle.passes = next;
      if (res === "fled") {
        setMsg(`야생 ${josa(idle.wildName, "이가")} 지루해서 떠났다.`);
        finishBattle("wildFled");
        return;
      }
      idle.lastActMs = now;
      const yawnLine = `야생 ${josa(idle.wildName, "이가")} 하품한다… (${next}/${WILD_IDLE_TURNS})`;
      setMsg(yawnLine);
      setBattleYawn(yawnLine);
    }, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battlePhase]);
  function fleeBattle() {
    if (battlePhase !== "fight" || battleFled) return;
    clearBattleTimers(); // MF-0: 남은 연출 건너뛰고 바로 도주 처리
    setBattleFled(true);
    finishBattle("fled");
  }
  // --- 9-A4: 종료 (결과 + 포획 + 복귀) ---
  function finishBattle(result: "won" | "lost" | "fled" | "wildFled" | "timeWin" | "timeDraw") {
    setBattleResult(result);
    setBattlePhase("result");
    setBattleYawn(null);
    stopBattleBgm();
    if (result === "won") {
      setSt((prev) => {
        const next = addXp(prev, EXP_BATTLE_WIN);
        saveStatus(next, partnerId);
        return next;
      });
      bumpQuest("won");
      try {
        playCry(partner.id, "happy");
      } catch {
        /* ignore */
      }
      setMsg(`승리! +${EXP_BATTLE_WIN} EXP!`);
    } else if (result === "lost") {
      try {
        playCry(partner.id, "cry");
      } catch {
        /* ignore */
      }
      setMsg("패배…");
    } else if (result === "wildFled") {
      setMsg("야생 크리처가 지루해서 떠났다.");
    } else if (result === "timeWin") {
      setMsg("시간 종료 — 판정승!");
    } else if (result === "timeDraw") {
      setMsg("시간 종료 — 무승부.");
    } else {
      setMsg("배틀에서 도망쳤다.");
    }
  }
  function handleCaptureDone(caught: boolean) {
    setCaptureDone(true);
    if (caught && battleWildId) {
      const wid = battleWildId;
      try {
        const raw = localStorage.getItem("snapquest-dex");
        const arr = (raw ? JSON.parse(raw) : []) as Array<{ id?: string; name?: string }>;
        const sp = ROSTER.find((s) => s.id === wid);
        if (!arr.some((e) => e.id === wid || (sp && e.name === sp.name))) {
          arr.unshift({ id: wid, name: sp?.name ?? wid });
          localStorage.setItem("snapquest-dex", JSON.stringify(arr.slice(0, 30)));
        }
      } catch {
        /* ignore */
      }
      const rw = captureReward(wid, true);
      setSt((prev) => {
        const next = addXp(prev, rw.exp);
        saveStatus(next, partnerId);
        return next;
      });
      bumpQuest("caught");
      setCaptureMsg(`포획 성공! 도감 등록 + EXP ${rw.exp}`);
    } else {
      setCaptureMsg("3회 실패 — 야생 크리처가 떠났다. EXP 0");
    }
  }
  // Q: 스캔 결과의 표 매칭 여부를 기록. 표 없음 3연속이면 즉시 힌트.
  function recordScanResult(label: string) {
    const m = matchLabel(label, 100);
    if (m.speciesId !== null) {
      missStreakRef.current = 0;
      lastHitRef.current = Date.now();
      recordActivityScan(); // LV-2: 유효 스캔 기록
      return;
    }
    missStreakRef.current += 1;
    const pick = pickMissHint({
      consecutiveMisses: missStreakRef.current,
      caughtIds: loadCaughtIds(),
      env,
      offset: hintOffsetRef.current++,
    });
    if (pick) {
      missStreakRef.current = 0;
      revealHint(pick, label || "주변 탐색", freshBox(recentBoxRef.current, Date.now()));
    }
  }
  const EMOTE_VOICE: Record<string, CryMood | null> = {
    beg: "want", want: "want", hungry: "hungry", happy: "happy",
    cry: "cry", hurt: "cry", eat: "eat", chomp: "eat", fetch: null, sleep: "sleep",
    attack: "attack", greet: "meet", roam: null, idle: null,
    drowsy: "sleep", zoomies: "happy", pat: "happy", cuddle: "happy",
  };
  function doEmote(e: Emote) {
    // 애정 없음(affection < AFFECTION_LOW): 애교·교감 반응(cuddle/pat)을 하지 않는다.
    const blocked = st.affection < AFFECTION_LOW && (e === "cuddle" || e === "pat");
    povRef.current?.emote(blocked ? "idle" : e);
    if (blocked) return;
    const m: CryMood | null = EMOTE_VOICE[e] ?? null;
    if (m) voice(m);
  }
  function bumpQuest(k: keyof Quest) {
    setQuest((prev) => {
      const n = { ...prev, [k]: prev[k] + 1 };
      try {
        localStorage.setItem(QUEST_KEY, JSON.stringify(n));
      } catch {
        /* ignore */
      }
      return n;
    });
  }

  useEffect(() => {
    markSeen(wild.id);
    // 조우 울음소리 (스폰 연출과 함께)
    playCry(wild.id, "meet");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wild.id]);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.search.includes("demo=1")) {
      setDemoIdx(0);
    }
  }, []);

  // TODO(survey-temp): R2 전수 표정 검증용 강제 감정 (?face=happy|chomp). 검증 후 삭제.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (poseLock) return; // ?pose 고정 중에는 감정 강제 발사 중단
    const m = new URLSearchParams(window.location.search).get("face");
    const FACE18: readonly string[] = ["idle", "beg", "want", "hungry", "happy", "cry", "hurt", "sleep", "eat", "chomp", "fetch", "greet", "roam", "attack", "drowsy", "zoomies", "pat", "cuddle"];
    if (m !== "walk" && !FACE18.includes(m ?? "")) return;
    const fire = () => {
      if (m === "walk") povRef.current?.emote("roam");
      else povRef.current?.emote(m as Emote);
    };
    const t1 = window.setTimeout(fire, 2500);
    const iv = window.setInterval(fire, 1600);
    return () => {
      window.clearTimeout(t1);
      window.clearInterval(iv);
    };
  }, []);

  useEffect(() => {
    if (demoIdx === null) return;
    const d = DEMO[demoIdx % DEMO.length];
    setMsg(`${d.act} — ${d.cap}`);
    void runLook(d.input);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoIdx]);

  // AR 모드 역할 분리: 댄싱 없이 감정 표현만 (춤은 도감 전담).

  // 데모 감독: 틀어놓으면 4막이 끝까지 자동 상영 (약 2분 30초)
  useEffect(() => {
    if (demoIdx === null) return;
    let live = true;
    hush();
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    (async () => {
      const d = DEMO[demoIdx % DEMO.length];
      setMsg(`${d.act} — ${d.cap}`);
      await runLook(d.input);
      if (!live) return;
      await sleep(4000);
      if (!live) return;
      if (demoIdx === 0) {
        await feed();
        if (!live) return;
        await sleep(4000);
        if (!live) return;
        doCapture(true);
      } else if (demoIdx === 1) {
        doEmote("greet");
        say("안녕!", { interactive: true });
        await sleep(4000);
        if (!live) return;
        doCapture(true);
      } else if (demoIdx === 2) {
        await sleep(8000);
      } else if (demoIdx === 3) {
        povRef.current?.emote("roam");
        setWalkM(addWalkM(120));
        const w = claimWalkExp(loadWalkM());
        if (w.gain > 0) {
          setSt((prev) => {
            const next = addXp(prev, w.gain);
            saveStatus(next, partnerId);
            return next;
          });
        }
        await sleep(4000);
        if (!live) return;
        await readDiary();
      }
      if (!live) return;
      await sleep(14000);
      if (!live) return;
      setDemoIdx((i) => (i === null || i + 1 >= DEMO.length ? null : i + 1));
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoIdx]);

  // 자율 감정: 가만히 둬도 크리처가 혼자 움직인다 (클릭 상영 아님)
  // §2 컨디션 유기적 행동: 해당 조건이 있으면 후보 중 랜덤 1종, 없으면 중립 풀.
  useEffect(() => {
    // 3-3: 듣는 중에는 상태 문구를 덮지 않는다.
    // 9-B 후속: 배틀 중 자율 감정 중단 (대기 바운스 유지).
    if (busy || demoIdx !== null || listening || battleActive) return;
    const wait = CALM_EMOTE_MIN_GAP_S * 1000 + Math.random() * 5000;
    const t = window.setTimeout(() => {
      if (document.visibilityState === "visible" && battlePhaseRef.current === "none") {
        // CALM-1: 효과 리마운트로 타이머가 당겨져도 최소 간격 보장.
        const nowS = Date.now() / 1000;
        const moveOk = nowS - lastAmbientMoveAtRef.current >= CALM_ROAM_MIN_GAP_S;
        const randomOk = nowS - lastRandomAtRef.current >= CALM_RANDOM_WINDOW_S / CALM_RANDOM_PER_MIN;
        if (nowS - lastAmbientEmoteAtRef.current < CALM_EMOTE_MIN_GAP_S) {
          setAmbientTick((n) => n + 1);
          return;
        }
        lastAmbientEmoteAtRef.current = nowS;
        const condActs: Array<() => void> = [];
        if (st.energy < ENERGY_LOW) {
          condActs.push(() => {
            doEmote("drowsy");
            say(SLEEPY_LINE);
            setMsg(`${josa(partner.name, "이가")} 주저앉아 꾸벅거려요. 이동속도 50%.`);
          });
        }
        if (st.fullness < FULLNESS_LOW) {
          condActs.push(() => {
            doEmote("hungry");
            setMsg(`${josa(partner.name, "이가")} 배를 움켜쥐고 시무룩해해요.`);
          });
        }
        if (st.fullness >= FULLNESS_HIGH) {
          condActs.push(() => {
            doEmote("pat");
            say("냠냠... 배불러!");
            setMsg(`${josa(partner.name, "이가")} 배를 두드리며 만족스러워해요.`);
          });
        }
        if (st.energy >= ENERGY_HIGH && moveOk) {
          condActs.push(() => {
            lastAmbientMoveAtRef.current = nowS;
            doEmote("zoomies");
            setMsg(`${josa(partner.name, "이가")} 발을 구르며 트레이너 주변을 빙글빙글 돌아요!`);
          });
        }
        if (st.affection >= AFFECTION_HIGH && moveOk) {
          condActs.push(() => {
            lastAmbientMoveAtRef.current = nowS;
            doEmote("cuddle");
            setMsg(`${josa(partner.name, "이가")} 정면으로 다가와 갸웃하며 애교를 부려요.`);
          });
        }
        if (getCreatureCondition(st).stressed && Math.random() < 0.35) {
          condActs.push(() => {
            doEmote("cry");
            setMsg(`${josa(partner.name, "이가")} 지쳐서 칭얼거려요. 휴식이 필요해요.`);
          });
        }
        if (condActs.length > 0) {
          condActs[Math.floor(Math.random() * condActs.length)]();
        } else if (randomOk) {
          const pool = ["happy", "greet", "roam", "roam", "roam", "eat"] as const;
          const e = pool[Math.floor(Math.random() * pool.length)];
          if ((e === "roam" || e === "greet") && !moveOk) {
            setAmbientTick((n) => n + 1);
            return;
          }
          if (e === "roam" || e === "greet") lastAmbientMoveAtRef.current = nowS;
          lastRandomAtRef.current = nowS;
          doEmote(e);
          setMsg(
            {
              happy: `${josa(partner.name, "이가")} 혼자 깔깔거려요.`,
              greet: `${josa(partner.name, "이가")} 당신에게 달려와 인사해요.`,
              roam: `${josa(partner.name, "이가")} 주변을 어슬렁거려요.`,
              eat: `${josa(partner.name, "이가")} 바닥 냄새를 맡아요.`,
            }[e]
          );
        }
      }
      setAmbientTick((n) => n + 1);
    }, wait);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, demoIdx, ambientTick, st.fullness, st.energy, st.affection, wild.id, partner.id, listening, battleActive]);

  // PC-1: 대표 파트너 값으로 읽는다 (교체되면 다시 읽음).
  useEffect(() => {
    fetchStatus(partnerId).then(setSt).catch(() => setSt(loadStatus()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId]);
  useEffect(() => {
    ensureStarter(); // ST-1: 첫 실행 스타터 지급
    setQuest(loadQuestState());
    setWalkM(loadWalkM());
    const stopBeat = startStatusHeartbeat();
    fetchBalance().then(setTokenN).catch(() => {
      /* 잔량 조회 실패 시 0 유지 */
    });
    // AR 진입: 9-C 0항 규칙 — 탐험 중 무음 (배틀 때만 battle.mp3).
    stopBgm();
    // ?mode=sim|cam + 트레이너 라운지에서 고른 대표 파트너
    // 모드는 localStorage에 보존: 뒤로 가기·새로고침해도 풀리지 않는다.
    try {
      const q = new URLSearchParams(window.location.search);
      const m = q.get("mode");
      if (m === "sim" || m === "cam") {
        setMode(m);
        localStorage.setItem("oishie-ar-mode", m);
      } else {
        const savedMode = localStorage.getItem("oishie-ar-mode");
        if (savedMode === "sim" || savedMode === "cam") setMode(savedMode);
      }
      // MF-2: 쿼리에 env가 없고 저장된 선택이 있으면 URL에 반영 (새로고침 없음)
      try {
        const s = sessionStorage.getItem(SIM_ENV_KEY);
        if ((s === "cafe" || s === "street") && q.get("env") !== "cafe" && q.get("env") !== "street") {
          const u = new URL(window.location.href);
          u.searchParams.set("env", s);
          window.history.replaceState(null, "", u.toString());
        }
      } catch {
        /* ignore */
      }
      // 동행 파트너: ?partner= 직링크 > 도감 선택 > 첫 포획 > 구 키 > 스타터 순
      const active = localStorage.getItem("snapquest_active_partner");
      const legacy = localStorage.getItem("oishie-partner");
      let pick: string | null = null;
      const qp = q.get("partner");
      if (qp && ROSTER.some((s) => s.id === qp)) pick = qp;
      if (!pick && active && ROSTER.some((s) => s.id === active)) pick = active;
      if (!pick) {
        try {
          const raw = localStorage.getItem("snapquest-dex");
          const arr = raw ? (JSON.parse(raw) as Array<{ id?: string }>) : [];
          const first = arr.map((d) => d.id).find((x) => x && ROSTER.some((s) => s.id === x));
          if (first) pick = first;
        } catch {
          /* ignore */
        }
      }
      if (!pick && legacy && ROSTER.some((s) => s.id === legacy)) pick = legacy;
      if (pick) setPartnerId(pick);
    } catch {
      /* ignore */
    }
    // 첫 터치에 브라우저 오디오 잠금 해제 (울음소리용)
    window.addEventListener("pointerdown", unlockAudio);
    // 소울캐쳐식 GPS 조우: 현재 위치를 시드로 근처 크리처 결정
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (p) => {
          const h =
            Math.abs(
              Math.round(p.coords.latitude * 100) * 7 +
                Math.round(p.coords.longitude * 100) * 13
            ) % ROSTER.length;
          setWildIdx(h);
          setMsg(`근처에서 야생 ${ROSTER[h].name} 감지.`);
        },
        () => {
          /* 위치 거부 시 기본 크리처로 시작 */
        },
        { timeout: 8000 }
      );
    }
    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      stopBeat();
      const s = videoRef.current?.srcObject as MediaStream | null;
      s?.getTracks().forEach((t) => t.stop());
      // AR 퇴장: AR 변주 끄고 기존 메인 BGM으로 롤백.
      stopBgm();
      startBgm();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function snapFrame(): string | null {
    // 활성 프레임 소스: 웹캠 우선, sim 모드에서는 보행 배경 비디오.
    const v =
      videoRef.current && videoRef.current.videoWidth > 0
        ? videoRef.current
        : simVideoRef.current && simVideoRef.current.videoWidth > 0
          ? simVideoRef.current
          : null;
    if (!v) return null;
    const c = document.createElement("canvas");
    c.width = 640;
    c.height = Math.round((640 * v.videoHeight) / v.videoWidth);
    c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.8);
  }

  function validEmote(e: unknown): Emote {
    return e === "happy" || e === "attack" || e === "hurt" || e === "sleep" || e === "eat" || e === "chomp" || e === "fetch" || e === "greet" || e === "roam"
      || e === "beg" || e === "want" || e === "hungry" || e === "cry"
      || e === "drowsy" || e === "zoomies" || e === "pat" || e === "cuddle"
      ? (e as Emote)
      : "idle";
  }

  async function look() {
    if (busy) return;
    hush();
    const photo = snapFrame();
    if (!photo) {
      // 카메라가 없어도 게임은 진행된다: 야생 크리처 목격으로 분석
      await runLook({ description: `주변 풍경, 야생 ${wild.name} 출현` });
    } else {
      await runLook({ imageDataUrl: photo });
    }
    // 둘러보기 = 함께 걷기: 산책 거리 누적 + 산책 EXP 정산
    setWalkM(addWalkM(50));
    const w = claimWalkExp(loadWalkM());
    if (w.gain > 0) {
      setSt((prev) => {
        const next = addXp(prev, w.gain);
        saveStatus(next, partnerId);
        return next;
      });
      // EX-2: AI 칩 유지 (aiMsgRef도 함께 갱신).
      setMsg((m) => {
        const t = `${m} 산책 +${w.gain} EXP.`;
        aiMsgRef.current = t;
        return t;
      });
    }
  }

  async function runBattle(mineName: string, wildLabel: string, wildId?: string): Promise<{ won: boolean; text: string; fb: boolean }> {
    const wid = wildId ?? wild.id; // Q ??? 카드: 힌트 종과 배틀할 때 id 지정
    const { battleStats, conditionMult, elementOf, loadBoosts, typeEdge } = await import("@/lib/stats");
    const mineStats = battleStats(partner.id, st.level, loadBoosts(partner.id), {
      fullness: st.fullness,
      affection: st.affection,
      energy: st.energy,
    });
    const cond = conditionMult(st);
    const edge = typeEdge(elementOf(partner.id), elementOf(wid));
    const b = await fetch("/api/battle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mine: mineName,
        wild: wildLabel,
        mineId: partner.id,
        wildId: wid,
        mineLevel: st.level,
        wildLevel: Math.max(1, st.level + (Math.random() < 0.3 ? 1 : 0)),
        boosts: loadBoosts(partner.id),
        condMult: cond,
        mineFull: st.fullness,
        mineAff: st.affection,
        mineEnergy: st.energy,
      }),
    });
    const bd = await b.json();
    if (b.ok) void meterRemote("battle", tokenN).then(setTokenN);
    if (!b.ok) {
      povRef.current?.emote("attack");
      return { won: false, text: "배틀이 불발됐어요.", fb: false };
    }
    const won = bd.result.winner === "mine";
    povRef.current?.emote(won ? "happy" : "hurt");
    const exhaustedTag = st.energy < ENERGY_LOW ? " 탈진 ATK/SPD 50%" : "";
    const statLine = `(${st.level}레벨 HP${mineStats.hp} ATK${mineStats.atk} 상성x${edge} 컨디션x${cond.toFixed(2)}${exhaustedTag})`;
    return { won, text: `${(bd.result.turns ?? []).join(" ")} ${bd.result.comment ?? ""} ${statLine}`, fb: bd.fallback === true };
  }

  async function runLook(input: {
    imageDataUrl?: string;
    description?: string;
    dexOverride?: string[];
    showPortrait?: string;
    roam?: boolean;
  }) {
    if (!input.imageDataUrl && !input.description) {
      setMsg("POV 카메라를 먼저 켜주세요.");
      return;
    }
    if (input.showPortrait) setPortrait(input.showPortrait);
    setBusy(true);
    try {
      const dexRaw = localStorage.getItem("snapquest-dex");
      const dexArr = (dexRaw ? JSON.parse(dexRaw) : []) as Array<{ name?: string }>;
      const res = await fetch("/api/look", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageDataUrl: input.imageDataUrl,
          description: input.description,
          dex: input.dexOverride ?? dexArr.map((d) => d.name).filter(Boolean),
          status: st,
          creatureLevel: st.level,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed");
      void meterRemote("look", tokenN).then(setTokenN);
      const lookFb = data.fallback === true;
      const r = data.result as {
        seen: string; label: string; friend: boolean; foe: boolean;
        emote: string; message: string; xpGain: number;
      };
      // Q: 수동 둘러보기도 표 매칭 기록 (데모 상영 제외).
      if (demoIdx === null) {
        if (r.seen === "food") {
          missStreakRef.current = 0;
          lastHitRef.current = Date.now();
        } else {
          recordScanResult(r.label ?? "");
        }
      }
      const { next, leveledUp, auto } = applyLook(
        st, r.seen, !!r.friend, !!r.foe, clampLookGain(r.xpGain)
      );
      let m: string = r.message ?? "";
      let wonBattle = false;
      let battleFb = false;
      if (auto === "battle") {
        const rep = dexArr[0]?.name ?? `${wild.name} (거울전)`;
        say("으르렁!", { interactive: true });
        playCry(partner.id, "attack");
        const bout = await runBattle(rep, r.label);
        battleFb = bout.fb;
        m += ` ${bout.text}`;
        const won = bout.won;
        if (won) {
          const up = addXp(next, EXP_BATTLE_WIN);
          next.xp = up.xp;
          next.level = up.level;
          bumpQuest("won");
          wonBattle = true;
        }
      } else if (r.friend) {
        doEmote("greet");
      } else {
        doEmote(validEmote(r.emote));
      }
      // §2 배고픔: 음식 인식 시 지정 말풍선.
      if (r.seen === "food" && st.fullness < FULLNESS_LOW) {
        doEmote("hungry");
        say(HUNGRY_FOOD_LINE, { interactive: true });
      }
      if (auto === "eat") {
        await dessertSequence(r.label || "디저트", { fromLook: true });
      }
      if (auto === "sleep") doEmote("sleep");
      if (input.roam) doEmote("roam");
      if (next.fullness < FULLNESS_LOW && auto !== "eat" && r.seen !== "food") {
        // 배고프면 배 움켜쥠 + 시무룩 + hungry 보이스
        doEmote("hungry");
        say("배고파!", { interactive: true });
      }
      // 승리 직후에는 기쁨 점프로 축하 (AR 역할 분리: 댄스 없음)
      if (wonBattle) {
        m += ` 승리! 배틀 승리 +${EXP_BATTLE_WIN} EXP. ${josa(partner.name, "이가")} 기뻐 뛰어요!`;
        doEmote("happy");
        say("신나!", { interactive: true });
      }
      if (leveledUp || next.level > st.level) m += ` 레벨 ${next.level} 달성!`;
      const el = guessElementLine(r.label ?? "");
      if (el) m += ` ${el}`;
      if (auto !== "eat") {
        setSt(next);
        saveStatus(next, partnerId);
      }
      bumpQuest("met");
      setAiMsg(m, lookFb || battleFb);
    } catch (e) {
      setMsg(`둘러보기 실패: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  async function startCamera() {
    hush();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCamOn(true);
        setMsg("POV 연결됨. 앞을 비춰보세요.");
      }
    } catch {
      setMsg("카메라를 열 수 없어요. 미리보기 배경으로 체험하세요.");
    }
  }

  // ---------- VA-1: 음성 질문 → 뮤즈 AI 이해 → 실행 ----------
  type AskSpotView = { name: string; kind: string; distM: number | null; source: string };
  type AskResponse = {
    intent: string;
    args: Record<string, unknown>;
    reply: string;
    spots?: AskSpotView[];
    fallback?: boolean;
  };

  // EX-2 규칙: 정규식 경로로 돌아가고 오프라인 칩을 붙인다.
  function askFallback(said: string) {
    legacyVoiceRef.current(said);
    setMsg((m) => {
      aiMsgRef.current = m;
      return m;
    });
    setMsgOffline(true);
  }

  function runSkillArgs(args: SkillArgs, skills: SkillInfo[], said: string, reply: string | null) {
    if (battlePhase !== "fight" || !battleState) {
      const line = reply ?? "배틀에서 외쳐줘!";
      doEmote("attack");
      say(line, { interactive: true });
      setAiMsg(`"${said}" — ${line}`, false);
      return;
    }
    let slot = -1;
    if (args.by === "slot") slot = args.slot;
    else if (args.by === "type") {
      slot = skills.find((s) => s.type === args.type && isSlotLegal(battleState.mine, s.slot))?.slot
        ?? skills.find((s) => s.type === args.type)?.slot ?? -1;
    } else {
      slot = skills.find((s) => s.name === (args as { name: string }).name)?.slot ?? -1;
    }
    if (slot < 0 || !isSlotLegal(battleState.mine, slot)) {
      const line = reply ?? "그 기술은 지금 못 써!";
      doEmote("idle");
      say(line, { interactive: true });
      setAiMsg(`"${said}" — ${line}`, false);
      return;
    }
    pickBattleMove(slot);
    const line = reply ?? `${skills[slot].name}!`;
    say(line, { interactive: true });
    setAiMsg(`"${said}" — ${line}`, false);
  }

  function runAskResult(data: AskResponse, said: string) {
    const reply = typeof data.reply === "string" && data.reply ? data.reply : "음, 잘 모르겠어.";
    const spots = Array.isArray(data.spots) ? data.spots : [];
    switch (data.intent) {
      case "skill": {
        runSkillArgs(data.args as unknown as SkillArgs, skillInfos(), said, reply);
        return;
      }
      case "battle_start": {
        if (busy) setAiMsg(`"${said}" — 지금 스캔 중! 끝나고 다시 외쳐봐.`, false);
        else {
          say(reply, { interactive: true });
          setAiMsg(`"${said}" — ${reply}`, false);
          void challengeBattle();
        }
        return;
      }
      case "flee": {
        if (battlePhase === "fight") fleeBattle();
        doEmote("roam");
        say(reply, { interactive: true });
        setAiMsg(`"${said}" — ${reply}`, false);
        return;
      }
      case "capture": {
        doCapture();
        say(reply, { interactive: true });
        setAiMsg(`"${said}" — ${reply}`, false);
        return;
      }
      case "care": {
        const kind = (data.args as { kind?: string }).kind;
        if (kind === "feed") void feed();
        else if (kind === "sleep") doEmote("sleep");
        else doEmote("happy");
        say(reply, { interactive: true });
        setAiMsg(`"${said}" — ${reply}`, false);
        return;
      }
      case "ask_token_spots":
      case "ask_hip_spots": {
        doEmote("happy");
        say(reply, { interactive: true });
        const tail = spots.slice(0, 3).map((s) => `${s.name}${s.distM !== null ? ` ${s.distM}m` : ""}`).join(" / ");
        setRecMsg(tail ? `${reply} · ${tail}` : reply);
        return;
      }
      default: {
        doEmote(data.intent === "chat" ? "happy" : "idle");
        say(reply, { interactive: true });
        setAiMsg(`"${said}" — ${reply}`, false);
      }
    }
  }

  function skillInfos(): SkillInfo[] {
    return buildMoveset(partner.id).map((m, i) => ({ slot: i, name: m.name, type: askSkillType(i, moveKind(m)) }));
  }

  async function handleAsk(said: string) {
    hush();
    const skills = skillInfos();
    // 빠른 길: 명확한 스킬 말은 로컬 매칭으로 즉시 실행 (AI 호출 없음).
    const fast = fastSkill(said, skills);
    if (fast) {
      if (drivingRef.current) {
        doEmote("idle");
        say("운전 중엔 안 돼!", { interactive: true });
        setAiMsg(`"${said}" — 운전 중엔 안 돼!`, false);
        return;
      }
      runSkillArgs(fast, skills, said, null);
      return;
    }
    // VA-2: 말한 즉시 대기 표시 — "생각 중" 말풍선 + 두리번(roam).
    doEmote("roam");
    say("음… 생각 중", { interactive: true, sticky: true });
    // 토큰 차감 (부족하면 크리처 말투 + 충전처 1곳, 무료·로컬).
    let bal = tokenN;
    try {
      const out = await spendRemote(AI_CALL_COSTS.ask, "ai:ask");
      if (Number.isFinite(out.balance)) {
        bal = out.balance;
        setTokenN(out.balance);
      }
      if (!out.ok) {
        const spot = TOKEN_ZONES.find((z) => z.video === env) ?? TOKEN_ZONES[0];
        doEmote("cry");
        say("토큰이 모자라…", { interactive: true });
        setAiMsg(`토큰이 모자라… ${spot.store}(${spot.distM}m)에 가면 충전돼!`, false);
        return;
      }
    } catch {
      askFallback(said);
      return;
    }
    // AI 이해.
    let data: AskResponse | null = null;
    try {
      const g = geoRef.current;
      const res = await fetch("/api/muse/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: said,
          screen: battleActive ? "battle" : scanReveal ? "encounter" : "idle",
          driving: drivingRef.current,
          partner: { speciesId: partner.id, name: partner.name, element: partner.element, role: speciesOf(partner.id).role },
          skills,
          loc: {
            mode, env,
            ...(mode === "cam" && g ? { lat: g.lat, lon: g.lon } : {}),
          },
          balance: bal,
          lang: typeof navigator !== "undefined" && navigator.language ? navigator.language : "ko-KR",
        }),
      });
      data = (await res.json()) as AskResponse;
      if (!res.ok) throw new Error("ask failed");
    } catch {
      askFallback(said);
      return;
    }
    if (!data || data.fallback === true) {
      askFallback(said);
      return;
    }
    runAskResult(data, said);
  }

  // MC-1: 전사 문장의 하류. VAD 경로(MicButton onSaid)와 SR 경로가 공유한다. VA-1 그대로.
  function handleSaid(said: string) {
    // VA-1: 플래그가 켜지면 AI 이해 경로, 꺼지면 기존 정규식 경로.
    if (ASK_ENABLED) {
      void handleAsk(said);
      return;
    }
    legacyVoiceRef.current(said);
  }

  // PKG-2: 앱(WebView)이면 네이티브 음성 인식, 브라우저면 기존 Web Speech.
  function voiceCapture() {
    legacyVoiceRef.current = runLegacyVoice;
    const lang = typeof navigator !== "undefined" && navigator.language ? navigator.language : "ko-KR";
    void nativeListenOnce({ lang, onText: (said: string) => handleSaid(said) }).then((r) => {
      if (r === "unavailable") voiceCaptureWeb();
      else if (r === "empty") setMsg("잘 안 들렸어요. 다시 눌러 주세요");
    });
  }

  function voiceCaptureWeb() {
    const SR =
      (window as unknown as { webkitSpeechRecognition?: new () => any })
        .webkitSpeechRecognition ??
      (window as unknown as { SpeechRecognition?: new () => any }).SpeechRecognition;
    if (!SR) {
      setMsg("이 브라우저는 음성 인식을 지원하지 않아요");
      return;
    }
    const rec = new SR();
    // 3-3: 인식 언어는 기기 언어, 상태 표시는 한국어.
    rec.lang = typeof navigator !== "undefined" && navigator.language ? navigator.language : "ko-KR";
    setListening(true);
    setMsg("듣는 중… '잡아/catch', '공격/attack', '웃어/happy'를 외쳐보세요");
    rec.onresult = (e: any) => {
      const said: string = e.results[0][0].transcript ?? "";
      setListening(false);
      handleSaid(said);
    };
    // 3-3: e.error 값으로 경우를 나눈다. 음성 인식에는 NotFoundError가 없고
    // 마이크 없음은 audio-capture로 들어온다 (둘 다 받는다).
    rec.onerror = (e: any) => {
      setListening(false);
      const err: string = e?.error ?? "";
      // VC-1: 사유별 한국어 안내 (문구는 주문서 규격).
      if (err === "not-allowed" || err === "service-not-allowed") setMsg("마이크 권한을 허용해 주세요");
      else if (err === "network") setMsg("음성 인식 서버에 연결할 수 없어요");
      else if (err === "no-speech") setMsg("잘 안 들렸어요. 다시 눌러 주세요");
      else if (err === "audio-capture" || err === "NotFoundError") setMsg("마이크를 찾을 수 없어요");
      else setMsg(`음성 인식 실패 — 다시 시도해보세요${err ? ` (${err})` : ""}`);
    };
    rec.onend = () => setListening(false);
    try {
      rec.start();
    } catch {
      setListening(false);
      setMsg("음성 인식 실패 — 다시 시도해보세요");
    }
  }

  // VA-1 이전 경로 (정규식 + 고정 문구). 키 없음·실패·플래그 off 때 사용.
  // PKG-2: voiceCapture 안쪽에서 컴포넌트 수준으로 이동(네이티브 경로와 공유).
  function runLegacyVoice(said: string) {
    hush();
    void meterRemote("voice", tokenN).then(setTokenN);
    // 3-3: 기존 한국어 명령 유지 + 영어 단어 추가.
    const emo: Emote | null =
      /공격|어택|때려|attack|fight/i.test(said) ? "attack"
      : /사줘|갖고싶|먹고싶|조르기/i.test(said) ? "beg"
      : /배고파|배고픈|배고픔/i.test(said) ? "hungry"
      : /울어|엉엉|슬퍼|눈물/i.test(said) ? "cry"
      : /웃어|기뻐|행복|신나|좋아|happy|smile/i.test(said) ? "happy"
      : /아파|아야|아프/i.test(said) ? "hurt"
      : /잘자|잠|쉬어|sleep/i.test(said) ? "sleep"
      : /산책|같이|걷자|walk/i.test(said) ? "roam"
      : /밥|먹어|냠냠|eat|food/i.test(said) ? "eat"
      : null;
    if (/불꽃|펀치|화염 펀치/i.test(said)) void challengeBattle();
    else if (/회피|닷지/i.test(said)) {
      doEmote("greet");
      say("휙!", { interactive: true });
      setMsg(`"${said}" — 날렵하게 회피!`);
    }
    // 3-3: 배틀은 스캔 중(busy)에 조용히 무시되므로 음성에서는 상태를 알린다. 배틀 로직은 그대로 둔다.
    else if (/배틀|싸워|겨뤄|붙어|battle/i.test(said)) {
      if (busy) setMsg(`"${said}" — 지금 스캔 중! 끝나고 다시 외쳐봐.`);
      else void challengeBattle();
    }
    else if (/먹어|밥줘|간식|먹이 줘/i.test(said)) void feed();
    else if (/catch|capture|캡처|잡아|포획/i.test(said)) doCapture();
    else if (/디저트|케이크|쇼트/i.test(said)) void look();
    else if (/초상화|그림 그려|그려줘/i.test(said)) void makePortrait();
    else if (/일기/i.test(said)) void readDiary();
    else if (/다른 곳|이동해|옮겨|다음 만나/i.test(said)) {
      setPortrait(null);
      setWildIdx((i) => i + 1);
      setMsg("이동. 새 위치를 스캔한다.");
    }
    // §2 단짝: 칭찬 인식 시 점프 환호. 애정 없음이면 반응하지 않는다.
    else if (/칭찬|잘했|예쁘|이쁘|귀여|사랑|최고|대단|멋져|장하|good job|cute|love/i.test(said)) {
      if (st.affection < AFFECTION_LOW) {
        setMsg(`"${said}" — 무관심하게 돌아선다.`);
      } else {
        doEmote("happy");
        say("헤헤! 신나!", { interactive: true });
        const gain = voiceExp();
        setSt((prev) => {
          const next = addXp(prev, gain);
          saveStatus(next, partnerId);
          return next;
        });
        setMsg(`"${said}" — 칭찬에 점프 환호! 음성 교감 +${gain} EXP.`);
      }
    }
    else if (emo) {
      doEmote(emo);
      const gain = voiceExp();
      setSt((prev) => {
        const next = addXp(prev, gain);
        saveStatus(next, partnerId);
        return next;
      });
      setMsg(`"${said}" — 반응. 음성 교감 +${gain} EXP.`);
    } else setMsg(`"${said}" — "잡아/catch", "공격/attack", "웃어/happy"를 외쳐보세요.`);
  }

  // BFCache 복원 시 강제 리로드: 뒤로가기로 옛 화면이 나오지 않게.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);


  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  // 디저트 덥석 시퀀스: HUD 타겟팅 → 앞장서기 → 하트눈 → 덥석/허그 → 눈웃음.
  // 무입 종(Type B)은 입 대신 온몸 허그 + 눈웃음으로 만족 표현.
  async function dessertSequence(label: string, opts?: { fromLook?: boolean }) {
    if (!opts?.fromLook && (busy || busyRef.current)) return;
    hush();
    setBusy(true);
    busyRef.current = true;
    const mouth = speciesHasMouth(partner.id);
    const shop = shopFor();
    try {
      setHud({ phase: "target", shop, amount: 0 });
      doEmote("fetch");
      setMsg(`${partner.name}: 앞장서서 쫄래쫄래. 디저트 냄새에 멈춰선다.`);
      await sleep(1900);
      say("우와 맛있겠다! 나 저거 한 입만!", { interactive: true });
      doEmote("beg");
      setMsg(`${partner.name}: 힐끔 돌아보며 하트눈으로 조른다.`);
      await sleep(1900);
      doEmote("chomp");
      setMsg(
        mouth
          ? `${partner.name}: 접시로 깡총 다가가 덥석. 볼이 빵빵해진다.`
          : `${partner.name}: 케이크를 통째로 끌어안고 머리를 부빈다.`
      );
      await sleep(2500);
      doEmote("happy");
      say(mouth ? "냠냠... 배불러!" : "퐁퐁! 기분 좋아!", { interactive: true });
      const gain = dineExp();
      setSt((prev) => {
        const next = addXp(
          {
            ...prev,
            fullness: Math.min(100, prev.fullness + 20),
            affection: Math.min(100, prev.affection + 12),
          },
          gain
        );
        saveStatus(next, partnerId);
        return next;
      });
      bumpQuest("fed");
      sfxPop();
      setHud(null);
      setMsg(`${partner.name}: 완식. 미식 탐험 +${gain} EXP.`);
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  }

  // 실제 AR 비전 파이프라인: 조준선(레티클) = 프레임 중앙 크롭.
  // 재생 비디오(또는 웹캠) 프레임을 OffscreenCanvas로 주기 캡처 → Base64 → /api/look(VLM).
  // VLM이 크롭 안에서 음식을 판독했을 때만 HUD 락온(target/charge) + 크리처 상호작용.
  // 화면 중앙 팝업 없음, 고정 문자열·타이머 발견 없음.
  const busyRef = useRef(false);
  const visionBusyRef = useRef(false);
  const lastLockRef = useRef(0);

  function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error("blob read failed"));
      fr.readAsDataURL(blob);
    });
  }

  async function captureReticleFrame(): Promise<string | null> {
    const v = mode === "sim" ? simVideoRef.current : videoRef.current;
    if (!v || !v.videoWidth || !v.videoHeight) return null;
    const side = Math.min(v.videoWidth, v.videoHeight);
    const sx = (v.videoWidth - side) / 2;
    const sy = (v.videoHeight - side) / 2;
    const S = 384;
    try {
      if (typeof OffscreenCanvas !== "undefined") {
        const oc = new OffscreenCanvas(S, S);
        const ctx = oc.getContext("2d");
        if (!ctx) throw new Error("no 2d context");
        ctx.drawImage(v, sx, sy, side, side, 0, 0, S, S);
        const blob = await oc.convertToBlob({ type: "image/jpeg", quality: 0.8 });
        return await blobToDataUrl(blob);
      }
    } catch {
      /* OffscreenCanvas 미지원/실패 시 아래 폴백 */
    }
    try {
      const c = document.createElement("canvas");
      c.width = S;
      c.height = S;
      c.getContext("2d")?.drawImage(v, sx, sy, side, side, 0, 0, S, S);
      return c.toDataURL("image/jpeg", 0.8);
    } catch {
      return null;
    }
  }

  // MF-3: 공유 합성용 배경 전체 프레임 (sim/cam 공용, 실패 시 null).
  async function captureVideoFrame(): Promise<string | null> {
    const v = mode === "sim" ? simVideoRef.current : videoRef.current;
    if (!v || !v.videoWidth || !v.videoHeight) return null;
    try {
      const c = document.createElement("canvas");
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      const g = c.getContext("2d");
      if (!g) return null;
      g.drawImage(v, 0, 0);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.85));
      if (!blob) return null;
      return await blobToDataUrl(blob);
    } catch {
      return null;
    }
  }

  async function visionTick() {
    if (busyMirrorRef.current || busyRef.current || visionBusyRef.current || demoIdx !== null) return;
    if (Date.now() - lastLockRef.current < VISION_LOCK_COOLDOWN_MS) return;
    const frame = await captureReticleFrame();
    if (!frame) return; // 프레임 소스 없음 → 스캔 생략 (결과 날조 금지)
    lastScanRef.current = Date.now() / 1000; // J 행동 입력: 마지막 탐색 시각
    visionBusyRef.current = true;
    try {
      const dexRaw = localStorage.getItem("snapquest-dex");
      const dexArr = (dexRaw ? JSON.parse(dexRaw) : []) as Array<{ name?: string }>;
      const live = loadStatus();
      const res = await fetch("/api/look", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageDataUrl: frame,
          dex: dexArr.map((d) => d.name).filter(Boolean),
          status: live,
          creatureLevel: live.level,
        }),
      });
      const data = await res.json();
      if (!res.ok) return; // 다음 주기에 재시도
      const autoFb = data?.fallback === true;
      void meterRemote("look", tokenN).then(setTokenN);
      const r = data?.result as { seen?: string; label?: string; message?: string } | undefined;
      if (r?.seen === "food") {
        lastLockRef.current = Date.now();
        // J 행동 입력: 조준선 중앙을 월드 좌표로 투영해 음식 스캔으로 기록.
        const fp = projectScreenToFloor(0.5, 0.5);
        scanRef.current = { x: fp.x, z: fp.z, visible: true, event: false, at: Date.now() / 1000 };
        missStreakRef.current = 0; // Q: 음식 락온은 유효 스캔
        recordActivityScan(); // LV-2: 유효 스캔 기록
        lastHitRef.current = Date.now();
        setAiMsg(`조준선 락온: ${r.label || "음식"} — ${r.message || ""}`.trim(), autoFb);
        await dessertSequence(r.label || "디저트", { fromLook: true });
      } else {
        recordScanResult(r?.label ?? "");
      }
      // 음식이 아니면 HUD 침묵 (중앙 팝업 금지).
    } catch {
      /* 네트워크 실패 → 다음 주기에 재시도 */
    } finally {
      visionBusyRef.current = false;
    }
  }

  useEffect(() => {
    if (demoIdx !== null) return;
    const id = window.setInterval(() => {
      void visionTick();
    }, VISION_PERIOD_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, demoIdx, partner.id]);

  // 7-B: sim 보행 영상 멈춤 감시. currentTime이 2초 안 늘거나 paused면 play() 재호출.
  // sim에는 초당 탐지기가 없어(12초 vision 스냅샷만) 탐지 주기는 건드리지 않는다.
  useEffect(() => {
    if (mode !== "sim" || !simVideoOk) return;
    simWatchRef.current = { t: -1, at: performance.now(), recovers: 0 };
    const id = window.setInterval(() => {
      const v = simVideoRef.current;
      if (!v) return;
      const w = simWatchRef.current;
      const now = performance.now();
      if (v.currentTime > w.t + 0.001) {
        w.t = v.currentTime;
        w.at = now;
        return;
      }
      if (v.paused || now - w.at > 2000) {
        w.at = now;
        w.recovers += 1;
        if (process.env.NODE_ENV !== "production") console.info(`[simvideo] replay #${w.recovers} t=${v.currentTime.toFixed(1)} paused=${v.paused}`);
        void v.play().catch(() => { /* 다음 주기에 재시도 */ });
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [mode, env, simVideoOk]);

  // 5-2: cam 모드 GPS 추적 (거부·미지원이면 조용히 sim 표만 쓴다).
  useEffect(() => {
    if (mode !== "cam" || typeof navigator === "undefined" || !navigator.geolocation) {
      geoRef.current = null;
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        geoRef.current = { lat: p.coords.latitude, lon: p.coords.longitude, speedMps: p.coords.speed ?? null };
      },
      () => {
        geoRef.current = null;
      },
      { enableHighAccuracy: false, maximumAge: 10000, timeout: 8000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [mode]);

  // G-2: 자동 스캔 (hazard 루프 읽기 전용, 1초 간격 별도 타이머).
  // 같은 최상위 라벨 3틱+conf>=60 → 조우 판정 1회. 발견만 카드+한 줄, 그 외 무표시. 폴백 없음.
  // headless: ?scan=<coco|none> (검증용 오버라이드).
  const autoScanRef = useRef<AutoScanState>(EMPTY_AUTO_SCAN);
  // BT-2: 운전 중 상태. 대기열은 운전 종료 시 다시 알림 (첫 발견 1건만 보관).
  const [driving, setDriving] = useState(false);
  const drivingRef = useRef(false);
  const driveStateRef = useRef<DrivingState>(EMPTY_DRIVING);
  const driveQueueRef = useRef<{ pick: HintPick; label: string; box: RevealBox | null } | null>(null);
  // UI-3 수정: 결과는 연출 후 자동 복귀 (뒤로 버튼 없음). 승리는 포획이 끝나면 복귀.
  useEffect(() => {
    if (battlePhase !== "result" || !battleResult) return;
    if (battleResult === "won" && !captureDone && !driving) return;
    if (battleResult === "won") {
      battleTimersRef.current.push(window.setTimeout(endBattle, UI3_CAPTURE_DONE_MS));
    } else {
      battleTimersRef.current.push(window.setTimeout(endBattle, UI3_RESULT_MS));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battlePhase, battleResult, captureDone, driving]);
  // VF-1 #5: 추적 중 마지막 중심 (같은 라벨이 여러 개면 가장 가까운 것을 따라감).
  const revealTrackRef = useRef<{ x: number; y: number } | null>(null);
  // VF-2: 카메라 감지의 마지막 박스 (2초 이내만 miss·timed 경로에 전달).
  const recentBoxRef = useRef<RecentBox | null>(null);
  // SCAN-2: sim 실감지 없음 → 데모용 가짜 박스 (결정적 드리프트, 같은 연출).
  const revealSimT0Ref = useRef(0);
  const revealSimRef = useRef(false);
  function simFakeBox(now: number): RevealBox {
    if (!revealSimT0Ref.current) revealSimT0Ref.current = now;
    const t = (now - revealSimT0Ref.current) / 1000;
    const cx = 0.66 + 0.05 * Math.sin(t * 0.7);
    const cy = 0.42 + 0.04 * Math.sin(t * 0.48 + 1);
    return { x0: cx - 0.11, y0: cy - 0.11, x1: cx + 0.11, y1: cy + 0.11 };
  }
  useEffect(() => {
    const id = window.setInterval(() => {
      void (async () => {
        if (battlePhaseRef.current !== "none" || wildHintRef.current || scanRevealRef.current) return;
        const q = new URLSearchParams(window.location.search);
        const simScan = q.get("scan");
        let label: string | null = null;
        let confidence = 0;
        let topBox: RevealBox | null = null;
        if (simScan !== null) {
          if (simScan !== "" && simScan !== "none") {
            label = simScan;
            confidence = 90;
          }
        } else {
          const dets = lastDetsRef.current ?? [];
          let top: { label: string; score: number; box: RevealBox } | null = null;
          for (const d of dets) {
            if (!top || d.score > top.score) top = d;
          }
          if (top) {
            label = top.label;
            confidence = Math.round(top.score * 100);
            // SR-1: 최고점 감지의 box를 정규화 값 그대로 전달 (오버라이드·힌트 경로는 null→가운데).
            topBox = { x0: top.box.x0, y0: top.box.y0, x1: top.box.x1, y1: top.box.y1 };
            // VF-2: 카메라 실감지의 마지막 박스 보관 (sim 영상감지·가짜 박스 제외).
            if (modeMirrorRef.current === "cam") recentBoxRef.current = { box: { ...topBox }, at: Date.now() };
          }
        }
        const r = autoScanTick(autoScanRef.current, label, confidence);
        autoScanRef.current = r.state;
        if (!r.fire || !r.label) return;
        const ko = cocoToLabel(r.label);
        if (!ko) return;
        try {
          const res = await fetch("/api/encounter", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              label: ko,
              confidence,
              caughtIds: loadCaughtIds(),
              fainted: (stMirrorRef.current.hp ?? 1) <= 0,
              demo: q.get("demo") === "1",
            }),
          });
          const d = (await res.json()) as { kind?: string; speciesId?: string; exp?: number };
          if (d.kind === "encounter" && d.speciesId && r.label) {
            // UI-2 보완: 자동 스캔 경로도 단일 진입점으로 (연출 끝나면 onDone에서 applyHint).
            revealHint({ speciesId: d.speciesId, hint: hintFor(d.speciesId), hintEn: hintEnFor(d.speciesId) }, r.label, topBox);
          } else if (d.kind === "exp" && typeof d.exp === "number") {
            const gain = d.exp;
            setSt((prev) => {
              const next = addXp(prev, gain);
              saveStatus(next, partnerId);
              return next;
            });
          }
        } catch {
          /* 무표시 */
        }
      })();
    }, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // BT-2: 운전 중 판정 1초 루프 (GPS 속도 + 보닛형 차량 박스 5초 지속).
  // headless: window.__bt2Drive = true/false (검증용 오버라이드). window.__bt2state = 현재 판정 읽기.
  // BT-2b 검증 주입: window.__bt2inject = [{ label, box }] 를 두면 그 틱의 감지로 쓴다.
  useEffect(() => {
    const id = window.setInterval(() => {
      const w = window as unknown as { __bt2Drive?: boolean; __bt2state?: boolean; __bt2inject?: Array<{ label: string; box: { x0: number; y0: number; x1: number; y1: number } }> };
      let d: boolean;
      if (typeof w.__bt2Drive === "boolean") {
        d = w.__bt2Drive;
      } else {
        const dets = Array.isArray(w.__bt2inject) ? w.__bt2inject : (lastDetsRef.current ?? []);
        const bonnet = dets.some((x) => isVehicleLabel(x.label) && isBonnetBox(x.box));
        const r = drivingTick(driveStateRef.current, {
          now: Date.now(),
          speedMps: geoRef.current?.speedMps ?? null,
          bonnet,
        });
        driveStateRef.current = r.state;
        d = r.driving;
      }
      w.__bt2state = d;
      if (d !== drivingRef.current) {
        drivingRef.current = d;
        setDriving(d);
        if (!d && driveQueueRef.current) {
          const q = driveQueueRef.current;
          driveQueueRef.current = null;
          revealHint(q.pick, q.label, q.box);
        }
      }
    }, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // LV-2 headless: window.__lv2(level) (검증용, 실제 레벨업과 같은 handleLevelup 경로).
  useEffect(() => {
    (window as unknown as { __lv2?: (level: number) => void }).__lv2 = (lv: number) => {
      handleLevelup(partner.id, lv);
    };
    return () => {
      delete (window as unknown as { __lv2?: (level: number) => void }).__lv2;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId]);

  // CALM-1b headless: window.__calmDine() (검증용, 실제 외식과 같은 dessertSequence 경로).
  useEffect(() => {
    (window as unknown as { __calmDine?: () => void }).__calmDine = () => {
      void dessertSequence("디저트", { fromLook: true });
    };
    return () => {
      delete (window as unknown as { __calmDine?: () => void }).__calmDine;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId]);

  // J 행동 결정 + K 위험 추적 1초 루프.
  useEffect(() => {
    let live = true;
    const id = window.setInterval(() => {
      void (async () => {
        if (!live || typeof window === "undefined") return;
        const nowS = Date.now() / 1000;
        // --- K: 위험 추적 (5-1: sim도 배경 <video> 프레임을 감지기에 넣는다) ---
        // 생성·추론이 틱을 막지 않게: 생성은 백그라운드 1회, 추론은 8초 타임아웃.
        const srcV = mode === "cam" ? videoRef.current : simVideoRef.current;
        if (srcV && srcV.videoWidth > 0 && !detectorRef.current && !detectorPendingRef.current
          && nowS - detectorFailAtRef.current > 30) {
          detectorPendingRef.current = true;
          createDetector().then(
            (d) => {
              detectorRef.current = d;
              detectorPendingRef.current = false;
            },
            () => {
              detectorFailAtRef.current = Date.now() / 1000;
              detectorPendingRef.current = false;
            },
          );
        }
        if (detectorRef.current && srcV && srcV.videoWidth > 0) {
          try {
            const v = srcV;
            const dets = await Promise.race([
              detectorRef.current.detect(v, v.videoWidth, v.videoHeight),
              new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("detect-timeout")), 8000)),
            ]);
            lastDetsRef.current = dets;
            if (mode === "sim") {
              const param = new URLSearchParams(window.location.search).get("hazard");
              zonesRef.current = trackZones(zonesRef.current, [...dets, ...parseSimHazard(param)], nowS);
            } else {
              zonesRef.current = trackZones(zonesRef.current, dets, nowS);
            }
          } catch {
            /* 다음 주기에 재시도 */
          }
        } else if (mode === "sim") {
          const param = new URLSearchParams(window.location.search).get("hazard");
          lastDetsRef.current = parseSimHazard(param);
          zonesRef.current = trackZones(zonesRef.current, parseSimHazard(param), nowS);
        }
        dangerRef.current = toWorldZones(zonesRef.current, projectScreenToFloor);
        const confirmed = confirmedZones(zonesRef.current);
        setHazardView((prev) => (
          prev.length === confirmed.length
          && prev.every((z, i) => z.id === confirmed[i].id && z.lastSeen === confirmed[i].lastSeen)
            ? prev : confirmed
        ));
        // --- J: 행동 결정 ---
        const curSt = stMirrorRef.current;
        if (!behaviorMemRef.current) {
          const mem = initialMemory(nowS, curSt.level);
          mem.lastWalkM = walkMirrorRef.current;
          behaviorMemRef.current = mem;
        }
        const goal = behaviorMemRef.current.goal;
        const scan = scanRef.current;
        const out = decide({
          now: nowS,
          prev: behaviorMemRef.current,
          status: curSt,
          walkM: walkMirrorRef.current,
          lastScanAt: lastScanRef.current,
          creature: { x: 0, z: 0 }, // 실측 포즈는 PovCreature 소유 (요청 필요)
          vel: { x: 0, z: 0 },
          scan,
          tap: null, // 탭-이동 UI 없음
          danger: dangerRef.current,
          freeScans: 1,
          goalVisible: goal?.kind === "food" ? (scan?.visible ?? false) : goal != null,
          goalReached: false, // 이동 적용 전까지 도달 판정 보류
          emoteDone: emoteDoneRef.current,
          heading: { x: 0, z: -1 }, // 나침반 없음, 전방 고정
          wildActive: busyMirrorRef.current || demoMirrorRef.current !== null,
        });
        behaviorMemRef.current = out.memory;
        if (out.yielded) return;
        // --- 7-C 2차: 걷기 계획 (J와 같은 틱에서 판단, 적용은 중재) ---
        const sv = simVideoRef.current;
        const simPlaying = mode === "sim" && !!sv && !sv.paused && !sv.ended && sv.readyState >= 2;
        const wm = walkMirrorRef.current;
        if (!walkInitRef.current) {
          walkInitRef.current = true;
          nextLookBackRef.current = nowS + 15 + Math.random() * 10;
          lastWalkMRef.current = wm;
        }
        const camMoving = mode === "cam" && wm - lastWalkMRef.current > 0.3;
        lastWalkMRef.current = wm;
        const dets = lastDetsRef.current;
        const cars = dets.filter((d) => /car|truck|bus|motor|bike|bicycle/i.test(d.label)).map((d) => d.box);
        const blocks = dets.filter((d) => /person/i.test(d.label)).map((d) => d.box);
        const wout = planWalk({
          now: nowS,
          mode,
          video: envMirrorRef.current === "street" ? "street" : "cafe",
          videoTime: sv?.currentTime ?? 0,
          userMoving: simPlaying || camMoving,
          laneX: laneXRef.current,
          cars,
          blocks,
          affection: curSt.affection,
          fullness: curSt.fullness,
          dangerRecently: nowS < dangerUntilRef.current,
          nextLookBackAt: nextLookBackRef.current,
          lookBackUntil: lookBackUntilRef.current,
          rand: Math.random(),
        });
        nextLookBackRef.current = wout.nextLookBackAt;
        if (carNowRef.current && wout.reason !== "car") dangerUntilRef.current = nowS + 10;
        carNowRef.current = wout.reason === "car";
        // 5-1 중재: 걷기가 차·막힘·뒤돌아보기를 주장하면 J 말풍선·emote는 쉰다.
        const walkClaims = wout.reason === "car" || wout.reason === "blocked"
          || (wout.lookBack && !wout.stopped);
        if (!walkClaims) {
          if (out.balloon) say(out.balloon);
          if (out.emote) {
            emoteDoneRef.current = false;
            doEmote(validEmote(out.emote));
            window.setTimeout(() => {
              emoteDoneRef.current = true;
            }, 2500);
          }
        }
        // 걷기 props 반영 (바뀐 값만)
        const nx = Math.round(wout.walkLane.x * 1000) / 1000;
        if (nx !== laneXRef.current) {
          laneXRef.current = nx;
          setLaneX(nx);
        }
        const nw = wout.walkLane.speed === 1;
        if (nw !== walkingRef.current) {
          walkingRef.current = nw;
          setWalking(nw);
        }
        const firing = wout.lookBack && !wout.stopped; // 걷기 중에만 뒤돌아보기
        if (firing && !prevLookBackRef.current) {
          hush(); // 춤과 faceBack 동시 사용 금지
          lookBackUntilRef.current = nowS + LOOKBACK_HOLD_S;
          try {
            const s = ((window as unknown as Record<string, { lookbacks?: number }>).__povStats ??= {});
            s.lookbacks = (s.lookbacks ?? 0) + 1;
          } catch { /* ignore */ }
        }
        try {
          const s = ((window as unknown as Record<string, { laneX?: number[] }>).__povStats ??= {});
          const arr = (s.laneX ??= []);
          if (arr.length < 200) arr.push(Math.round(wout.walkLane.x * 1000) / 1000);
        } catch { /* ignore */ }
        prevLookBackRef.current = firing;
        if (firing !== faceBackRef.current) {
          faceBackRef.current = firing;
          setFaceBack(firing);
        }
        // 걷기 반응: 뒤돌아보기 상승 엣지·차 경고·막힘 idle (변경 시에만)
        const wBalloon = firing || wout.reason === "car" ? wout.balloon : null;
        if (wBalloon !== lastWalkBalloonRef.current) {
          lastWalkBalloonRef.current = wBalloon;
          if (wBalloon) say(wBalloon);
        }
        const wEmote = firing || wout.reason === "blocked" ? wout.emote : null;
        if (wEmote !== lastWalkEmoteRef.current) {
          lastWalkEmoteRef.current = wEmote;
          // 5-1 두리번 신호명 lookAround: 실제 포즈는 R-C 몫 (지금은 idle로 표시).
          if (wEmote) doEmote(validEmote(wEmote));
        }
        if (out.scanDue) void visionTick();
        if (out.eventFood) say("반짝이는 음식을 찾았어!", { interactive: true });
        if (out.levelup) {
          setMsg(`${out.levelup.level}레벨 달성!`); // MF-1: 해금 줄 제거 (고를 곳 없음)
          setLevelupFx({ level: out.levelup.level, key: Date.now() }); // D-2 fanfare
          handleLevelup(partner.id, out.levelup.level); // LV-2: 레벨당 1회 (decide가 밴드당 1회만 발화)
        }
        // out.move / out.face: PovCreature에 이동 수단이 없어 무시 (소유 CLI에 요청).
        // --- Q: AR 상단 힌트 타이머 (유효 스캔 없이 60초 + 힌트 간격 90초) ---
        // CI-1: cam 모드에서 카메라가 꺼져 있으면 타이머 힌트·야생 조우를 내지 않는다.
        // 꺼진 동안 lastHitRef를 계속 갱신해서, 켠 뒤 60초부터 세게 한다. 감정 표현 루프는 그대로.
        if (mode === "cam" && !camOnRef.current) {
          lastHitRef.current = Date.now();
        } else {
          if (lastHitRef.current === 0) lastHitRef.current = Date.now();
          const idleMs = Date.now() - lastHitRef.current;
          const sinceLast = lastHintAtRef.current > 0 ? Date.now() - lastHintAtRef.current : null;
          const timed = pickTimedHint({
            caughtIds: loadCaughtIds(),
            env: envMirrorRef.current,
            idleMs,
            sinceLastHintMs: sinceLast,
            offset: hintOffsetRef.current++,
          });
          if (timed) revealHint(timed, "주변 탐색", freshBox(recentBoxRef.current, Date.now()));
        }
        // --- 5-2: 토큰 존 HUD (cam=GPS, sim=영상 구간) ---
        const zone = mode === "cam"
          ? (geoRef.current ? zoneAtGeo(geoRef.current.lat, geoRef.current.lon) : null)
          : zoneAt(envMirrorRef.current === "street" ? "street" : "cafe", sv?.currentTime ?? -1);
        const zid = zone?.id ?? null;
        if (zid && zid !== curZoneRef.current) {
          curZoneRef.current = zid;
          lastZoneRef.current = zone;
          if (shouldShow(lastZoneShownRef.current, zid, Date.now())) {
            lastZoneShownRef.current[zid] = Date.now();
            try {
              const s = ((window as unknown as Record<string, { zoneCards?: string[] }>).__povStats ??= {});
              (s.zoneCards ??= []).push(zid);
            } catch { /* ignore */ }
            setZoneCard(zone);
            setNearbyHint(null);
            if (zoneTimerRef.current) window.clearTimeout(zoneTimerRef.current);
            zoneTimerRef.current = window.setTimeout(() => setZoneCard(null), CARD_SHOW_MS);
          }
        } else if (!zid && curZoneRef.current) {
          curZoneRef.current = null;
          const last = lastZoneRef.current;
          if (last) setNearbyHint(`근처: ${last.store} +${last.amount} · ${last.distM}m`);
        }
      })();
    }, BEHAVIOR_PERIOD_MS);
    return () => {
      live = false;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, partner.id]);

  function doCapture(force?: boolean) {
    hush();
    const rate = force ? 100 : Math.min(95, 65 + Math.floor(st.affection / 2));
    if (Math.random() * 100 >= rate) {
      doEmote("hurt");
      setMsg(`${josa(wild.name, "을를")} 놓쳤다! 친밀도를 쌓으면 포획률이 올라가요. (성공률 ${rate}%)`);
      return;
    }
    povRef.current?.capture();
    povRef.current?.emote("happy");
    try {
      const raw = localStorage.getItem("snapquest-dex");
      const arr = raw ? (JSON.parse(raw) as unknown[]) : [];
      localStorage.setItem("snapquest-dex", JSON.stringify([wild, ...arr].slice(0, 30)));
    } catch {
      /* ignore */
    }
    bumpQuest("caught");
    playCry(wild.id, "happy");
    setWildHint((w) => (w && w.speciesId === wild.id ? null : w)); // Q: 잡은 종의 ??? 카드 닫기
    setMsg(`${wild.name} 포획. 도감 등록.`);
    setTimeout(() => {
      setPortrait(null);
      setWildIdx((i) => i + 1);
    }, 1200);
  }

  async function feed() {
    if (busy) return;
    hush();
    setBusy(true);
    busyRef.current = true;
    // §10과 같은 무료 횟수·추가 구매·잠금 규칙. 잠기면 API 호출 없이 끝낸다.
    const care = await useCareRemote("feed").catch(() => null);
    if (!care || !care.ok) {
      if (care && Number.isFinite(care.balance)) setTokenN(care.balance);
      setBusy(false);
      busyRef.current = false;
      setMsg(INSUFFICIENT_MSG);
      return;
    }
    setTokenN(care.balance);
    const careTag = care.free ? ` (무료 ${care.remainingFree}회 남음)` : ` (추가 1회 -${COST_CARE_EXTRA} 토큰)`;
    try {
      const food = "숲 열매 도시락";
      const res = await fetch("/api/feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creature: `${wild.name} (${wild.element})`, food, creatureLevel: st.level }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed");
      void meterRemote("feed", tokenN).then(setTokenN);
      const r = data.result as { note?: string; buff?: string };
      if (st.fullness < FULLNESS_LOW) say(HUNGRY_FOOD_LINE, { interactive: true });
      doEmote("eat");
      setSt((prev) => {
        const next = addXp(
          {
            ...prev,
            fullness: Math.min(100, prev.fullness + 15),
            affection: Math.min(100, prev.affection + 10),
          },
          EXP_FEED
        );
        saveStatus(next, partnerId);
        return next;
      });
      bumpQuest("fed");
      setAiMsg(`냠냠. ${r.note ?? r.buff ?? "포만감이 올랐다."}${careTag}`, data.fallback === true);
    } catch (e) {
      setMsg(`먹이 주기 실패: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  }

  async function challengeBattle(foe?: { id: string; name: string }) {
    if (busy) return;
    hush();
    const target = foe ?? wild; // Q ??? 카드: 힌트 종 지정 시 그 종과 배틀
    // §2 졸림/탈진 상태에서는 배틀 불가 → 트레이너 라운지 휴식 권장.
    // (야생 조우 자동 배틀은 출전 강행 시 ATK/SPD 50% 패널티로 진행.)
    if (st.energy < ENERGY_LOW) {
      doEmote("drowsy");
      say(SLEEPY_LINE, { interactive: true });
      setMsg(`${josa(partner.name, "이가")} 너무 졸려 배틀할 수 없어요. 트레이너 라운지에서 휴식시키세요. (출전 시 ATK/SPD 50%)`);
      return;
    }
    setBusy(true);
    try {
      const dexRaw = localStorage.getItem("snapquest-dex");
      const dexArr = (dexRaw ? JSON.parse(dexRaw) : []) as Array<{ name?: string }>;
      const rep = dexArr[0]?.name ?? `${target.name} (거울전)`;
      say("으르렁!", { interactive: true });
      playCry(partner.id, "attack");
      const { won, text, fb } = await runBattle(rep, target.name, target.id);
      if (won) {
        setSt((prev) => {
          const next = addXp(prev, EXP_BATTLE_WIN);
          saveStatus(next, partnerId);
          return next;
        });
        bumpQuest("won");
        doEmote("happy");
        say("신나!", { interactive: true });
        setAiMsg(`배틀 승리! ${text} +${EXP_BATTLE_WIN} EXP!`, fb);
      } else {
        doEmote("hurt");
        setAiMsg(`배틀 패배... ${text} 다시 노려보세요!`, fb);
      }
    } catch (e) {
      setMsg(`배틀 실패: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  async function readDiary() {
    if (busy) return;
    hush();
    setBusy(true);
    try {
      const res = await fetch("/api/diary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          log: `조우 ${quest.met}회, 포획 ${quest.caught}마리, 먹이 ${quest.fed}회, 배틀 승리 ${quest.won}회`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed");
      void meterRemote("diary", tokenN).then(setTokenN);
      doEmote("happy");
      bumpQuest("diary");
      setAiMsg(`거울 퀘스트 — 크리처의 그림일기: ${data.diary as string}`, data.fallback === true);
    } catch (e) {
      setMsg(`그림일기 실패: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  // F&B 제휴 매장명 (HUD 타겟팅 표시용).
  function shopFor(): string {
    if (mode === "sim") {
      return env === "cafe" ? "성수 베이커리" : env === "street" ? "연남 푸드트럭" : "홈카페 파트너";
    }
    return "근처 제휴 매장";
  }

  // 바이럴 공유 시트: 스냅샷 합성 → 타깃 선택 (네이티브 시트/딥링크).
  const [sheet, setSheet] = useState<{ shot: string; file: File; title: string; tags: string; preview: string } | null>(null);
  function closeSheet() {
    if (sheet) {
      try {
        URL.revokeObjectURL(sheet.preview);
      } catch {
        /* ignore */
      }
    }
    setSheet(null);
  }
  async function handleShare() {
    if (scene3d !== "3d-ready") {
      setMsg("3D 준비 중. 잠시 후 다시 시도.");
      return;
    }
    const shot = povRef.current?.snapshot();
    if (!shot) {
      setMsg("스냅샷 실패. 잠시 후 다시 시도.");
      return;
    }
    const title = `${partner.name}와 AR 한 컷`;
    const tags = `${SHARE_TAGS} ${shopTag(mode, env)}`;
    const backdrop = await captureVideoFrame(); // MF-3: 배경 영상 프레임 합성
    const file = await composeShareFile(shot, { title, tags, backdrop });
    if (!file) {
      setMsg("스냅샷 합성 실패. 잠시 후 다시 시도.");
      return;
    }
    setSheet({ shot, file, title, tags, preview: URL.createObjectURL(file) });
  }
  async function handleShareTarget(t: ShareTarget) {
    if (!sheet) return;
    const caption = shareCaption(sheet.title, sheet.tags);
    const grantShareExp = () => {
      setSt((prev) => {
        const next = addXp(prev, EXP_SHARE);
        saveStatus(next, partnerId);
        return next;
      });
    };
    if (t.id === "system") {
      const res = await systemShare(sheet.file, { title: sheet.title, tags: sheet.tags });
      if (res === "shared") {
        grantShareExp();
        setMsg(`공유 완료. SNS 바이럴 +${EXP_SHARE} EXP.`);
        closeSheet();
      } else {
        setMsg("이 기기에서 시스템 공유 미지원. 다른 타깃 선택.");
      }
    } else if (t.id === "save") {
      downloadFile(sheet.file);
      setMsg("이미지 저장됨.");
    } else if (t.id === "copy") {
      setMsg((await copyCaption(caption)) ? "캡션 복사됨." : "복사 실패.");
    } else {
      if (t.id === "instagram" || t.id === "tiktok" || t.id === "facebook") await copyCaption(caption);
      if (t.url) window.open(t.url, "_blank", "noopener");
      grantShareExp();
      setMsg(`${t.label} 공유 화면 열림. SNS 바이럴 +${EXP_SHARE} EXP.`);
    }
  }

  async function makePortrait() {
    hush();
    setBusy(true);
    try {
      const res = await fetch("/api/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `Original cute monster portrait, storybook illustration, ${wild.element} elemental imp with horns, original design, not pokemon: ${wild.name}, ${wild.flavor}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed");
      void meterRemote("portrait", tokenN).then(setTokenN);
      setPortrait(data.url ?? (data.b64 ? `data:image/png;base64,${data.b64}` : null));
      if (!data.url && !data.b64) setAiMsg("초상화 응답에 이미지가 없어요.", data.fallback === true);
      else setMsg("Muse Image 초상화 완성!");
    } catch (e) {
      setMsg(`초상화 실패: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`screen-root uh1-scope${bp3.shakePx > 0 ? " bp3-shake" : ""}${bp3.zoom ? " bp3-zoom" : ""}`}
      style={{
        position: "fixed", top: 0, left: 0, right: 0, overflow: "hidden",
        background: "#060a12", color: "#fff",
        ...(bp3.shakePx > 0 ? { "--bp3-px": `${bp3.shakePx.toFixed(1)}px` } as React.CSSProperties : {}),
      }}
    >
      {/* D-2 level-up fanfare (real event or ?levelup=N demo) */}
      {levelupFx != null ? (
        <LevelUpFx key={levelupFx.key} level={levelupFx.level} onDone={() => setLevelupFx(null)} />
      ) : mounted && levelupDemo != null ? (
        <LevelUpFx key="demo" level={levelupDemo} onDone={() => {}} />
      ) : null}
      {/* LV-2: 성장 토스트 (한 줄·자동 닫힘·선택 없음·클릭 방해 없음) */}
      {lvToast && (
        <div
          key={lvToast.key}
          data-testid="lv-toast"
          style={{ position: "absolute", left: "50%", bottom: 176, transform: "translateX(-50%)", fontSize: 13, fontWeight: 600, color: "#fff", maxWidth: "92%", wordBreak: "keep-all", lineHeight: 1.35, textAlign: "center", zIndex: 60, pointerEvents: "none", textShadow: "0 2px 8px rgba(0,0,0,0.8)" }}
        >
          {lvToast.text}
        </div>
      )}
      {mode === "cam" ? (
        <video
          ref={videoRef} playsInline muted
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : null}
      {mode === "sim" && simVideoOk && (
        <video
          key={env}
          ref={simVideoRef}
          src={SIM_WALK_SRC[env]}
          autoPlay loop muted playsInline
          onError={() => setSimVideoOk(false)}
          onEnded={(e) => { const v = e.currentTarget; v.currentTime = 0; void v.play().catch(() => {}); }}
          onStalled={() => { if (process.env.NODE_ENV !== "production") console.info("[simvideo] stalled"); }}
          onWaiting={() => { if (process.env.NODE_ENV !== "production") console.info("[simvideo] waiting"); }}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
      )}
      {mode === "sim" && !simVideoOk && (
        <div
          className="glass-panel"
          style={{ position: "absolute", top: 148, left: 12, padding: "8px 12px", fontSize: 12, maxWidth: 300 }}
        >
          1인칭 보행 영상 에셋 없음 — HDRI 배경으로 체험 중 (필요: /videos/cafe_walk.mp4·street_walk.mp4)
        </div>
      )}
      {/* K 위험 구역 오버레이 (확정 존만, 빨간 점선) */}
      {!battleActive && hazardView.map((z) => (
        <div
          key={z.id}
          style={{
            position: "absolute",
            left: `${z.box.x0 * 100}%`, top: `${z.box.y0 * 100}%`,
            width: `${(z.box.x1 - z.box.x0) * 100}%`, height: `${(z.box.y1 - z.box.y0) * 100}%`,
            border: "2px dashed rgba(255,70,70,0.9)", borderRadius: 6,
            pointerEvents: "none",
          }}
        >
          <span style={{ position: "absolute", top: -22, left: 0, fontSize: 12, color: "#ff6b6b", background: "rgba(0,0,0,0.6)", padding: "0 4px", borderRadius: 4, whiteSpace: "nowrap" }}>
            {z.label}{z.approaching ? " ▲" : ""}
          </span>
        </div>
      ))}
      <div className={`bp3-fighter${bp3.windup === "mine" ? " bp3-windup-mine" : ""}${bp3.knock === "mine" ? " bp3-knock-mine" : ""}`} style={battleActive ? { position: "absolute", inset: 0, transform: "translate(12px, 0px) scale(0.8)", transformOrigin: "left center" } : { position: "absolute", inset: 0 }}>
        <PovCreature key={partner.id} handleRef={povRef} element={partner.element} modelUrl={`/models/${partner.id}.glb`} tintUrl={scanCard} speciesId={partner.id} ground={mode === "sim" ? env : null} videoBg={mode === "sim" && simVideoOk} poseLock={battleActive ? null : poseLock} laneX={battleActive ? 0.28 : laneX} walking={battleActive ? false : walking} faceBack={battleActive ? false : faceBack} battle={battleActive ? { role: "mine", action: mineAction } : null} onStatus={setScene3d} speedMult={st.energy < ENERGY_LOW ? 0.5 : 1} drowsy={st.energy < ENERGY_LOW} />
      </div>
      {/* 9-A2: 배틀 중에는 크리처 2마리만 남기고 HUD 전부 숨김 */}
      {!battleActive && (
      <>
      {bubble && !isRayban && (
        <div
          className="pov-bubble"
          style={{
            left: bubblePos?.x ?? "50%",
            top: bubblePos?.y ?? "30%",
            transform: "translate(-50%, -110%)",
          }}
        >
          {bubble}
        </div>
      )}
      <HudOverlay phase={hud?.phase ?? null} shop={hud?.shop ?? ""} amount={hud?.amount ?? 0} />
      {/* Q/7-A 2차: 상단 힌트 바 (영어, ??? 카드가 뜨면 숨김) */}
      {arHint && !wildHint && (
        <div
          className="glass-panel"
          onClick={() => setArHint(null)}
          style={{ position: "absolute", top: 60, left: "50%", transform: "translateX(-50%)", padding: "6px 12px", fontSize: 13, maxWidth: "86%", zIndex: 5, cursor: "pointer" }}
        >
          💡 {arHint.hint}
        </div>
      )}
      {/* UI-2: 스캔 조우 연출 (뷰파인더→Scanned→등장→??? 카드) */}
      {scanReveal && (
        <ScanReveal
          label={scanReveal.label}
          box={scanReveal.box}
          speciesName={ROSTER.find((s) => s.id === scanReveal.pick.speciesId)?.name ?? scanReveal.pick.speciesId}
          element={speciesOf(scanReveal.pick.speciesId).element}
          hidden={driving}
          simBox={() => revealSimRef.current}
          getBox={() => {
            const dets = lastDetsRef.current ?? [];
            const lbl = (scanReveal.target || scanReveal.label || "").trim().toLowerCase();
            if (!lbl) return null;
            const cands = dets.filter((d) => (d.label || "").trim().toLowerCase() === lbl);
            if (cands.length === 0) {
              // SCAN-2: sim 실감지 없음 → 가짜 박스로 동일 연출 (실감지 있으면 그쪽).
              if (modeMirrorRef.current === "sim") {
                revealSimRef.current = true;
                return simFakeBox(Date.now());
              }
              return null;
            }
            revealSimRef.current = false;
            const prev = revealTrackRef.current;
            let best = cands[0];
            let bd = Infinity;
            for (const c of cands) {
              const cx = (c.box.x0 + c.box.x1) / 2;
              const cy = (c.box.y0 + c.box.y1) / 2;
              const dd = prev ? (cx - prev.x) * (cx - prev.x) + (cy - prev.y) * (cy - prev.y) : -c.score;
              if (dd < bd) {
                bd = dd;
                best = c;
              }
            }
            revealTrackRef.current = { x: (best.box.x0 + best.box.x1) / 2, y: (best.box.y0 + best.box.y1) / 2 };
            return { x0: best.box.x0, y0: best.box.y0, x1: best.box.x1, y1: best.box.y1 };
          }}
          onDone={() => {
            const sp = scanReveal;
            revealTrackRef.current = null;
            revealSimT0Ref.current = 0;
            revealSimRef.current = false;
            setScanReveal(null);
            applyHint(sp.pick);
            setMsg("야생 크리처 발견!");
          }}
        />
      )}
      {/* Q/7-A 2차 + 9-A1: 야생 ??? 카드 (우상단 버튼 아래, 15초 뒤 자동 해제) */}
      {/* UH-1: HP 패널 토큰 + 아래에서 튀어오르는 스프링 1회 + 조사 함수. 아이콘: Lucide zap·footprints inline (ISC). */}
      {wildHint && (
        <motion.div
          key={hintSeq}
          initial={{ y: 56, scale: 0.92, opacity: 0 }}
          animate={{ y: 0, scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 380, damping: 24 }}
          style={{
            position: "absolute", top: 64, right: 12, padding: "10px", maxWidth: 240, zIndex: 5,
            background: "var(--battle-panel)", border: "1px solid var(--battle-edge)",
            borderRadius: "var(--battle-radius)", boxShadow: "var(--battle-shadow)",
            backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
            fontFamily: "var(--battle-font)",
          }}
        >
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {wildSp?.image ? (
              <img src={wildSp.image} alt="" width={48} height={48} style={{ borderRadius: 12, objectFit: "cover", border: "1px solid var(--battle-edge)" }} />
            ) : null}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", wordBreak: "keep-all", overflowWrap: "break-word", lineHeight: 1.25, textShadow: "0 1px 3px rgba(0,0,0,0.85), 0 0 12px rgba(0,0,0,0.35)" }}>
                야생의 {josa(wildSp?.name ?? wildHint.speciesId, "이가")} 나타났다!
              </div>
              <div style={{ marginTop: 4 }}>
                <span
                  style={{
                    fontSize: 11, fontWeight: 600, color: "#fff", whiteSpace: "nowrap",
                    border: `1px solid ${wildSp ? (UH1_WILD_GRAD[wildSp.element]?.[0] ?? "#fff") : "#fff"}`,
                    borderRadius: 999, padding: "1px 7px", fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {wildSp ? `${ELEMENT_KO[wildSp.element] ?? wildSp.element} · ${wildLv}레벨` : `${wildLv}레벨`}
                </span>
              </div>
            </div>
          </div>
          {/* AF-3/8: 응답 제한 진행 막대 (얇게, 흰 테두리 없음). */}
          <div style={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,0.14)", marginTop: 8, overflow: "hidden" }} aria-hidden>
            <div style={{
              height: "100%", borderRadius: 2,
              width: `${(((wildHintSec ?? ACCEPT_WAIT_S) / ACCEPT_WAIT_S) * 100).toFixed(1)}%`,
              background: wildSp && UH1_WILD_GRAD[wildSp.element] ? UH1_WILD_GRAD[wildSp.element][0] : "#00f2fe",
            }} />
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <motion.button
              className="wild-btn wild-btn-battle"
              disabled={driving}
              whileTap={driving ? undefined : { scale: 0.94 }}
              transition={{ type: "spring", stiffness: 500, damping: 20 }}
              style={wildSp && UH1_WILD_GRAD[wildSp.element] ? {
                background: `linear-gradient(135deg, ${UH1_WILD_GRAD[wildSp.element][0]} 0%, ${UH1_WILD_GRAD[wildSp.element][1]} 100%)`,
                borderColor: UH1_WILD_GRAD[wildSp.element][0],
              } : undefined}
              onClick={() => {
                const sp = ROSTER.find((s) => s.id === wildHint.speciesId);
                if (!sp) return;
                setWildIdx(ROSTER.indexOf(sp));
                markSeen(sp.id);
                startBattle(sp.id);
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z" /></svg>
              배틀
            </motion.button>
            <motion.button
              className="wild-btn wild-btn-run"
              whileTap={{ scale: 0.94 }}
              transition={{ type: "spring", stiffness: 500, damping: 20 }}
              onClick={closeWildHint}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z" /><path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z" /><path d="M16 17h4" /><path d="M4 13h4" /></svg>
              도망
            </motion.button>
          </div>
          {driving && (
            <div style={{ fontSize: 11, opacity: 0.8, marginTop: 6 }}>{DRIVING_MSG}</div>
          )}
        </motion.div>
      )}
      {/* 5-2: 토큰 존 이벤트 카드 (4초 뒤 자동 접힘, 적립은 visit 신호로만) */}
      {zoneCard && (
        <div
          className="glass-panel"
          style={{ position: "absolute", top: 230, right: 12, padding: "10px 12px", maxWidth: 250, zIndex: 5 }}
        >
          <div style={{ fontSize: 13, fontWeight: 700 }}>이벤트 · {zoneCard.store}</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>+{zoneCard.amount} 뮤즈 토큰 충전 가능 — 방문해서 충전</div>
          {zoneCard.trending.length > 0 && (
            <div style={{ fontSize: 11, marginTop: 4 }}>🔥 {zoneCard.trending.join(" / ")}에서 유행 중</div>
          )}
          <div style={{ fontSize: 9, opacity: 0.6, marginTop: 4 }}>데모 데이터</div>
        </div>
      )}
      {/* 5-2: 존 통과 뒤 상단 한 줄 근처 힌트 (??? 카드와 겹치지 않게 카드 표시 중 숨김) */}
      {nearbyHint && !zoneCard && !wildHint && (
        <div
          className="glass-panel"
          style={{ position: "absolute", top: 100, left: "50%", transform: "translateX(-50%)", padding: "5px 12px", fontSize: 12, maxWidth: "86%", zIndex: 5, whiteSpace: "nowrap" }}
        >
          {nearbyHint}
        </div>
      )}

      {/* 상단 바: 우측 끝 캠프·공유만 (✕·토큰알약 없음). 상단 메시지는 좌상단 별도 배치 */}
      <div className="pov-topbar">
        <TopBar
          overlay
          right={
            <>
              {mode === "sim" && (
                <button onClick={() => setEnvSync("cafe")} className="glass-btn topbar-btn" style={{ background: env === "cafe" ? "rgba(255,255,255,0.25)" : "transparent" }} aria-label="카페" aria-pressed={env === "cafe"}>
                  <span className="btn-icon" aria-hidden>◐</span>
                  <span className="btn-label">카페</span>
                </button>
              )}
              {mode === "sim" && (
                <button onClick={() => setEnvSync("street")} className="glass-btn topbar-btn" style={{ background: env === "street" ? "rgba(255,255,255,0.25)" : "transparent" }} aria-label="거리" aria-pressed={env === "street"}>
                  <span className="btn-icon" aria-hidden>◑</span>
                  <span className="btn-label">거리</span>
                </button>
              )}
              <button className="glass-btn topbar-btn" style={{ background: "transparent" }} aria-label="라운지" onClick={() => { window.location.href = "/camp"; }}>
                <span className="btn-icon" aria-hidden>◫</span>
                <span className="btn-label">라운지</span>
              </button>
              <button className="glass-btn topbar-btn" style={{ background: "transparent" }} aria-label="공유" onClick={() => void handleShare()}>
                <span className="btn-icon" aria-hidden>↗</span>
                <span className="btn-label">공유</span>
              </button>
            </>
          }
        />
      </div>

      {demoIdx !== null && (
        <div style={{ position: "absolute", top: 108, left: 16, right: 16, background: "rgba(0,0,0,0.7)", borderRadius: 10, padding: "10px 14px", textAlign: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{DEMO[demoIdx % DEMO.length].act}</div>
          <div style={{ fontSize: 13 }}>{DEMO[demoIdx % DEMO.length].cap}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              style={btn}
              disabled={busy}
              onClick={() => setDemoIdx((i) => (i === null || i + 1 >= DEMO.length ? null : i + 1))}
            >
              다음 장면
            </button>
            <button style={btn} onClick={() => { setDemoIdx(null); }}>
              종료
            </button>
          </div>
        </div>
      )}

      {/* 메시지 한 줄 (7-5 + 7-3 14번): 토큰 알약이 있던 좌상단 자리. 탭하면 스캔 */}
      {msg !== "" && (
        <div
          onClick={() => void look()}
          aria-label="탭하여 스캔"
          className="pov-msg"
        >
          {msg}
          {msgOffline && msg === aiMsgRef.current && <OfflineChip />}
          {msgRec && msg === recMsgRef.current && (
            <span
              aria-label="목록 근거 추천"
              style={{
                display: "inline-block", fontSize: 10, lineHeight: 1.4, color: "#9fe870",
                background: "rgba(159,232,112,0.10)", border: "1px solid rgba(159,232,112,0.35)",
                borderRadius: 4, padding: "0 5px", marginLeft: 6, verticalAlign: "middle", whiteSpace: "nowrap",
              }}
            >
              추천
            </span>
          )}
        </div>
      )}

      {/* 동행 파트너 미니 카드 (좌하). 레이벤 모드에서는 핵심 한 줄(msg)만 표시하므로 숨긴다 */}
      {!isRayban && (
      <div className="glass-panel pov-status-card" style={{ padding: "8px 10px" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {scanCard && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={scanCard} alt={`${partner.name} 스캔 카드`} style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 8, border: "1px solid #9fe870" }} />
          )}
          <div style={{ fontSize: 11 }}>
            <div style={{ fontWeight: 700, fontSize: 12 }}>{partner.name}</div>
          </div>
        </div>
        <div style={{ marginTop: 4 }}>
          {statBar("체력", "hp", maxHp > 0 ? Math.max(0, Math.min(100, ((st.hp ?? maxHp) / maxHp) * 100)) : 0, `${st.hp ?? maxHp}/${maxHp}`)}
          {statBar("포만감", "fullness", st.fullness, `${Math.round(st.fullness)}`)}
          {statBar("활력", "energy", st.energy, `${Math.round(st.energy)}`)}
          {statBar("친밀도", "affection", st.affection, `${Math.round(st.affection)}`)}
          {statBar(`${st.level}레벨 · EXP`, null, (expCur / expNext) * 100, `${expCur}/${expNext}`)}
        </div>
        <div style={{ marginTop: 3, display: "flex", justifyContent: "space-between", gap: 8, fontSize: 10, opacity: 0.9, whiteSpace: "nowrap" }}>
          <span>뮤즈 토큰 <span style={{ fontSize: 8, opacity: 0.6 }}>데모</span></span>
          <span>{tokenN}</span>
        </div>
      </div>
      )}

      {/* 음성 단일 버튼 (우하): 말로 지시. 시연 모드는 ?demo=1 로 진입 */}
      <div id="bottom-bar" style={{ position: "absolute", right: BOTTOM_SIDE, bottom: BOTTOM_GAP, paddingBottom: "env(safe-area-inset-bottom)", textAlign: "center" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
          {!isRayban && <PeerEncounter onEmote={(p, e) => doEmote(e)} onBattle={(p) => startBattle(p.speciesId)} notice={(m) => setMsg(m)} />}
          {mode === "cam" && !camOn && !isRayban && (
            <button onClick={startCamera} className="glass-mic" aria-label="POV 카메라 켜기">카메라</button>
          )}
          {/* 3-3: 레이벤(?hud=rayban)에서는 MIC를 숨기고 휴대폰 안내만 표시. 자동 판별 신호가
              문서에 없으므로 기존 ?hud=rayban 규약을 재사용한다. */}
          {!isRayban ? (
            <MicButton
              onSaid={handleSaid}
              onFallback={voiceCapture}
              notice={(m) => setMsg(m)}
              disabled={listening}
            />
          ) : (
            <div className="glass-panel" style={{ fontSize: 12, padding: "8px 12px", maxWidth: 220 }}>
              음성 인식은 휴대폰에서 돼요
            </div>
          )}
        </div>
      </div>

      {/* 바이럴 공유 시트 */}
      {sheet && (
        <div
          style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => closeSheet()}
        >
          <div
            style={{ background: "#101812", borderRadius: 16, padding: 16, maxWidth: 420, width: "100%", border: "1px solid #2f6b4f" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>어디에 공유할까요?</div>
              <button onClick={() => closeSheet()} style={{ background: "transparent", color: "#fff", border: "1px solid #666", borderRadius: 8, padding: "4px 10px", cursor: "pointer" }}>닫기</button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={sheet.preview} alt="AR 스냅샷" style={{ width: "100%", borderRadius: 10, border: "1px solid #333", maxHeight: 220, objectFit: "cover" }} />
            <div style={{ fontSize: 12, color: "#7cc7ff", margin: "8px 0" }}>{shareCaption(sheet.title, sheet.tags)}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {buildShareTargets(sheet.title, sheet.tags, typeof window !== "undefined" ? window.location.href : "")
                // MF-3: 시스템 공유 미지원(Electron 실측 false)이면 버튼 숨김
                .filter((t) => t.id !== "system" || (typeof navigator !== "undefined" && typeof (navigator as unknown as { share?: unknown }).share === "function"))
                .map((t) => (
                <button
                  key={t.id}
                  onClick={() => void handleShareTarget(t)}
                  className={t.id === "system" ? "hud-btn hud-btn-primary" : "hud-btn"}
                  style={{ padding: "10px 6px", fontWeight: 600, fontSize: 13 }}
                >
                  {t.label}
                  <div style={{ fontSize: 10, fontWeight: 400, opacity: 0.75 }}>{t.note}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      </>
      )}
      {/* 9-A2: 배틀 레이어 (야생 크리처 + 색 덮개). 9-B 후속: battle prop 연결됨 */}
      {battleActive && battleWildId && (
        <>
          <div className={`bp3-fighter${bp3.windup === "wild" ? " bp3-windup-wild" : ""}${bp3.knock === "wild" ? " bp3-knock-wild" : ""}`} style={{ position: "absolute", inset: 0, pointerEvents: "none", transform: "translate(-15px, -25px) scale(0.6)", transformOrigin: "top right" }}>
            <PovCreature key={battleWildId} handleRef={wildPovRef} element={(ROSTER.find((s) => s.id === battleWildId)?.element ?? partner.element)} modelUrl={`/models/${battleWildId}.glb`} tintUrl={(ROSTER.find((s) => s.id === battleWildId)?.image ?? scanCard)} speciesId={battleWildId} ground={mode === "sim" ? env : null} videoBg={mode === "sim" && simVideoOk} poseLock={null} laneX={0.72} walking={false} faceBack={false} battle={{ role: "wild", action: wildAction }} onStatus={noopBattleStatus} speedMult={1} drowsy={false} />
          </div>
          {coverOn && !driving && (
            <div
              data-testid="ar-battle-cover"
              onClick={() => {
                (window as unknown as { __arCoverRelease?: boolean }).__arCoverRelease = true;
              }}
              style={{ position: "absolute", inset: 0, background: `linear-gradient(to bottom, ${hexA(ELEMENT_FX_COLOR[speciesOf(battleWildId).element] ?? "#7cc7ff", 0)} 20%, ${hexA(ELEMENT_FX_COLOR[speciesOf(battleWildId).element] ?? "#7cc7ff", BATTLE_OVERLAY_MAX_ALPHA)} 100%)`, opacity: coverFade ? 0 : 1, transition: "opacity 0.5s", zIndex: 40, pointerEvents: battleDemo ? "auto" : "none", cursor: battleDemo ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              {battleDemo && (
                <div style={{ fontSize: 15, fontWeight: 700, color: "#fff", background: "rgba(0,0,0,0.35)", padding: "8px 16px", borderRadius: 10 }}>
                  배틀 시작 — 탭!
                </div>
              )}
            </div>
          )}
          {/* 9-A3: BattleStage 오버레이 (기술·HP·거리·상태·연출, 하단 정렬) */}
          {battleState && battleView && (battlePhase === "fight" || battlePhase === "result") && (
            <div style={{ position: "absolute", inset: 0, padding: "64px 10px 24px", zIndex: 30, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
              {/* BT-2: 흰 베일 최대 0.25 (뒷배경 항상 보임). 운전 중에는 제거. */}
              <style>{`@keyframes battleVeil { 0% { opacity: 0; } 100% { opacity: ${BATTLE_OVERLAY_MAX_ALPHA}; } }`}</style>
              {!driving && (
                <div data-testid="battle-veil" style={{ position: "absolute", inset: 0, background: "#ffffff", animation: "battleVeil 0.6s ease-out forwards", pointerEvents: "none" }} />
              )}
              {/* BP-3: 피격 반짝임 (맞은 쪽 절반 흰색). */}
              {bp3.flash && (
                <div
                  data-testid="bp3-flash"
                  className="bp3-flash-half"
                  style={{ position: "absolute", left: 0, right: 0, top: bp3.flash === "wild" ? 0 : "50%", height: "50%", background: "radial-gradient(ellipse at center, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 70%)", zIndex: 2, pointerEvents: "none" }}
                />
              )}
              {/* UI-4 수정: 배틀 배경 다듬기 (그라디언트·비네팅·바닥 그림자, 3D 무변경). */}
              <div
                data-testid="battle-backdrop"
                style={{
                  position: "absolute", inset: 0, pointerEvents: "none",
                  background:
                    "radial-gradient(ellipse 120% 55% at 50% 108%, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0) 60%), radial-gradient(ellipse 130% 100% at 50% 45%, rgba(0,0,0,0) 55%, rgba(4,8,14,0.42) 100%), linear-gradient(180deg, rgba(10,22,38,0.4) 0%, rgba(10,22,38,0) 32%, rgba(0,0,0,0) 60%, rgba(0,0,0,0.34) 100%)",
                }}
              />
              <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", flex: 1 }}>
              {driving && (
                <div style={{ fontSize: 11, opacity: 0.85, marginBottom: 6, textAlign: "center" }}>{DRIVING_MSG}</div>
              )}
              <BattleStage
                compact
                fxFullscreen
                mine={battleView.mine}
                wild={battleView.wild}
                events={battleEvents}
                fxKey={battleFxKey}
                moves={battleMoves}
                onPickMove={pickBattleMove}
                movesDisabled={battleLocked || battlePhase !== "fight" || driving}
                distance={battleDistance}
                fled={battleFled}
                onFlee={fleeBattle}
                holdFx={bp3.hold}
                timerSec={battlePhase === "fight" ? battleIdleSec : null}
                timerMax={WILD_TURN_S}
              />
              {battlePhase === "fight" && battleYawn && (
                <div data-testid="battle-yawn" style={{ marginTop: 6, textAlign: "center", pointerEvents: "none" }}>
                  <span style={{ display: "inline-block", background: "rgba(0,0,0,0.55)", padding: "6px 12px", borderRadius: 999, fontSize: 13, fontWeight: 600, fontFamily: "var(--battle-font)", color: "#fff", whiteSpace: "nowrap" }}>
                    {battleYawn}
                  </span>
                </div>
              )}
              {battlePhase === "fight" && (
                <div style={{ marginTop: 6, textAlign: "center", pointerEvents: "none", paddingBottom: "env(safe-area-inset-bottom)" }}>
                  <span style={{ display: "inline-block", background: "rgba(0,0,0,0.55)", padding: "6px 12px", borderRadius: 999, fontSize: 13, fontWeight: 600, fontFamily: "var(--battle-font)", color: "#fff", whiteSpace: "nowrap" }}>
                    {BATTLE_SAFETY_LINE}
                  </span>
                </div>
              )}
              </div>
            </div>
          )}
          {/* UI-3 수정: 결과 연출 텍스트 + 포획 (카드·뒤로 없음, 자동 복귀) */}
          {battlePhase === "result" && battleResult && battleState && (
            <>
              <BattleResultText
                result={battleResult}
                exp={battleResult === "won" ? EXP_BATTLE_WIN : 0}
                element={partner.element}
              />
              {battleResult === "won" && !captureDone && !driving && (
                <div style={{ position: "absolute", left: 12, right: 12, bottom: 96, zIndex: 45 }}>
                  <CaptureShutter
                    speciesId={battleWildId}
                    objectName={ENV_LABEL[env]}
                    hpRatio={Math.max(0, battleState.wild.hp / battleState.wild.maxHp)}
                    fullness={st.fullness}
                    hidden={driving}
                    onDone={handleCaptureDone}
                  />
                </div>
              )}
              {captureMsg && (
                <div style={{ position: "absolute", left: 12, right: 12, bottom: 64, zIndex: 45, textAlign: "center", pointerEvents: "none" }}>
                  {/* UH-1: 포획 결과도 같은 카드 스타일로. */}
                  <span className="uh1-result-card" style={{ fontSize: 13, fontWeight: 600, color: "#fff", textShadow: "0 2px 8px rgba(0,0,0,0.8)" }}>
                    {captureMsg}
                  </span>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
