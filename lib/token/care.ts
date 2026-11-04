// 기본 교감 하루 무료 횟수 (TOKEN_WORKORDER §10).
// 밥 먹이기·놀아주기·낮잠 자기는 행동별 하루 무료 횟수를 쓰고, 소진 후에는
// COST_CARE_EXTRA 토큰으로 추가 1회씩 산다. 날짜는 서버 시각 기준.
// 횟수 차감과 토큰 차감은 원장과 같은 exclusive 안에서 처리한다 (원자성).
// Node 전용. 독립 tsc 컴파일을 위해 상대 import만 쓴다.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  COST_CARE_EXTRA,
  FREE_FEED_PER_DAY,
  FREE_PLAY_PER_DAY,
  FREE_SLEEP_PER_DAY,
} from "./config";
import { exclusive, loadEntries, saveEntries, sumEntries } from "./ledger";
import { kstDay5am } from "../status/decay";

export type CareAction = "feed" | "play" | "sleep";
const FREE_OF: Record<CareAction, number> = {
  feed: FREE_FEED_PER_DAY,
  play: FREE_PLAY_PER_DAY,
  sleep: FREE_SLEEP_PER_DAY,
};

export function careQuotaPath(): string {
  const override = process.env.CARE_QUOTA_PATH;
  if (override && override.length > 0) return override;
  return join(process.cwd(), "data", "care-quota.json");
}

export type CareQuota = { date: string; feed: number; play: number; sleep: number };

// 무료 횟수 리셋 경계: 05시 기준 KST 날짜 (D4-3, CREATURE_STATUS §2-2).
// 테스트는 CARE_TEST_TODAY로 날짜를 고정한다.
export function todayStr(): string {
  const forced = process.env.CARE_TEST_TODAY;
  if (forced && /^\d{4}-\d{2}-\d{2}$/.test(forced)) return forced;
  return kstDay5am(Date.now());
}

function freshQuota(date: string): CareQuota {
  return { date, feed: 0, play: 0, sleep: 0 };
}

function loadQuota(path: string): CareQuota {
  try {
    const q = JSON.parse(readFileSync(path, "utf8")) as CareQuota;
    if (
      typeof q?.date !== "string" ||
      !Number.isInteger(q.feed) ||
      !Number.isInteger(q.play) ||
      !Number.isInteger(q.sleep)
    ) {
      throw new Error("care quota corrupt");
    }
    return q;
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return freshQuota(todayStr());
    throw e;
  }
}

function saveQuota(path: string, q: CareQuota): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(q));
  renameSync(tmp, path);
}

export type CareUseResult =
  | { ok: true; free: boolean; remainingFree: number; balance: number }
  | { ok: false; error: string; locked: boolean; balance: number; remainingFree: number };

// 교감 1회 사용. 무료 횟수가 남으면 횟수만 차감하고, 소진 시 토큰으로 산다.
// 잔량도 모자라면 locked (호출자는 §4 안내를 띄운다).
export function useCare(action: unknown): Promise<CareUseResult> {
  return exclusive(() => {
    if (action !== "feed" && action !== "play" && action !== "sleep") {
      return {
        ok: false as const,
        error: "action must be feed|play|sleep",
        locked: false,
        balance: sumEntries(loadEntries()),
        remainingFree: 0,
      };
    }
    const path = careQuotaPath();
    const today = todayStr();
    let q = loadQuota(path);
    if (q.date !== today) q = freshQuota(today);
    const freeMax = FREE_OF[action];
    if (q[action] < freeMax) {
      q[action] += 1;
      saveQuota(path, q);
      return {
        ok: true as const,
        free: true,
        remainingFree: freeMax - q[action],
        balance: sumEntries(loadEntries()),
      };
    }
    const entries = loadEntries();
    const bal = sumEntries(entries);
    if (bal < COST_CARE_EXTRA) {
      return {
        ok: false as const,
        error: "insufficient",
        locked: true,
        balance: bal,
        remainingFree: 0,
      };
    }
    entries.push({
      id: randomUUID(),
      type: "spend",
      amount: COST_CARE_EXTRA,
      reason: `care-extra:${action}`,
      ts: Date.now(),
    });
    saveEntries(entries);
    return { ok: true as const, free: false, remainingFree: 0, balance: bal - COST_CARE_EXTRA };
  });
}

export type CareStatus = {
  date: string;
  remaining: Record<CareAction, number>;
  balance: number;
};

// 조회만 한다 (리셋 저장을 하지 않는다).
export function careStatus(): Promise<CareStatus> {
  return exclusive(() => {
    const today = todayStr();
    let q: CareQuota;
    try {
      q = loadQuota(careQuotaPath());
    } catch {
      q = freshQuota(today);
    }
    if (q.date !== today) q = freshQuota(today);
    return {
      date: today,
      remaining: {
        feed: Math.max(0, FREE_OF.feed - q.feed),
        play: Math.max(0, FREE_OF.play - q.play),
        sleep: Math.max(0, FREE_OF.sleep - q.sleep),
      },
      balance: sumEntries(loadEntries()),
    };
  });
}
