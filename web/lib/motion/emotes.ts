// 작업 1b: 감정 모션 데이터 단일 표.
// - autoRig.poseFor: EMOTE_BONES → 본 회전(rx/ry/rz) + 몸통 스쿼시.
// - puppetRig.update: EMOTE_RIGID → 전신 리지드(y/rx/ry/rz/z).
// - PovCreature: EMOTE_DUR(지속시간) + EMOTE_FACE(표정) + EMOTE_LOCO(이동 여부).
// 수치는 기존 3곳의 식에서 그대로 옮김. 1c에서 의도된 변경 적용
// (1c-1 attack, 1c-2 시간축 e, 1c-3 주파수). 식 형태는 유지한다.
import type { EyeState, MouthState } from "../facePaint";

export type EmoteId =
  | "idle" | "beg" | "want" | "hungry" | "happy" | "cry" | "hurt"
  | "sleep" | "eat" | "chomp" | "fetch" | "greet" | "roam" | "attack"
  | "drowsy" | "zoomies" | "pat" | "cuddle" | "faint";

export const EMOTE_IDS: readonly EmoteId[] = [
  "idle", "beg", "want", "hungry", "happy", "cry", "hurt", "sleep",
  "eat", "chomp", "fetch", "greet", "roam", "attack", "drowsy",
  "zoomies", "pat", "cuddle", "faint",
];

// PovCreature에서 이동 (값 동일).
export const EMOTE_DUR: Record<EmoteId, number> = {
  idle: Infinity, beg: 2.0, want: 2.0, hungry: 2.2, happy: 1.8, cry: 2.0,
  hurt: 1.3, sleep: 4.0, eat: 1.6, chomp: 2.4, fetch: 1.8, greet: 1.6, roam: 6.0, attack: 1.1,
  drowsy: 4.0, zoomies: 3.2, pat: 2.2, cuddle: 2.6, faint: 2.0,
};

// ---------- 본 채널 (autoRig.poseFor) ----------
// 항목이 없는 채널은 기본 서 있기 값을 유지한다 (덮어쓰지 않음).
// 1c-2: clock 미지정 시 "e" (감정 경과시간). "t"는 씬 시계.
// (걷기·춤·베이스 호흡은 표 밖에 있어 항상 기존 시간축을 쓴다.)
export type Clock = "t" | "e";
export type BoneCh = { clock?: Clock } & (
  | { op: "const"; v: number }
  | { op: "sin"; base: number; amp: number; f: number; ph?: number }
  | { op: "abs"; base: number; amp: number; f: number; ph?: number }
  | { op: "pulse"; scale: number }
  | { op: "reach"; scale: number }
  | { op: "reachAbs"; rs: number; as: number; f: number }
);

export type BoneAxes = { rx?: BoneCh; ry?: BoneCh; rz?: BoneCh };
export type BonesDef = {
  torso?: BoneAxes; head?: BoneAxes;
  legL?: BoneAxes; legR?: BoneAxes; armL?: BoneAxes; armR?: BoneAxes;
  tail?: BoneAxes;
  sx?: BoneCh; sy?: BoneCh; sz?: BoneCh;
  reach?: "pulse" | "const"; reachConst?: number;
  hug?: BonesDef; // 무입 종 chomp/eat 대체 포즈
};

export const EMPTY_BONES: BonesDef = {};

const C = (v: number): BoneCh => ({ op: "const", v });
const S = (base: number, amp: number, f: number, ph?: number): BoneCh =>
  ({ op: "sin", base, amp, f, ph });
const A = (base: number, amp: number, f: number): BoneCh =>
  ({ op: "abs", base, amp, f });

const BEG: BonesDef = {
  armL: { rx: S(-1.85, 0.3, 7.5) },
  armR: { rx: S(-1.85, -0.3, 7.5) },
  head: { rx: C(-0.1), rz: S(0, 0.16, 7.5) }, // 1c-3: 6 → 7.5
  legL: { rx: A(0.15, 0.1, 7.5) },
  legR: { rx: A(0.15, 0.1, 7.5) },
  tail: { ry: S(0, 0.5, 9) },
};

// 1c-4: cry = 느린 흐느낌(머리 숙임 + 어깨 들썩).
const CRY: BonesDef = {
  legL: { rx: C(0.15) },
  legR: { rx: C(0.15) },
  head: { rx: S(0.3, 0.08, 3) },
  armL: { rx: S(0.1, 0.08, 3) },
  armR: { rx: S(0.1, 0.08, 3) },
};

