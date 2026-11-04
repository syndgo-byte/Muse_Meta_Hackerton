#!/usr/bin/env python3
"""9-D (2nd batch): ACE-Step battle tracks at ~132 BPM, text prompt only.

No reference audio input (no original songs). Prompts are English.
Usage (from repo root, CLI 2 venv):
  scratch/dance-venv/Scripts/python.exe scripts/gen-ace-battle.py [--tracks 5]

Outputs 48kHz stereo WAV to scratch/bgm-work/ace-wav/, encodes
public/bgm/candidates/ace-battle-NN.mp3 (single pass), and appends one JSON
line per track to scratch/bgm-work/manifest-ace.jsonl (tool, prompt, seed,
length, gen time, license). Run scripts/norm-battle-ace.py afterwards for
two-pass -14.7 LUFS normalization. Listening is NOT verified (user away).
"""
import json
import os
import subprocess
import sys
import time

# GTX 1060 6GB small settings (9-D authorized): fp16 + expandable segments.
os.environ.setdefault("ACE_PIPELINE_DTYPE", "float16")
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WAV_DIR = os.path.join(ROOT, "scratch", "bgm-work", "ace-wav")
CAND_DIR = os.path.join(ROOT, "public", "bgm", "candidates")
# ace-local: 4 required subdirs as junctions into the cached snapshot, so the
# pipeline loads straight from disk ("Load models from") without snapshot_download.
CKPT_DIR = os.path.join(ROOT, "scratch", "bgm-work", "ace-local")
MANIFEST = os.path.join(ROOT, "scratch", "bgm-work", "manifest-ace.jsonl")
TARGET_LUFS = -14.7
TRACK_SECONDS = 60.0
TOOL = "ACE-Step v1"
LICENSE = "Apache-2.0"

# 132 BPM area, battle tension, instrumental, no vocals, loopable.
TRACKS = [
    ("ace-battle-01", 132001,
     "tense orchestral battle, instrumental, no vocals, d minor, 132 bpm, "
     "driving taiko drums, staccato string ostinato, sharp brass stabs, "
     "rising tension build-up, loopable video game battle music"),
    ("ace-battle-02", 132002,
     "dark orchestral battle, instrumental, no vocals, d minor, 130 bpm, "
     "heavy war drums, aggressive low strings, bold brass hits, "
     "relentless battle tension, loopable video game battle music"),
    ("ace-battle-03", 132003,
     "fast orchestral battle, instrumental, no vocals, d minor, 134 bpm, "
     "string ostinato lead, taiko drums, subtle brass, urgent build-up, "
     "loopable video game battle music"),
    ("ace-battle-04", 132004,
     "heroic orchestral battle, instrumental, no vocals, d minor, 132 bpm, "
     "brass fanfare, war drums, string runs, triumphant tension, "
     "loopable video game battle music"),
    ("ace-battle-05", 132005,
     "epic orchestral battle, instrumental, no vocals, d minor, 131 bpm, "
     "tribal percussion, staccato strings, deep brass stabs, "
     "climactic build-up, loopable video game battle music"),
]


def ffmpeg() -> str:
    from imageio_ffmpeg import get_ffmpeg_exe
    return get_ffmpeg_exe()


def main() -> int:
    n = int(sys.argv[sys.argv.index("--tracks") + 1]) if "--tracks" in sys.argv else len(TRACKS)
    os.makedirs(WAV_DIR, exist_ok=True)
    from acestep.pipeline_ace_step import ACEStepPipeline

    t_load0 = time.time()
    pipe = ACEStepPipeline(
        checkpoint_dir=CKPT_DIR,
        dtype="float32",
        torch_compile=False,
        cpu_offload=True,
        overlapped_decode=True,
    )
    print(f"LOAD_SECONDS={time.time() - t_load0:.1f} CKPT={CKPT_DIR}", flush=True)
    ff = ffmpeg()
    with open(MANIFEST, "a", encoding="utf-8") as mf:
        for name, seed, prompt in TRACKS[:n]:
            wav = os.path.join(WAV_DIR, name + ".wav")
            mp3 = os.path.join(CAND_DIR, name + ".mp3")
            if os.path.exists(mp3) and os.path.getsize(mp3) > 100 * 1024:
                print(json.dumps({"track": name, "skipped": True, "mp3_bytes": os.path.getsize(mp3)}), flush=True)
                continue
            t0 = time.time()
            pipe(
                audio_duration=TRACK_SECONDS,
                prompt=prompt,
                lyrics="[inst]",
                infer_step=60,
                guidance_scale=15.0,
                scheduler_type="euler",
                cfg_type="apg",
                omega_scale=10.0,
                manual_seeds=str(seed),
                guidance_interval=0.5,
                guidance_interval_decay=0.0,
                min_guidance_scale=3.0,
                use_erg_tag=True,
                use_erg_lyric=True,
                use_erg_diffusion=True,
                oss_steps="",
                guidance_scale_text=0.0,
                guidance_scale_lyric=0.0,
                save_path=wav,
            )
            gen_s = time.time() - t0
            subprocess.run(
                [ff, "-y", "-hide_banner", "-loglevel", "error", "-i", wav,
                 "-af", f"loudnorm=I={TARGET_LUFS}:TP=-1.5:LRA=11,afade=t=in:st=0:d=0.5,afade=t=out:st={TRACK_SECONDS - 2:.1f}:d=2",
                 "-codec:a", "libmp3lame", "-b:a", "128k", mp3],
                check=True,
            )
            size = os.path.getsize(mp3)
            row = {"track": name, "tool": TOOL, "license": LICENSE, "seed": seed,
                   "seconds": TRACK_SECONDS, "gen_seconds": round(gen_s, 1),
                   "mp3_bytes": size, "prompt": prompt}
            mf.write(json.dumps(row, ensure_ascii=False) + "\n")
            mf.flush()
            print(json.dumps({"track": name, "seed": seed, "gen_seconds": round(gen_s, 1),
                              "mp3_bytes": size}), flush=True)
            assert size <= 3 * 1024 * 1024, f"{name} exceeds 3MB"
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
