// 뮤즈 AI 토큰 서버 원장 (TOKEN_WORKORDER §5, §2-1a SQLite 전환).
// 파일: data/token.sqlite (테스트는 TOKEN_LEDGER_PATH로 격리).
// 모든 쓰기는 모듈 내 promise 체인으로 순차 처리한다 (동시 차감 시 음수 방지).
// Node 전용 (node:sqlite 사용). 독립 tsc 컴파일을 위해 상대 import만 쓴다.
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CREDIT_RATE, TOKEN_CATEGORIES } from "./config";

export type LedgerType = "credit" | "spend";
export type LedgerSource =
  | "store_payment" | "visit" | "event"
  | "spend_upgrade" | "spend_diary_image" | "spend_care_extra"
  | "spend_dance" | "spend_motion_gen" | "spend_ai";
export type LedgerEntry = {
  id: string;
  type: LedgerType;
  amount: number;
  reason: string;
  signalId?: string;
  ts: number;
  // SQLite 확장 컬럼 (§2-1a). JSON 시절 항목에는 없을 수 있어 optional.
  action?: string;
  source?: LedgerSource;
  storeName?: string;
  category?: string;
};

const SOURCES: readonly LedgerSource[] = [
  "store_payment", "visit", "event",
  "spend_upgrade", "spend_diary_image", "spend_care_extra",
  "spend_dance", "spend_motion_gen", "spend_ai",
];

export function ledgerPath(): string {
  const override = process.env.TOKEN_LEDGER_PATH;
  if (override && override.length > 0) return override;
  return join(process.cwd(), "data", "token.sqlite");
}

// 순차 실행 뮤텍스: 체인이 끊어지지 않게 실패는 삼켜서 다음으로 넘긴다.
// care.ts와 같은 체인을 공유한다 (횟수·토큰 원자 처리, 중첩 잠금 금지).
let chain: Promise<unknown> = Promise.resolve();
export function exclusive<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = chain.then(fn);
  chain = run.catch(() => undefined);
  return run;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ledger (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('credit','spend')),
  amount INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  storeName TEXT,
  category TEXT,
  signalId TEXT UNIQUE,
  source TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_ts ON ledger (ts);