// 1c-4: hurt = 짧은 움찔(뒤로 젖힘 1회 후 감쇠, pulse형).
const HURT: BonesDef = {
  legL: { rx: C(0.15) },
  legR: { rx: C(0.15) },
  torso: { rx: { op: "pulse", scale: -0.25 } },
  head: { rx: { op: "pulse", scale: -0.15 } },
  armL: { rx: { op: "pulse", scale: -0.5 } },
  armR: { rx: { op: "pulse", scale: -0.5 } },
};

const HUG: BonesDef = {
  armL: { rx: C(-0.55), rz: C(0.55) },
  armR: { rx: C(-0.55), rz: C(-0.55) },
  sy: S(0.93, 0.03, 5),
  sx: C(1.04),
  sz: C(1.04),
  torso: { rz: S(0, 0.1, 5) },
  head: { rx: C(0.15), rz: S(0, 0.2, 5) },
  legL: { rx: C(0.2) },
  legR: { rx: C(0.2) },
  tail: { ry: S(0, 0.4, 5) },
};

export const EMOTE_BONES: Record<EmoteId, BonesDef> = {
  idle: EMPTY_BONES,
  beg: BEG,
  want: BEG,
  hungry: {
    legL: { rx: C(0.25) },
    legR: { rx: C(0.25) },
    head: { rx: C(0.35), rz: S(0, 0.12, 3) },
    armL: { rx: C(0.12) },
    armR: { rx: C(0.12) },
  },
  happy: {
    armL: { rx: C(-1.9) },
    armR: { rx: C(-1.9) },
    legL: { rx: S(0, 0.4, 7) },
    legR: { rx: S(0, 0.4, 7, Math.PI) },
    head: { rz: S(0, 0.12, 7) },
    sy: A(1, 0.04, 7),
    tail: { ry: S(0, 0.6, 8) },
  },
  cry: CRY,
  hurt: HURT,
  sleep: {
    legL: { rx: C(0.4) },
    legR: { rx: C(0.4) },
    torso: { rx: C(0.18) },
    head: { rx: C(0.5) },
    armL: { rx: C(0.2) },
    armR: { rx: C(0.2) },
    sy: S(1, 0.03, 1.1),
  },
  eat: {
    reach: "pulse", // 1c-9: chomp와 같은 pulse로 통일
    legL: { rx: { op: "reach", scale: 0.18 } },
    legR: { rx: { op: "reach", scale: 0.18 } },
    armL: { rx: { op: "reachAbs", rs: -1.15, as: 0.15, f: 10 } },
    armR: { rx: { op: "reachAbs", rs: -1.15, as: 0.15, f: 10 } },
    torso: { rx: { op: "reach", scale: 0.3 } },
    head: { rx: { op: "reachAbs", rs: 0.25, as: 0.18, f: 10 } },
    hug: HUG,
  },
  chomp: {
    reach: "pulse",
    legL: { rx: { op: "reach", scale: 0.18 } },
    legR: { rx: { op: "reach", scale: 0.18 } },
    armL: { rx: { op: "reachAbs", rs: -1.15, as: 0.15, f: 9 } },
    armR: { rx: { op: "reachAbs", rs: -1.15, as: 0.15, f: 9 } },
    torso: { rx: { op: "reach", scale: 0.3 } },
    head: { rx: { op: "reachAbs", rs: 0.25, as: 0.18, f: 9 } },
    hug: HUG,
  },
  fetch: {
    // 1c-6: Y 상승 없이 몸통 rx 진동으로 발맞춤. 다리(걷기 스텝)는 건드리지 않음.
    head: { ry: S(0, 0.25, 3) },
    torso: { rx: S(0, 0.08, 8) },
  },
  greet: {
    legL: { rx: A(0, 0.3, 8) },
    legR: { rx: A(0, 0.3, 8) },
    armR: { rx: C(-1.9), rz: S(0, 0.45, 8) },
    armL: { rx: C(-0.4) },
    head: { rz: S(0, 0.1, 8) },
    tail: { ry: S(0, 0.5, 8) },
  },
  // 1c-5: 가벼운 두리번. 다리·걷기 스텝은 건드리지 않음.
  roam: {
    head: { ry: S(0, 0.3, 0.9) },
  },
  attack: {
    legL: { rx: { op: "pulse", scale: -0.35 } },
    legR: { rx: { op: "pulse", scale: 0.25 } },
    torso: { rx: { op: "pulse", scale: 0.35 } },
    armL: { rx: { op: "pulse", scale: -1.6 } },
    armR: { rx: { op: "pulse", scale: -1.6 } },
    head: { rx: { op: "pulse", scale: 0.2 } },
  },
  drowsy: {
    legL: { rx: C(0.45) },
    legR: { rx: C(0.45) },
    torso: { rx: C(0.2) },
    head: { rx: C(0.55), rz: S(0, 0.08, 1.4) },
    armL: { rx: C(0.25) },
    armR: { rx: C(0.25) },
    sy: S(0.94, 0.02, 1.1),
    sx: C(1.04),
  },
  zoomies: {
    legL: { rx: S(0, 0.45, 14) },
    legR: { rx: S(0, 0.45, 14, Math.PI) },
    armL: { rx: S(-1.2, 0.4, 14) },
    armR: { rx: S(-1.2, -0.4, 14) },
    head: { rx: C(-0.12) },
    tail: { ry: S(0, 0.6, 10) },
  },
  pat: {
    armL: { rx: S(-0.7, 0.25, 6) },
    armR: { rx: S(-0.7, -0.25, 6) },
    head: { rx: A(0.12, 0.06, 6) },
    legL: { rx: C(0.12) },
    legR: { rx: C(0.12) },
    sy: A(1, 0.03, 6),
    tail: { ry: S(0, 0.3, 6) },
  },
  cuddle: {
    // 1c-3: 8 → 4로 통일.
    head: { rz: S(0.28, 0.1, 4), rx: C(-0.08) },
    armL: { rx: S(-0.9, 0.3, 4) },
    armR: { rx: S(-0.9, -0.3, 4) },
    legL: { rx: A(0, 0.2, 4) },
    legR: { rx: A(0, 0.2, 4) },
    tail: { ry: S(0, 0.55, 4) },
  },
  // 9-B: 기절. 옆으로 쓰러짐 + 축 처짐 (정적 const, 미세 호흡만).
  faint: {
    legL: { rx: C(0.55) },
    legR: { rx: C(-0.15) },
    torso: { rx: C(0.3), rz: C(0.55) },
    head: { rx: C(0.4), rz: C(0.5) },
    armL: { rx: C(-0.3), rz: C(0.7) },
    armR: { rx: C(-0.3), rz: C(-0.7) },
    sy: S(0.9, 0.015, 1.1),
    sx: C(1.05),
  },
};

