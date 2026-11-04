#!/usr/bin/env python3
"""9-D: two-pass EBU R128 normalize ace-wav/*.wav to field.mp3 level (-14.7 LUFS).

Re-encodes public/bgm/candidates/battle-ace-*.mp3 (128k CBR, 0.5s head
fade-in, 2s tail fade-out). Verifies each mp3 <=3MB after encode.
"""
import glob
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WAV_DIR = os.path.join(ROOT, "scratch", "bgm-work", "ace-wav")
CAND_DIR = os.path.join(ROOT, "public", "bgm", "candidates")
TARGET_LUFS = -14.7


def ffmpeg() -> str:
    from imageio_ffmpeg import get_ffmpeg_exe
    return get_ffmpeg_exe()


def main() -> int:
    ff = ffmpeg()
    prefix = sys.argv[1] if len(sys.argv) > 1 else "battle-ace"
    wavs = sorted(glob.glob(os.path.join(WAV_DIR, prefix + "-*.wav")))
    assert wavs, f"no wavs for {prefix}"
    for wav in wavs:
        name = os.path.splitext(os.path.basename(wav))[0]
        mp3 = os.path.join(CAND_DIR, name + ".mp3")
        p1 = subprocess.run(
            [ff, "-hide_banner", "-i", wav, "-af",
             f"loudnorm=I={TARGET_LUFS}:TP=-1.5:LRA=11:print_format=json",
             "-f", "null", "-"],
            capture_output=True, text=True, check=True,
        )
        blob = p1.stderr[p1.stderr.index("{"):p1.stderr.rindex("}") + 1]
        measured = json.loads(blob)
        ln2 = (
            f"loudnorm=I={TARGET_LUFS}:TP=-1.5:LRA=11"
            f":measured_I={measured['input_i']}:measured_TP={measured['input_tp']}"
            f":measured_LRA={measured['input_lra']}:measured_thresh={measured['input_thresh']}"
            f":offset={measured['target_offset']}:linear=true"
        )
        dur = subprocess.run(
            [ff, "-hide_banner", "-i", wav], capture_output=True, text=True,
        ).stderr
        import re
        m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", dur)
        secs = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
        subprocess.run(
            [ff, "-y", "-hide_banner", "-loglevel", "error", "-i", wav,
             "-af", f"{ln2},afade=t=in:st=0:d=0.5,afade=t=out:st={secs - 2:.1f}:d=2",
             "-codec:a", "libmp3lame", "-b:a", "128k", mp3],
            check=True,
        )
        size = os.path.getsize(mp3)
        print(f"{name}: {secs:.1f}s {size} bytes LUFS~{TARGET_LUFS}", flush=True)
        assert size <= 3 * 1024 * 1024, name
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
