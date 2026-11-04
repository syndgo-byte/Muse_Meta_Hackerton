// 12-joint 2-segment K-POP mascot figure factory for the Dex stage.
// Hierarchy: root -> hips -> spine -> head -> eyes; spine -> shoulder ->
// upperArm -> elbow -> forearm -> hand; hips -> hipJoint -> thigh -> knee ->
// shin -> foot; hips -> tail. Head carries horns/ears/hats/tail extras.
// NO scale-stretch: dance is joint rotation + root/hips translation only.
// NO wireframe: hologram mode is smooth translucent dark MeshStandardMaterial.
// ATEEZ 8-count keyframe engine at 128 BPM with snap interpolation.
import * as THREE from "three";
// FN-1: 절차형 폴백 눈꺼풀 깜빡임도 같은 상수로 끈다.
import { FACE_PAINT_ENABLED } from "./facePaint";

export type V3 = [number, number, number];

export type CreatureDef = {
  body: V3;
  belly?: V3;
  accent: V3;
  glow: V3;
  build: "round" | "tall" | "wide" | "bean";
  horns?: { n: number; s: number; c: V3 };
  ears?: { k: "fin" | "cat" | "round" | "bat"; c: V3 };
  tail?: { k: "flame" | "drop" | "puff" | "fin" | "string" | "none"; c: V3 };
  hat?: { k: "cap" | "cloud" | "helmet" | "bud" | "wick" | "blades" | "wings" | "scarf" | "brow"; c?: V3 };
  eyes?: { sleepy?: boolean; single?: boolean; big?: boolean };
  dots?: { c: V3; n: number };
  scale?: number;
};

export type CreatureRig = {
  group: THREE.Group;
  height: number;
  update: (t: number, beat: number, bar: number, amp: number, dancing: boolean) => void;
};

const CREAM: V3 = [0.96, 0.93, 0.82];
const DARK: V3 = [0.18, 0.16, 0.15];

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const col = (c: V3) => new THREE.Color(c[0], c[1], c[2]);

