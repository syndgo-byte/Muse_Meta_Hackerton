"use client";
import { useEffect, useRef, useState } from "react";
import { startBgm } from "@/lib/bgm";
import { josa } from "@/lib/josa";
import ChargeGuide from "@/components/ChargeGuide";
import ExternalPanel from "@/components/ExternalPanel";
import PairingChip from "@/components/PairingChip";
import TopBar from "@/components/TopBar";
import { ROSTER, type Species } from "@/lib/species";
import { currentAccount, type TrainerProfile } from "@/lib/account";
import { formatCredits } from "@/lib/tokens";
import { speciesOf } from "@/lib/battle/roster";
import {
  POINTS_PER_LEVEL,
  POINTS_PER_UPGRADE,
  asRoleKey,
  boostsToPoints,
  pointsToBoosts,
  recommend,
  sanitizeBoosts,
  spentPoints,
  statCap,
  totalSpent,
  type Boosts4,
} from "@/lib/status/statpoints";
import { fetchStatus } from "@/lib/status/client";
import { barColor } from "@/lib/status/barColor";
import { applyCareAction } from "@/lib/status/effects";
import { COST_CARE_EXTRA, COST_UPGRADE, FREE_FEED_PER_DAY, FREE_PLAY_PER_DAY, FREE_SLEEP_PER_DAY } from "@/lib/token/config";
import { creditSignalRemote, fetchBalance, fetchCareStatus, fetchHistory, insufficientMsg, spendRemote, useCareRemote, type HistoryEntry } from "@/lib/token/client";
import { DANCE_UNLOCKS, STAGE_UNLOCKS, danceTier, growthStage } from "@/lib/progression";
import { battleStats, loadBoosts, nextExpFor, saveBoosts, xpThreshold } from "@/lib/stats";
import { FAINTED_MESSAGE } from "@/lib/status/decay";
import { startStatusHeartbeat } from "@/lib/status/heartbeat";
import { BOTTOM_BTN_H, BOTTOM_SIDE } from "@/lib/layout";
import { ensureStarter } from "@/lib/starter";
import {
  AFFECTION_HIGH,
  ENERGY_HIGH,
  ENERGY_LOW,
  FULLNESS_HIGH,
  FULLNESS_LOW,
  HUNGRY_FOOD_LINE,
  SLEEPY_LINE,
  getCreatureCondition,
  loadSeen,
  loadStatus,
  saveStatus,
  stressOf,
  type Status,
} from "@/lib/state";

const PARTNER_KEY = "snapquest_active_partner";
const LEGACY_PARTNER_KEY = "oishie-partner";

// 한글 종성 판별: 받침 있으면 true (와/과 분기용).
function hasJong(s: string): boolean {
  if (!s) return false;
  const c = s.charCodeAt(s.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return false;
  return (c - 0xac00) % 28 !== 0;
}

// 성장 단계는 lib/progression.ts growthStage 단일 기준.
// 라운지는 상태 확인(컨디션/에너지/친밀도/다이어리)+휴식/회복 전용. EXP 지급 없음.

type TabType = "partner" | "roster";

// 내역 한 줄 표시 문구 (§2-1). 원장 reason을 화면용으로 바꾼다.
function historyLabel(e: HistoryEntry): string {
  if (e.type === "credit") {
    const m = e.reason.match(/^(.*) (coffee|food|alcohol|other) (\d+)원$/);
    if (m) return `매장 결제 · ${m[1]} ${Number(m[3]).toLocaleString("ko-KR")}원`;
    return e.reason;
  }
  const [head, tail] = e.reason.split(":");
  switch (head) {
    case "upgrade":
      return tail === "statpoints" ? "스탯 포인트 +2" : "능력치 업그레이드";
    case "respec":
      return "스탯 재배분";
    case "diary-image":
      return "그림일기 이미지";
    case "care-extra":
      return tail === "feed" ? "밥 먹이기 추가" : tail === "play" ? "놀아주기 추가" : tail === "sleep" ? "낮잠 자기 추가" : "교감 추가";
    case "dance":
      return "밈 댄스 스킬";
    case "motion-gen":
      return "AI 모션 생성";
    case "ai":
      return "AI 기능";
    default:
      return e.reason;
  }
}

// 한국 시각 MM/DD HH:mm.
function formatKST(ts: number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ts));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}

