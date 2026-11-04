// lib/josa.ts — UH-1: 받침 판별 조사 하나 (화면 문구의 이(가)·을(를) 교체용).
// 규칙: 한글 음절 종성 유무. 한글이 아니면 받침 없음 취급. '으로'는 받침 ㄹ 뒤에서 '로'.

export type JosaKind = "이가" | "을를" | "은는" | "와과" | "으로";

export function hasJong(word: string): boolean {
  if (!word) return false;
  const c = word.charCodeAt(word.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return false;
  return (c - 0xac00) % 28 !== 0;
}

function endsRieul(word: string): boolean {
  if (!word) return false;
  const c = word.charCodeAt(word.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return false;
  return (c - 0xac00) % 28 === 8;
}

export function josa(word: string, kind: JosaKind): string {
  const w = word ?? "";
  if (!w) return kind;
  const jong = hasJong(w);
  switch (kind) {
    case "이가":
      return w + (jong ? "이" : "가");
    case "을를":
      return w + (jong ? "을" : "를");
    case "은는":
      return w + (jong ? "은" : "는");
    case "와과":
      return w + (jong ? "과" : "와");
    case "으로":
      return w + (jong && !endsRieul(w) ? "으로" : "로");
  }
}
