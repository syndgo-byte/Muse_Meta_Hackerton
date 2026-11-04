// lib/encounter/snapshots.ts — G4 시연용 상대 스냅샷 5개 (BATTLE_DESIGN §15-3 1단계).
// 서버 없음. 개인정보(이름·사진·위치) 없음. 별명+크리처 정보만.
// 화면에는 "시연용 상대" 표시를 붙인다.

export interface RivalSnapshot {
  nickname: string;
  speciesId: string;
  level: number;
  boosts: { atk: number; hp: number; def: number; spd: number };
  note: string;
}

export const RIVAL_SNAPSHOTS: RivalSnapshot[] = [
  { nickname: "달리기왕", speciesId: "wind-01", level: 5, boosts: { atk: 1, hp: 0, def: 0, spd: 2 }, note: "시연용 상대" },
  { nickname: "돌벽", speciesId: "rock-01", level: 6, boosts: { atk: 0, hp: 5, def: 2, spd: 0 }, note: "시연용 상대" },
  { nickname: "물장구", speciesId: "water-04", level: 4, boosts: { atk: 1, hp: 0, def: 1, spd: 1 }, note: "시연용 상대" },
  { nickname: "불꽃튀김", speciesId: "fire-02", level: 7, boosts: { atk: 2, hp: 0, def: 0, spd: 1 }, note: "시연용 상대" },
  { nickname: "풀잎검사", speciesId: "grass-05", level: 5, boosts: { atk: 2, hp: 5, def: 0, spd: 0 }, note: "시연용 상대" },
];
