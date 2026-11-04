# OiShi-e! 메인 음성 확보 스크립트
# 출처: 맨 앞 "오이쉬에!"가 있는 밈 영상 (기본값: 유튜브 쇼츠, 폴백: 틱톡)
# 권리: 원 음성의 권리는 원저작자에게 있음. 해커톤 데모용 밈 오마주.
# 사용: public/oishie.mp3 로 저장되면 메인 페이지 GAME START 클릭 시 재생.
import re
import subprocess
import sys

from imageio_ffmpeg import get_ffmpeg_exe
from yt_dlp import YoutubeDL

URL = sys.argv[1] if len(sys.argv) > 1 else "https://www.youtube.com/shorts/R2FSHvw2WzQ"
SRC_TMPL = "scripts/oishie_src.%(ext)s"
OUT = "public/oishie.mp3"
FF = get_ffmpeg_exe()

with YoutubeDL({"format": "bestaudio", "outtmpl": SRC_TMPL, "quiet": True}) as ydl:
    info = ydl.extract_info(URL, download=True)
    src = ydl.prepare_filename(info)

print("SRC:", src)


def mean_db(start: float, dur: float = 3.0) -> float:
    r = subprocess.run(
        [FF, "-hide_banner", "-ss", str(start), "-t", str(dur),
         "-i", src, "-vn", "-af", "volumedetect", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    m = re.search(r"mean_volume:\s*(-?[\d.]+|-\s*inf)", r.stderr)
    if not m:
        return -99.0
    v = m.group(1).strip()
    return -99.0 if "inf" in v else float(v)


# 맨 앞에서 소리 있는 3초 구간을 찾는다 (최대 15초까지 탐색)
pick = 0.0
for s in (0.0, 3.0, 6.0, 9.0, 12.0):
    db = mean_db(s)
    print(f"window {s:.0f}s mean {db} dB")
    if db > -45.0:
        pick = s
        break

r = subprocess.run(
    [FF, "-y", "-hide_banner", "-ss", str(pick), "-t", "3",
     "-i", src, "-vn", "-acodec", "libmp3lame", "-ar", "44100", "-ac", "1", OUT],
    capture_output=True, text=True,
)
if r.returncode != 0:
    print(r.stderr[-1200:])
    sys.exit(1)
print(f"OK -> {OUT} (from {pick:.0f}s)")
