export type Species = {
  id: string;
  name: string;
  element: "fire" | "grass" | "water" | "rock" | "wind";
  flavor: string;
  // 로컬 초상화 (스타터 3종). 없으면 게임 안에서 Muse Image로 생성.
  image?: string;
};

// 스타일 통일선: round body, cream belly, huge glossy eyes,
// Palworld-like stylized 3D, plain dark green background.
const STYLE =
  "Original cute monster, round body, cream oval belly, huge glossy eyes, " +
  "stylized AAA creature-game art like Palworld, soft studio lighting, " +
  "full-body front view, plain dark green background, original design, " +
  "no text, no watermark";

function s(
  id: string,
  name: string,
  element: Species["element"],
  flavor: string,
  look: string,
  image?: string
): Species & { prompt: string } {
  return { id, name, element, flavor, image, prompt: `${STYLE}, ${look}` };
}

export type SpeciesFull = ReturnType<typeof s>;

export const ROSTER: SpeciesFull[] = [
  s("fire-01", "모카퐁", "fire", "뜨거운 에스프레소 잔에서 태어난 불씨 도깨비",
    "ember-orange imp, dark curved horns, glowing tail tip", "/dex/fire-01.jpg"),
  s("grass-01", "리피몽", "grass", "몬스테라 화분에서 자란 이끼 두깨비",
    "moss-green creature, leaf-sprout horns, root feet", "/dex/grass-01.jpg"),
  s("water-01", "물방울이", "water", "빗방울이 모여 태어난 방울 도깨비",
    "sky-blue droplet creature, fin ears, droplet tail", "/dex/water-01.jpg"),
  s("fire-02", "화로냥", "fire", "장작불 옆에서 낮잠 자는 아기 불고양이",
    "small orange kitten-like monster, flame-pattern tail, ember paws", "/dex/fire-02.jpg"),
  s("fire-03", "불도깨비", "fire", "지하철 난로에서 태어난 장난꾸러기",
    "chubby red imp, single bent horn, soot smudges, grin", "/dex/fire-03.jpg"),
  s("fire-04", "라바콩", "fire", "화산 초콜릿에서 태어난 콩알 몬스터",
    "bean-shaped lava creature, cracked glowing shell, tiny feet", "/dex/fire-04.jpg"),
  s("fire-05", "촛농이", "fire", "생일 케이크 촛불에서 태어난 왁스 도깨비",
    "melted candle-wax creature, wick sprout on head, drippy arms", "/dex/fire-05.jpg"),
  s("grass-02", "콩나물이", "grass", "콩나물 시루에서 자란 새싹 몬스터",
    "sprout-headed creature, bean body, dangling roots", "/dex/grass-02.jpg"),
  s("grass-03", "버섯통", "grass", "장마철 화단에 핀 우산버섯 몬스터",
    "mushroom-cap creature, spotted umbrella hat, stubby legs", "/dex/grass-03.jpg"),
  s("grass-04", "잔디멍", "grass", "공원 잔디밭에서 낮잠 자는 멍뭉이",
    "fluffy grass puppy, clover ears, dandelion tail", "/dex/grass-04.jpg"),
  s("grass-05", "선인장이", "grass", "창가 선인장에서 떨어진 가시 도깨비",
    "round cactus creature, flower bud on head, tiny thorns", "/dex/grass-05.jpg"),
  s("water-02", "수돗물이", "water", "수도꼭지에서 떨어진 물방울 기사",
    "droplet knight, faucet-handle helmet, bubble shield", "/dex/water-02.jpg"),
  s("water-03", "어항이", "water", "어항 속에서 자란 유리알 몬스터",
    "translucent fishbowl creature, seaweed hair, pebble feet", "/dex/water-03.jpg"),
  s("water-04", "장마이", "water", "장마철 웅덩이에서 태어난 개구리",
    "puddle frog, rain-cloud hat, lily-pad cape", "/dex/water-04.jpg"),
  s("water-05", "얼음콩", "water", "냉동실 얼음 트레이에서 태어난 콩알",
    "ice-cube bean creature, frost patterns, mitten hands", "/dex/water-05.jpg"),
  s("rock-01", "돌멩이", "rock", "등산로에서 주운 조약돌 도깨비",
    "smooth pebble creature, moss stripes, heavy brow", "/dex/rock-01.jpg"),
  s("rock-02", "시멘돌", "rock", "공사장에서 태어난 콘크리트 골렘",
    "small concrete golem, rebar horns, painted safety lines", "/dex/rock-02.jpg"),
  s("rock-03", "자갈이", "rock", "냇가 자갈밭에서 태어난 굴러다니는 몬스터",
    "rolling gravel ball creature, one big eye, tiny nubs", "/dex/rock-03.jpg"),
  s("rock-04", "동굴박쥐", "rock", "석회동굴 천장에서 자란 박쥐",
    "cave bat, stalactite ears, crystal spots", "/dex/rock-04.jpg"),
  s("wind-01", "바람돌이", "wind", "빨래줄에서 태어난 바람 요정",
    "swirl-bodied wind sprite, scarf arms, cloud feet", "/dex/wind-01.jpg"),
  s("wind-02", "먼지몽", "wind", "햇살 속 먼지에서 태어난 투명 도깨비",
    "dust-mote creature, sunbeam halo, barely-there body", "/dex/wind-02.jpg"),
  s("wind-03", "연날이", "wind", "하늘에 걸린 연에서 떨어진 종이학",
    "origami crane creature, paper-fold wings, string tail", "/dex/wind-03.jpg"),
  s("wind-04", "선풍기", "wind", "여름 선풍기 앞에서 태어난 회전 도깨비",
    "fan-blade imp, three spinning blades, breezy grin", "/dex/wind-04.jpg"),
  s("wind-05", "구름빵", "wind", "뭉게구름에서 떨어진 빵꾸러기",
    "bread-loaf cloud creature, flaky crust, sleepy eyes", "/dex/wind-05.jpg"),
];