export function bonesFor(emote: string, hug: boolean): BonesDef {
  const def: BonesDef = (EMOTE_BONES as Record<string, BonesDef>)[emote] ?? EMPTY_BONES;
  if (hug && def.hug) return def.hug;
  return def;
}

export function resolveReach(def: BonesDef, pulse: number): number {
  if (def.reach === "pulse") return pulse;
  if (def.reach === "const") return def.reachConst ?? 0;
  return 0;
}

export function evalBoneCh(ch: BoneCh, t: number, e: number, pulse: number, reach: number): number {
  const tt = ch.clock === "t" ? t : e;
  switch (ch.op) {
    case "const":
      return ch.v;
    case "sin":
      return ch.base + ch.amp * (ch.ph === undefined ? Math.sin(tt * ch.f) : Math.sin(tt * ch.f + ch.ph));
    case "abs":
      return ch.base + ch.amp * Math.abs(ch.ph === undefined ? Math.sin(tt * ch.f) : Math.sin(tt * ch.f + ch.ph));
    case "pulse":
      return ch.scale * pulse;
    case "reach":
      return ch.scale * reach;
    case "reachAbs":
      return ch.rs * reach + ch.as * Math.abs(Math.sin(tt * ch.f));
  }
}

// ---------- 전신 리지드 (puppetRig.update) ----------
// y/ry/rz는 베이스(호흡)에 더하고, rx는 덮어쓴다. z는 attack 펄스 후 하단에서 0으로 리셋(기존 동작 유지).
export type RigidCh = { clock?: Clock } & (
  | { op: "set"; v: number }
  | { op: "setSin"; base: number; amp: number; f: number }
  | { op: "setAbs"; base: number; amp: number; f: number }
  | { op: "setPulse"; scale: number }
  | { op: "add"; v: number }
  | { op: "addSin"; amp: number; f: number }
  | { op: "addAbs"; amp: number; f: number }
  | { op: "addBaseSin"; base: number; amp: number; f: number }
  | { op: "addPulse"; scale: number }
  | { op: "addDip"; dip: number; amp: number; f: number }
);

export type RigidDef = {
  y?: RigidCh; rx?: RigidCh; ry?: RigidCh; rz?: RigidCh; z?: RigidCh;
};

export const EMPTY_RIGID: RigidDef = {};

const BEG_RIGID: RigidDef = {
  // 1c-3: 6 → 7.5로 통일.
  y: { op: "addAbs", amp: 0.12, f: 7.5 },
  rx: { op: "set", v: -0.12 },
  rz: { op: "addSin", amp: 0.06, f: 7.5 },
};

