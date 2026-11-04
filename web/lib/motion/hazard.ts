// Part K: hazard perception (pure detection->zone logic + detector factory).
// See docs/CREATURE_BEHAVIOR.md §2-1. Screen boxes are normalized 0..1.
// The camera loop + screen->world projection live in pov (CLI 3);
// this module only decides WHAT is dangerous and WHERE (screen), and
// converts caller-projected zones to J's DangerZone shape.
import type { DangerZone } from "./behavior";

export type ScreenBox = { x0: number; y0: number; x1: number; y1: number };
export type Detection = { label: string; score: number; box: ScreenBox };
export type TrackedZone = {
  id: number; label: string; box: ScreenBox;
  firstSeen: number; lastSeen: number; baseArea: number; confirmed: boolean;
  approaching: boolean;
};

export const MIN_SCORE = 0.5; // fit < 0.5 counts as absent
export const NMS_IOU = 0.6;
export const CONFIRM_S = 2; // candidate must persist 2s before it becomes a zone
export const EXPIRE_S = 30; // drop after 30s unmatched
export const WIDEN = 0.1; // +10% of size per side (+20% total)
export const WIDEN_APPROACH = 0.25; // +25% per side (+50%) when approaching
export const APPROACH_GROWTH = 1.25; // area growth vs first-seen = approaching
export const MATCH_IOU = 0.3; // track matching threshold (same label)
export const MODEL_URL = "/models/vision/efficientdet_lite0.tflite";

// 7 danger kinds. Real-model (COCO-80) coverage is knife/scissors/bottle;
// the rest arrive via CARD donors / sim words until a broader model lands.
export const DANGER_LABELS: Array<{ ko: string; en: string[] }> = [
  { ko: "칼", en: ["knife"] },
  { ko: "가위", en: ["scissors"] },
  { ko: "약병", en: ["bottle", "pill bottle", "medicine"] },
  { ko: "배터리", en: ["battery"] },
  { ko: "동전", en: ["coin"] },
  { ko: "깨진 유리", en: ["broken glass", "glass"] },
  { ko: "청소 스프레이", en: ["spray", "cleaning spray"] },
];

/** Canonical Korean label for a detection, or null when not dangerous. */
export function matchDanger(label: string): string | null {
  const t = (label ?? "").trim().toLowerCase();
  if (!t) return null;
  for (const d of DANGER_LABELS) {
    if (t === d.ko.toLowerCase()) return d.ko;
    if (d.en.some((e) => t.includes(e))) return d.ko;
  }
  return null;
}

export function boxArea(b: ScreenBox): number {
  return Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
}

export function iou(a: ScreenBox, b: ScreenBox): number {
  const x0 = Math.max(a.x0, b.x0);
  const y0 = Math.max(a.y0, b.y0);
  const x1 = Math.min(a.x1, b.x1);
  const y1 = Math.min(a.y1, b.y1);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const union = boxArea(a) + boxArea(b) - inter;
  return union <= 0 ? 0 : inter / union;
}

/** Greedy NMS over same-label boxes (highest score wins). */
export function nms(dets: Detection[]): Detection[] {
  const out: Detection[] = [];
  const byLabel = new Map<string, Detection[]>();
  for (const d of dets) {
    const list = byLabel.get(d.label) ?? [];
    list.push(d);
    byLabel.set(d.label, list);
  }
  for (const list of Array.from(byLabel.values())) {
    const sorted = [...list].sort((a, b) => b.score - a.score);
    const kept: Detection[] = [];
    for (const d of sorted) {
      if (kept.every((k) => iou(k.box, d.box) < NMS_IOU)) kept.push(d);
    }
    out.push(...kept);
  }
  return out;
}

function widen(b: ScreenBox, f: number): ScreenBox {
  const w = Math.max(0, b.x1 - b.x0);
  const h = Math.max(0, b.y1 - b.y0);
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return {
    x0: clamp(b.x0 - w * f), y0: clamp(b.y0 - h * f),
    x1: clamp(b.x1 + w * f), y1: clamp(b.y1 + h * f),
  };
}

let nextId = 1;

/**
 * Update tracked zones from fresh detections. Pure except the id counter.
 * Flow: score/match filter -> NMS -> match tracks -> confirm after 2s ->
 * widen 20% (50% when approaching) -> expire after 30s unmatched.
 * Returns ALL live tracks (caller threads them back as `prev`);
 * use confirmedZones() for behavior input.
 */
