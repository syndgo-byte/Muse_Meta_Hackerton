// Part J: behavior state machine (pure decision function).
// See docs/CREATURE_BEHAVIOR.md. Caller (pov timer, CLI 3) persists `memory`,
// computes goalReached/goalVisible/heading, performs scans, and applies rewards.
// This module never touches timers, storage, or network.
import { FULLNESS_LOW, isExhausted, moveSpeedMult, type Status } from "../state";
import { pickDance } from "./dances";
import type { EmoteId } from "./emotes";

export type BehaviorState = "avoid" | "interact" | "approach" | "focus" | "follow" | "idle";
export type GoalKind = "food" | "trainer" | "path" | "wild";
export type Goal = { kind: GoalKind; x: number; z: number; at: number; event?: boolean };
// World-XZ danger zones (K's hazard module produces these from screen boxes).
export type DangerZone = {
  x0: number; x1: number; z0: number; z1: number; cx: number; approaching: boolean;
};

export const MIN_STATE_S = 3; // anti-flutter (applies to lateral/down switches only)
export const AVOID_CLEAR_S = 2; // zone-free time before leaving avoid
export const SCAN_EVERY_S = 12; // food-seeking look cadence (10~15s)
export const GOAL_EXPIRE_S = 60; // food/trainer goals expire without refresh
export const WALK_MOVING_M = 0.3; // walkM delta per tick that counts as moving

const RANK: Record<BehaviorState, number> = {
  avoid: 6, interact: 5, approach: 4, focus: 3, follow: 2, idle: 1,
};

export type BehaviorMemory = {
  state: BehaviorState;
  since: number;
  avoidClearSince: number | null;
  lastScanAt: number;
  lastWalkM: number;
  notifiedLevel: number;
  goal: Goal | null;
};

export function initialMemory(now: number, level: number): BehaviorMemory {
  return {
    state: "idle", since: now, avoidClearSince: null,
    lastScanAt: 0, lastWalkM: 0, notifiedLevel: level, goal: null,
  };
}

export type BehaviorInput = {
  now: number;
  prev: BehaviorMemory;
  status: Status;
  walkM: number;
  lastScanAt: number; // caller-owned: when the last look scan ran
  creature: { x: number; z: number };
  vel: { x: number; z: number }; // current velocity (m/s-ish, for heading-into test)
  scan: { x: number; z: number; visible: boolean; event: boolean; at: number } | null;
  tap: { x: number; z: number; at: number } | null;
  danger: DangerZone[];
  freeScans: number;
  goalVisible: boolean; // current goal on screen (for focus)
  goalReached: boolean; // caller-computed arrival
  emoteDone: boolean; // interact emote finished
  heading: { x: number; z: number }; // trainer heading (for follow)
  wildActive: boolean; // existing encounter flow owns the creature
};

export type BehaviorOutput = {
  state: BehaviorState;
  memory: BehaviorMemory;
  move: { dx: number; dz: number; speed: number } | null;
  face: { x: number; z: number } | null;
  emote: EmoteId | null; // fires once on interact entry
  balloon: string | null; // "위험해!" fires once on avoid entry
  scanDue: boolean;
  levelup: { level: number; danceId: string } | null;
  eventFood: boolean; // reached event food (caller shows TOKEN §11-2 balloon)
  yielded: boolean; // wild flow owns the creature; hold everything
  goalDropped: string | null; // debug reason when the goal was dropped
};

function inRect(x: number, z: number, r: DangerZone): boolean {
  return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
}

function segHitsRect(
  ax: number, az: number, bx: number, bz: number, r: DangerZone,
): boolean {
  if (inRect(ax, az, r) || inRect(bx, bz, r)) return true;
  // Segment vs 4 rect edges (2D cross-product test).
  const edges: Array<[[number, number], [number, number]]> = [
    [[r.x0, r.z0], [r.x1, r.z0]],
    [[r.x1, r.z0], [r.x1, r.z1]],
    [[r.x1, r.z1], [r.x0, r.z1]],
    [[r.x0, r.z1], [r.x0, r.z0]],
  ];
  const cross = (ox: number, oz: number, px: number, pz: number, qx: number, qz: number) =>
    (px - ox) * (qz - oz) - (pz - oz) * (qx - ox);
  for (const [[cx, cz], [dx, dz]] of edges) {
    const d1 = cross(cx, cz, dx, dz, ax, az);
    const d2 = cross(cx, cz, dx, dz, bx, bz);
    const d3 = cross(ax, az, bx, bz, cx, cz);
    const d4 = cross(ax, az, bx, bz, dx, dz);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))
      && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  }
  return false;
}

function norm(x: number, z: number): { dx: number; dz: number } {
  const m = Math.hypot(x, z);
  if (m < 1e-9) return { dx: 0, dz: 0 };
  return { dx: x / m, dz: z / m };
}