export const DEFS: Record<string, CreatureDef> = {
  "fire-01": { body: [0.85, 0.37, 0.12], accent: DARK, glow: [1, 0.6, 0.24], build: "round", horns: { n: 2, s: 0.42, c: DARK }, tail: { k: "flame", c: [1, 0.55, 0.15] } },
  "fire-02": { body: [0.95, 0.55, 0.2], accent: DARK, glow: [1, 0.6, 0.24], build: "round", ears: { k: "cat", c: [0.95, 0.55, 0.2] }, tail: { k: "flame", c: [1, 0.5, 0.1] } },
  "fire-03": { body: [0.8, 0.2, 0.15], accent: DARK, glow: [1, 0.55, 0.2], build: "wide", horns: { n: 1, s: 0.4, c: [0.25, 0.2, 0.18] }, dots: { c: [0.2, 0.18, 0.16], n: 6 } },
  "fire-04": { body: [0.45, 0.2, 0.12], accent: DARK, glow: [1, 0.55, 0.15], build: "bean", dots: { c: [1, 0.5, 0.12], n: 9 } },
  "fire-05": { body: [0.97, 0.9, 0.75], accent: DARK, glow: [1, 0.7, 0.3], build: "tall", hat: { k: "wick" } },
  "grass-01": { body: [0.31, 0.61, 0.28], accent: [0.42, 0.29, 0.18], glow: [0.62, 0.91, 0.44], build: "round", horns: { n: 2, s: 0.4, c: [0.25, 0.55, 0.25] } },
  "grass-02": { body: [0.65, 0.85, 0.4], accent: [0.5, 0.35, 0.2], glow: [0.62, 0.91, 0.44], build: "tall", horns: { n: 2, s: 0.45, c: [0.3, 0.65, 0.3] } },
  "grass-03": { body: [0.95, 0.9, 0.78], accent: [0.9, 0.8, 0.65], glow: [0.62, 0.91, 0.44], build: "round", hat: { k: "cap", c: [0.8, 0.2, 0.2] } },
  "grass-04": { body: [0.45, 0.75, 0.35], accent: DARK, glow: [0.62, 0.91, 0.44], build: "wide", ears: { k: "round", c: [0.35, 0.6, 0.3] }, tail: { k: "puff", c: [1, 1, 1] } },
  "grass-05": { body: [0.3, 0.6, 0.32], accent: DARK, glow: [0.62, 0.91, 0.44], build: "round", hat: { k: "bud", c: [1, 0.55, 0.7] }, horns: { n: 6, s: 0.18, c: [0.9, 0.95, 0.85] } },
  "water-01": { body: [0.35, 0.65, 0.95], accent: DARK, glow: [0.49, 0.78, 1], build: "tall", ears: { k: "fin", c: [0.6, 0.85, 1] }, tail: { k: "drop", c: [0.4, 0.7, 1] } },
  "water-02": { body: [0.3, 0.6, 0.9], accent: DARK, glow: [0.49, 0.78, 1], build: "round", hat: { k: "helmet", c: [0.6, 0.62, 0.65] } },
  "water-03": { body: [0.55, 0.8, 0.9], accent: [0.55, 0.5, 0.45], glow: [0.49, 0.78, 1], build: "round", horns: { n: 3, s: 0.36, c: [0.2, 0.5, 0.3] } },
  "water-04": { body: [0.4, 0.7, 0.55], accent: DARK, glow: [0.49, 0.78, 1], build: "wide", hat: { k: "cloud" }, eyes: { big: true } },
  "water-05": { body: [0.75, 0.88, 0.95], accent: DARK, glow: [0.49, 0.78, 1], build: "bean", ears: { k: "round", c: [0.9, 0.95, 1] }, dots: { c: [1, 1, 1], n: 8 } },
  "rock-01": { body: [0.55, 0.52, 0.48], accent: DARK, glow: [1, 0.77, 0.42], build: "wide", hat: { k: "brow" }, dots: { c: [0.35, 0.55, 0.3], n: 5 } },
  "rock-02": { body: [0.5, 0.5, 0.52], accent: DARK, glow: [1, 0.77, 0.42], build: "tall", horns: { n: 2, s: 0.45, c: [0.5, 0.3, 0.2] }, dots: { c: [0.95, 0.6, 0.15], n: 4 } },
  "rock-03": { body: [0.6, 0.58, 0.55], accent: DARK, glow: [1, 0.77, 0.42], build: "round", eyes: { single: true, big: true } },
  "rock-04": { body: [0.35, 0.3, 0.4], accent: DARK, glow: [0.7, 0.85, 1], build: "round", ears: { k: "bat", c: [0.3, 0.25, 0.35] }, dots: { c: [0.55, 0.85, 1], n: 6 }, tail: { k: "fin", c: [0.3, 0.25, 0.35] } },
  "wind-01": { body: [0.5, 0.77, 0.71], accent: DARK, glow: [0.84, 1, 0.95], build: "tall", hat: { k: "scarf" } },
  "wind-02": { body: [0.85, 0.85, 0.8], accent: DARK, glow: [1, 0.95, 0.8], build: "round", eyes: { big: true }, scale: 0.85 },
  "wind-03": { body: [0.95, 0.95, 0.92], accent: DARK, glow: [0.84, 1, 0.95], build: "tall", hat: { k: "wings" }, tail: { k: "string", c: [0.7, 0.7, 0.7] } },
  "wind-04": { body: [0.6, 0.8, 0.9], accent: DARK, glow: [0.84, 1, 0.95], build: "round", hat: { k: "blades" } },
  "wind-05": { body: [0.97, 0.93, 0.85], accent: DARK, glow: [1, 0.95, 0.85], build: "wide", eyes: { sleepy: true }, dots: { c: [0.85, 0.7, 0.5], n: 5 } },
};

const BUILD_S: Record<CreatureDef["build"], V3> = {
  round: [1, 1, 1], tall: [0.88, 1.12, 0.88], wide: [1.14, 0.92, 1.04], bean: [0.82, 1.22, 0.82],
};

