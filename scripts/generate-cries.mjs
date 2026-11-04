// 크리처 감정 보이스 생성: public/cries/<id>_<mood>_<take>.mp3 (24종 x 8감정 x 3테이크 = 576개)
// 사용법: node scripts/generate-cries.mjs
//
// [음성 모델 연동 후크]
// Meta 음성/오디오 생성 API 키가 있으면 .env에 아래를 넣고
//   META_VOICE_API_URL / META_VOICE_API_KEY
// synthesizeWithMetaVoice()를 실제 호출로 교체하면 같은 파일명으로 덮어쓴다.
// 이 환경에는 음성 API 엔드포인트·키가 없으므로, 가입 없이 바로 도는
// 오프라인 절차적 보이스 신스로 실생성한다.
// 종 프로필은 lib/voice/profiles.json 원본 (VOICE_DESIGN §2 + G보강 call). 하드코딩 없음.
// 기존 <id>_<mood>.mp3는 _1과 같은 내용으로 남겨 호환을 지킨다.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MOODS, encodeMp3, floatToInt16, synthCry } from "./voice-synth.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "cries");

const profiles = JSON.parse(readFileSync(join(ROOT, "lib", "voice", "profiles.json"), "utf8"));
if (!Array.isArray(profiles) || profiles.length !== 24) {
  throw new Error(`profiles.json must hold 24 profiles (got ${profiles?.length})`);
}

mkdirSync(OUT, { recursive: true });
let n = 0;
let bytes = 0;
for (const profile of profiles) {
  for (const mood of Object.keys(MOODS)) {
    for (let take = 1; take <= 3; take++) {
      const pcm = synthCry(profile, mood, take);
      const mp3 = encodeMp3(floatToInt16(pcm));
      writeFileSync(join(OUT, `${profile.id}_${mood}_${take}.mp3`), mp3);
      if (take === 1) writeFileSync(join(OUT, `${profile.id}_${mood}.mp3`), mp3);
      n++;
      bytes += mp3.length;
    }
  }
  console.log(`... ${profile.id} done`);
}
console.log(`cries: ${n} take files (+192 legacy), ${(bytes / 1024).toFixed(0)}KB takes in public/cries/`);
