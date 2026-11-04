// 스캔 조우: 사물 → 종 표 24종 (BATTLE_DESIGN §15-1a).
// 힌트에는 사물 이름을 넣지 않는다. 순수 모듈 (클라이언트 안전).
export type Env = "cafe" | "street" | "room";

export interface EncounterRow {
  speciesId: string;
  keywords: string[];
  hint: string;
  hintEn: string;
  env: Env;
}

export const ENCOUNTER_TABLE: EncounterRow[] = [
  { speciesId: "fire-01", keywords: ["커피", "에스프레소", "아메리카노", "라떼", "카푸치노"], hint: "따뜻한 갈색 음료가 담긴 잔", hintEn: "The cup with the warm brown drink", env: "cafe" },
  { speciesId: "fire-02", keywords: ["고양이", "난로", "벽난로", "장작", "모닥불"], hint: "따뜻한 곳에서 낮잠 자는 털뭉치", hintEn: "A furry lump napping somewhere warm", env: "street" },
  { speciesId: "fire-03", keywords: ["지하철", "전철역", "히터", "온풍기"], hint: "땅속을 달리는 탈것이 서는 곳", hintEn: "Where the underground ride stops", env: "street" },
  { speciesId: "fire-04", keywords: ["초콜릿", "핫초코", "브라우니", "초코"], hint: "달콤하고 진한 갈색 간식", hintEn: "A sweet, dark brown treat", env: "cafe" },
  { speciesId: "fire-05", keywords: ["양초", "촛불", "케이크", "캔들"], hint: "생일에 불을 붙이는 것", hintEn: "The thing you light on a birthday", env: "cafe" },
  { speciesId: "grass-01", keywords: ["화분", "몬스테라", "화초", "관엽식물", "식물"], hint: "잎이 넓은 실내 초록 친구", hintEn: "The broad-leafed green friend indoors", env: "cafe" },
  { speciesId: "grass-02", keywords: ["콩나물", "숙주", "새싹", "나물"], hint: "국에 들어가는 가는 싹", hintEn: "Thin sprouts floating in soup", env: "room" },
  { speciesId: "grass-03", keywords: ["버섯", "우산"], hint: "비 오는 날 펼치는 동그란 지붕", hintEn: "The round roof you open in the rain", env: "street" },
  { speciesId: "grass-04", keywords: ["강아지", "잔디", "공원", "반려견"], hint: "풀밭에서 뛰노는 친구", hintEn: "A friend playing on the lawn", env: "street" },
  { speciesId: "grass-05", keywords: ["선인장", "다육이", "다육식물"], hint: "가시가 돋은 창가 식물", hintEn: "The spiky plant on the windowsill", env: "room" },
  { speciesId: "water-01", keywords: ["생수", "물병", "페트병", "물컵"], hint: "투명한 물이 담긴 병", hintEn: "A bottle of clear water", env: "cafe" },
  { speciesId: "water-02", keywords: ["수도꼭지", "세면대", "싱크대", "정수기"], hint: "돌리면 물이 나오는 손잡이", hintEn: "The handle that pours water when turned", env: "room" },
  { speciesId: "water-03", keywords: ["어항", "물고기", "금붕어", "수족관"], hint: "유리 안에서 헤엄치는 것", hintEn: "Something swimming behind glass", env: "room" },
  { speciesId: "water-04", keywords: ["웅덩이", "빗물", "개구리", "장화"], hint: "비 온 뒤 길바닥에 고인 것", hintEn: "What puddles on the road after rain", env: "street" },
  { speciesId: "water-05", keywords: ["얼음", "아이스", "빙수", "아이스크림", "냉동실"], hint: "차갑게 얼린 것", hintEn: "Something frozen cold", env: "room" },
  { speciesId: "rock-01", keywords: ["조약돌", "돌멩이", "바위", "등산로"], hint: "산길에 굴러다니는 단단한 것", hintEn: "Hard things rolling on the trail", env: "street" },
  { speciesId: "rock-02", keywords: ["콘크리트", "시멘트", "공사장", "벽돌", "라바콘"], hint: "안전모를 쓰는 곳", hintEn: "Where people wear hard hats", env: "street" },
  { speciesId: "rock-03", keywords: ["자갈", "모래", "개울", "냇가"], hint: "물가 바닥에 깔린 작은 알갱이", hintEn: "Tiny pebbles lining the stream bed", env: "street" },
  { speciesId: "rock-04", keywords: ["터널", "동굴", "지하주차장", "박쥐"], hint: "햇빛이 들지 않는 어두운 통로", hintEn: "A dark passage the sun never reaches", env: "street" },
  { speciesId: "wind-01", keywords: ["빨래", "건조대", "수건", "옷걸이"], hint: "햇볕에 말리는 것", hintEn: "Things drying in the sun", env: "room" },
  { speciesId: "wind-02", keywords: ["먼지", "햇살", "창문", "블라인드"], hint: "햇빛이 비치는 창가", hintEn: "The sunny side of the window", env: "room" },
  { speciesId: "wind-03", keywords: ["종이학", "종이접기", "색종이", "연날리기"], hint: "접어서 만드는 새", hintEn: "A bird made by folding", env: "room" },
  { speciesId: "wind-04", keywords: ["선풍기", "서큘레이터", "에어컨", "환풍기"], hint: "날개가 돌며 바람을 보내는 것", hintEn: "Spinning wings sending a breeze", env: "room" },
  { speciesId: "wind-05", keywords: ["식빵", "빵집", "크루아상", "베이글", "모닝빵", "구름"], hint: "폭신하게 부푼 아침 식사", hintEn: "A fluffy, risen breakfast", env: "cafe" },
];

export type MatchResult =
  | { speciesId: string; keyword: string }
  | { speciesId: null; reason: "low-confidence" | "no-match" };

// label 부분 문자열 매칭. 여러 종이면 가장 긴 키워드, 동점이면 표 순서.
// 한 글자 키워드는 표에 넣지 않는다. confidence < 60이면 매칭 없음.
export function matchLabel(label: string, confidence: number): MatchResult {
  if (!Number.isFinite(confidence) || confidence < 60) {
    return { speciesId: null, reason: "low-confidence" };
  }
  const text = (label ?? "").trim();
  if (!text) return { speciesId: null, reason: "no-match" };
  let best: { speciesId: string; keyword: string } | null = null;
  for (const row of ENCOUNTER_TABLE) {
    for (const kw of row.keywords) {
      if (kw.length < 2) continue;
      if (!text.includes(kw)) continue;
      if (!best || kw.length > best.keyword.length) {
        best = { speciesId: row.speciesId, keyword: kw };
      }
    }
  }
  if (!best) return { speciesId: null, reason: "no-match" };
  return best;
}

export function rowOf(speciesId: string): EncounterRow | null {
  return ENCOUNTER_TABLE.find((r) => r.speciesId === speciesId) ?? null;
}
