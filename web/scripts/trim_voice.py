# 음성 정밀 컷: 무음 경계로 첫 발성 구간만 잘라 public/oishie.mp3로 저장 (볼륨 0.7)
import re
import subprocess
import sys

from imageio_ffmpeg import get_ffmpeg_exe
from yt_dlp import YoutubeDL

URL = sys.argv[1] if len(sys.argv) > 1 else "https://www.youtube.com/shorts/CWjLsoFeRkg"
FF = get_ffmpeg_exe()

with YoutubeDL({"format": "bestaudio", "outtmpl": "scripts/voice_src.%(ext)s", "quiet": True}) as ydl:
    info = ydl.extract_info(URL, download=True)
    src = ydl.prepare_filename(info)

print("SRC:", src)
r = subprocess.run(
    [FF, "-hide_banner", "-i", src, "-vn",
     "-af", "silencedetect=noise=-35dB:d=0.15", "-f", "null", "-"],
    capture_output=True, text=True,
)
ends = [float(x) for x in re.findall(r"silence_end:\s*([\d.]+)", r.stderr)]
starts = [float(x) for x in re.findall(r"silence_start:\s*([\d.]+)", r.stderr)]
print("ends:", ends[:6], "starts:", starts[:6])

# 첫 발성 구간 = 첫 무음 끝 ~ 다음 무음 시작
vstart = ends[0] if ends else 0.0
vend = next((s for s in starts if s > vstart + 0.3), vstart + 2.0)
vstart = max(0.0, vstart - 0.10)
vend = min(vstart + 2.5, vend + 0.15)
print(f"CUT: {vstart:.2f}s ~ {vend:.2f}s")

r = subprocess.run(
    [FF, "-y", "-hide_banner", "-ss", f"{vstart:.2f}", "-t", f"{vend - vstart:.2f}",
     "-i", src, "-vn", "-af", "volume=0.7",
     "-acodec", "libmp3lame", "-ar", "44100", "-ac", "1", "public/oishie.mp3"],
    capture_output=True, text=True,
)
if r.returncode != 0:
    print(r.stderr[-800:])
    sys.exit(1)
print("OK -> public/oishie.mp3")
