"use client";

// EX-2: AI 대신 규칙 기반 대체 결과가 나왔음을 알리는 작은 회색 칩 (10~11px).
export default function OfflineChip() {
  return (
    <span
      aria-label="AI 대신 규칙 기반 대체 결과"
      style={{
        display: "inline-block",
        fontSize: 10,
        lineHeight: 1.4,
        color: "#9aa3ad",
        background: "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.16)",
        borderRadius: 4,
        padding: "0 5px",
        marginLeft: 6,
        verticalAlign: "middle",
        whiteSpace: "nowrap",
      }}
    >
      오프라인
    </span>
  );
}
