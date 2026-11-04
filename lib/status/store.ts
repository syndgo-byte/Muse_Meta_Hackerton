// 크리처 수치 서버 저장 (TOKEN_WORKORDER §14 항목 4, D4-3 확장, PC-1 크리처별 성장).
// data/creature-status.json: 돌봄 수치 공용 + growth: Record<speciesId, 성장값>.
// 잔량과 같은 뮤텍스를 쓴다. Node 전용, 상대 import만 쓴다.
import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { exclusive } from "../token/ledger";
import { applyTick } from "./decay";
import { ROSTER } from "../species";

export const PARTNER_DEFAULT = "fire-01";

// PC-1: 크리처별 성장값 (옛 단일 레코드의 xp·level·hp·stat*).
export type CreatureGrowth = {
  xp: number;
  level: number;
  hp?: number;
  statPoints?: number;
  statBoosts?: { atk: number; hp: number; def: number; spd: number };
  statUpgrades?: number;
  statRespecs?: number;
  statGrantedLevel?: number;
};

// PC-1: 파일 모양 v2 (돌봄 공용 + 대표 파트너 + 크리처별 성장).
export type CreatureStatus = {
  fullness: number;
  energy: number;
  affection: number;
  lastTickAt: number;
  lastCareAt: number;
  lastResetDay: string;
  partnerId: string;
  growth: Record<string, CreatureGrowth>;
};

// PC-1: 읽기 모양 (공용 + 요청 크리처 펼침 + 전체 growth). 구 모양 상위 호환.
export type CreatureStatusView = {
  fullness: number;
  energy: number;
  affection: number;
  lastTickAt: number;
  lastCareAt: number;
  lastResetDay: string;
  xp: number;
  level: number;
  hp?: number;
  statPoints?: number;
  statBoosts?: { atk: number; hp: number; def: number; spd: number };
  statUpgrades?: number;
  statRespecs?: number;
  statGrantedLevel?: number;
  speciesId: string;
  partnerId: string;
  growth: Record<string, CreatureGrowth>;
};

// PC-1: 문자열 검증 (roster에 있는 id만, 32자 제한).
export function isSpeciesId(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= 32 && ROSTER.some((s) => s.id === v);
}

export const DEFAULT_GROWTH: CreatureGrowth = { xp: 0, level: 1 };

// lib/state.ts DEFAULT_STATUS와 같은 돌봄 값. 0/""은 채택 마커 (처벌 없이 현재로 채움).
export const DEFAULT_CREATURE_STATUS: CreatureStatus = {
  fullness: 50,
  energy: 80,
  affection: 20,
  lastTickAt: 0,
  lastCareAt: 0,
  lastResetDay: "",
  partnerId: PARTNER_DEFAULT,
  growth: {},
};

export function statusPath(): string {
  const override = process.env.CREATURE_STATUS_PATH;
  if (override && override.length > 0) return override;
  return join(process.cwd(), "data", "creature-status.json");
}

function bakPath(path: string): string {
  return path.endsWith(".json") ? `${path.slice(0, -5)}.bak.json` : `${path}.bak`;
}

const isCount = (x: unknown): x is number =>
  typeof x === "number" && Number.isInteger(x) && x >= 0;

function validBoosts(b: unknown): b is NonNullable<CreatureGrowth["statBoosts"]> {
  if (!b || typeof b !== "object" || Array.isArray(b)) return false;
  const r = b as Record<string, unknown>;
  for (const k of ["atk", "hp", "def", "spd"] as const) {
    if (!isCount(r[k])) return false;
  }
  return (r.hp as number) % 5 === 0;
}

function validGrowth(g: unknown): g is CreatureGrowth {
  const v = g as Record<string, unknown>;
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  if (!isCount(v.xp)) return false;
  if (!isCount(v.level) || (v.level as number) < 1) return false;
  if (v.hp !== undefined && !isCount(v.hp)) return false;
  for (const k of ["statPoints", "statUpgrades", "statRespecs", "statGrantedLevel"] as const) {
    if (v[k] !== undefined && !isCount(v[k])) return false;
  }
  if (v.statBoosts !== undefined && !validBoosts(v.statBoosts)) return false;
  // 토큰 강화 횟수 상한 = 그 크리처 레벨 × 1.
  if (
    typeof v.statUpgrades === "number" &&
    typeof v.level === "number" &&
    v.statUpgrades > v.level
  ) {
    return false;
  }
  return true;
}