export function decide(input: BehaviorInput): BehaviorOutput {
  const { now, prev, status, walkM } = input;
  const base = {
    move: null, face: null, emote: null, balloon: null, scanDue: false,
    levelup: null, eventFood: false, yielded: false, goalDropped: null,
  };
  // Wild encounters keep existing rules: freeze, caller drives.
  if (input.wildActive) {
    return { state: prev.state, memory: { ...prev }, ...base, yielded: true };
  }
  const mem: BehaviorMemory = {
    ...prev, lastScanAt: input.lastScanAt, lastWalkM: walkM,
  };
  const hungry = status.fullness < FULLNESS_LOW;
  const exhausted = isExhausted(status);

  // --- goal bookkeeping: expire, consume, danger-drop, then select ---
  let dropped: string | null = null;
  const fresh = (at: number) => now - at < GOAL_EXPIRE_S;
  let food: Goal | null = null;
  if (input.scan && hungry && fresh(input.scan.at)) {
    food = { kind: "food", x: input.scan.x, z: input.scan.z, at: input.scan.at, event: input.scan.event };
  } else if (prev.goal?.kind === "food" && hungry && fresh(prev.goal.at)) {
    food = prev.goal;
  } else if (prev.goal?.kind === "food") {
    dropped = "food-expired-or-full";
  }
  let trainer: Goal | null = null;
  if (input.tap && fresh(input.tap.at)) {
    trainer = { kind: "trainer", x: input.tap.x, z: input.tap.z, at: input.tap.at };
  } else if (prev.goal?.kind === "trainer" && fresh(prev.goal.at)) {
    trainer = prev.goal;
  } else if (prev.goal?.kind === "trainer") {
    dropped = "trainer-expired";
  }
  let goal: Goal | null = food ?? trainer;
  if (goal && input.danger.some((r) => inRect(goal!.x, goal!.z, r))) {
    dropped = "goal-in-danger";
    goal = null;
  }
  if (prev.state === "interact" && input.emoteDone) {
    goal = null; // consumed by the finished interaction
  }
  mem.goal = goal;

  // --- danger evaluation (world XZ) ---
  const { x: cx, z: cz } = input.creature;
  const inside = input.danger.some((r) => inRect(cx, cz, r));
  const headingIn = input.danger.some((r) =>
    segHitsRect(cx, cz, cx + input.vel.x, cz + input.vel.z, r));
  const dangerActive = inside || headingIn;
  if (dangerActive) mem.avoidClearSince = null;
  else if (mem.avoidClearSince === null) mem.avoidClearSince = now;
  const clearFor = mem.avoidClearSince === null ? 0 : now - mem.avoidClearSince;
  const avoidCond = dangerActive || (prev.state === "avoid" && clearFor < AVOID_CLEAR_S);

  // --- candidates by priority ---
  const moving = walkM - prev.lastWalkM > WALK_MOVING_M;
  let desired: BehaviorState = "idle";
  if (avoidCond) desired = "avoid";
  else if (goal && input.goalReached) desired = "interact"; // eat/greet even when exhausted
  else if (goal && !exhausted) desired = "approach";
  else if (!exhausted && ((goal && input.goalVisible) || (input.scan?.visible ?? false))) desired = "focus";
  else if (moving && !exhausted) desired = "follow";

  // --- transition: higher preempts now; lower/lateral waits out 3s ---
  let state = prev.state;
  if (RANK[desired] > RANK[prev.state]) state = desired;
  else if (desired !== prev.state && now - prev.since >= MIN_STATE_S) state = desired;
  mem.since = state === prev.state ? prev.since : now;
  mem.state = state;
  const entered = state !== prev.state;

  // --- outputs per state ---
  const speed = moveSpeedMult(status);
  let move: BehaviorOutput["move"] = null;
  let face: BehaviorOutput["face"] = null;
  let emote: EmoteId | null = null;
  let balloon: string | null = null;
  let eventFood = false;
  if (state === "avoid") {
    const z = input.danger.find((r) => inRect(cx, cz, r)) ?? input.danger[0];
    const dx = z ? (cx >= z.cx ? 1 : -1) : 0;
    const dz = cz < 0 ? 1 : cz > 0.4 ? -1 : 0;
    const d = norm(dx, dz);
    move = { ...d, speed };
    if (entered) balloon = "위험해!";
  } else if (state === "interact" && goal) {
    emote = entered ? (goal.kind === "food" ? "eat" : "greet") : null;
    face = { x: goal.x, z: goal.z };
    eventFood = goal.kind === "food" && goal.event === true;
  } else if (state === "approach" && goal) {
    const d = norm(goal.x - cx, goal.z - cz);
    move = { ...d, speed };
    face = { x: goal.x, z: goal.z };
  } else if (state === "focus") {
    const p = goal ?? input.scan;
    face = p ? { x: p.x, z: p.z } : null;
  } else if (state === "follow") {
    const d = norm(input.heading.x, input.heading.z);
    move = { ...d, speed };
    face = { x: cx + input.heading.x, z: cz + input.heading.z };
  }

  // --- food-seeking scans cost tokens: hungry + no food + quota + 12s ---
  const scanDue = hungry && !food && input.freeScans > 0
    && now - input.lastScanAt >= SCAN_EVERY_S;

  // --- levelup fanfare, once per level band (§6-1) ---
  let levelup: BehaviorOutput["levelup"] = null;
  if (status.level > mem.notifiedLevel) {
    mem.notifiedLevel = status.level;
    levelup = { level: status.level, danceId: pickDance(status.level).id };
  }

  return {
    state, memory: mem, move, face, emote, balloon, scanDue, levelup,
    eventFood, yielded: false, goalDropped: dropped,
  };
}
