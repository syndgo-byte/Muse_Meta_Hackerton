// Raw API outputs -> readable game cards. Never throws: falls back to raw text.
export function fmtCreature(data: unknown): { title: string; lines: string[] } {
  try {
    const c = (data as { creature?: Record<string, unknown> }).creature ?? data;
    const g = (k: string) => String((c as Record<string, unknown>)[k] ?? "-");
    return {
      title: `새 크리처: ${g("name")}`,
      lines: [`속성 ${g("element")} · 성격 ${g("personality")}`, `공격 ${g("attack")} / 방어 ${g("defense")}`, g("flavor")],
    };
  } catch {
    return { title: "결과", lines: [String(data).slice(0, 300)] };
  }
}

export function fmtFeed(data: unknown): { title: string; lines: string[] } {
  try {
    const r = (data as { result?: Record<string, unknown> }).result ?? data;
    const g = (k: string) => String((r as Record<string, unknown>)[k] ?? "-");
    return {
      title: `냠냠! ${g("food")}`,
      lines: [`포만감 ${g("fullness")} · 친밀도 ${g("affection")}`, `버프: ${g("buff")}`, g("note")],
    };
  } catch {
    return { title: "결과", lines: [String(data).slice(0, 300)] };
  }
}

export function fmtBattle(data: unknown): { title: string; lines: string[] } {
  try {
    const r = (data as { result?: Record<string, unknown> }).result ?? data;
    const turns = ((r as Record<string, unknown>).turns as string[]) ?? [];
    const winner = String((r as Record<string, unknown>).winner ?? "?");
    const comment = String((r as Record<string, unknown>).comment ?? "");
    return {
      title: winner === "mine" ? "승리!" : winner === "wild" ? "패배..." : "배틀 종료",
      lines: [...turns.map((t, i) => `${i + 1}턴 ${t}`), comment],
    };
  } catch {
    return { title: "결과", lines: [String(data).slice(0, 300)] };
  }
}
