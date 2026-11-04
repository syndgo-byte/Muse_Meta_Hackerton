// FN-1: 감정 아이콘 (표정 덧대기 대체). 머리 위 1.0초 표시.
// inline canvas 벡터만 사용 — 이모지 폰트 없음.
import * as THREE from "three";

export type EmoteIconKind =
  | "heart" | "drop" | "bang" | "question" | "zzz" | "sparkle" | "anger";

// FN-1 6종: greet→느낌표, happy→반짝이, eat→하트, roam→물음표,
// sleep→Zzz, hurt→땀방울. 나머지는 같은 팔레트에서 보너스 매핑.
export const EMOTE_ICON: Record<string, EmoteIconKind | null> = {
  idle: null,
  greet: "bang",
  happy: "sparkle",
  eat: "heart",
  roam: "question",
  sleep: "zzz",
  drowsy: "zzz",
  faint: "zzz",
  hurt: "drop",
  cry: "drop",
  hungry: "drop",
  attack: "anger",
  cuddle: "heart",
  pat: "heart",
  chomp: "heart",
  beg: "question",
  want: "question",
  fetch: "bang",
  zoomies: "sparkle",
};

const CHIP = "rgba(8,12,24,0.72)";

function drawChip(g: CanvasRenderingContext2D, s: number): void {
  g.clearRect(0, 0, s, s);
  const r = s * 0.22;
  g.beginPath();
  g.roundRect(s * 0.06, s * 0.06, s * 0.88, s * 0.88, r);
  g.fillStyle = CHIP;
  g.fill();
  g.strokeStyle = "rgba(255,255,255,0.35)";
  g.lineWidth = s * 0.025;
  g.stroke();
}

function drawGlyph(g: CanvasRenderingContext2D, s: number, kind: EmoteIconKind): void {
  const c = s / 2;
  if (kind === "heart") {
    g.fillStyle = "#ff6b8a";
    g.beginPath();
    g.moveTo(c, s * 0.78);
    g.bezierCurveTo(s * 0.08, s * 0.52, s * 0.22, s * 0.18, c, s * 0.4);
    g.bezierCurveTo(s * 0.78, s * 0.18, s * 0.92, s * 0.52, c, s * 0.78);
    g.fill();
  } else if (kind === "drop") {
    g.fillStyle = "#4fc3f7";
    g.beginPath();
    g.moveTo(c, s * 0.16);
    g.bezierCurveTo(c + s * 0.22, s * 0.48, c + s * 0.2, s * 0.66, c, s * 0.78);
    g.bezierCurveTo(c - s * 0.2, s * 0.66, c - s * 0.22, s * 0.48, c, s * 0.16);
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.75)";
    g.beginPath();
    g.arc(c - s * 0.06, s * 0.62, s * 0.045, 0, Math.PI * 2);
    g.fill();
  } else if (kind === "sparkle") {
    g.fillStyle = "#ffd84a";
    g.beginPath();
    const R = s * 0.32, r = s * 0.09;
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i - Math.PI / 2;
      const rr = i % 2 === 0 ? R : r;
      const x = c + Math.cos(a) * rr, y = c + Math.sin(a) * rr;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
    g.fill();
  } else if (kind === "anger") {
    g.strokeStyle = "#ff5a5a";
    g.lineWidth = s * 0.07;
    g.lineCap = "round";
    const arms: Array<[number, number, number, number]> = [
      [0, -1, 0.5, -0.5], [0, 1, 0.5, 0.5], [-1, 0, -0.5, -0.5], [1, 0, 0.5, 0.5],
    ];
    for (const [dx, dy, ex, ey] of arms) {
      g.beginPath();
      g.moveTo(c + dx * s * 0.26, c + dy * s * 0.26);
      g.quadraticCurveTo(
        c + dx * s * 0.05 + ex * s * 0.08, c + dy * s * 0.05 + ey * s * 0.08,
        c + ex * s * 0.3, c + ey * s * 0.3
      );
      g.stroke();
    }
  } else if (kind === "bang") {
    g.fillStyle = "#ffd84a";
    g.font = `900 ${s * 0.62}px system-ui, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("!", c, c + s * 0.03);
  } else if (kind === "question") {
    g.fillStyle = "#ffffff";
    g.font = `900 ${s * 0.6}px system-ui, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("?", c, c + s * 0.03);
  } else {
    // zzz: 두 글자 크기 다르게
    g.fillStyle = "#ffffff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `italic 900 ${s * 0.42}px system-ui, sans-serif`;
    g.fillText("Z", c - s * 0.13, c - s * 0.08);
    g.font = `italic 900 ${s * 0.26}px system-ui, sans-serif`;
    g.fillText("z", c + s * 0.17, c + s * 0.14);
  }
}

const texCache = new Map<EmoteIconKind, THREE.CanvasTexture>();

function iconTexture(kind: EmoteIconKind): THREE.CanvasTexture {
  const hit = texCache.get(kind);
  if (hit) return hit;
  const cv = document.createElement("canvas");
  cv.width = 128;
  cv.height = 128;
  const g = cv.getContext("2d");
  if (g) {
    drawChip(g, 128);
    drawGlyph(g, 128, kind);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(kind, t);
  return t;
}

// 머리 위 감정 아이콘 1개 관리 (재트리거 시 리셋). Sprite라 항상 빌보드.
export class EmoteIcon {
  private sprite: THREE.Sprite | null = null;
  private until = -1;
  private rise = 0;
  private anchor: (() => THREE.Vector3) | null = null;

  constructor(private scene: THREE.Scene) {}

  show(kind: EmoteIconKind, anchor: () => THREE.Vector3, now: number, dur = 1.0): void {
    if (!this.sprite) {
      const mat = new THREE.SpriteMaterial({
        map: iconTexture(kind),
        transparent: true,
        depthTest: true,
      });
      this.sprite = new THREE.Sprite(mat);
      this.sprite.scale.set(0.3, 0.3, 1);
      this.sprite.renderOrder = 50;
      this.scene.add(this.sprite);
    } else {
      (this.sprite.material as THREE.SpriteMaterial).map = iconTexture(kind);
      (this.sprite.material as THREE.SpriteMaterial).needsUpdate = true;
    }
    this.anchor = anchor;
    this.rise = 0;
    this.until = now + dur;
    this.sprite.visible = true;
    try {
      (window as unknown as Record<string, unknown>).__emoteIcon = kind;
    } catch {
      /* review flag only */
    }
  }

  get visible(): boolean {
    return !!this.sprite?.visible;
  }

  update(now: number, dt: number): void {
    if (!this.sprite || !this.sprite.visible) return;
    if (now >= this.until) {
      this.sprite.visible = false;
      return;
    }
    const left = this.until - now;
    this.rise = Math.min(0.18, this.rise + dt * 0.18);
    if (this.anchor) {
      const p = this.anchor();
      this.sprite.position.set(p.x, p.y + this.rise, p.z);
    }
    (this.sprite.material as THREE.SpriteMaterial).opacity = left < 0.3 ? left / 0.3 : 1;
  }

  dispose(): void {
    if (this.sprite) {
      this.scene.remove(this.sprite);
      (this.sprite.material as THREE.SpriteMaterial).dispose();
      this.sprite = null;
    }
  }
}
