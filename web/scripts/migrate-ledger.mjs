// TOKEN_WORKORDER §2-1a: JSON 원장 → SQLite 1회 이관.
// 실행: node scripts/migrate-ledger.mjs
// TOKEN_LEDGER_JSON(원본, 기본 data/token-ledger.json)과
// TOKEN_LEDGER_PATH(대상 sqlite, 기본 data/token.sqlite)를 본다.
// 두 번 실행해도 중복이 생기지 않는다 (id OR IGNORE + 원본 rename).
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = process.cwd();
const SRC = process.env.TOKEN_LEDGER_JSON ?? join(ROOT, "data", "token-ledger.json");
const DST = process.env.TOKEN_LEDGER_PATH ?? join(ROOT, "data", "token.sqlite");

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

const CATS = ["coffee", "food", "alcohol", "other"];

function spendSourceOf(reason) {
  const r = String(reason ?? "").trim();
  if (r.startsWith("upgrade:")) return "spend_upgrade";
  if (r.startsWith("diary-image")) return "spend_diary_image";
  if (r.startsWith("care-extra")) return "spend_care_extra";
  if (r.startsWith("dance")) return "spend_dance";
  if (r.startsWith("motion-gen") || r.startsWith("motion:")) return "spend_motion_gen";
  if (r.startsWith("ai:")) return "spend_ai";
  return "spend_ai";
}

// 적립 reason "매장명 카테고리 금액원"을 역추적. 매장명에 공백이 있을 수 있어 뒤에서 자른다.
function parseCredit(reason) {
  const m = /^(.*) (\S+) (\d+)원$/.exec(String(reason ?? "").trim());
  if (!m) return { storeName: "매장", category: "other" };
  const category = CATS.includes(m[2]) ? m[2] : "other";
  return { storeName: m[1].length > 0 ? m[1] : "매장", category };
}

function main() {
  if (!existsSync(SRC)) {
    console.log(`migrate-ledger: 원본 없음 (${SRC}). ${existsSync(DST) ? "이미 이관된 상태." : "이관할 것도 없음."}`);
    return;
  }
  const arr = JSON.parse(readFileSync(SRC, "utf8"));
  if (!Array.isArray(arr)) throw new Error("ledger json is not an array");
  mkdirSync(dirname(DST), { recursive: true });
  const db = new DatabaseSync(DST);
  try {
    db.exec(SCHEMA);
    const ins = db.prepare(
      "INSERT OR IGNORE INTO ledger (id, type, amount, ts, action, reason, storeName, category, signalId, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    let added = 0;
    for (const e of arr) {
      const type = e.type === "credit" ? "credit" : "spend";
      let action = "credit";
      let source = "store_payment";
      let storeName = null;
      let category = null;
      if (type === "spend") {
        const reason = String(e.reason ?? "");
        const i = reason.indexOf(":");
        action = i > 0 ? reason.slice(0, i) : reason;
        source = spendSourceOf(reason);
      } else {
        const pc = parseCredit(e.reason);
        storeName = pc.storeName;
        category = pc.category;
      }
      const r = ins.run(
        String(e.id), type, Number(e.amount), Number(e.ts), action,
        String(e.reason ?? ""), storeName, category,
        typeof e.signalId === "string" ? e.signalId : null, source
      );
      if (Number(r.changes) === 1) added += 1;
    }
    const bak = `${SRC}.bak`;
    rmSync(bak, { force: true });
    renameSync(SRC, bak);
    console.log(`migrate-ledger: ${arr.length}건 중 ${added}건 추가, 원본 → ${bak}`);
  } finally {
    db.close();
  }
}

main();
