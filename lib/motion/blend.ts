// 작업 2: 감정 전환 블렌딩 + 꼬리 2차 모션.
// - 감정이 바뀌는 순간에만 직전 출력 → 새 출력으로 BLEND_DUR(0.25초) smoothstep 보간.
// - 보간 중이 아닐 때 꼬리 외 전 채널은 poseFor 결과와 비트 동일 (걷기 위상 보존).
// - 꼬리(B_TAIL)는 임계감쇠 스프링으로 지연 추종. 다른 본은 스프링이 건드리지 않음.
import { B_TAIL, neutralPose, type BonePose } from "../autoRig";

export const BLEND_DUR = 0.25;
const TAIL_STIFFNESS = 120;
const TAIL_DAMPING = 2 * Math.sqrt(TAIL_STIFFNESS);
const DT_MAX = 0.05;

function smooth(x: number): number {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
}

function copyPose(dst: BonePose, src: BonePose): void {
  dst.rx.set(src.rx);
  dst.ry.set(src.ry);
  dst.rz.set(src.rz);
  dst.sx = src.sx;
  dst.sy = src.sy;
  dst.sz = src.sz;
}

export class PoseBlender {
  private out: BonePose = neutralPose();
  private start: BonePose = neutralPose();
  private lastEmote: string | null = null;
  private blendT = BLEND_DUR;
  private tp = [0, 0, 0]; // 꼬리 스프링 위치 (rx, ry, rz)
  private tv = [0, 0, 0]; // 꼬리 스프링 속도

  reset(): void {
    this.lastEmote = null;
    this.blendT = BLEND_DUR;
  }

  update(emote: string, target: BonePose, dt: number): BonePose {
    const step = Math.min(Math.max(dt, 0), DT_MAX);
    if (this.lastEmote === null) {
      // 첫 호출: 블렌드 없이 스냅.
      copyPose(this.out, target);
      this.tp = [target.rx[B_TAIL], target.ry[B_TAIL], target.rz[B_TAIL]];
      this.tv = [0, 0, 0];
      this.lastEmote = emote;
      this.blendT = BLEND_DUR;
      return this.out;
    }
    if (emote !== this.lastEmote) {
      copyPose(this.start, this.out);
      this.blendT = 0;
      this.lastEmote = emote;
    }
    this.blendT += step;
    const n = target.rx.length;
    if (this.blendT >= BLEND_DUR) {
      // 보간 종료: 목표 그대로 복사 (비트 동일).
      for (let b = 0; b < n; b++) {
        if (b === B_TAIL) continue;
        this.out.rx[b] = target.rx[b];
        this.out.ry[b] = target.ry[b];
        this.out.rz[b] = target.rz[b];
      }
      this.out.sx = target.sx;
      this.out.sy = target.sy;
      this.out.sz = target.sz;
      this.springTail(target.rx[B_TAIL], target.ry[B_TAIL], target.rz[B_TAIL], step);
    } else if (this.blendT <= 0) {
      // 전환 직후(dt=0): 직전 출력 그대로.
      for (let b = 0; b < n; b++) {
        if (b === B_TAIL) continue;
        this.out.rx[b] = this.start.rx[b];
        this.out.ry[b] = this.start.ry[b];
        this.out.rz[b] = this.start.rz[b];
      }
      this.out.sx = this.start.sx;
      this.out.sy = this.start.sy;
      this.out.sz = this.start.sz;
      this.springTail(this.start.rx[B_TAIL], this.start.ry[B_TAIL], this.start.rz[B_TAIL], step);
    } else {
      const a = smooth(this.blendT / BLEND_DUR);
      for (let b = 0; b < n; b++) {
        if (b === B_TAIL) continue;
        this.out.rx[b] = this.start.rx[b] + (target.rx[b] - this.start.rx[b]) * a;
        this.out.ry[b] = this.start.ry[b] + (target.ry[b] - this.start.ry[b]) * a;
        this.out.rz[b] = this.start.rz[b] + (target.rz[b] - this.start.rz[b]) * a;
      }
      this.out.sx = this.start.sx + (target.sx - this.start.sx) * a;
      this.out.sy = this.start.sy + (target.sy - this.start.sy) * a;
      this.out.sz = this.start.sz + (target.sz - this.start.sz) * a;
      this.springTail(
        this.start.rx[B_TAIL] + (target.rx[B_TAIL] - this.start.rx[B_TAIL]) * a,
        this.start.ry[B_TAIL] + (target.ry[B_TAIL] - this.start.ry[B_TAIL]) * a,
        this.start.rz[B_TAIL] + (target.rz[B_TAIL] - this.start.rz[B_TAIL]) * a,
        step,
      );
    }
    return this.out;
  }

  private springTail(tx: number, ty: number, tz: number, dt: number): void {
    if (dt > 0) {
      const tg = [tx, ty, tz];
      for (let i = 0; i < 3; i++) {
        const acc = TAIL_STIFFNESS * (tg[i] - this.tp[i]) - TAIL_DAMPING * this.tv[i];
        this.tv[i] += acc * dt;
        this.tp[i] += this.tv[i] * dt;
      }
    }
    this.out.rx[B_TAIL] = this.tp[0];
    this.out.ry[B_TAIL] = this.tp[1];
    this.out.rz[B_TAIL] = this.tp[2];
  }
}