function validShared(v: Record<string, unknown>): boolean {
  for (const k of ["fullness", "energy", "affection"] as const) {
    if (typeof v[k] !== "number" || !Number.isFinite(v[k]) || (v[k] as number) < 0 || (v[k] as number) > 100) {
      return false;
    }
  }
  for (const k of ["lastTickAt", "lastCareAt"] as const) {
    if (v[k] !== undefined && !isCount(v[k])) return false;
  }
  if (
    v.lastResetDay !== undefined &&
    (typeof v.lastResetDay !== "string" || (v.lastResetDay !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(v.lastResetDay)))
  ) {
    return false;
  }
  return true;
}

function validFile(s: unknown): s is CreatureStatus {
  const v = s as Record<string, unknown>;
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  if (!validShared(v)) return false;
  if (!isSpeciesId(v.partnerId)) return false;
  if (!v.growth || typeof v.growth !== "object" || Array.isArray(v.growth)) return false;
  const g = v.growth as Record<string, unknown>;
  if (Object.keys(g).length > ROSTER.length) return false;
  for (const k of Object.keys(g)) {
    if (!isSpeciesId(k) || !validGrowth(g[k])) return false;
  }
  return true;
}

function adoptGrowth(g: unknown): CreatureGrowth {
  const v = (g ?? {}) as Partial<CreatureGrowth>;
  return {
    xp: v.xp ?? 0,
    level: v.level ?? 1,
    ...(v.hp !== undefined ? { hp: v.hp } : {}),
    ...(v.statPoints !== undefined ? { statPoints: v.statPoints } : {}),
    ...(v.statBoosts !== undefined ? { statBoosts: v.statBoosts } : {}),
    ...(v.statUpgrades !== undefined ? { statUpgrades: v.statUpgrades } : {}),
    ...(v.statRespecs !== undefined ? { statRespecs: v.statRespecs } : {}),
    ...(v.statGrantedLevel !== undefined ? { statGrantedLevel: v.statGrantedLevel } : {}),
  };
}

function adopted(s: Partial<CreatureStatus>): CreatureStatus {
  const growth: Record<string, CreatureGrowth> = {};
  if (s.growth && typeof s.growth === "object") {
    for (const k of Object.keys(s.growth)) growth[k] = adoptGrowth((s.growth as Record<string, unknown>)[k]);
  }
  return {
    fullness: s.fullness ?? DEFAULT_CREATURE_STATUS.fullness,
    energy: s.energy ?? DEFAULT_CREATURE_STATUS.energy,
    affection: s.affection ?? DEFAULT_CREATURE_STATUS.affection,
    lastTickAt: s.lastTickAt ?? 0,
    lastCareAt: s.lastCareAt ?? 0,
    lastResetDay: s.lastResetDay ?? "",
    partnerId: s.partnerId ?? PARTNER_DEFAULT,
    growth,
  };
}

// PC-1 마이그레이션(한 번, 자동): 옛 성장값은 대표 파트너 몫으로, 옛 종별 boosts는 각 종에 보존.
// 기존 파일은 .bak.json으로 복사 후 변환(삭제 금지).
function migrate(path: string, raw: unknown, hint: string | null): CreatureStatus {
  const v = raw as Record<string, unknown>;
  const rep = hint && isSpeciesId(hint) ? hint : PARTNER_DEFAULT;
  const oldBoosts =
    v.statBoosts && typeof v.statBoosts === "object" && !Array.isArray(v.statBoosts)
      ? (v.statBoosts as Record<string, unknown>)
      : {};
  const growth: Record<string, CreatureGrowth> = {};
  growth[rep] = adoptGrowth({
    xp: v.xp,
    level: v.level,
    hp: v.hp,
    statPoints: v.statPoints,
    statBoosts: oldBoosts[rep],
    statUpgrades: v.statUpgrades,
    statRespecs: v.statRespecs,
    statGrantedLevel: v.statGrantedLevel,
  });
  for (const k of Object.keys(oldBoosts)) {
    if (k !== rep && isSpeciesId(k)) growth[k] = adoptGrowth({ statBoosts: oldBoosts[k] });
  }
  const next = adopted({
    fullness: v.fullness as number,
    energy: v.energy as number,
    affection: v.affection as number,
    lastTickAt: v.lastTickAt as number | undefined,
    lastCareAt: v.lastCareAt as number | undefined,
    lastResetDay: v.lastResetDay as string | undefined,
    partnerId: rep,
    growth,
  });
  if (!validFile(next)) throw new Error("creature status corrupt");
  copyFileSync(path, bakPath(path));
  writeStatus(path, next);
  return next;
}

