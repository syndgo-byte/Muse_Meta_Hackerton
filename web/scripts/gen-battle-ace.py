#!/usr/bin/env python3
"""9-D: ACE-Step battle-track candidates (text prompt only, no reference audio).

Usage (from repo root, CLI 2 venv):
  scratch/dance-venv/Scripts/python.exe scripts/gen-battle-ace.py [--tracks 5]

Outputs 48kHz stereo WAV to scratch/bgm-work/ace-wav/, then this script
loudness-normalizes to field.mp3 level (-14.7 LUFS), trims/pads to length,
and encodes public/bgm/candidates/battle-ace-NN.mp3 (<=3MB each).
Per-track log lines (tool, prompt, seed, length, gen seconds) go to stdout
for the 9-D report. Listening verdict stays unverified (user listens).
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
CKPT_DIR = os.path.join(ROOT, "scratch", "bgm-work", "ace-checkpoints")
TARGET_LUFS = -14.7
TRACK_SECONDS = 60.0

# 9-D prompt basis: instrumental, no vocals, D minor, ~150 BPM,
# orchestra + war drums/taiko, staccato strings, brass stabs, build-up, loopable.
TRACKS = [
    ("battle-ace-01", 110201,
     "epic orchestral battle, instrumental, no vocals, d minor, 150 bpm, "
     "driving taiko drums, staccato string ostinato, bold brass stabs, "
     "heroic build-up to climax, loopable video game battle music"),
    ("battle-ace-02", 110202,
     "fast orchestral battle, instrumental, no vocals, d minor, 160 bpm, "
     "tribal war drums and percussion forward, string ostinato, brass hits, "
     "relentless energy, loopable video game battle music"),
    ("battle-ace-03", 110203,
     "orchestral battle, instrumental, no vocals, d minor, 150 bpm, "
     "staccato strings lead, taiko drums, subtle brass, rising tension "
     "build-up, loopable video game battle music"),
    ("battle-ace-04", 110204,
     "heroic orchestral battle, instrumental, no vocals, d minor, 145 bpm, "
     "bold brass fanfare, war drums, string runs, triumphant build-up, "
     "loopable video game battle music"),
    ("battle-ace-05", 110205,
     "dark orchestral battle, instrumental, no vocals, d minor, 152 bpm, "
     "heavy taiko and bass drums, aggressive low strings, sharp brass stabs, "
     "intense build-up, loopable video game battle music"),
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
        dtype="float32",  # GTX 1060 has no bf16; explicit fp32
        torch_compile=False,
        cpu_offload=True,  # 6GB VRAM: stage-by-stage GPU load
        overlapped_decode=True,
    )
    print(f"LOAD_SECONDS={time.time() - t_load0:.1f} CKPT={CKPT_DIR}", flush=True)
    ff = ffmpeg()
    for name, seed, prompt in TRACKS[:n]:
        wav = os.path.join(WAV_DIR, name + ".wav")
        mp3 = os.path.join(CAND_DIR, name + ".mp3")
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
        # loudness normalize to field.mp3 level + encode mp3 (2s fade-out tail, 0.5s fade-in head)
        subprocess.run(
            [ff, "-y", "-hide_banner", "-loglevel", "error", "-i", wav,
             "-af", f"loudnorm=I={TARGET_LUFS}:TP=-1.5:LRA=11,afade=t=in:st=0:d=0.5,afade=t=out:st={TRACK_SECONDS - 2:.1f}:d=2",
             "-codec:a", "libmp3lame", "-b:a", "128k", mp3],
            check=True,
        )
        size = os.path.getsize(mp3)
        print(json.dumps({
            "track": name, "tool": "ACE-Step v1 (Apache-2.0)", "seed": seed,
            "seconds": TRACK_SECONDS, "gen_seconds": round(gen_s, 1),
            "mp3_bytes": size, "prompt": prompt,
        }), flush=True)
        assert size <= 3 * 1024 * 1024, f"{name} exceeds 3MB"
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
