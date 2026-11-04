"use client";
import { useEffect, useState } from "react";
import { EXTERNAL_REGISTRY } from "@/lib/external/registry";

// EX-3: 접히는 "외부 연결" 패널. 항목별 상태 점 + 목적 + 나가는 데이터.
// 키 값은 절대 표시하지 않는다.
type HealthItem = {
  id: string;
  configured: boolean;
  status: "ready" | "not_configured" | "unreachable" | "fallback";
  lastLatencyMs: number | null;
  calls: number;
  fallbacks: number;
};

const DOT: Record<HealthItem["status"], string> = {
  ready: "#3ddc84",
  not_configured: "#8a8f98",
  unreachable: "#ff5a5a",
  fallback: "#ffd84a",
};

const STATUS_KO: Record<HealthItem["status"], string> = {
  ready: "연결됨",
  not_configured: "미설정",
  unreachable: "끊김",
  fallback: "대체 중",
};

export default function ExternalPanel() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<HealthItem[] | null>(null);
  const [err, setErr] = useState(false);

  // AF-1a: 응답이 안 오면 8초 후 중단하고 "확인 불가"로 끝낸다 (무한 "불러오는 중..." 방지).
  // /api/health/external 자체는 3초 핑 타임아웃 후 항상 JSON을 돌려주므로, 멈춤은 fetch 무한 대기가 원인.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const ctl = new AbortController();
    const timer = window.setTimeout(() => ctl.abort(), 8000);
    fetch("/api/health/external", { cache: "no-store", signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive) return;
        if (j && Array.isArray(j.items)) setItems(j.items as HealthItem[]);
        else setErr(true);
      })
      .catch(() => {
        if (alive) setErr(true);
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      alive = false;
      ctl.abort();
      window.clearTimeout(timer);
    };
  }, [open ]);

  return (
    <div className="glass-panel" style={{ padding: "12px 16px", marginBottom: 14 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="glass-btn"
        style={{ width: "100%", fontSize: 14, fontWeight: 800 }}
        aria-expanded={open}
      >
        {open ? "외부 연결 닫기 ▲" : "외부 연결 보기 ▼"}
      </button>
      {open && (
        <div style={{ marginTop: 10 }}>
          {err && <div style={{ fontSize: 13, opacity: 0.7 }}>외부 연결 상태를 확인할 수 없어요 (확인 불가)</div>}
          {!err && items === null && <div style={{ fontSize: 13, opacity: 0.7 }}>불러오는 중...</div>}
          {(items ?? []).map((h) => {
            const meta = EXTERNAL_REGISTRY.find((e) => e.id === h.id);
            return (
              <div
                key={h.id}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                  padding: "8px 0",
                  borderTop: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <span
                  role="img"
                  aria-label={STATUS_KO[h.status]}
                  style={{
                    flexShrink: 0,
                    marginTop: 4,
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: DOT[h.status],
                  }}
                />
                <div style={{ fontSize: 12, lineHeight: 1.5, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 13 }}>
                    {h.id} <span style={{ fontWeight: 400, opacity: 0.65 }}>· {STATUS_KO[h.status]}</span>
                  </div>
                  <div style={{ opacity: 0.85 }}>{meta?.purpose ?? ""}</div>
                  <div style={{ opacity: 0.65 }}>나가는 데이터: {meta?.sends ?? ""}</div>
                  <div style={{ opacity: 0.5, fontSize: 11 }}>
                    호출 {h.calls}회 · 대체 {h.fallbacks}회
                    {h.lastLatencyMs !== null ? ` · 마지막 지연 ${h.lastLatencyMs}ms` : ""}
                  </div>
                </div>
              </div>
            );
          })}
          <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700, color: "#9fe870" }}>
            AI가 끊겨도 게임은 계속됩니다
          </div>
        </div>
      )}
    </div>
  );
}