export default function CampPage() {
  const [st, setSt] = useState<Status | null>(null);
  const [partnerId, setPartnerId] = useState<string>("fire-01");
  const [capturedIds, setCapturedIds] = useState<string[]>([]);
  const [showCredits, setShowCredits] = useState(false);
  const [seenIds, setSeenIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>("partner");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [tokens, setTokens] = useState(0);
  const [boosts, setBoosts] = useState({ atk: 0, hp: 0, def: 0, spd: 0 });
  const [account, setAccount] = useState<TrainerProfile | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [careFree, setCareFree] = useState({ feed: FREE_FEED_PER_DAY, play: FREE_PLAY_PER_DAY, sleep: FREE_SLEEP_PER_DAY });
  const [guideOpen, setGuideOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [historyFail, setHistoryFail] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(3);
  // G3 스탯 포인트 (서버 /api/status 저장). all은 종별 boosts 기록.
  const [g3, setG3] = useState<{
    points: number;
    all: Record<string, Boosts4>;
    upgrades: number;
    respecs: number;
    granted: number;
    ready: boolean;
  }>({ points: 0, all: {}, upgrades: 0, respecs: 0, granted: 1, ready: false });

  async function saveG3(next: { points: number; all: Record<string, Boosts4>; upgrades: number; respecs: number; granted: number }, pid: string = partnerId) {
    setG3({ ...next, ready: true });
    setBoosts(next.all[pid] ?? { atk: 0, hp: 0, def: 0, spd: 0 });
    try {
      saveBoosts(pid, next.all[pid] ?? { atk: 0, hp: 0, def: 0, spd: 0 });
    } catch {
      /* ignore */
    }
    try {
      const res = await fetch("/api/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          speciesId: pid,
          statPoints: next.points,
          statBoosts: next.all[pid] ?? { atk: 0, hp: 0, def: 0, spd: 0 },
          statUpgrades: next.upgrades,
          statRespecs: next.respecs,
          statGrantedLevel: next.granted,
        }),
      });
      if (!res.ok) showFeedback("스탯 저장에 실패했어요. 잠시 후 다시 시도해주세요.");
    } catch {
      showFeedback("스탯 저장에 실패했어요. 잠시 후 다시 시도해주세요.");
    }
  }

  // G3 초기화: 레벨업분 지급 + 구 localStorage 1회 이관 (PC-1: 파트너 1마리분).
  async function initG3(remote: {
    level: number;
    statPoints?: number;
    statBoosts?: Boosts4;
    statUpgrades?: number;
    statRespecs?: number;
    statGrantedLevel?: number;
    growth?: Record<string, unknown>;
  }, pid: string) {
    const level = Math.max(1, Math.floor(remote.level));
    let granted = remote.statGrantedLevel ?? 1;
    let points = remote.statPoints ?? 0;
    if (level > granted) {
      points += POINTS_PER_LEVEL * (level - granted);
      granted = level;
    }
    const all: Record<string, Boosts4> = {};
    if (remote.statBoosts) all[pid] = sanitizeBoosts(remote.statBoosts);
    const serverFresh = !remote.growth || Object.keys(remote.growth).length === 0;
    if (!all[pid] || serverFresh) {
      try {
        const raw = localStorage.getItem("oishie-stat-boosts");
        const legacy = raw ? (JSON.parse(raw) as Record<string, Boosts4>) : {};
        for (const k of Object.keys(legacy)) {
          if (!ROSTER.some((r) => r.id === k)) continue;
          if (!serverFresh && k !== pid) continue;
          if (all[k]) continue;
          const b = sanitizeBoosts(legacy[k]);
          if (spentPoints(b) > 0) all[k] = b;
        }
      } catch {
        /* ignore */
      }
    }
    const next = {
      points,
      all,
      upgrades: remote.statUpgrades ?? 0,
      respecs: remote.statRespecs ?? 0,
      granted,
    };
    setG3({ ...next, ready: true });
    setBoosts(all[pid] ?? loadBoosts(pid));
    const serverEmpty =
      remote.statPoints === undefined && remote.statBoosts === undefined && remote.statGrantedLevel === undefined;
    if (serverEmpty || level > (remote.statGrantedLevel ?? 1) || Object.keys(all).length > 0) {
      await saveG3(next, pid);
      // 새로 연 서버면 다른 종 이관분도 종별로 저장.
      if (serverFresh) {
        for (const k of Object.keys(all)) {
          if (k === pid) continue;
          try {
            await fetch("/api/status", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ speciesId: k, statBoosts: all[k] }),
            });
          } catch {
            /* ignore */
          }
        }
      }
    }
  }
  // 내역은 서버에서만 읽는다 (브라우저 저장 금지).
  async function loadHistory(limit: number) {
    try {
      setHistory(await fetchHistory(limit));
      setHistoryFail(false);
    } catch {
      setHistoryFail(true);
    }
  }

  useEffect(() => {
    ensureStarter(); // ST-1: 첫 실행 스타터 지급 (도감 읽기 전)
    startBgm();
    // PC-1: 대표 파트너를 먼저 확정하고 그 크리처 값으로 읽는다.
    const resolvedPartner = (() => {
      try {
        const sv = localStorage.getItem(PARTNER_KEY) ?? localStorage.getItem(LEGACY_PARTNER_KEY) ?? "fire-01";
        if (ROSTER.some((r) => r.id === sv)) return sv;
        const raw0 = localStorage.getItem("snapquest-dex");
        const list0 = (raw0 ? JSON.parse(raw0) : []) as Array<{ id?: string; name?: string }>;
        for (const item of list0) {
          if (item.id && ROSTER.some((r) => r.id === item.id)) return item.id;
          if (item.name) {
            const m = ROSTER.find((r) => r.name === item.name);
            if (m) return m.id;
          }
        }
      } catch {
        /* ignore */
      }
      return "fire-01";
    })();
    setPartnerId(resolvedPartner);
    fetchStatus(resolvedPartner)
      .then((remote) => {
        setSt(remote);
        void initG3(remote, resolvedPartner);
      })
      .catch(() => setSt(loadStatus()));
    try {
      fetchBalance().then(setTokens).catch(() => {
        /* 잔량 조회 실패 시 0 유지 */
      });
      fetchCareStatus()
        .then((care) => {
          setCareFree(care.remaining);
          setTokens(care.balance);
        })
        .catch(() => {
          /* 조회 실패 시 기본값 유지 */
        });
      void loadHistory(3);
      setAccount(currentAccount());

      // 1. 도감 로컬스토리지에서 포획 크리처 중복 제거 및 유효 id 매핑
      const raw = localStorage.getItem("snapquest-dex");
      const list = (raw ? JSON.parse(raw) : []) as Array<{ id?: string; name?: string }>;
      const capturedSet = new Set<string>();

      list.forEach((item) => {
        if (item.id && ROSTER.some((r) => r.id === item.id)) {
          capturedSet.add(item.id);
        } else if (item.name) {
          const match = ROSTER.find((r) => r.name === item.name);
          if (match) capturedSet.add(match.id);
        }
      });

      // ST-1: 화면 전용 지급 삭제 — ensureStarter()가 저장소에 지급함
      setCapturedIds(Array.from(capturedSet));

      // 2. 발견한 크리처 목록
      setSeenIds(loadSeen());

      // 3. 대표 파트너
      const savedPartner =
        localStorage.getItem(PARTNER_KEY) ?? localStorage.getItem(LEGACY_PARTNER_KEY) ?? "fire-01";
      if (ROSTER.some((r) => r.id === savedPartner)) {
        setPartnerId(savedPartner);
      } else {
        setPartnerId(Array.from(capturedSet)[0] || "fire-01");
      }

    } catch {
      /* 기본값 유지 */
    }
    // D4-3: 접속 하트비트 (1분마다 tick).
    const stopBeat = startStatusHeartbeat();
    return stopBeat;
  }, []);

  function pickPartner(id: string) {
    setPartnerId(id);
    try {
      localStorage.setItem(PARTNER_KEY, id);
      // snapquest-dex 순서 최우선 반영
      const raw = localStorage.getItem("snapquest-dex");
      const arr = (raw ? JSON.parse(raw) : []) as Array<{ id?: string; name?: string; image?: string }>;
      const targetSp = ROSTER.find((r) => r.id === id);
      if (targetSp) {
        const i = arr.findIndex((d) => d.id === id || (d.name && d.name === targetSp.name));
        if (i > 0) {
          const [head] = arr.splice(i, 1);
          arr.unshift(head);
        } else if (i === -1) {
          arr.unshift({ id: targetSp.id, name: targetSp.name, image: targetSp.image });
        }
        localStorage.setItem("snapquest-dex", JSON.stringify(arr));
      }
    } catch {
      /* ignore */
    }
    showFeedback(`파트너를 ${josa(ROSTER.find((r) => r.id === id)?.name ?? "???", "으로")} 교체했습니다!`);
    // PC-1: 교체한 파트너 값으로 다시 읽고, 서버 대표도 바꾼다.
    void fetchStatus(id)
      .then((remote) => {
        setSt(remote);
        void initG3(remote, id);
      })
      .catch(() => {});
    try {
      void fetch("/api/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partnerId: id }),
      }).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  // 항목 7 규격: 토스트는 ✕ 버튼과 5초 자동 숨김을 갖는다 (단일 타이머).
  const feedbackTimer = useRef<number | null>(null);
  const [feedbackGuide, setFeedbackGuide] = useState(false);
  function showFeedback(msg: string, guide = false) {
    setFeedback(msg);
    setFeedbackGuide(guide);
    if (feedbackTimer.current != null) window.clearTimeout(feedbackTimer.current);
    feedbackTimer.current = window.setTimeout(() => {
      setFeedback(null);
      setFeedbackGuide(false);
    }, 5000);
  }

  // 항목 8: 밥·놀아주기·낮잠 메시지는 해당 버튼 아래에 띄운다 (상단 토스트 사용 금지).
  const [careMsg, setCareMsg] = useState<{ feed: string | null; play: string | null; sleep: string | null }>({
    feed: null,
    play: null,
    sleep: null,
  });
  function showCareMsg(key: "feed" | "play" | "sleep", msg: string) {
    setCareMsg((prev) => ({ ...prev, [key]: msg }));
  }

  function careSuffix(free: boolean, remainingFree: number): string {
    return free ? ` (무료 ${remainingFree}회 남음)` : ` (추가 1회 -${COST_CARE_EXTRA} 토큰)`;
  }

  // 회복 전용 케어 액션 (EXP 지급 없음. 성장은 AR 액션에서만).
  // 하루 무료 횟수 → 소진 시 토큰 추가 구매 (서버 원자 처리).
  async function feedPartner() {
    const wasHungry = (st?.fullness ?? 50) < FULLNESS_LOW;
    let out;
    try {
      out = await useCareRemote("feed");
    } catch {
      showCareMsg("feed", "교감 요청 실패. 잠시 후 다시 시도해주세요.");
      return;
    }
    if (!out.ok) {
      const bal = Number.isFinite(out.balance) ? out.balance : tokens;
      setTokens(bal);
      showCareMsg("feed", insufficientMsg("밥 먹이기", COST_CARE_EXTRA, bal));
      return;
    }
    setTokens(out.balance);
    void loadHistory(historyLimit);
    setCareFree((prev) => ({ ...prev, feed: out.free ? out.remainingFree : 0 }));
    setSt((prev) => {
      const base = prev ?? { fullness: 50, energy: 80, affection: 20, xp: 0, level: 1 };
      const next = applyCareAction(base, "feed");
      saveStatus(next, partnerId);
      return next;
    });
    showCareMsg(
      "feed",
      (wasHungry
        ? `${HUNGRY_FOOD_LINE} 맛있게 먹어 포만감이 회복됐어요.`
        : "맛있는 간식을 먹여 포만감이 회복됐어요. (EXP는 AR 필드 탐험에서)") +
        careSuffix(out.free, out.remainingFree)
    );
  }

  async function playWithPartner() {
    const isMate = (st?.affection ?? 0) >= AFFECTION_HIGH;
    if ((st?.energy ?? 100) < 15) {
      showCareMsg("play", "파트너가 지쳐있어요. 먼저 휴식을 취해주세요.");
      return;
    }
    let out;
    try {
      out = await useCareRemote("play");
    } catch {
      showCareMsg("play", "교감 요청 실패. 잠시 후 다시 시도해주세요.");
      return;
    }
    if (!out.ok) {
      const bal = Number.isFinite(out.balance) ? out.balance : tokens;
      setTokens(bal);
      showCareMsg("play", insufficientMsg("놀아주기", COST_CARE_EXTRA, bal));
      return;
    }
    setTokens(out.balance);
    void loadHistory(historyLimit);
    setCareFree((prev) => ({ ...prev, play: out.free ? out.remainingFree : 0 }));
    setSt((prev) => {
      const base = prev ?? { fullness: 50, energy: 80, affection: 20, xp: 0, level: 1 };
      const next = applyCareAction(base, "play");
      saveStatus(next, partnerId);
      return next;
    });
    showCareMsg(
      "play",
      (isMate
        ? "정면으로 다가와 갸웃! 쓰다듬어주자 점프 환호해요. (EXP는 AR 필드 탐험에서)"
        : "신나게 놀아주어 친밀도가 올랐어요. (EXP는 AR 필드 탐험에서)") +
        careSuffix(out.free, out.remainingFree)
    );
  }

  async function restPartner() {
    let out;
    try {
      out = await useCareRemote("sleep");
    } catch {
      showCareMsg("sleep", "교감 요청 실패. 잠시 후 다시 시도해주세요.");
      return;
    }
    if (!out.ok) {
      const bal = Number.isFinite(out.balance) ? out.balance : tokens;
      setTokens(bal);
      showCareMsg("sleep", insufficientMsg("낮잠 자기", COST_CARE_EXTRA, bal));
      return;
    }
    setTokens(out.balance);
    void loadHistory(historyLimit);
    setCareFree((prev) => ({ ...prev, sleep: out.free ? out.remainingFree : 0 }));
    setSt((prev) => {
      const base = prev ?? { fullness: 50, energy: 80, affection: 20, xp: 0, level: 1 };
      const next = applyCareAction(base, "sleep");
      saveStatus(next, partnerId);
      return next;
    });
    showCareMsg("sleep", "달콤한 낮잠을 자고 활력이 회복됐습니다." + careSuffix(out.free, out.remainingFree));
  }

  const partner: Species = ROSTER.find((s) => s.id === partnerId) ?? ROSTER[0];
  const stage = growthStage(st?.level ?? 1);
  const tier = danceTier(st?.level ?? 1);
  const stress = st ? stressOf(st) : 0;
  const cond = st ? getCreatureCondition(st) : null;
  const level = st?.level ?? 1;
  const stats = battleStats(partner.id, level, boosts, {
    fullness: st?.fullness ?? 0,
    affection: st?.affection ?? 0,
    energy: st?.energy ?? 100,
  });
  // §2 컨디션 유기적 행동 (AR과 동일 임계값).
  const exhausted = (st?.energy ?? 100) < ENERGY_LOW;
  const energetic = (st?.energy ?? 0) >= ENERGY_HIGH;
  const hungry = (st?.fullness ?? 100) < FULLNESS_LOW;
  const stuffed = (st?.fullness ?? 0) >= FULLNESS_HIGH;
  const soulmate = (st?.affection ?? 0) >= AFFECTION_HIGH;
  const expBase = xpThreshold(level);
  const expNeed = nextExpFor(level);
  const expCur = Math.max(0, (st?.xp ?? 0) - expBase);

  useEffect(() => {
    setBoosts(g3.ready && g3.all[partnerId] ? g3.all[partnerId] : loadBoosts(partner.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId, g3.ready]);

  async function handleSimSignal() {
    if (simBusy) return;
    setSimBusy(true);
    try {
      const r = await creditSignalRemote({
        signalId: `sim-${Date.now()}`,
        storeName: "시연용 가상 매장",
        category: "coffee",
        amountKrw: 5000,
        mineId: partner.id,
        mineLevel: level,
      });
      setTokens(r.balance);
      void loadHistory(historyLimit);
      showFeedback(
        r.duplicate
          ? "이미 적립된 결제 신호입니다. (시연용: 실제 결제 아님)"
          : `매장 결제 신호 적립 +${r.tokens} Tokens! (시연용: 실제 결제 아님)`
      );
    } catch {
      showFeedback("적립 신호 실패. 잠시 후 다시 시도해주세요.");
    } finally {
      setSimBusy(false);
    }
  }

  // ---- G3 스탯 포인트 배분 (§7) ----
  const g3Pool = totalSpent(g3.all) + g3.points;
  const g3Cap = statCap(g3Pool);
  const g3Cur = boostsToPoints(sanitizeBoosts(g3.all[partnerId] ?? boosts));
  const g3Role = (() => {
    try {
      return asRoleKey(speciesOf(partnerId).role);
    } catch {
      return asRoleKey("");
    }
  })();

  async function allocPoint(kind: "atk" | "hp" | "def" | "spd", delta: 1 | -1) {
    if (!g3.ready) return;
    if (delta === 1) {
      if (g3.points < 1) {
        showFeedback("쓸 수 있는 포인트가 없어요. 레벨업이나 토큰 강화로 모으세요.");
        return;
      }
      if (g3Cur[kind] + 1 > g3Cap) {
        showFeedback(`단일 능력은 전체의 50%(${g3Cap}pt)까지만 올릴 수 있어요.`);
        return;
      }
    } else if (g3Cur[kind] < 1) {
      return;
    }
    const step = kind === "hp" ? 5 : 1;
    const cur = sanitizeBoosts(g3.all[partnerId] ?? boosts);
    const nb = { ...cur, [kind]: cur[kind] + step * delta };
    await saveG3({
      points: g3.points - delta,
      all: { ...g3.all, [partnerId]: nb },
      upgrades: g3.upgrades,
      respecs: g3.respecs,
      granted: g3.granted,
    });
  }

  async function recommendAlloc() {
    if (!g3.ready) return;
    if (g3.points < 1) {
      showFeedback("쓸 수 있는 포인트가 없어요.");
      return;
    }
    const { add, used } = recommend(g3Role, g3.points, g3Cur, g3Pool);
    if (used < 1) {
      showFeedback("상한(50%) 때문에 더 배분할 곳이 없어요. 재배분을 쓰세요.");
      return;
    }
    const inc = pointsToBoosts(add);
    const cur = sanitizeBoosts(g3.all[partnerId] ?? boosts);
    const nb = { atk: cur.atk + inc.atk, hp: cur.hp + inc.hp, def: cur.def + inc.def, spd: cur.spd + inc.spd };
    await saveG3({
      points: g3.points - used,
      all: { ...g3.all, [partnerId]: nb },
      upgrades: g3.upgrades,
      respecs: g3.respecs,
      granted: g3.granted,
    });
    showFeedback(`추천 배분 완료! ${used}pt 사용 (역할 ${g3Role})`);
  }

  async function respecStats() {
    if (!g3.ready) return;
    const refund = spentPoints(sanitizeBoosts(g3.all[partnerId] ?? boosts));
    if (refund < 1) {
      showFeedback("되돌릴 배분이 없어요.");
      return;
    }
    if (g3.respecs > 0) {
      let out;
      try {
        out = await spendRemote(COST_UPGRADE, "respec:statpoints");
      } catch {
        showFeedback("차감 요청 실패. 잠시 후 다시 시도해주세요.");
        return;
      }
      if (!out.ok) {
        const bal = Number.isFinite(out.balance) ? out.balance : tokens;
        setTokens(bal);
        showFeedback(insufficientMsg("스탯 재배분", COST_UPGRADE, bal), true);
        return;
      }
      setTokens(out.balance);
      void loadHistory(historyLimit);
    }
    await saveG3({
      points: g3.points + refund,
      all: { ...g3.all, [partnerId]: { atk: 0, hp: 0, def: 0, spd: 0 } },
      upgrades: g3.upgrades,
      respecs: g3.respecs + 1,
      granted: g3.granted,
    });
    showFeedback(g3.respecs === 0 ? `재배분 완료! ${refund}pt 환불 (첫 회 무료)` : `재배분 완료! ${refund}pt 환불 (-${COST_UPGRADE} Tokens)`);
  }

  async function buyPoints() {
    if (!g3.ready) return;
    if (g3.upgrades >= level) {
      showFeedback(`토큰 강화는 ${level}레벨까지 ${level}회예요 (현재 ${g3.upgrades}회).`);
      return;
    }
    let out;
    try {
      out = await spendRemote(COST_UPGRADE, "upgrade:statpoints");
    } catch {
      showFeedback("차감 요청 실패. 잠시 후 다시 시도해주세요.");
      return;
    }
    if (!out.ok) {
      const bal = Number.isFinite(out.balance) ? out.balance : tokens;
      setTokens(bal);
      showFeedback(insufficientMsg("스탯 포인트", COST_UPGRADE, bal), true);
      return;
    }
    await saveG3({
      points: g3.points + POINTS_PER_UPGRADE,
      all: g3.all,
      upgrades: g3.upgrades + 1,
      respecs: g3.respecs,
      granted: g3.granted,
    });
    setTokens(out.balance);
    void loadHistory(historyLimit);
    showFeedback(`스탯 포인트 +${POINTS_PER_UPGRADE}! (-${COST_UPGRADE} 토큰, 잔액 ${formatCredits(out.balance)})`);
  }

  return (
    <main
      className="page-narrow screen-root"
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        color: "#fff",
        padding: "24px 0 0",
        overflow: "hidden",
        background: "radial-gradient(circle at 50% 15%, #183324, #0a0f0c 75%)",
      }}
    >
      {/* 상단: 헤더 (7-3 21번 3단 중 1단, UI-1: TopBar 공용 구조) */}
      <div style={{ width: "100%", maxWidth: 680, flexShrink: 0, padding: "0 16px" }}>
        <TopBar
          left={<span aria-hidden style={{ display: "inline-block", width: 36 }} />}
          center={
            <h1 className="topbar-title" style={{ fontSize: 28, margin: 0, fontWeight: 900 }}>
              트레이너 라운지
            </h1>
          }
          right={
            <button
              id="camp-help-btn"
              onClick={() => setHelpOpen(true)}
              aria-label="도움말"
              className="glass-btn topbar-btn"
              style={{ width: 36, fontSize: 16, fontWeight: 800 }}
            >
              ?
            </button>
          }
        />
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 12, letterSpacing: 4, opacity: 0.7 }}>AR 뮤즈</div>
          <p style={{ opacity: 0.8, fontSize: 13, margin: "2px 0 0" }}>
            상태 확인 · 휴식/회복 & 수집한 전체 크리처 관리 (EXP는 AR 필드 탐험에서)
          </p>
        </div>
      </div>
      {/* 본문: 남는 높이, 넘치면 본문만 스크롤 (7-3 21번 3단 중 2단). AF-1a: 하단 바와 같은 좌우 12px */}
      <div style={{ width: "100%", maxWidth: 680, flex: 1, minHeight: 0, overflowY: "auto", padding: "0 12px" }}>
        {/* 피드백 토스트 알림 */}
        {feedback && (
          <div className="glass-toast" style={{ marginBottom: 12, position: "relative" }}>
            <button
              onClick={() => { setFeedback(null); setFeedbackGuide(false); }}
              aria-label="닫기"
              style={{ position: "absolute", top: 4, right: 8, background: "transparent", border: "none", color: "inherit", cursor: "pointer", fontSize: 14, opacity: 0.7 }}
            >
              ✕
            </button>
            {feedback}
            {feedbackGuide && (
              <button
                onClick={() => setGuideOpen(true)}
                style={{ display: "block", margin: "6px auto 0", background: "transparent", color: "#7cc7ff", border: "1px solid #7cc7ff", borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}
              >
                충전 방법 보기
              </button>
            )}
          </div>
        )}
        <ChargeGuide open={guideOpen} onClose={() => setGuideOpen(false)} />

        {/* 도움말 패널 (7-3 13번): ✕ 또는 바깥 누르기로 닫기 */}
        {helpOpen && (
          <div
            id="camp-help-panel"
            onClick={() => setHelpOpen(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          >
            <div
              className="glass-panel"
              onClick={(e) => e.stopPropagation()}
              style={{ position: "relative", maxWidth: 420, width: "100%", maxHeight: "80vh", overflowY: "auto", padding: "16px 18px" }}
            >
              <button
                onClick={() => setHelpOpen(false)}
                aria-label="도움말 닫기"
                style={{ position: "absolute", top: 8, right: 10, background: "transparent", border: "none", color: "inherit", cursor: "pointer", fontSize: 16 }}
              >
                ✕
              </button>
              <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>도움말</div>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>상태</div>
              <div style={{ fontSize: 12, lineHeight: 1.7, marginBottom: 10 }}>
                <div>레벨·EXP — AR 탐험과 교감으로 쌓이는 성장도</div>
                <div>체력 — 전투력의 바탕 · 현재 완전</div>
                <div>포만감 — 낮으면 밥 먹이기로 회복</div>
                <div>활력 — 낮으면 낮잠 자기로 회복</div>
                <div>친밀도 — 높을수록 특별한 반응</div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>뮤즈 AI 토큰 충전 방법</div>
              <div style={{ fontSize: 12, lineHeight: 1.7, marginBottom: 10 }}>
                <div>매장 결제 — 결제 금액의 3% 적립</div>
                <div>핫플 방문 — 방문 1회당 +50</div>
                <div>이벤트 — 이벤트별 추가 충전</div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>무료 횟수</div>
              <div style={{ fontSize: 12, lineHeight: 1.7 }}>
                밥 먹이기·놀아주기·낮잠 자기 각 하루 무료 3회 (서버 시각 기준 날짜 변경 시 리셋)
              </div>
            </div>
          </div>
        )}

        {/* 탭 네비게이션 (상단 바 공통 규격: 높이 48px, 버튼 36px, 간격 8px) */}
        <div
          className="camp-tabs"
          style={{
            display: "flex",
            background: "rgba(0,0,0,0.45)",
            borderRadius: 12,
            padding: "6px 12px",
            marginBottom: 16,
            height: 48,
            gap: 8,
            alignItems: "center",
          }}
        >
          <button
            onClick={() => setActiveTab("partner")}
            className={`glass-btn${activeTab === "partner" ? " active" : ""}`}
            style={{ flex: 1, minWidth: 0, height: 36, fontSize: "clamp(13px, 3.5vw, 14px)", whiteSpace: "nowrap", overflow: "hidden", lineHeight: "36px" }}
          >
            대표 파트너
          </button>
          <button
            onClick={() => setActiveTab("roster")}
            className={`glass-btn${activeTab === "roster" ? " active" : ""}`}
            style={{ flex: 1, minWidth: 0, height: 36, fontSize: "clamp(13px, 3.5vw, 14px)", whiteSpace: "nowrap", overflow: "hidden", lineHeight: "36px" }}
          >
            도감 ({capturedIds.length}/24)
          </button>
        </div>

        {/* 탭 1: 대표 파트너 돌보기 */}
        {activeTab === "partner" && (
          <div>
            {/* 뮤즈 AI 토큰 HUD (원본: 서버 원장) + 시연 전용 패널 */}
            <div className="glass-panel" style={{ padding: "14px 18px", marginBottom: 14 }}>
              <div style={{ fontSize: 20, fontWeight: 900 }}>
                뮤즈 AI 토큰: {tokens}{" "}
                <span style={{ fontSize: 10, fontWeight: 700, opacity: 0.6, verticalAlign: "middle" }}>데모</span>{" "}
                <button
                  onClick={() => setGuideOpen(true)}
                  style={{ fontSize: 12, fontWeight: 700, background: "transparent", color: "#7cc7ff", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}
                >
                  충전 방법 보기
                </button>
              </div>
              <div style={{ fontSize: 11, opacity: 0.65 }}>
                {account ? `${account.provider} · ${account.name}` : "게스트 (로그인 시 연동)"}
                {tokens <= 0 && " · 잔량 0: 소비처 잠금 중"}
              </div>
              {/* 토큰 내역 (§2-1). 기본 3줄, 펼쳐보기/닫기로 20줄 전환. 목록은 하나만 */}
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 4 }}>최근 내역</div>
                {historyFail ? (
                  <div style={{ fontSize: 12, opacity: 0.7 }}>내역을 불러오지 못했습니다.</div>
                ) : history == null ? (
                  <div style={{ fontSize: 12, opacity: 0.5 }}>불러오는 중...</div>
                ) : history.length === 0 ? (
                  <div style={{ fontSize: 12, opacity: 0.7 }}>아직 내역이 없습니다.</div>
                ) : (
                  <>
                    {history.map((e) => (
                      <div
                        key={e.id}
                        style={{
                          display: "flex",
                          gap: 8,
                          fontSize: 12,
                          padding: "3px 0",
                          color: e.type === "credit" ? "#9fe870" : "#ff7b8f",
                        }}
                      >
                        <span style={{ fontWeight: 800, whiteSpace: "nowrap" }}>
                          {e.type === "credit" ? `+${e.amount}` : `−${e.amount}`}
                        </span>
                        <span style={{ flex: 1 }}>{historyLabel(e)}</span>
                        <span style={{ opacity: 0.65, whiteSpace: "nowrap" }}>{formatKST(e.ts)}</span>
                      </div>
                    ))}
                    <button
                      onClick={() => {
                        const next = historyLimit < 20 ? 20 : 3;
                        setHistoryLimit(next);
                        void loadHistory(next);
                      }}
                      className="glass-btn"
                      style={{ fontSize: 12, marginTop: 6 }}
                    >
                      {historyLimit < 20 ? "펼쳐보기" : "닫기"}
                    </button>
                  </>
                )}
              </div>
              <div style={{ marginTop: 10, background: "rgba(0,0,0,0.35)", borderRadius: 12, padding: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>시연용 패널 (시연용: 실제 결제 아님)</div>
                <button onClick={() => void handleSimSignal()} disabled={simBusy} className="glass-btn" style={{ fontSize: 13 }}>
                  매장 결제 완료 (시뮬레이션)
                </button>
                <span style={{ fontSize: 11, opacity: 0.65, marginLeft: 8 }}>
                  5,000원 결제 신호 → +150 토큰 (시연용: 실제 결제 아님)
                </span>
              </div>
            </div>
            {/* 보유한 포획 크리처 셀렉터 (7-3 15번: 상단 배치) */}
            <div
              style={{
                background: "rgba(0,0,0,0.5)",
                borderRadius: 16,
                padding: 16,
                marginBottom: 14,
              }}
            >
              <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10 }}>
                가방 속 내 크리처 ({capturedIds.length}마리 보유)
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(78px, 1fr))", gap: 10 }}>
                {capturedIds.map((cid) => {
                  const sp = ROSTER.find((r) => r.id === cid);
                  if (!sp) return null;
                  const isSelected = sp.id === partnerId;
                  return (
                    <button
                      key={sp.id}
                      onClick={() => pickPartner(sp.id)}
                      style={{
                        border: isSelected ? "2px solid rgba(0, 242, 254, 0.7)" : "1px solid rgba(255,255,255,0.15)",
                        borderRadius: 12,
                        background: isSelected ? "rgba(0, 242, 254, 0.12)" : "#141c16",
                        color: "#fff",
                        padding: "8px 4px",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={sp.image}
                        alt={sp.name}
                        style={{
                          width: 52,
                          height: 52,
                          objectFit: "cover",
                          borderRadius: 8,
                        }}
                      />
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: isSelected ? 800 : 500,
                          color: isSelected ? "#d9fbff" : "#fff",
                          textAlign: "center",
                        }}
                      >
                        {sp.name}
                      </div>
                      {isSelected && (
                        <span style={{ fontSize: 9, background: "#00f2fe", color: "#03252b", borderRadius: 4, padding: "1px 4px", fontWeight: 800 }}>
                          대표
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            {/* AR 필드 탐험 바로가기 (7-3 15번: 가방 아래, 파트너 카드 위) */}
            <a
              href="/pov?mode=cam"
              className="glass-btn"
              style={{ display: "flex", fontSize: 15, marginBottom: 14 }}
            >
              {partner.name}{hasJong(partner.name) ? "과" : "와"} AR 필드 탐험 출발
            </a>
            {/* 파트너 프로필 카드 */}
            <div
              style={{
                background: "rgba(18, 28, 22, 0.8)",
                borderRadius: 16,
                padding: 18,
                border: "1px solid rgba(159, 232, 112, 0.25)",
                marginBottom: 14,
              }}
            >
              <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={partner.image}
                  alt={partner.name}
                  style={{
                    width: 90,
                    height: 90,
                    objectFit: "cover",
                    borderRadius: 16,
                    border: exhausted
                      ? "2px solid #64748b"
                      : energetic
                        ? "2px solid #ffd54a"
                        : soulmate
                          ? "2px solid #ff8fb2"
                          : "2px solid #9fe870",
                    background: "#0c120e",
                    transform: exhausted
                      ? "scale(1.06, 0.84)"
                      : hungry
                        ? "rotate(-4deg) scale(0.96)"
                        : energetic
                          ? "scale(1.05)"
                          : "none",
                    filter: exhausted ? "saturate(0.55) brightness(0.9)" : "none",
                    transition: "transform 0.3s ease, filter 0.3s ease",
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 20, fontWeight: 900 }}>{partner.name}</span>
                    <span
                      style={{
                        background: stage.color,
                        color: "#0a1c10",
                        padding: "2px 8px",
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 800,
                      }}
                    >
                      {stage.title} ({st?.level ?? 1}레벨)
                    </span>
                    <span style={{ fontSize: 13, opacity: 0.75 }}>({partner.element} 속성)</span>
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>{partner.flavor}</div>
                  {cond && (
                    <div style={{ fontSize: 12, marginTop: 4, color: "#9fe870" }}>
                      현재 컨디션: {cond.labels.join(" · ")} (스트레스 {stress})
                    </div>
                  )}
                  {/* §2 컨디션 유기적 행동 (AR과 동일): 상태별 행동+지정 대사 */}
                  {st && (
                    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                      {exhausted && (
                        <div style={{ background: "rgba(100,116,139,0.15)", borderRadius: 10, padding: "8px 10px", fontSize: 12 }}>
                          <div style={{ fontWeight: 800 }}>주저앉음 · 이동속도 50% · 반쯤 감은 눈+하품</div>
                          <div style={{ marginTop: 4, background: "#fff", color: "#111", borderRadius: 10, padding: "6px 10px", fontWeight: 700 }}>
                            {SLEEPY_LINE}
                          </div>
                          <div style={{ marginTop: 4, opacity: 0.85 }}>배틀 출전 불가 (출전 시 ATK/SPD 50%) · 라운지 낮잠 권장</div>
                        </div>
                      )}
                      {energetic && !exhausted && (
                        <div style={{ background: "rgba(255,213,74,0.12)", borderRadius: 10, padding: "8px 10px", fontSize: 12 }}>
                          <div style={{ fontWeight: 800 }}>발 구르기 + 트레이너 주변 고속 회전</div>
                          <div style={{ opacity: 0.85 }}>에너지 {ENERGY_HIGH}% 이상 — AR에서 빙글빙글!</div>
                        </div>
                      )}
                      {hungry && (
                        <div style={{ background: "rgba(232,161,60,0.12)", borderRadius: 10, padding: "8px 10px", fontSize: 12 }}>
                          <div style={{ fontWeight: 800 }}>배 움켜쥠 + 시무룩</div>
                          <div style={{ marginTop: 4, background: "#fff", color: "#111", borderRadius: 10, padding: "6px 10px", fontWeight: 700 }}>
                            음식 인식 시: {HUNGRY_FOOD_LINE}
                          </div>
                        </div>
                      )}
                      {stuffed && !hungry && (
                        <div style={{ background: "rgba(159,232,112,0.12)", borderRadius: 10, padding: "8px 10px", fontSize: 12 }}>
                          <div style={{ fontWeight: 800 }}>배 두드림 + 만족 미소</div>
                          <div style={{ opacity: 0.85 }}>포만감 {FULLNESS_HIGH}% 이상 — 배불러 행복해해요.</div>
                        </div>
                      )}
                      {soulmate && (
                        <div style={{ background: "rgba(255,143,178,0.12)", borderRadius: 10, padding: "8px 10px", fontSize: 12 }}>
                          <div style={{ fontWeight: 800 }}>정면 접근 + 갸웃 + 애교</div>
                          <div style={{ opacity: 0.85 }}>칭찬 인식 시 점프 환호! (AR 음성: 칭찬/귀여워/최고)</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* 상태 묶음 (7-3 항목 8): 레벨·EXP, 체력, 포만감, 활력, 친밀도 + 한 줄 설명 */}
              <div style={{ marginTop: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, whiteSpace: "nowrap" }}>
                    {level}레벨 · EXP {expCur} / {expNeed}
                  </span>
                  <div style={{ flex: 1, height: 8, background: "rgba(255,255,255,0.1)", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ width: `${Math.min(100, Math.round((expCur / expNeed) * 100))}%`, height: "100%", background: "#9fe870", borderRadius: 4 }} />
                  </div>
                </div>
                <div style={{ fontSize: 11, opacity: 0.7 }}>AR 탐험과 교감으로 쌓이는 성장도 (다음 {level + 1}레벨)</div>
                {(
                  [
                    ["체력", "hp", st?.hp ?? stats.hp, stats.hp, st?.hp === 0 ? FAINTED_MESSAGE : "전투력의 바탕 · 현재 완전"],
                    ["포만감", "fullness", Math.round(st?.fullness ?? 50), 100, "낮으면 밥 먹이기로 회복"],
                    ["활력", "energy", Math.round(st?.energy ?? 80), 100, "낮으면 낮잠 자기로 회복"],
                    ["친밀도", "affection", Math.round(st?.affection ?? 20), 100, "높을수록 특별한 반응"],
                  ] as Array<[string, "hp" | "fullness" | "energy" | "affection", number, number, string]>
                ).map(([label, kind, val, max, desc]) => (
                  <div key={label} style={{ marginTop: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 13, width: 52 }}>{label}</span>
                      <div style={{ flex: 1, height: 10, background: "rgba(255,255,255,0.1)", borderRadius: 5, overflow: "hidden" }}>
                        <div
                          style={{
                            width: `${Math.min(100, Math.round((val / max) * 100))}%`,
                            height: "100%",
                            background: barColor(kind, val, max),
                            borderRadius: 5,
                            transition: "width 0.3s ease",
                          }}
                        />
                      </div>
                      <span style={{ fontSize: 12, width: 58, textAlign: "right" }}>{val}/{max}</span>
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.7, marginLeft: 62 }}>{desc}</div>
                  </div>
                ))}
              </div>

            </div>
            {/* 회복 전용 케어 버튼 (7-3 15번: 파트너 카드 아래. EXP 없음, 효과 한 줄 + 메시지는 버튼 아래) */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 10,
                marginTop: 14,
              }}
            >
              {([
                ["feed", "밥 먹이기", careFree.feed, () => void feedPartner(), "효과: 포만감 회복"],
                ["play", "놀아주기", careFree.play, () => void playWithPartner(), "효과: 친밀도 상승"],
                ["sleep", "낮잠 자기", careFree.sleep, () => void restPartner(), "효과: 활력 회복"],
              ] as Array<["feed" | "play" | "sleep", string, number, () => void, string]>).map(([key, label, free, run, effect]) => (
                <div key={key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <button
                    onClick={run}
                    className="glass-btn"
                    style={{ fontSize: 14, ...(free <= 0 && tokens < COST_CARE_EXTRA ? { opacity: 0.45, filter: "grayscale(1)" } : {}) }}
                  >
                    {label}{free > 0 ? ` (무료 ${free}회)` : ` (+${COST_CARE_EXTRA})`}
                  </button>
                  <div style={{ fontSize: 11, opacity: 0.75 }}>{effect}</div>
                  <div style={{ fontSize: 11, minHeight: 16, color: "#ffd9a0" }}>{careMsg[key]}</div>
                </div>
              ))}
            </div>
            {/* 전투 스탯 (HP/ATK/DEF/SPD) + G3 스탯 포인트 배분 */}
            <div style={{ marginTop: 12, background: "rgba(0,0,0,0.35)", borderRadius: 12, padding: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>
                배틀 스탯 ({level}레벨) · 포인트 {g3.ready ? g3.points : "?"}pt · 잔액 {formatCredits(tokens)}
              </div>
              {exhausted && (
                <div style={{ fontSize: 12, color: "#fbbf24", marginBottom: 6 }}>
                  탈진: ATK/SPD 50% 패널티 적용 중 · 배틀 출전 불가 (휴식 필요)
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, fontSize: 13 }}>
                <div>HP {stats.hp}{boosts.hp > 0 && <span style={{ color: "#9fe870" }}> (+{boosts.hp})</span>}</div>
                <div>ATK {stats.atk}{boosts.atk > 0 && <span style={{ color: "#9fe870" }}> (+{boosts.atk})</span>}</div>
                <div>DEF {stats.def}{boosts.def > 0 && <span style={{ color: "#9fe870" }}> (+{boosts.def})</span>}</div>
                <div>SPD {stats.spd}{boosts.spd > 0 && <span style={{ color: "#9fe870" }}> (+{boosts.spd})</span>}</div>
              </div>
              <div style={{ fontSize: 11, opacity: 0.7, marginTop: 6 }}>
                레벨업마다 +{POINTS_PER_LEVEL}pt · 단일 능력은 전체의 50%(최대 {g3Cap}pt)까지 · 체력 1pt = +5
              </div>
              {(
                [
                  ["atk", "공격", "+1/pt"],
                  ["hp", "체력", "+5/pt"],
                  ["def", "방어", "+1/pt"],
                  ["spd", "스피드", "+1/pt"],
                ] as Array<["atk" | "hp" | "def" | "spd", string, string]>
              ).map(([kind, label, unit]) => (
                <div key={kind} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, fontSize: 13 }}>
                  <span style={{ width: 88 }}>{label} {g3Cur[kind]}pt <span style={{ opacity: 0.6, fontSize: 11 }}>{unit}</span></span>
                  <button onClick={() => void allocPoint(kind, -1)} disabled={!g3.ready || g3Cur[kind] < 1} className="glass-btn" style={{ fontSize: 13, padding: "2px 10px" }}>
                    −
                  </button>
                  <button onClick={() => void allocPoint(kind, 1)} disabled={!g3.ready || g3.points < 1 || g3Cur[kind] + 1 > g3Cap} className="glass-btn" style={{ fontSize: 13, padding: "2px 10px" }}>
                    ＋
                  </button>
                </div>
              ))}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 10 }}>
                <button onClick={() => void recommendAlloc()} disabled={!g3.ready || g3.points < 1} className="glass-btn" style={{ fontSize: 12 }}>
                  추천 배분
                </button>
                <button onClick={() => void respecStats()} disabled={!g3.ready} className="glass-btn" style={{ fontSize: 12 }}>
                  재배분{g3.respecs === 0 ? " (무료)" : ` (${COST_UPGRADE})`}
                </button>
                <button
                  onClick={() => void buyPoints()}
                  disabled={!g3.ready || g3.upgrades >= level || tokens < COST_UPGRADE}
                  className="glass-btn"
                  style={{ fontSize: 12, ...(tokens < COST_UPGRADE || g3.upgrades >= level ? { opacity: 0.45, filter: "grayscale(1)" } : {}) }}
                >
                  +{POINTS_PER_UPGRADE}pt ({COST_UPGRADE}) {g3.upgrades}/{level}
                </button>
              </div>
            </div>
            {/* 밈 댄스 스킬 해금 (성장 단계 연동) */}
            <div style={{ marginTop: 12, background: "rgba(0,0,0,0.35)", borderRadius: 12, padding: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>밈 댄스 스킬 ({stage.title})</div>
              {DANCE_UNLOCKS.map((d) => {
                const un = tier >= d.tier;
                return (
                  <div key={d.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", opacity: un ? 1 : 0.45 }}>
                    <span>{un ? "◆" : "◇"} {d.name}</span>
                    <span style={{ opacity: 0.75 }}>{un ? d.desc : `${d.tier === 1 ? 5 : 10}레벨 해금`}</span>
                  </div>
                );
              })}
            </div>
            {/* 성장단계별 능력/언락 (표시 전용) */}
            <div style={{ marginTop: 12, background: "rgba(0,0,0,0.35)", borderRadius: 12, padding: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>성장 단계 ({STAGE_UNLOCKS[tier].levels} {stage.title})</div>
              {STAGE_UNLOCKS.map((s) => {
                const un = tier >= s.tier;
                const cur = tier === s.tier;
                return (
                  <div key={s.title} style={{ padding: "6px 0", borderTop: s.tier > 0 ? "1px solid rgba(255,255,255,0.08)" : "none", opacity: un ? 1 : 0.45 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: cur ? 800 : 500 }}>
                      <span>{un ? "◆" : "◇"} {s.title} · {s.levels}{cur ? " (현재)" : ""}</span>
                      <span style={{ opacity: 0.75 }}>{un ? s.unlocks.join(" · ") : `${s.tier === 1 ? "5레벨" : "10레벨"} 해금`}</span>
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>
                      능력: {s.abilities.join(" · ")} / AR: {s.arFlavor} / 배틀: {s.battleBonus}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 탭 2: 전체 24마리 도감 현황 */}
        {activeTab === "roster" && (
          <div
            style={{
              background: "rgba(18, 28, 22, 0.8)",
              borderRadius: 16,
              padding: 16,
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>
                24마리 크리처 도감 진척도
              </div>
              <div style={{ fontSize: 13, opacity: 0.8 }}>
                포획 {capturedIds.length} / 24 · 발견 {seenIds.length}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(135px, 1fr))", gap: 10 }}>
              {ROSTER.map((sp) => {
                const isCaptured = capturedIds.includes(sp.id);
                const isSeen = isCaptured || seenIds.includes(sp.id);
                const isCurrentPartner = sp.id === partnerId;

                return (
                  <div
                    key={sp.id}
                    style={{
                      background: isCaptured ? "#1a271f" : "#111713",
                      borderRadius: 12,
                      padding: 10,
                      border: isCurrentPartner
                        ? "2px solid #9fe870"
                        : isCaptured
                        ? "1px solid rgba(159, 232, 112, 0.3)"
                        : "1px solid rgba(255,255,255,0.06)",
                      opacity: isSeen ? 1 : 0.5,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      textAlign: "center",
                      position: "relative",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={sp.image}
                      alt={sp.name}
                      style={{
                        width: 64,
                        height: 64,
                        objectFit: "cover",
                        borderRadius: 10,
                        filter: isCaptured ? "none" : isSeen ? "grayscale(40%)" : "grayscale(100%) brightness(40%)",
                      }}
                    />
                    <div style={{ fontWeight: 700, fontSize: 13, marginTop: 6 }}>
                      {isSeen ? sp.name : "???"}
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
                      {sp.element} 속성
                    </div>

                    <div style={{ marginTop: 6, width: "100%" }}>
                      {isCaptured ? (
                        <button
                          onClick={() => pickPartner(sp.id)}
                          className={isCurrentPartner ? "hud-btn hud-btn-primary" : "hud-btn"}
                          style={{
                            width: "100%",
                            padding: "4px 0",
                            fontSize: 11,
                            fontWeight: 800,
                          }}
                        >
                          {isCurrentPartner ? "대표 파트너" : "파트너 선택"}
                        </button>
                      ) : (
                        <div style={{ fontSize: 11, opacity: 0.6, padding: "4px 0" }}>
                          {isSeen ? "미포획" : "미발견"}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 외부 연결 상태 (AF-1a: 탭에서 분리, 라운지 맨 아래 접힌 링크) */}
        <details style={{ margin: "4px 0 12px", fontSize: 12 }}>
          <summary style={{ cursor: "pointer", padding: "8px 4px", fontWeight: 700, opacity: 0.75 }}>
            외부 연결 상태
          </summary>
          <ExternalPanel />
        </details>
        <PairingChip />
      </div>
      {/* 하단 바: 퀵 네비게이션 (종류·순서·문구 유지, 화면 맨 아래 고정. 7-3 21번 3단 중 3단) */}
      <div id="bottom-bar" className="bottom-bar-pad" style={{ width: "100%", maxWidth: 680, flexShrink: 0, paddingLeft: BOTTOM_SIDE, paddingRight: BOTTOM_SIDE, paddingTop: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
          <a href="/pov?mode=cam" className="glass-btn" style={{ fontSize: 12, height: BOTTOM_BTN_H, display: "flex", alignItems: "center", justifyContent: "center" }}>
            AR 필드 탐험(카메라)
          </a>
          <a href="/pov?mode=sim" className="glass-btn" style={{ fontSize: 12, height: BOTTOM_BTN_H, display: "flex", alignItems: "center", justifyContent: "center" }}>
            AR 필드 탐험(가상)
          </a>
          <a href="/dex" className="glass-btn" style={{ fontSize: 12, height: BOTTOM_BTN_H, display: "flex", alignItems: "center", justifyContent: "center" }}>
            크리처 도감 & 파트너 관리 ({capturedIds.length}/24)
          </a>
        </div>
        {/* CC-BY 음원 크레딧 (8-E 후보곡 정리 후에도 유지) */}
        <div style={{ textAlign: "center", marginTop: 10 }}>
          <button
            onClick={() => setShowCredits(true)}
            style={{ background: "none", border: "none", padding: 4, fontSize: 11, color: "rgba(255,255,255,0.4)", cursor: "pointer", textDecoration: "underline" }}
          >
            크레딧
          </button>
        </div>
      </div>
      {showCredits && (
        <div
          onClick={() => setShowCredits(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 90, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#1a2030", borderRadius: 12, padding: "16px 18px", maxWidth: 420, width: "100%", maxHeight: "70vh", overflowY: "auto", fontSize: 12, lineHeight: 1.7 }}
          >
            <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 8 }}>BGM 크레딧</div>
            <div>필드 BGM: 자작곡 (Call to Adventure, 8-D).</div>
            <div style={{ marginTop: 8, opacity: 0.7 }}>
              과거 후보곡은 CC-BY 라이선스로 Wikimedia Commons에서 수집했으며,
              상세 출처는 public/bgm/CREDITS.txt에 기록되어 있습니다.
            </div>
            <button onClick={() => setShowCredits(false)} className="glass-btn" style={{ fontSize: 12, marginTop: 12, width: "100%" }}>
              닫기
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