// 8-count keyframe poses. Every field lerps prev -> current per count.
type Pose = {
  hipsY: number; hipsRX: number; hipsRY: number; hipsRZ: number;
  spineRX: number; spineRY: number; spineRZ: number;
  headRX: number; headRY: number; headRZ: number;
  shLx: number; shLz: number; shRx: number; shRz: number;
  elL: number; elR: number;
  hipLx: number; hipLz: number; hipRx: number; hipRz: number;
  kneeL: number; kneeR: number; tailRY: number; rootY: number;
};
const REST: Pose = {
  hipsY: 0, hipsRX: 0, hipsRY: 0, hipsRZ: 0,
  spineRX: 0, spineRY: 0, spineRZ: 0,
  headRX: 0, headRY: 0, headRZ: 0,
  shLx: 0, shLz: 0.15, shRx: 0, shRz: -0.15,
  elL: -0.25, elR: -0.25,
  hipLx: 0, hipLz: 0.06, hipRx: 0, hipRz: -0.06,
  kneeL: 0.08, kneeR: 0.08, tailRY: 0, rootY: 0,
};
// Beat 1: wide squat & guard — knees bent, elbows crossed hard.
const P0: Pose = {
  ...REST, hipsY: -0.3, spineRX: 0.15, headRX: 0.1,
  hipLx: -0.3, hipLz: 0.55, hipRx: -0.3, hipRz: -0.55,
  kneeL: 1.0, kneeR: 1.0,
  shLx: -0.3, shLz: 0.55, shRx: -0.3, shRz: -0.55,
  elL: -1.5, elR: -1.5, tailRY: 0.2,
};
// Beat 2: chest pop & arm open — knees straight, chest out, head back.
const P1: Pose = {
  ...REST, hipsY: 0.02, spineRX: -0.3, headRX: -0.25,
  shLx: -0.2, shLz: 1.25, shRx: -0.2, shRz: -1.25,
  elL: -0.25, elR: -0.25, kneeL: 0.1, kneeR: 0.1,
  hipLz: 0.15, hipRz: -0.15, tailRY: -0.2,
};
// Beat 3: left hands-up, right on waist, twist hips/spine opposite.
const P2: Pose = {
  ...REST, hipsY: -0.05, hipsRY: 0.35, spineRY: -0.3, spineRZ: 0.1, headRZ: 0.15,
  shLx: 0, shLz: 2.4, elL: -0.9, shRx: 0, shRz: -0.5, elR: -1.3,
  kneeL: 0.25, kneeR: 0.15, tailRY: 0.3,
};
// Beat 4: mirror twist.
const P3: Pose = {
  ...REST, hipsY: -0.05, hipsRY: -0.35, spineRY: 0.3, spineRZ: -0.1, headRZ: -0.15,
  shRx: 0, shRz: -2.4, elR: -0.9, shLx: 0, shLz: 0.5, elL: -1.3,
  kneeL: 0.15, kneeR: 0.25, tailRY: -0.3,
};
// Beat 5: right knee kick + left punch snap.
const P4: Pose = {
  ...REST, hipsY: -0.12, spineRX: 0.1, headRX: 0.05,
  hipRx: -1.2, kneeR: 1.4, hipLx: -0.1, kneeL: 0.15,
  shLx: -1.3, shLz: 0.1, elL: -0.1, shRz: -0.4, elR: -0.5, tailRY: 0.2,
};
// Beat 6: land right, left knee bent, arms overhead, head isolation tilt.
const P5: Pose = {
  ...REST, hipsY: -0.08, spineRZ: 0.08, headRZ: 0.35,
  hipRx: -0.15, kneeR: 0.25, hipLx: -0.35, kneeL: 0.75,
  shLx: 0, shLz: 2.2, shRx: 0, shRz: -2.2, elL: -0.4, elR: -0.4, tailRY: -0.2,
};
// Beat 7: bouncy groove walk R (lean fwd, elbows pumping, cross step).
const P6: Pose = {
  ...REST, hipsY: -0.12, spineRX: 0.25, headRX: 0.1, hipsRY: 0.15,
  shLx: -0.5, shRx: 0.5, elL: -0.9, elR: -0.9,
  hipLz: 0.3, hipRz: -0.3, kneeL: 0.4, kneeR: 0.4, rootY: 0.05, tailRY: 0.3,
};
// Beat 8: groove walk L + snap front.
const P7: Pose = {
  ...REST, hipsY: -0.12, spineRX: 0.15, headRX: 0, hipsRY: -0.15,
  shLx: 0.5, shRx: -0.5, elL: -0.9, elR: -0.9,
  hipLz: -0.3, hipRz: 0.3, kneeL: 0.4, kneeR: 0.4, rootY: 0.05, tailRY: -0.3,
};
const POSES = [P0, P1, P2, P3, P4, P5, P6, P7];
const KEYS = Object.keys(REST) as Array<keyof Pose>;