export function trackZones(prev: TrackedZone[], dets: Detection[], now: number): TrackedZone[] {
  const matched: Detection[] = [];
  for (const d of dets) {
    if (d.score < MIN_SCORE) continue;
    const ko = matchDanger(d.label);
    if (ko) matched.push({ ...d, label: ko });
  }
  const kept = nms(matched);
  const used = new Set<number>();
  const out: TrackedZone[] = [];
  for (const t of prev) {
    let best = -1;
    let bestIou = MATCH_IOU;
    kept.forEach((d, i) => {
      if (used.has(i) || d.label !== t.label) return;
      const v = iou(d.box, t.box);
      if (v > bestIou) {
        bestIou = v;
        best = i;
      }
    });
    if (best < 0) {
      if (now - t.lastSeen < EXPIRE_S) out.push(t); // keep, await re-match
      continue;
    }
    used.add(best);
    const box = kept[best].box;
    const approaching = boxArea(box) / Math.max(t.baseArea, 1e-9) >= APPROACH_GROWTH;
    out.push({
      ...t, box, lastSeen: now, approaching,
      confirmed: t.confirmed || now - t.firstSeen >= CONFIRM_S,
    });
  }
  for (let i = 0; i < kept.length; i++) {
    if (used.has(i)) continue;
    const box = kept[i].box;
    // Fresh candidates start unconfirmed; sim-grounded callers confirm below.
    out.push({
      id: nextId++, label: kept[i].label, box,
      firstSeen: now, lastSeen: now, baseArea: Math.max(boxArea(box), 1e-9),
      confirmed: false, approaching: false,
    });
  }
  // Widen confirmed zones (render + behavior input); keep candidates raw.
  return out.map((t) => (t.confirmed
    ? { ...t, box: widen(t.box, t.approaching ? WIDEN_APPROACH : WIDEN) }
    : t));
}

/** Confirmed zones only (for behavior input after trackZones). */
export function confirmedZones(zones: TrackedZone[]): TrackedZone[] {
  return zones.filter((z) => z.confirmed);
}

/**
 * Sim-mode fake detections from "?hazard=칼:0.2,0.3;가위:0.7,0.5".
 * Each entry is label:center-x,center-y with a default 0.2x0.2 box.
 */
export function parseSimHazard(param: string | null): Detection[] {
  if (!param) return [];
  const out: Detection[] = [];
  for (const part of param.split(";")) {
    const m = part.trim().match(/^(.+):([0-9.]+),([0-9.]+)$/);
    if (!m) continue;
    const ko = matchDanger(m[1]);
    if (!ko) continue;
    const cx = Number(m[2]);
    const cy = Number(m[3]);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    out.push({
      label: ko, score: 1,
      box: { x0: cx - 0.1, y0: cy - 0.1, x1: cx + 0.1, y1: cy + 0.1 },
    });
  }
  return out;
}

/** Sim detections enter pre-confirmed (they stand in for seen objects). */
export function simZones(param: string | null, now: number): TrackedZone[] {
  return parseSimHazard(param).map((d) => ({
    id: nextId++, label: d.label, box: widen(d.box, WIDEN),
    firstSeen: now - CONFIRM_S, lastSeen: now,
    baseArea: Math.max(boxArea(d.box), 1e-9),
    confirmed: true, approaching: false,
  }));
}

/**
 * Screen zones -> J's world-XZ DangerZone. `project` maps normalized
 * screen (x, y) to floor (x, z); supplied by pov (owns the camera).
 */
export function toWorldZones(
  zones: TrackedZone[],
  project: (x: number, y: number) => { x: number; z: number },
): DangerZone[] {
  return confirmedZones(zones).map((z) => {
    const a = project(z.box.x0, z.box.y0);
    const b = project(z.box.x1, z.box.y1);
    const c = project((z.box.x0 + z.box.x1) / 2, (z.box.y0 + z.box.y1) / 2);
    return {
      x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x),
      z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z),
      cx: c.x, approaching: z.approaching,
    };
  });
}

/** Resettable id counter (tests). */
export function resetZoneIds(): void {
  nextId = 1;
}

// --- detector factory (pov camera loop; dynamic import keeps node safe) ---
export type HazardDetector = {
  detect: (image: unknown, width: number, height: number) => Promise<Detection[]>;
  close: () => void;
};

/** Create the on-device ObjectDetector (browser only; pov calls this). */
export async function createDetector(): Promise<HazardDetector> {
  const vision = await import("@mediapipe/tasks-vision");
  // [EXT:cdn-mediapipe] 로컬 번들(외부 호출 없음) — 출처: public/vendor/LICENSES.md
  const fileset = await vision.FilesetResolver.forVisionTasks("/vendor/mediapipe");
  const detector = await vision.ObjectDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
    scoreThreshold: MIN_SCORE,
    runningMode: "VIDEO",
  });
  return {
    detect: async (image: unknown, width: number, height: number) => {
      const t0 = performance.now();
      const res = detector.detectForVideo(image as never, t0);
      const w = Math.max(width, 1);
      const h = Math.max(height, 1);
      return (res.detections ?? []).map((d) => {
        const ox = d.boundingBox?.originX ?? 0;
        const oy = d.boundingBox?.originY ?? 0;
        const bw = d.boundingBox?.width ?? 0;
        const bh = d.boundingBox?.height ?? 0;
        return {
          label: d.categories?.[0]?.categoryName ?? "",
          score: d.categories?.[0]?.score ?? 0,
          box: { x0: ox / w, y0: oy / h, x1: (ox + bw) / w, y1: (oy + bh) / h },
        };
      });
    },
    close: () => detector.close(),
  };
}
