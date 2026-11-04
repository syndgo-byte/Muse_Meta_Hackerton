# 밈 영상 2초 프레임 추출 → public/woni.jpg
# 권리: 원 이미지의 권리는 원저작자에게 있음. 해커톤 데모용 밈 오마주.
import subprocess
import sys

from imageio_ffmpeg import get_ffmpeg_exe
from yt_dlp import YoutubeDL

URL = sys.argv[1] if len(sys.argv) > 1 else "https://www.youtube.com/watch?v=Y8qq4871Bn4"
SEC = float(sys.argv[2]) if len(sys.argv) > 2 else 2.0
OUT = "public/woni.jpg"
FF = get_ffmpeg_exe()

with YoutubeDL({
    "format": "136",
    "outtmpl": "scripts/woni_src.%(ext)s",
    "quiet": True,
}) as ydl:
    info = ydl.extract_info(URL, download=True)
    src = ydl.prepare_filename(info)

print("SRC:", src)
r = subprocess.run(
    [FF, "-y", "-hide_banner", "-ss", str(SEC), "-i", src,
     "-frames:v", "1", "-q:v", "3", OUT],
    capture_output=True, text=True,
)
if r.returncode != 0:
    print(r.stderr[-1200:])
    sys.exit(1)
print(f"OK -> {OUT} (from {SEC:.0f}s)")