function readStatus(path: string, hint?: string | null): CreatureStatus {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return adopted({});
    throw e;
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "growth" in raw) {
    if (!validFile(raw)) throw new Error("creature status corrupt");
    return adopted(raw as Partial<CreatureStatus>);
  }
  const v = raw as Record<string, unknown>;
  if (
    !v || typeof v !== "object" || Array.isArray(v) ||
    !validShared(v) || !isCount(v.xp) || !isCount(v.level) || (v.level as number) < 1
  ) {
    throw new Error("creature status corrupt");
  }
  return migrate(path, raw, hint ?? null);
}

function writeStatus(path: string, s: CreatureStatus): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(s));
  renameSync(tmp, path);
}

function viewOf(file: CreatureStatus, speciesId: string): CreatureStatusView {
  const g = file.growth[speciesId] ? adoptGrowth(file.growth[speciesId]) : { ...DEFAULT_GROWTH };
  return {
    fullness: file.fullness,
    energy: file.energy,
    affection: file.affection,
    lastTickAt: file.lastTickAt,
    lastCareAt: file.lastCareAt,
    lastResetDay: file.lastResetDay,
    xp: g.xp,
    level: g.level,
    ...(g.hp !== undefined ? { hp: g.hp } : {}),
    ...(g.statPoints !== undefined ? { statPoints: g.statPoints } : {}),
    ...(g.statBoosts !== undefined ? { statBoosts: g.statBoosts } : {}),
    ...(g.statUpgrades !== undefined ? { statUpgrades: g.statUpgrades } : {}),
    ...(g.statRespecs !== undefined ? { statRespecs: g.statRespecs } : {}),
    ...(g.statGrantedLevel !== undefined ? { statGrantedLevel: g.statGrantedLevel } : {}),
    speciesId,
    partnerId: file.partnerId,
    growth: file.growth,
  };
}

export function readCreatureStatus(speciesId?: string): Promise<CreatureStatusView> {
  return exclusive(() => {
    if (speciesId !== undefined && !isSpeciesId(speciesId)) throw new Error("invalid speciesId");
    const file = readStatus(statusPath(), speciesId ?? null);
    return viewOf(file, speciesId ?? file.partnerId);
  });
}

export type WriteResult = { ok: true; status: CreatureStatusView } | { ok: false; error: string };

const CARE_KEYS = ["fullness", "energy", "affection", "lastTickAt", "lastCareAt", "lastResetDay"] as const;
const SLICE_KEYS = ["xp", "level", "hp", "statPoints", "statBoosts", "statUpgrades", "statRespecs", "statGrantedLevel"] as const;

