// components/battle/fx.ts — G2 배틀 연출 순수 로직 (BATTLE_DESIGN §10-1, §13-1).
// 의존성 없음 (verify-battlefx.mjs가 tsc 단독 컴파일).
// 연출은 엔진 이벤트 배열만 읽는다 (BattleEvent 구조 호환).

export type FxSide = "mine" | "wild";

export type FxKind = "melee" | "ranged" | "buff" | "debuff";

export interface FxInput {
  type: string;
  target: FxSide;
  value?: number;
  element?: string;
  crit?: boolean;
  effect?: string;
  stat?: string;
  delta?: number;
  status?: string;
  /** J-2: 기술 종류. 없으면 기존 연출 그대로. */
  kind?: FxKind;
  /** J-2: 기술명 (디버프 색 구분용). */
  skill?: string;
}

export type BadgeTone = "none" | "good" | "bad" | "crit" | "miss" | "buff" | "debuff"; // BP-4 효과 말풍선 6종

export interface FxItem {
  id: string;
  side: FxSide;
  text: string;
  color: string;
  big: boolean;
  small: boolean;
  delayMs: number;
  dx: number;
  badge: BadgeTone; // BP-4: 말풍선 톤(none=숫자 그대로)
  stack: number; // BP-4: 같은 편의 n번째 배지(0부터, 위로 22px씩)
}

export interface FxBurst {
  side: FxSide;
  color: string;
  count: number;
  dir: "up" | "all" | "down";
  delayMs: number;
  /** 9-E: 입자 출발지 (없으면 side). 공격은 상대 쪽에서 날아간다. */
  from?: FxSide;
  /** J-2: 특수 입자 모양 (없으면 기존 방식). */
  shape?: "fireball" | "lunge" | "ring-up" | "ring-down";
  /** BP-2: 투사체 속성 (fireball 스프라이트 선택용). */
  element?: string;
}

export interface FxRing {
  side: FxSide;
  element?: string;
}

export interface FxFlags {
  shakeMine: number;
  shakeWild: number;
  flashMine: boolean;
  flashWild: boolean;
  vignette: boolean;
  faintMine: boolean;
  faintWild: boolean;
}

export const ELEMENT_FX_COLOR: Record<string, string> = {
  fire: "#ff7a45",
  water: "#4fc3f7",
  grass: "#66bb6a",
  rock: "#a1887f",
  wind: "#b0bec5",
  none: "#ffffff",
  // J-2: 디버프 기술명별 색 (차가운 계열 3종, 기존 디버프 링과 동계).
  debuff0: "#60a5fa",
  debuff1: "#2dd4bf",
  debuff2: "#22d3ee",
};

/** J-2: 기술명을 디버프 색 키로 (결정적, 같은 기술은 항상 같은 색). */
export function debuffHue(skill?: string): string {
  if (!skill) return "debuff0";
  let h = 0;
  for (let i = 0; i < skill.length; i++) h = (h + skill.charCodeAt(i)) | 0;
  return `debuff${Math.abs(h) % 3}`;
}

export const ELEMENT_KO: Record<string, string> = {
  fire: "불",
  grass: "풀",
  water: "물",
  rock: "바위",
  wind: "바람",
  none: "무",
};

export const STATUS_LABEL: Record<string, string> = {
  burn: "그슬림",
  wrap: "덩굴감김",
  crack: "균열",
  dizzy: "어지럼",
  soak: "흠뻑",
};

export const STATUS_ELEMENT: Record<string, string> = {
  burn: "fire",
  wrap: "grass",
  crack: "rock",
  dizzy: "wind",
  soak: "water",
};

export const STAGE_KO: Record<string, string> = {
  ATK: "공격",
  DEF: "방어",
  SPD: "스피드",
  ACC: "명중",
};

const elColor = (el?: string) => ELEMENT_FX_COLOR[el ?? "none"] ?? "#ffffff";
const elKo = (el?: string) => ELEMENT_KO[el ?? "none"] ?? "?";

