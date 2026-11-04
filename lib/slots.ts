// 세이브/로드: 라이브 키의 스냅샷을 슬롯 3개에 보관. 서버 없음.
// PLATFORM_WORKORDER 작업 7-6: localStorage 키 + 서버 상태(/api/status) 스냅샷.
// 토큰 잔액·내역과 조우 상태는 슬롯에 넣지 않는다 (계정 공용).
import { DEFAULT_STATUS, type Status } from "./state";
import { EMPTY_QUEST, QUEST_KEY, type Quest } from "./quest";
import { ensureStarter } from "./starter";

const SLOTS_KEY = "snapquest-slots";
const TRAINER_KEY = "snapquest-trainer";
const DEX_KEY = "snapquest-dex";
const SEEN_KEY = "snapquest-seen";
const STATUS_KEY = "snapquest-status";
const PARTNER_KEY = "snapquest_active_partner";
const LEGACY_PARTNER_KEY = "oishie-partner";
const CURRENT_KEY = "snapquest-current-slot";

export const DEFAULT_PARTNER = "fire-01";

// /api/status 레코드 스냅샷 (store.ts CreatureStatusView와 같은 모양, 옛 평탄본도 허용.
// store.ts는 Node 전용이라 타입만 복제한다).
export type ServerStatusSnapshot = {
  fullness?: number;
  energy?: number;
  affection?: number;
  lastTickAt?: number;
  lastCareAt?: number;
  lastResetDay?: string;
  xp?: number;
  level?: number;
  hp?: number;
  statPoints?: number;
  statBoosts?: { atk: number; hp: number; def: number; spd: number } | Record<string, { atk: number; hp: number; def: number; spd: number }>;
  statUpgrades?: number;
  statRespecs?: number;
  statGrantedLevel?: number;
  speciesId?: string;
  partnerId?: string;
  growth?: Record<string, { xp: number; level: number }>;
};

export type SlotData = {
  status: Status;
  dex: unknown[];
  seen: string[];
  quest: Quest;
  partnerId: string;
  server: ServerStatusSnapshot | null;
};
export type Slot = { trainer: string; updatedAt: number; data: SlotData } | null;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return { ...fallback, ...(JSON.parse(raw) as Partial<T>) } as T;
  } catch {
    /* ignore */
  }
  return fallback;
}

function readArr(key: string): unknown[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as unknown[];
  } catch {
    /* ignore */
  }
  return [];
}

function readPartner(): string {
  try {
    return localStorage.getItem(PARTNER_KEY) ?? localStorage.getItem(LEGACY_PARTNER_KEY) ?? DEFAULT_PARTNER;
  } catch {
    return DEFAULT_PARTNER;
  }
}

export function loadSlots(): [Slot, Slot, Slot] {
  try {
    const raw = localStorage.getItem(SLOTS_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as Slot[];
      return [arr[0] ?? null, arr[1] ?? null, arr[2] ?? null];
    }
  } catch {
    /* ignore */
  }
  return [null, null, null];
}

function storeSlots(slots: [Slot, Slot, Slot]) {
  try {
    localStorage.setItem(SLOTS_KEY, JSON.stringify(slots));
  } catch {
    /* ignore */
  }
}

// 현재 플레이를 슬롯에 덮어쓴다. server는 /api/status GET 결과 그대로.
export function saveSlot(i: number, trainer: string, server: ServerStatusSnapshot | null) {
  if (i < 0 || i > 2) return;
  const slots = loadSlots();
  const data: SlotData = {
    status: read<Status>(STATUS_KEY, { ...DEFAULT_STATUS }),
    dex: readArr(DEX_KEY),
    seen: readArr(SEEN_KEY) as string[],
    quest: read<Quest>(QUEST_KEY, { ...EMPTY_QUEST }),
    partnerId: readPartner(),
    server,
  };
  slots[i] = { trainer, updatedAt: Date.now(), data };
  storeSlots(slots);
}

// 슬롯을 라이브 키에 복원한다. 서버 상태는 호출자가 /api/status로 덮어쓴다.
export function applySlot(i: number): { ok: boolean; server: ServerStatusSnapshot | null } {
  const slot = loadSlots()[i];
  if (!slot) return { ok: false, server: null };
  try {
    localStorage.setItem(STATUS_KEY, JSON.stringify(slot.data.status));
    localStorage.setItem(DEX_KEY, JSON.stringify(slot.data.dex));
    localStorage.setItem(SEEN_KEY, JSON.stringify(slot.data.seen));
    localStorage.setItem(QUEST_KEY, JSON.stringify(slot.data.quest));
    localStorage.setItem(PARTNER_KEY, slot.data.partnerId ?? DEFAULT_PARTNER);
    localStorage.setItem(TRAINER_KEY, slot.trainer);
    return { ok: true, server: slot.data.server ?? null };
  } catch {
    return { ok: false, server: null };
  }
}

export function deleteSlot(i: number) {
  if (i < 0 || i > 2) return;
  const slots = loadSlots();
  slots[i] = null;
  storeSlots(slots);
}

export function currentTrainer(): string {
  try {
    return localStorage.getItem(TRAINER_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setTrainer(name: string) {
  try {
    localStorage.setItem(TRAINER_KEY, name);
  } catch {
    /* ignore */
  }
}

// 현재 슬롯 번호 (camp 저장이 같은 슬롯에 덮어쓴다).
export function currentSlot(): number {
  try {
    const n = Number(localStorage.getItem(CURRENT_KEY));
    if (n === 0 || n === 1 || n === 2) return n;
  } catch {
    /* ignore */
  }
  return 0;
}

export function setCurrentSlot(i: number) {
  if (i < 0 || i > 2) return;
  try {
    localStorage.setItem(CURRENT_KEY, String(i));
  } catch {
    /* ignore */
  }
}

export function freshStart(trainer: string) {
  try {
    localStorage.setItem(STATUS_KEY, JSON.stringify({ ...DEFAULT_STATUS }));
    localStorage.setItem(DEX_KEY, JSON.stringify([]));
    localStorage.setItem(SEEN_KEY, JSON.stringify([]));
    localStorage.setItem(QUEST_KEY, JSON.stringify({ ...EMPTY_QUEST }));
    localStorage.setItem(PARTNER_KEY, DEFAULT_PARTNER);
    localStorage.setItem(TRAINER_KEY, trainer);
    ensureStarter(); // ST-1: 초기화 직후 스타터 지급
  } catch {
    /* ignore */
  }
}