// 1c-4: cry = 느린 흐느낌.
const CRY_RIGID: RigidDef = {
  y: { op: "addBaseSin", base: -0.06, amp: 0.02, f: 3 },
  rx: { op: "setSin", base: 0.1, amp: 0.05, f: 3 },
  rz: { op: "addSin", amp: 0.04, f: 3 },
  ry: { op: "addSin", amp: 0.06, f: 3 },
};

// 1c-4: hurt = 짧은 움찔(1회 후 감쇠).
const HURT_RIGID: RigidDef = {
  y: { op: "addPulse", scale: -0.06 },
  rx: { op: "setPulse", scale: -0.15 },
};

export const EMOTE_RIGID: Record<EmoteId, RigidDef> = {
  idle: EMPTY_RIGID,
  beg: BEG_RIGID,
  want: BEG_RIGID,
  hungry: {
    y: { op: "add", v: -0.08 },
    rx: { op: "set", v: 0.22 },
    rz: { op: "addSin", amp: 0.1, f: 3 },
  },
  happy: {
    y: { op: "addAbs", amp: 0.2, f: 7 },
    rz: { op: "addSin", amp: 0.1, f: 7 },
    ry: { op: "addSin", amp: 0.15, f: 3.5 },
  },
  cry: CRY_RIGID,
  hurt: HURT_RIGID,
  sleep: {
    // 1c-8: 낮추기는 A만 담당. P y 제거.
    rx: { op: "set", v: 0.12 },
  },
  eat: {
    rx: { op: "setAbs", base: 0.08, amp: 0.12, f: 10 },
  },
  chomp: {
    y: { op: "addAbs", amp: 0.1, f: 9 },
    rx: { op: "setAbs", base: 0.1, amp: 0.22, f: 9 },
    rz: { op: "addSin", amp: 0.05, f: 9 },
  },
  fetch: {
    // 1c-6: Y 상승 제거. 발돋움 느낌은 몸통 rx 진동으로만.
    rx: { op: "setSin", base: -0.06, amp: 0.05, f: 8 },
  },
  greet: {
    y: { op: "addAbs", amp: 0.1, f: 8 },
    rz: { op: "addSin", amp: 0.1, f: 8 },
  },
  roam: {
    // 1c-10: "Y 점프 금지" 준수. P y 제거.
    rz: { op: "addSin", amp: 0.05, f: 2.5 },
    ry: { op: "addSin", amp: 0.2, f: 1.2 },
  },
  attack: {
    // 1c-1 수정: 월드 이동은 액터 레이어만 담당. z 채널 없음(항상 0).
    // rx는 autoRig와 같은 숙임 방향(+) 유지.
    rx: { op: "setPulse", scale: 0.2 },
    rz: { op: "addPulse", scale: -0.06 },
  },
  drowsy: {
    // 1c-8: 낮추기는 A만 담당. P y 제거.
    rx: { op: "set", v: 0.16 },
    rz: { op: "addSin", amp: 0.06, f: 1.4 },
  },
  zoomies: {
    // 1c-7: 회전은 V만 담당. P ry 제거.
    y: { op: "addAbs", amp: 0.16, f: 14 },
    rz: { op: "addSin", amp: 0.08, f: 14 },
  },
  pat: {
    y: { op: "addAbs", amp: 0.06, f: 6 },
    rx: { op: "setAbs", base: 0.06, amp: 0.1, f: 6 },
    rz: { op: "addSin", amp: 0.04, f: 6 },
  },
  cuddle: {
    // 1c-3: 8 → 4로 통일.
    y: { op: "addAbs", amp: 0.1, f: 4 },
    rz: { op: "addBaseSin", base: 0.18, amp: 0.08, f: 4 },
    rx: { op: "set", v: -0.08 },
    ry: { op: "addSin", amp: 0.12, f: 4 },
  },
  // 9-B: 기절 리지드 (낮추기 + 옆 기울기).
  faint: {
    y: { op: "add", v: -0.16 },
    rx: { op: "set", v: 0.1 },
    rz: { op: "set", v: 0.3 },
  },
};

export function rigidFor(emote: string): RigidDef {
  return (EMOTE_RIGID as Record<string, RigidDef>)[emote] ?? EMPTY_RIGID;
}