// 한 턴 이벤트 배열 → 플로터 + 입자 + 링 + 플래그. 0.25초 간격 stagger, 좌우 ±12px.
export function fxFromEvents(
  events: FxInput[],
  salt = 0
): { items: FxItem[]; bursts: FxBurst[]; flags: FxFlags; rings: FxRing[] } {
  const items: FxItem[] = [];
  const bursts: FxBurst[] = [];
  const rings: FxRing[] = [];
  const flags: FxFlags = {
    shakeMine: 0,
    shakeWild: 0,
    flashMine: false,
    flashWild: false,
    vignette: false,
    faintMine: false,
    faintWild: false,
  };
  let n = 0;
  const badgeN: Record<FxSide, number> = { mine: 0, wild: 0 }; // BP-4 편의 n번째 배지
  const push = (side: FxSide, text: string, color: string, big = false, small = false, badge: BadgeTone = "none") => {
    items.push({
      id: `fx${salt}-${n}`,
      side,
      text,
      color,
      big,
      small,
      delayMs: n * 250,
      dx: n % 2 === 0 ? -12 : 12,
      badge,
      stack: badge === "none" ? 0 : badgeN[side]++,
    });
    n++;
  };
  const burst = (side: FxSide, color: string, count: number, dir: FxBurst["dir"], from?: FxSide, shape?: FxBurst["shape"], delayExtra = 0, element?: string) => {
    bursts.push({ side, color, count, dir, delayMs: Math.max(0, (n - 1) * 250) + delayExtra, ...(from ? { from } : {}), ...(shape ? { shape } : {}), ...(element ? { element } : {}) });
  };
  const ring = (side: FxSide, element?: string) => {
    if (!rings.some((r) => r.side === side)) rings.push(element ? { side, element } : { side });
  };
  const shake = (side: FxSide, times: number) => {
    if (side === "mine") flags.shakeMine = Math.max(flags.shakeMine, times);
    else flags.shakeWild = Math.max(flags.shakeWild, times);
  };
  const flash = (side: FxSide) => {
    if (side === "mine") flags.flashMine = true;
    else flags.flashWild = true;
  };

  for (const e of events) {
    const t = e.target === "mine" ? "mine" : "wild";
    switch (e.type) {
      case "damage": {
        const v = Math.max(0, Math.floor(e.value ?? 0));
        const atk: FxSide = t === "wild" ? "mine" : "wild"; // 9-E: 공격은 때린 쪽에서 날아간다
        const hitColor = e.crit ? "#ff5a5a" : elColor(e.element);
        const hitCount = e.crit ? 10 : e.effect === "good" ? 10 : e.effect === "bad" ? 6 : 8;
        if (e.kind === "melee") {
          // J-2 콩콩 들이받기: 돌진(왕복) + 적중 시 기존 흔들림과 입자 1회.
          burst(t, elColor(e.element), 8, "all", atk, "lunge");
          burst(atk, elColor(e.element), 8, "all", t, "lunge", 100);
          if (e.crit) {
            push(t, `-${v}!`, "#ffd84a", true);
            push(t, "치명타!", "#ffd84a", false, false, "crit"); // BP-4
            flags.vignette = true;
            shake(t, 2);
            flash(t);
            burst(t, hitColor, hitCount, "all", t, undefined, 100);
          } else {
            push(t, `-${v}`, "#ffffff");
            if (e.effect === "good") { shake(t, 2); flash(t); }
            else if (e.effect !== "bad") { shake(t, 1); flash(t); }
            burst(t, hitColor, hitCount, "all", t, undefined, 100);
          }
          if (e.effect === "good") push(t, "약점 공략!", "#fb923c", false, false, "good"); // BP-4
          else if (e.effect === "bad") push(t, "버텼다", "#8fa3bf", false, false, "bad"); // BP-4
        } else if (e.kind === "ranged") {
          // J-2 원거리공격: 발사체 + 착탄 시 입자. 흔들림은 즉시(고속탄과 대략 동기).
          burst(t, elColor(e.element), 14, "all", atk, "fireball", 0, e.element);
          if (e.crit) {
            push(t, `-${v}!`, "#ffd84a", true);
            push(t, "치명타!", "#ffd84a", false, false, "crit"); // BP-4
            flags.vignette = true;
            shake(t, 2);
            flash(t);
            burst(t, hitColor, hitCount, "all", t, undefined, 350);
          } else {
            push(t, `-${v}`, "#ffffff");
            if (e.effect === "good") { shake(t, 2); flash(t); }
            else if (e.effect !== "bad") { shake(t, 1); flash(t); }
            burst(t, hitColor, hitCount, "all", t, undefined, 350);
          }
          if (e.effect === "good") push(t, "약점 공략!", "#fb923c", false, false, "good"); // BP-4
          else if (e.effect === "bad") push(t, "버텼다", "#8fa3bf", false, false, "bad"); // BP-4
        } else if (e.crit) {
          push(t, `-${v}!`, "#ffd84a", true);
          push(t, "치명타!", "#ffd84a", false, false, "crit"); // BP-4
          flags.vignette = true;
          shake(t, 2);
          flash(t);
          burst(t, "#ff5a5a", 10, "all", atk);
        } else {
          push(t, `-${v}`, "#ffffff");
          if (e.effect === "good") {
            shake(t, 2);
            flash(t);
            burst(t, elColor(e.element), 12, "all", atk);
          } else if (e.effect !== "bad") {
            shake(t, 1);
            flash(t);
            burst(t, elColor(e.element), 6, "all", atk);
          }
        }
        if (e.effect === "good") push(t, "약점 공략!", "#fb923c", false, false, "good"); // BP-4
        else if (e.effect === "bad") push(t, "버텼다", "#8fa3bf", false, false, "bad"); // BP-4
        break;
      }
      case "miss":
        push(t, "빗나감", "#dbe3ec", false, false, "miss"); // BP-4 말풍선
        if (e.kind === "melee") {
          // 빗나간 돌진: 왕복만, 적중 없음.
          const atk: FxSide = t === "wild" ? "mine" : "wild";
          burst(t, elColor(e.element), 8, "all", atk, "lunge");
          burst(atk, elColor(e.element), 8, "all", t, "lunge", 100);
        } else if (e.kind === "ranged") {
          // 빗나간 발사체: 날아가고 끝, 착탄 없음.
          const atk: FxSide = t === "wild" ? "mine" : "wild";
          burst(t, elColor(e.element), 14, "all", atk, "fireball", 0, e.element);
        }
        break;
      case "heal":
        push(t, `+${Math.max(0, Math.floor(e.value ?? 0))}`, "#4ade80");
        burst(t, "#4ade80", 8, "up");
        if (e.kind === "buff") ring(t);
        break;
      case "stage": {
        const up = (e.delta ?? 0) > 0;
        push(t, `${STAGE_KO[e.stat ?? ""] ?? "?"}${up ? "↑" : "↓"}`, up ? "#22d3ee" : "#c084fc", false, false, up ? "buff" : "debuff"); // BP-4
        if (e.kind === "buff" && up) {
          // J-2 버프: 속성색 링 + 솟는 입자 (stage 호박색과 구분).
          ring(t, e.element);
          burst(t, elColor(e.element), 12, "up", undefined, "ring-up");
          burst(t, elColor(e.element), 6, "up");
        } else if (e.kind === "debuff" && !up) {
          // J-2 디버프: 기술명별 색 링 + 가라앉는 입자.
          const hue = debuffHue(e.skill);
          ring(t, hue);
          burst(t, elColor(hue), 12, "down", undefined, "ring-down");
          burst(t, elColor(hue), 6, "down");
        } else {
          burst(t, up ? "#f59e0b" : "#60a5fa", 6, up ? "up" : "down");
          if (!up) ring(t); // 9-E: 디버프 링
        }
        break;
      }
      case "resist": {
        const up = (e.delta ?? 0) > 0;
        push(t, `${elKo(e.element)}저항 ${up ? "▲" : "▼"}`, elColor(e.element));
        burst(t, elColor(e.element), 4, "all");
        break;
      }
      case "status-apply":
        push(t, `${STATUS_LABEL[e.status ?? ""] ?? "?"}!`, elColor(STATUS_ELEMENT[e.status ?? ""]));
        if (e.kind === "debuff") {
          // J-2: 기술명별 색 링 + 가라앉는 입자.
          const hue = debuffHue(e.skill);
          ring(t, hue);
          burst(t, elColor(hue), 10, "down", undefined, "ring-down");
          burst(t, elColor(hue), 6, "down");
        } else {
          ring(t, STATUS_ELEMENT[e.status ?? ""]); // 9-E: 디버프 링 (상태 속성색)
        }
        break;
      case "status-tick":
        push(t, `-${Math.max(0, Math.floor(e.value ?? 0))}`, elColor(STATUS_ELEMENT[e.status ?? ""]), false, true);
        burst(t, elColor(STATUS_ELEMENT[e.status ?? ""]), 1, "all");
        break;
      case "faint":
        push(t, "쓰러짐", "#ffffff");
        if (t === "mine") flags.faintMine = true;
        else flags.faintWild = true;
        break;
      default:
        break;
    }
  }
  return { items, bursts, flags, rings };
}