// 쓰기: 준 필드만 해당 크리처 slice + 공용 돌봄에 덮어쓴다.
// growth 전체가 오면(슬롯 복원) 검증 후 통째로 교체한다.
export function writeCreatureStatus(s: unknown): Promise<WriteResult> {
  return exclusive(() => {
    if (!s || typeof s !== "object" || Array.isArray(s)) return { ok: false as const, error: "invalid status" };
    const v = s as Record<string, unknown>;
    if (v.speciesId !== undefined && !isSpeciesId(v.speciesId)) {
      return { ok: false as const, error: "invalid speciesId" };
    }
    if (v.partnerId !== undefined && !isSpeciesId(v.partnerId)) {
      return { ok: false as const, error: "invalid partnerId" };
    }
    const hint = isSpeciesId(v.speciesId) ? (v.speciesId as string) : null;
    const file = readStatus(statusPath(), hint);
    if (v.growth !== undefined) {
      if (!v.growth || typeof v.growth !== "object" || Array.isArray(v.growth)) {
        return { ok: false as const, error: "invalid status" };
      }
      const ng: Record<string, CreatureGrowth> = {};
      for (const k of Object.keys(v.growth)) {
        if (!isSpeciesId(k)) return { ok: false as const, error: "invalid speciesId" };
        ng[k] = adoptGrowth((v.growth as Record<string, unknown>)[k]);
        if (!validGrowth(ng[k])) return { ok: false as const, error: "invalid status" };
      }
      file.growth = ng;
    }
    const target = hint ?? file.partnerId;
    if (!file.growth[target]) file.growth[target] = { xp: 0, level: 1 };
    const slice: Record<string, unknown> = {};
    for (const k of SLICE_KEYS) if (v[k] !== undefined) slice[k] = v[k];
    // statBoosts: 단일이면 엄격 검증, 옛 Record 모양(옛 슬롯 복원)이면 각 종에 나눠 넣는다.
    if (slice.statBoosts !== undefined && !validBoosts(slice.statBoosts)) {
      const rec = slice.statBoosts as Record<string, unknown>;
      const isSingleShape =
        rec && typeof rec === "object" && !Array.isArray(rec) &&
        ["atk", "hp", "def", "spd"].every((k) => typeof rec[k] === "number");
      if (isSingleShape || !rec || typeof rec !== "object" || Array.isArray(rec)) {
        return { ok: false as const, error: "invalid status" };
      }
      if (!Object.keys(rec).some(isSpeciesId)) {
        return { ok: false as const, error: "invalid status" };
      }
      delete slice.statBoosts;
      for (const k of Object.keys(rec)) {
        if (!isSpeciesId(k)) continue;
        const merged = adoptGrowth({ ...file.growth[k], statBoosts: rec[k] });
        if (!validGrowth(merged)) return { ok: false as const, error: "invalid status" };
        file.growth[k] = merged;
      }
    }
    if (Object.keys(slice).length > 0) {
      const merged = adoptGrowth({ ...file.growth[target], ...slice });
      if (!validGrowth(merged)) return { ok: false as const, error: "invalid status" };
      file.growth[target] = merged;
    }
    const care: Record<string, unknown> = {};
    for (const k of CARE_KEYS) if (v[k] !== undefined) care[k] = v[k];
    if (!validShared({ ...file, ...care })) return { ok: false as const, error: "invalid status" };
    Object.assign(file, care);
    if (v.partnerId !== undefined) file.partnerId = v.partnerId as string;
    if (!validFile(file)) return { ok: false as const, error: "invalid status" };
    writeStatus(statusPath(), file);
    return { ok: true as const, status: viewOf(file, target) };
  });
}

// 접속 tick: 05시 리셋·친밀도 절감·접속중 감소를 적용하고 저장한다.
export function tickStatus(nowMs: number, speciesId?: string): Promise<CreatureStatusView> {
  return exclusive(() => {
    if (speciesId !== undefined && !isSpeciesId(speciesId)) throw new Error("invalid speciesId");
    const file = readStatus(statusPath(), speciesId ?? null);
    const target = speciesId ?? file.partnerId;
    const g = file.growth[target] ? adoptGrowth(file.growth[target]) : { ...DEFAULT_GROWTH };
    const next = applyTick(
      {
        fullness: file.fullness,
        energy: file.energy,
        affection: file.affection,
        xp: g.xp,
        level: g.level,
        ...(g.hp !== undefined ? { hp: g.hp } : {}),
        lastTickAt: file.lastTickAt,
        lastCareAt: file.lastCareAt,
        lastResetDay: file.lastResetDay,
      },
      nowMs
    );
    file.fullness = next.fullness;
    file.energy = next.energy;
    file.affection = next.affection;
    file.lastTickAt = next.lastTickAt;
    file.lastCareAt = next.lastCareAt;
    file.lastResetDay = next.lastResetDay;
    writeStatus(statusPath(), file);
    return viewOf(file, target);
  });
}

// 교감 1회: lastCareAt만 갱신한다. useCare 성공 뒤에 호출한다.
export function touchCareAt(nowMs: number): Promise<CreatureStatusView> {
  return exclusive(() => {
    const file = readStatus(statusPath());
    file.lastCareAt = nowMs;
    writeStatus(statusPath(), file);
    return viewOf(file, file.partnerId);
  });
}

// 충전 적립 1회: 그 크리처 hp를 최대치로 채우고 기절을 푼다. duplicate 신호에는 호출하지 않는다.
export function healToMax(maxHp: number, speciesId?: string): Promise<CreatureStatusView> {
  return exclusive(() => {
    if (!Number.isFinite(maxHp)) throw new Error("invalid maxHp");
    if (speciesId !== undefined && !isSpeciesId(speciesId)) throw new Error("invalid speciesId");
    const file = readStatus(statusPath(), speciesId ?? null);
    const target = speciesId ?? file.partnerId;
    const g = file.growth[target] ? adoptGrowth(file.growth[target]) : { ...DEFAULT_GROWTH };
    g.hp = Math.max(0, Math.floor(maxHp));
    file.growth[target] = g;
    writeStatus(statusPath(), file);
    return viewOf(file, target);
  });
}
