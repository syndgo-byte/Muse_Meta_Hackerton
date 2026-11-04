// 충전 경로 안내 카드 (§11·§14 항목 2). "충전 방법 보기" 링크로 열린다.
// 미설정 출처 항목은 숨긴다 (오류 화면 없음).
"use client";
import { useEffect, useState } from "react";
import { CREDIT_RATE, CREDIT_VISIT } from "@/lib/token/config";

type Trend = { storeName: string; category: string; score: number };

export default function ChargeGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [trends, setTrends] = useState<Trend[]>([]);
  useEffect(() => {
    if (!open) return;
    fetch("/api/token/sources", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { trends?: unknown }) => {
        if (Array.isArray(d?.trends)) {
          setTrends(
            (d.trends as Array<Record<string, unknown>>)
              .filter((t) => typeof t.storeName === "string")
              .slice(0, 3)
              .map((t) => ({
                storeName: t.storeName as string,
                category: typeof t.category === "string" ? t.category : "",
                score: typeof t.score === "number" ? t.score : 0,
              }))
          );
        }
      })
      .catch(() => {
        /* 조회 실패 시 목록 숨김 */
      });
  }, [open ]);
  if (!open) return null;
  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 60,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
      onClick={onClose}
    >
      <div
        className="glass-panel"
        style={{ maxWidth: 420, width: "100%", padding: "18px 20px" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 10 }}>토큰 충전 방법 (시연)</div>
        <div style={{ fontSize: 13, lineHeight: 2 }}>
          <div>매장 결제 시 {Math.round(CREDIT_RATE * 100)}% 충전</div>
          <div>핫플 방문 +{CREDIT_VISIT}</div>
          <div>이벤트 참여 시 추가 충전</div>
        </div>
        {trends.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85 }}>
            <div style={{ fontWeight: 800, marginBottom: 4 }}>지금 뜨는 핫플 (시연)</div>
            {trends.map((t) => (
              <div key={t.storeName}>
                {t.storeName} · {t.category}
              </div>
            ))}
          </div>
        )}
        <button onClick={onClose} className="glass-btn" style={{ marginTop: 14, width: "100%", fontSize: 13 }}>
          닫기
        </button>
      </div>
    </div>
  );
}
