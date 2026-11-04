// components/battle/Chips.tsx — 단계·저항 칩 + 상태 아이콘 (HP 바 아래).
"use client";

import { ELEMENT_FX_COLOR, STATUS_ELEMENT, STATUS_LABEL } from "./fx";

const STAGE_SHORT: Record<string, string> = { ATK: "공", DEF: "방", SPD: "속", ACC: "명" };
const EL_KO: Record<string, string> = { fire: "불", grass: "풀", water: "물", rock: "바위", wind: "바람" };

const chip: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  fontFamily: "var(--battle-font)",
  fontVariantNumeric: "tabular-nums",
  borderRadius: 6,
  padding: "1px 6px",
  border: "1px solid var(--battle-edge)",
  background: "var(--battle-panel)",
  color: "#fff",
  whiteSpace: "nowrap",
};

export default function Chips({
  stages,
  resists,
  status,
}: {
  stages: Partial<Record<string, number>>;
  resists: Partial<Record<string, number>>;
  status: string | null;
}) {
  const stageChips = Object.entries(stages).filter(([, v]) => (v ?? 0) !== 0);
  const resistChips = Object.entries(resists).filter(([, v]) => (v ?? 0) !== 0);
  if (stageChips.length === 0 && resistChips.length === 0 && !status) return null;
  return (
    <div className="bp3-chip-pop" style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
      {stageChips.map(([k, v]) => (
        <span key={k} style={chip}>
          {STAGE_SHORT[k] ?? k}
          {(v ?? 0) > 0 ? "▲" : "▼"}
          {Math.abs(v ?? 0) > 1 ? Math.abs(v ?? 0) : ""}
        </span>
      ))}
      {resistChips.map(([el, v]) => (
        <span key={el} style={{ ...chip, borderColor: ELEMENT_FX_COLOR[el] ?? "#fff", color: ELEMENT_FX_COLOR[el] ?? "#fff" }}>
          {EL_KO[el] ?? el}
          {(v ?? 0) > 0 ? "+" : ""}
          {v}
        </span>
      ))}
      {status && (
        <span
          style={{
            ...chip,
            borderColor: ELEMENT_FX_COLOR[STATUS_ELEMENT[status]] ?? "#fff",
            color: ELEMENT_FX_COLOR[STATUS_ELEMENT[status]] ?? "#fff",
          }}
        >
          {STATUS_LABEL[status] ?? status}
        </span>
      )}
    </div>
  );
}
