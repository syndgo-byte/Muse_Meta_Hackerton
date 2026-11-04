// 크리처 수치 조회 클라이언트. 저장은 saveStatus(lib/state.ts)가 이중 기록한다.
export type RemoteStatus = {
  fullness: number;
  energy: number;
  affection: number;
  xp: number;
  level: number;
  hp?: number;
  // G3 스탯 포인트 (서버 직통, 검증은 서버가 한다). PC-1: 요청 크리처 1마리분.
  statPoints?: number;
  statBoosts?: { atk: number; hp: number; def: number; spd: number };
  statUpgrades?: number;
  statRespecs?: number;
  statGrantedLevel?: number;
  speciesId?: string;
  growth?: Record<string, { xp: number; level: number }>;
};

// PC-1: speciesId를 주면 그 크리처 성장값으로 펼친 뷰를 준다. 없으면 대표 파트너.
export async function fetchStatus(speciesId?: string): Promise<RemoteStatus> {
  const url = speciesId ? `/api/status?speciesId=${encodeURIComponent(speciesId)}` : "/api/status";
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`status ${res.status}`);
  const d = (await res.json()) as Record<string, unknown>;
  for (const k of ["fullness", "energy", "affection", "xp", "level"] as const) {
    if (typeof d[k] !== "number") throw new Error("status invalid");
  }
  const out: RemoteStatus = {
    fullness: d.fullness as number,
    energy: d.energy as number,
    affection: d.affection as number,
    xp: d.xp as number,
    level: d.level as number,
  };
  if (typeof d.hp === "number") out.hp = d.hp;
  for (const k of ["statPoints", "statUpgrades", "statRespecs", "statGrantedLevel"] as const) {
    if (typeof d[k] === "number") (out[k] as number) = d[k] as number;
  }
  if (d.statBoosts && typeof d.statBoosts === "object" && !Array.isArray(d.statBoosts)) {
    const b = d.statBoosts as Record<string, unknown>;
    if (typeof b.atk === "number" && typeof b.hp === "number" && typeof b.def === "number" && typeof b.spd === "number") {
      out.statBoosts = { atk: b.atk, hp: b.hp, def: b.def, spd: b.spd };
    }
  }
  if (typeof d.speciesId === "string") out.speciesId = d.speciesId;
  if (d.growth && typeof d.growth === "object" && !Array.isArray(d.growth)) {
    out.growth = d.growth as RemoteStatus["growth"];
  }
  return out;
}
