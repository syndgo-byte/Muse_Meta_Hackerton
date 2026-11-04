// 9-B 후속: 배틀 모션 순수 코어 (PovCreature tick이 호출, verify-battle9b가 검증).
// 프레임 상태·three 없이 t(초)·k01(0~1)만으로 결정. 바운스 주기 1.5s = 3초 검증 그리드와 정렬.
export type BattleRole9B = "mine" | "wild";

/** 제자리 바운스 주기(초). 3초 간격 검증샷이 같은 위상에 걸리도록 1.5로 고정. */
export const BATTLE_BOUNCE_PERIOD = 1.5;
/** 바운스 높이(월드 단위). MODEL_H 0.6의 약 22%. */
export const BATTLE_BOUNCE_AMP = 0.13;

/** 제자리 바운스 y 오프셋. t=0에서 0(접지), 피크 1회/주기. 항상 0 이상. */
export function battleBounceY(t: number): number {
  return Math.abs(Math.sin((Math.PI * t) / BATTLE_BOUNCE_PERIOD)) * BATTLE_BOUNCE_AMP;
}

/** 바운스 위상에 맞춘 다리 굽힘(rx 가산). 착지(낮음)에서 굽고 피크에서 핀다. */
export function battleLegCrouch(bounceY: number): number {
  const norm = Math.max(0, Math.min(1, bounceY / BATTLE_BOUNCE_AMP));
  return (1 - norm) * 0.3;
}

/** 대각선 마주보기 yaw 오프셋(rad). mine은 위·오른쪽(야생 쪽), wild는 아래·왼쪽(내 쪽). */
export const BATTLE_DIAG = 0.42;

/** 배틀 중 모델 yaw 목표. mine = π−0.42(뒤·오른쪽), wild = −0.42(정면·왼쪽). */
export function battleYaw(role: BattleRole9B): number {
  return role === "mine" ? Math.PI - BATTLE_DIAG : -BATTLE_DIAG;
}

/** 공격 이동량(액터 공간). J-5: 옆·위 짧은 홉, 앞뒤(z)는 ±0.03 잔향만. k01=0·1에서 원점 복귀. */
export function battleAttackMove(k01: number, role: BattleRole9B): { x: number; y: number; z: number } {
  const lunge = Math.sin(Math.min(Math.max(k01, 0), 1) * Math.PI);
  return role === "mine"
    ? { x: lunge * 0.35, y: lunge * 0.3, z: -lunge * 0.03 }
    : { x: -lunge * 0.35, y: lunge * 0.3, z: lunge * 0.03 };
}

/** BP-2: 원거리 발사 동작 이동량. 제자리(위 미세 들썩만), 돌진 없음. k01=0·1에서 원점 복귀. */
export function battleShootMove(k01: number): { x: number; y: number; z: number } {
  const k = Math.sin(Math.min(Math.max(k01, 0), 1) * Math.PI);
  return { x: 0, y: k * 0.06, z: 0 };
}
