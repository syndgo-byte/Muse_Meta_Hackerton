// 산책 거리 누적 (로컬, 데모용). GPS 실측은 Stage 2.
const KEY = "snapquest-walk";

export function loadWalkM(): number {
  try {
    return Number(localStorage.getItem(KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

export function addWalkM(m: number): number {
  const next = loadWalkM() + m;
  try {
    localStorage.setItem(KEY, String(next));
  } catch {
    /* ignore */
  }
  return next;
}

// 사물 설명 → 속성 기운 한 줄 (Muse 비전 판정의 데모용 Mari)
export function guessElementLine(label: string): string {
  const t = label ?? "";
  if (/커피|불|화염|머그|촛불|장작/.test(t)) return "불의 기운이 느껴진다!";
  if (/식물|화분|잎|풀|나무|꽃/.test(t)) return "풀의 기운이 느껴진다!";
  if (/물|비|수영|어항|수도/.test(t)) return "물의 기운이 느껴진다!";
  if (/돌|바위|시멘트|자갈|동굴/.test(t)) return "대지의 기운이 느껴진다!";
  if (/바람|하늘|구름|연|선풍기/.test(t)) return "바람의 기운이 느껴진다!";
  return "";
}