export function buildCreature(id: string, hologram = false): CreatureRig {
  const def = DEFS[id] ?? DEFS["fire-01"];
  const rnd = mulberry32(hashStr(id));
  const sc = BUILD_S[def.build];
  const gs = def.scale ?? 1;

  // Hologram: smooth translucent dark standard material, emissive glow. No wireframe.
  const holoMain = new THREE.MeshStandardMaterial({
    color: col([0.07, 0.08, 0.1]), emissive: col(def.glow), emissiveIntensity: 0.85,
    transparent: true, opacity: 0.55, roughness: 0.4, metalness: 0.05,
  });
  const std = (c: V3, emissive?: V3, rough = 0.4) => {
    if (hologram) return holoMain;
    const m = new THREE.MeshStandardMaterial({ color: col(c), roughness: rough, metalness: 0.05 });
    if (emissive) {
      m.emissive = col(emissive);
      m.emissiveIntensity = 0.9;
    }
    return m;
  };
  const mBody = std(def.body);
  const mBelly = std(def.belly ?? CREAM, undefined, 0.5);
  const mAccent = std(def.accent, undefined, 0.6);
  const mWhite = std([1, 1, 1], undefined, 0.25);
  const mGlow = std([0.12, 0.12, 0.12], def.glow);
  const mMouth = std([0.3, 0.08, 0.1], undefined, 0.5);
  const mBlush = std([1, 0.55, 0.6], undefined, 0.6);

  const group = new THREE.Group();
  const inner = new THREE.Group();
  group.add(inner);
  inner.scale.set(sc[0] * gs, sc[1] * gs, sc[2] * gs);

  const ball = (m: THREE.Material, r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, seg = 20) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(10, Math.floor(seg * 0.7))), m);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    return mesh;
  };

  // Root -> Hips (feet bottom at y=0)
  const root = new THREE.Group();
  inner.add(root);
  const hips = new THREE.Group();
  hips.position.y = 0.9;
  root.add(hips);
  hips.add(ball(mBody, 0.34, 0, 0, 0, 1.1, 0.8, 0.95));

  // Hips -> Spine/Chest (rounded capsule torso, NOT a ball stack)
  const spine = new THREE.Group();
  spine.position.y = 0.15;
  hips.add(spine);
  const chestMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.32, 6, 16), mBody);
  chestMesh.position.y = 0.28;
  spine.add(chestMesh);
  spine.add(ball(mBelly, 0.26, 0, 0.18, 0.24, 0.85, 1.05, 0.55));

  // Spine -> Head (mochi head, wider than torso) -> Eyes
  const head = new THREE.Group();
  head.position.y = 0.62;
  spine.add(head);
  head.add(ball(mBody, 0.4, 0, 0.26, 0, 1.15, 1.0, 1.05));
  const eyesGroup = new THREE.Group();
  head.add(eyesGroup);
  const eyeXs = def.eyes?.single ? [0] : [-0.15, 0.15];
  const eyeR = def.eyes?.big ? 0.13 : 0.105;
  for (const ex of eyeXs) {
    const esy = def.eyes?.sleepy ? 0.4 : 1;
    eyesGroup.add(ball(mWhite, eyeR, ex, 0.32, 0.33, 1, esy, 0.55, 14));
    eyesGroup.add(ball(mGlow, eyeR * 0.52, ex, 0.32, 0.41, 1, esy, 0.55, 12));
    // highlight dots x2
    eyesGroup.add(ball(mWhite, 0.022, ex - 0.02, 0.36, 0.45, 1, 1, 0.5, 8));
    eyesGroup.add(ball(mWhite, 0.013, ex + 0.025, 0.29, 0.45, 1, 1, 0.5, 8));
  }
  // eyelids
  for (const ex of eyeXs) {
    const lid = new THREE.Mesh(new THREE.BoxGeometry(eyeR * 2.1, 0.035, 0.05), mBody);
    lid.position.set(ex, 0.32 + eyeR + 0.02, 0.36);
    eyesGroup.add(lid);
  }
  // open smile + blush
  eyesGroup.add(ball(mMouth, 0.07, 0, 0.12, 0.36, 1.3, 0.7, 0.5, 12));
  for (const s of [-1, 1]) eyesGroup.add(ball(mBlush, 0.05, s * 0.26, 0.2, 0.3, 1, 0.6, 0.4, 10));

  // Spine -> Shoulder -> UpperArm -> Elbow -> ForeArm -> Hand (separated!)
  const mkArm = (s: 1 | -1) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(s * 0.4, 0.48, 0);
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.22, 4, 12), mBody);
    upper.position.y = -0.17;
    shoulder.add(upper);
    const elbow = new THREE.Group();
    elbow.position.y = -0.34;
    shoulder.add(elbow);
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.2, 4, 12), mBody);
    fore.position.y = -0.15;
    elbow.add(fore);
    elbow.add(ball(mAccent, 0.1, 0, -0.3, 0));
    spine.add(shoulder);
    return { shoulder, elbow };
  };
  const armL = mkArm(-1);
  const armR = mkArm(1);

  // Hips -> HipJoint -> Thigh -> Knee -> Shin -> Foot (foot rides along!)
  const mkLeg = (s: 1 | -1) => {
    const hipJ = new THREE.Group();
    hipJ.position.set(s * 0.2, -0.06, 0);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.24, 4, 12), mBody);
    thigh.position.y = -0.2;
    hipJ.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -0.4;
    hipJ.add(knee);
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.24, 4, 12), mBody);
    shin.position.y = -0.2;
    knee.add(shin);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.34), mAccent);
    foot.position.set(0, -0.42, 0.07);
    knee.add(foot);
    hips.add(hipJ);
    return { hipJ, knee };
  };
  const legL = mkLeg(-1);
  const legR = mkLeg(1);

  // Hips -> Tail
  const tail = new THREE.Group();
  tail.position.set(0, 0, -0.38);
  hips.add(tail);
  const tailKind = def.tail?.k ?? "none";
  const tailC = def.tail?.c ?? def.body;
  const mTail = hologram ? holoMain : std(tailC, tailKind === "flame" ? tailC : undefined);
  if (tailKind === "flame") {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.46, 10), mTail);
    f.rotation.x = -1.1;
    f.position.set(0, 0.08, -0.18);
    tail.add(f);
  } else if (tailKind === "drop" || tailKind === "puff") {
    tail.add(ball(tailKind === "puff" ? mWhite : mTail, 0.15, 0, 0.04, -0.16));
  } else if (tailKind === "fin") {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.36, 4), mTail);
    f.rotation.x = -1.4;
    f.scale.z = 0.4;
    f.position.set(0, 0.04, -0.18);
    tail.add(f);
  } else if (tailKind === "string") {
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.55, 6), mTail);
    st.rotation.x = 0.5;
    st.position.set(0, -0.18, -0.14);
    tail.add(st);
  }

  // Head extras
  if (def.horns) {
    const mH = hologram ? holoMain : std(def.horns.c, undefined, 0.7);
    for (let i = 0; i < def.horns.n; i++) {
      const a2 = def.horns.n === 1 ? 0 : (i / (def.horns.n - 1) - 0.5) * 1.6 + (rnd() - 0.5) * 0.3;
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.075, def.horns.s * (0.85 + rnd() * 0.4), 8), mH);
      horn.position.set(Math.sin(a2) * 0.2, 0.6, -0.02);
      horn.rotation.z = -Math.sin(a2) * 0.6;
      head.add(horn);
    }
  }
  if (def.ears) {
    const mE = hologram ? holoMain : std(def.ears.c, undefined, 0.65);
    if (def.ears.k === "cat" || def.ears.k === "bat") {
      const tall = def.ears.k === "bat" ? 0.4 : 0.26;
      for (const s of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.11, tall, 4), mE);
        ear.position.set(s * 0.26, 0.58, 0);
        ear.rotation.z = -s * 0.2;
        if (def.ears!.k === "bat") ear.scale.z = 0.45;
        head.add(ear);
      }
    } else if (def.ears.k === "fin") {
      for (const s of [-1, 1]) {
        const fin = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 4), mE);
        fin.position.set(s * 0.42, 0.28, 0);
        fin.rotation.z = s * 1.2;
        fin.scale.z = 0.4;
        head.add(fin);
      }
    } else {
      for (const s of [-1, 1]) head.add(ball(mE, 0.12, s * 0.4, 0.3, -0.02));
    }
  }
  const hat = def.hat;
  const mHat = (c?: V3) => (hologram ? holoMain : std(c ?? [0.8, 0.2, 0.2], undefined, 0.55));
  if (hat?.k === "cap") {
    head.add(ball(mHat(hat.c), 0.4, 0, 0.58, 0, 1.15, 0.5, 1.15));
    for (let i = 0; i < 5; i++) {
      const a2 = rnd() * Math.PI * 2;
      head.add(ball(mWhite, 0.055, Math.cos(a2) * 0.28, 0.72 + rnd() * 0.08, Math.sin(a2) * 0.28));
    }
  } else if (hat?.k === "cloud") {
    for (const [ox, oy, r2] of [[-0.19, 0.66, 0.19], [0.15, 0.72, 0.23], [0, 0.6, 0.17]] as Array<[number, number, number]>) {
      head.add(ball(mWhite, r2, ox, oy, 0));
    }
  } else if (hat?.k === "helmet") {
    head.add(ball(mHat(hat.c), 0.38, 0, 0.38, -0.04, 1, 0.55, 1));
    const spout = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.09, 0.18), mAccent);
    spout.position.set(0.18, 0.36, 0.3);
    head.add(spout);
  } else if (hat?.k === "bud") {
    head.add(ball(mHat([0.3, 0.6, 0.3]), 0.09, 0, 0.58, 0));
    head.add(ball(mHat(hat.c), 0.11, 0, 0.72, 0));
  } else if (hat?.k === "wick") {
    const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.2, 8), mAccent);
    wick.position.set(0, 0.66, 0);
    head.add(wick);
    head.add(ball(hologram ? holoMain : std([1, 0.6, 0.2], [1, 0.5, 0.15]), 0.075, 0, 0.82, 0));
  } else if (hat?.k === "blades") {
    const blades = new THREE.Group();
    blades.position.set(0, 0.66, 0);
    head.add(blades);
    for (let i = 0; i < 3; i++) {
      const bl = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.08, 0.03), mWhite);
      bl.rotation.z = (i / 3) * Math.PI * 2;
      blades.add(bl);
    }
    head.userData.blades = blades;
  } else if (hat?.k === "wings") {
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.38, 0.04), mWhite);
      w.position.set(s * 0.46, 0.42, -0.14);
      w.rotation.z = s * 0.5;
      w.rotation.y = s * 0.4;
      head.add(w);
    }
  } else if (hat?.k === "scarf") {
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.09, 10, 20), mWhite);
    scarf.position.y = 0.02;
    scarf.rotation.x = Math.PI / 2;
    spine.add(scarf);
    const tail2 = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.3, 0.05), mWhite);
    tail2.position.set(0.28, -0.12, 0.28);
    spine.add(tail2);
  } else if (hat?.k === "brow") {
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.09, 0.1), mAccent);
    brow.position.set(0, 0.48, 0.32);
    head.add(brow);
  }

  if (def.dots) {
    const mD = hologram ? holoMain : std(def.dots.c, undefined, 0.75);
    for (let i = 0; i < def.dots.n; i++) {
      const th = (rnd() - 0.5) * 2.2;
      const ph = (rnd() - 0.5) * 1.2;
      hips.add(ball(mD, 0.055, Math.sin(th) * 0.34, Math.sin(ph) * 0.28, Math.cos(th) * 0.32));
    }
  }

  let blinkT = 1.5 + rnd() * 2;
  let lastT = 0;
  const cur: Pose = { ...REST };

  const apply = (p: Pose) => {
    hips.position.y = 0.9 + p.hipsY;
    hips.rotation.set(p.hipsRX, p.hipsRY, p.hipsRZ);
    spine.rotation.set(p.spineRX, p.spineRY, p.spineRZ);
    head.rotation.set(p.headRX, p.headRY, p.headRZ);
    armL.shoulder.rotation.set(p.shLx, 0, p.shLz);
    armR.shoulder.rotation.set(p.shRx, 0, p.shRz);
    armL.elbow.rotation.x = p.elL;
    armR.elbow.rotation.x = p.elR;
    legL.hipJ.rotation.set(p.hipLx, 0, p.hipLz);
    legR.hipJ.rotation.set(p.hipRx, 0, p.hipRz);
    legL.knee.rotation.x = p.kneeL;
    legR.knee.rotation.x = p.kneeR;
    tail.rotation.y = p.tailRY;
    root.position.y = p.rootY;
  };
  apply(REST);

  const update = (t: number, beat: number, _bar: number, amp: number, dancing: boolean) => {
    const dt = Math.min(Math.max(t - lastT, 0), 0.1);
    lastT = t;
    // blink + extras always alive
    blinkT -= dt;
    if (blinkT < 0) blinkT = 1.8 + rnd() * 2.6;
    const lid = !FACE_PAINT_ENABLED ? 1 : def.eyes?.sleepy ? 0.4 : blinkT < 0.12 ? 0.12 : 1;
    eyesGroup.scale.y += (lid - eyesGroup.scale.y) * 0.5;
    const blades = head.userData.blades as THREE.Group | undefined;
    if (blades) blades.rotation.y = t * 6;
    if (!dancing) {
      // locked groove: breath + sway, joints near rest
      for (const k of KEYS) cur[k] += (REST[k] - cur[k]) * Math.min(1, dt * 3);
      cur.hipsRY = Math.sin(t * 0.9) * 0.05;
      cur.spineRZ = Math.sin(t * 0.9 + 0.4) * 0.05;
      cur.headRY = Math.sin(t * 0.7) * 0.15;
      cur.tailRY = Math.sin(t * 1.4) * 0.25;
      apply(cur);
      return;
    }
    // 8-count snap interpolation: prev -> current count.
    const count = ((Math.floor(beat) % 8) + 8) % 8;
    const prev = POSES[(count + 7) % 8];
    const next = POSES[count];
    const e = 1 - Math.exp(-6 * (beat % 1));
    for (const k of KEYS) cur[k] = prev[k] + (next[k] - prev[k]) * e;
    // amplitude = REST 오프셋 스케일 (스케일 스트레치 아님, 관절 회전 그대로).
    const posed = { ...cur };
    for (const k of KEYS) posed[k] = REST[k] + (cur[k] - REST[k]) * amp;
    apply(posed);
  };

  return { group, height: 2.3, update };
}