// 우리 공격 모션(적중·빗나감) → playCry(mineId, "attack") 1회.
export function shouldPlayAttackCry(events: FxInput[]): boolean {
  return events.some((e) => (e.type === "damage" || e.type === "miss") && e.target === "wild");
}

// ---- §13-1 음성 선택 파싱 ----

// 번호: "1번"~"4번", "1호"~"4호", 맨 숫자, 첫~넷째/번째 → 인덱스 0~3.
export function parseSkillNumber(text: string): number | null {
  const t = text.replace(/\s+/g, "");
  const m = t.match(/([1-4])\s*[번호]/) ?? t.match(/^([1-4])$/);
  if (m) return Number(m[1]) - 1;
  const ord: Array<[RegExp, number]> = [
    [/첫\s*(번째|째)/, 0],
    [/두\s*(번째|째)/, 1],
    [/세\s*(번째|째)/, 2],
    [/네\s*(번째|째)/, 3],
  ];
  for (const [re, i] of ord) {
    if (re.test(text)) return i;
  }
  return null;
}

// 이름: 두 글자 연속 일치하면 채택. 범위 밖·불일치 → null.
export function matchSkillName(spoken: string, names: string[]): number | null {
  const s = spoken.replace(/\s+/g, "");
  if (s.length < 2) return null;
  for (let i = 0; i < names.length; i++) {
    const name = names[i].replace(/\s+/g, "");
    for (let k = 0; k + 2 <= s.length; k++) {
      if (name.includes(s.slice(k, k + 2))) return i;
    }
  }
  return null;
}