export function applyRigidCh(cur: number, ch: RigidCh, t: number, e: number, pulse: number): number {
  const tt = ch.clock === "t" ? t : e;
  switch (ch.op) {
    case "set":
      return ch.v;
    case "setSin":
      return ch.base + ch.amp * Math.sin(tt * ch.f);
    case "setAbs":
      return ch.base + ch.amp * Math.abs(Math.sin(tt * ch.f));
    case "setPulse":
      return ch.scale * pulse;
    case "add":
      return cur + ch.v;
    case "addSin":
      return cur + ch.amp * Math.sin(tt * ch.f);
    case "addAbs":
      return cur + ch.amp * Math.abs(Math.sin(tt * ch.f));
    case "addBaseSin":
      return cur + (ch.base + ch.amp * Math.sin(tt * ch.f));
    case "addPulse":
      return cur + ch.scale * pulse;
    case "addDip":
      return cur - (ch.dip + ch.amp * Math.sin(tt * ch.f));
  }
}

// ---------- 표정 (PovCreature face.setFace) ----------
// mouthAlt가 있으면 sin(emoteT*freq) > thresh 토글. hug 변형은 chomp/eat에만 있다.
export type FaceDef = {
  eyes: EyeState; mouth: MouthState;
  mouthAlt?: MouthState; mouthFreq?: number; mouthThresh?: number;
  hugEyes?: EyeState; hugMouth?: MouthState;
};

export const EMOTE_FACE: Record<EmoteId, FaceDef> = {
  idle: { eyes: "baked", mouth: "baked" },
  beg: { eyes: "heart", mouth: "smile" },
  want: { eyes: "heart", mouth: "smile" },
  hungry: { eyes: "sad", mouth: "flat" },
  happy: { eyes: "happy", mouth: "smile" },
  cry: { eyes: "sad", mouth: "flat" },
  hurt: { eyes: "closed", mouth: "flat" },
  sleep: { eyes: "closed", mouth: "baked" },
  attack: { eyes: "wow", mouth: "open" },
  greet: { eyes: "happy", mouth: "smile" },
  eat: {
    eyes: "happy", mouth: "flat", mouthAlt: "open",
    mouthFreq: 10, mouthThresh: 0, hugEyes: "happy", hugMouth: "baked",
  },
  chomp: {
    eyes: "wow", mouth: "flat", mouthAlt: "open",
    mouthFreq: 9, mouthThresh: 0, hugEyes: "happy", hugMouth: "baked",
  },
  fetch: { eyes: "wow", mouth: "baked" },
  roam: { eyes: "baked", mouth: "baked" }, // 1c-5: faceFor가 idle 머신으로 보내므로 미사용
  drowsy: {
    eyes: "closed", mouth: "baked", mouthAlt: "open", mouthFreq: 3, mouthThresh: 0.2,
  },
  zoomies: { eyes: "wow", mouth: "smile" },
  pat: { eyes: "happy", mouth: "smile" },
  cuddle: { eyes: "heart", mouth: "smile" },
  faint: { eyes: "closed", mouth: "baked" },
};

// idle+평상은 null (호출자의 깜빡임/하품 머신이 담당). 그 외는 기존 if/else와 동일한 결과.
export function faceFor(
  emote: string,
  o: { emoteT: number; hug: boolean; dancing: boolean },
): { eyes: EyeState; mouth: MouthState } | null {
  // 1c-5: roam 얼굴은 idle 매핑(깜빡임/하품 머신)을 쓴다.
  if (emote === "idle" || emote === "roam") {
    return o.dancing ? { eyes: "baked", mouth: "baked" } : null;
  }
  const def: FaceDef | undefined = (EMOTE_FACE as Record<string, FaceDef>)[emote];
  if (!def) return { eyes: "baked", mouth: "baked" };
  if (o.hug && def.hugEyes !== undefined && def.hugMouth !== undefined) {
    return { eyes: def.hugEyes, mouth: def.hugMouth };
  }
  if (def.mouthAlt !== undefined && def.mouthFreq !== undefined && def.mouthThresh !== undefined) {
    return Math.sin(o.emoteT * def.mouthFreq) > def.mouthThresh
      ? { eyes: def.eyes, mouth: def.mouthAlt }
      : { eyes: def.eyes, mouth: def.mouth };
  }
  return { eyes: def.eyes, mouth: def.mouth };
}

// ---------- 이동 (걷기 스텝 + 등 돌림 대상 감정) ----------
export const EMOTE_LOCO: Record<EmoteId, boolean> = {
  idle: false, beg: false, want: false, hungry: false, happy: false, cry: false,
  hurt: false, sleep: false, eat: false, chomp: false, fetch: true, greet: false,
  roam: true, attack: false, drowsy: false, zoomies: false, pat: false, cuddle: false,
  faint: false,
};

export function emoteLocomotion(emote: string): boolean {
  return (EMOTE_LOCO as Record<string, boolean>)[emote] ?? false;
}