`;

function openDb(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

// reason 접두 → source. 앱의 모든 차감 경로는 아래 접두 중 하나를 쓴다.
// 모르는 접두(테스트용 test:* 등)는 spend_ai로 둔다 (거부하지 않음, 기존 동작 유지).
export function spendSourceOf(reason: string): LedgerSource {
  const r = reason.trim();
  if (r.startsWith("upgrade:")) return "spend_upgrade";
  if (r.startsWith("diary-image")) return "spend_diary_image";
  if (r.startsWith("care-extra")) return "spend_care_extra";
  if (r.startsWith("dance")) return "spend_dance";
  if (r.startsWith("motion-gen") || r.startsWith("motion:")) return "spend_motion_gen";
  if (r.startsWith("ai:")) return "spend_ai";
  return "spend_ai";
}

function actionOf(type: LedgerType, reason: string): string {
  if (type === "credit") return "credit";
  const i = reason.indexOf(":");
  return i > 0 ? reason.slice(0, i) : reason;
}

type Row = {
  id: string;
  type: LedgerType;
  amount: number;
  ts: number;
  action: string;
  reason: string;
  storeName: string | null;
  category: string | null;
  signalId: string | null;
  source: LedgerSource;
};

function toEntry(r: Row): LedgerEntry {
  const e: LedgerEntry = {
    id: r.id,
    type: r.type,
    amount: r.amount,
    reason: r.reason,
    ts: r.ts,
    action: r.action,
    source: r.source,
  };
  if (r.signalId !== null) e.signalId = r.signalId;
  if (r.storeName !== null) e.storeName = r.storeName;
  if (r.category !== null) e.category = r.category;
  return e;
}

function fullRow(e: LedgerEntry): Row {
  const src: LedgerSource =
    e.source && (SOURCES as readonly string[]).includes(e.source)
      ? e.source
      : e.type === "credit"
        ? "store_payment"
        : spendSourceOf(e.reason);
  return {
    id: e.id,
    type: e.type,
    amount: e.amount,
    ts: e.ts,
    action: e.action ?? actionOf(e.type, e.reason),
    reason: e.reason,
    storeName: e.storeName ?? null,
    category: e.category ?? null,
    signalId: e.signalId ?? null,
    source: src,
  };
}

// 저수준 입출력 (care.ts가 같은 exclusive 안에서 호출, 잠금 없이 직접 쓰지 말 것).
export function loadEntries(): LedgerEntry[] {
  const db = openDb(ledgerPath());
  try {
    const rows = db
      .prepare(
        "SELECT id, type, amount, ts, action, reason, storeName, category, signalId, source FROM ledger ORDER BY rowid"
      )
      .all() as unknown as Row[];
    return rows.map(toEntry);
  } finally {
    db.close();
  }
}

export function saveEntries(entries: LedgerEntry[]): void {
  const db = openDb(ledgerPath());
  try {
    db.exec("DELETE FROM ledger");
    const ins = db.prepare(
      "INSERT INTO ledger (id, type, amount, ts, action, reason, storeName, category, signalId, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    for (const e of entries) {
      const r = fullRow(e);
      ins.run(r.id, r.type, r.amount, r.ts, r.action, r.reason, r.storeName, r.category, r.signalId, r.source);
    }
  } finally {
    db.close();
  }
}

export function sumEntries(entries: LedgerEntry[]): number {
  let b = 0;
  for (const e of entries) b += e.type === "credit" ? e.amount : -e.amount;
  return b;
}

export type CreditInput = {
  signalId: unknown;
  storeName: unknown;
  category: unknown;
  amountKrw: unknown;
};
export type CreditResult =
  | { ok: true; duplicate: boolean; tokens: number; balance: number }
  | { ok: false; error: string };

// 적립량 = round(amountKrw × CREDIT_RATE). 카테고리와 무관하게 동일.
// 같은 signalId는 두 번 적립하지 않는다.
export function credit(input: CreditInput): Promise<CreditResult> {
  return exclusive(() => {
    const signalId = typeof input.signalId === "string" ? input.signalId.trim() : "";
    if (!signalId) return { ok: false as const, error: "signalId required" };
    const category = typeof input.category === "string" ? input.category : "";
    if (!(TOKEN_CATEGORIES as readonly string[]).includes(category)) {
      return { ok: false as const, error: "category must be coffee|food|alcohol|other" };
    }
    const amountKrw = input.amountKrw;
    if (typeof amountKrw !== "number" || !Number.isFinite(amountKrw) || amountKrw <= 0) {
      return { ok: false as const, error: "amountKrw must be a number > 0" };
    }
    const storeName =
      typeof input.storeName === "string" && input.storeName.trim().length > 0
        ? input.storeName.trim().slice(0, 120)
        : "매장";
    const db = openDb(ledgerPath());
    try {
      const dup = db.prepare("SELECT 1 AS one FROM ledger WHERE signalId = ?").get(signalId) !== undefined;
      const tokens = Math.round(amountKrw * CREDIT_RATE);
      if (dup) {
        return { ok: true as const, duplicate: true, tokens: 0, balance: sumRows(db) };
      }
      try {
        db.prepare(
          "INSERT INTO ledger (id, type, amount, ts, action, reason, storeName, category, signalId, source) VALUES (?, 'credit', ?, ?, 'credit', ?, ?, ?, ?, 'store_payment')"
        ).run(randomUUID(), tokens, Date.now(), `${storeName} ${category} ${amountKrw}원`, storeName, category, signalId);
      } catch {
        // UNIQUE 경합: 이미 들어갔으면 중복으로 처리.
        return { ok: true as const, duplicate: true, tokens: 0, balance: sumRows(db) };
      }
      return { ok: true as const, duplicate: false, tokens, balance: sumRows(db) };
    } finally {
      db.close();
    }
  });
}

function sumRows(db: DatabaseSync): number {
  const row = db
    .prepare("SELECT COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END), 0) AS b FROM ledger")
    .get() as unknown as { b: number };
  return row.b;
}

export type SpendResult =
  | { ok: true; spent: number; balance: number }
  | { ok: false; error: string; balance: number };

// 차감: 잔량 검사와 기록을 뮤텍스 안에서 한 번에 처리한다.
export function spend(amount: unknown, reason: unknown): Promise<SpendResult> {
  return exclusive(() => {
    const db = openDb(ledgerPath());
    try {
      const balance = sumRows(db);
      if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
        return { ok: false as const, error: "amount must be a positive integer", balance };
      }
      const r = typeof reason === "string" ? reason.trim().slice(0, 200) : "";
      if (!r) return { ok: false as const, error: "reason required", balance };
      if (balance < amount) return { ok: false as const, error: "insufficient", balance };
      db.prepare(
        "INSERT INTO ledger (id, type, amount, ts, action, reason, storeName, category, signalId, source) VALUES (?, 'spend', ?, ?, ?, ?, NULL, NULL, NULL, ?)"
      ).run(randomUUID(), amount, Date.now(), actionOf("spend", r), r, spendSourceOf(r));
      return { ok: true as const, spent: amount, balance: balance - amount };
    } finally {
      db.close();
    }
  });
}

export function balance(): Promise<number> {
  return exclusive(() => {
    const db = openDb(ledgerPath());
    try {
      return sumRows(db);
    } finally {
      db.close();
    }
  });
}

export function entries(): Promise<LedgerEntry[]> {
  return exclusive(() => loadEntries());
}

// 내역 조회 (§2-1). 최신순, limit 기본 5·최대 50. 읽기 전용 (쓰기 경로 불변).
// 응답 형식 유지: id·type·amount·reason·signalId?·ts만 돌려준다.
export function readHistory(limit: number): Promise<LedgerEntry[]> {
  return exclusive(() => {
    let n = Math.floor(limit);
    if (!Number.isFinite(n)) n = 5;
    n = Math.min(50, Math.max(1, n));
    const db = openDb(ledgerPath());
    try {
      const rows = db
        .prepare("SELECT id, type, amount, reason, signalId, ts FROM ledger ORDER BY ts DESC, rowid DESC LIMIT ?")
        .all(n) as unknown as Array<{
        id: string;
        type: LedgerType;
        amount: number;
        reason: string;
        signalId: string | null;
        ts: number;
      }>;
      return rows.map((r) => {
        const e: LedgerEntry = { id: r.id, type: r.type, amount: r.amount, reason: r.reason, ts: r.ts };
        if (r.signalId !== null) e.signalId = r.signalId;
        return e;
      });
    } finally {
      db.close();
    }
  });
}
