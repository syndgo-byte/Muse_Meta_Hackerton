# 8-F: battle BGM candidates with MusicGen-small (fp32, text-only, continuation).
# Usage: dance-venv python scripts/gen-battle.py
# Writes: public/bgm/candidates/battle-gen-0N.mp3 + scratch/bgm-work/manifest.jsonl
import json
import os
import subprocess
import sys
import time

os.environ.setdefault("HF_HOME", "D:/Meta_hackerton/scratch/bgm-models")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
import numpy as np  # noqa: E402
import torch  # noqa: E402
from scipy.io import wavfile  # noqa: E402
from transformers import (MusicgenForConditionalGeneration,  # noqa: E402
                          MusicgenProcessor)

ROOT = "D:/Meta_hackerton"
FF = (f"{ROOT}/scratch/dance-venv/Lib/site-packages/imageio_ffmpeg/binaries"
      "/ffmpeg-win-x86_64-v7.1.exe")
WORK = f"{ROOT}/scratch/bgm-work"
CAND = f"{ROOT}/public/bgm/candidates"
MODEL = "facebook/musicgen-small"
TOKENS = 1536  # ~30.3s per chunk
GUIDANCE = 3.0

PROMPTS = {
    "P1": ("Epic orchestral battle theme, instrumental, D minor, fast tempo "
           "150 BPM, driving tribal war drums and taiko, staccato string "
           "ostinato, bold brass stabs, choir accents, adventurous and heroic, "
           "steady build-up to a powerful climax, video game battle music"),
    "P2": ("Epic orchestral battle theme, instrumental, D minor, very fast "
           "tempo 172 BPM, racing staccato string ostinato, pounding taiko "
           "war drums, sharp brass hits, driving timpani, frantic and heroic, "
           "steady build-up to a powerful climax, video game battle music"),
    "P3": ("Epic orchestral battle theme, instrumental, D minor, fast tempo "
           "160 BPM, thunderous war drums and deep booming taiko, soaring "
           "heroic brass fanfares, driving string ostinato, adventurous and "
           "triumphant, steady build-up to a powerful climax, video game "
           "battle music"),
}
# 7 songs (6 required + 1 spare).
PLAN = [("P1", 1101), ("P1", 1102), ("P2", 2201), ("P2", 2202),
        ("P3", 3301), ("P3", 3302), ("P3", 3303)]


def stats(tag, wav):
    a = wav.astype(np.float64)
    print(f"  {tag}: rms={np.sqrt((a ** 2).mean()):.4f} peak={np.abs(a).max():.4f}",
          flush=True)


def main():
    os.makedirs(WORK, exist_ok=True)
    os.makedirs(CAND, exist_ok=True)
    print(f"cuda: {torch.cuda.is_available()} "
          f"{torch.cuda.get_device_name(0) if torch.cuda.is_available() else ''}",
          flush=True)
    t0 = time.time()
    processor = MusicgenProcessor.from_pretrained(MODEL)
    model = MusicgenForConditionalGeneration.from_pretrained(
        MODEL, dtype=torch.float32).to("cuda")
    model.eval()
    print(f"loaded {MODEL} in {time.time() - t0:.0f}s", flush=True)
    sr = model.config.sampling_rate
    manifest = []
    for n, (pid, seed) in enumerate(PLAN, 1):
        name = f"battle-gen-{n:02d}"
        print(f"== {name} {pid} seed={seed} ==", flush=True)
        rec = {"name": name, "model": MODEL, "prompt_id": pid,
               "prompt": PROMPTS[pid], "seed": seed}
        try:
            inputs = processor(text=[PROMPTS[pid]], padding=True,
                               return_tensors="pt").to("cuda")
            torch.manual_seed(seed)
            t1 = time.time()
            with torch.no_grad():
                c1 = model.generate(**inputs, max_new_tokens=TOKENS,
                                    guidance_scale=GUIDANCE)
            dt1 = time.time() - t1
            a1 = c1[0, 0].float().cpu().numpy()
            stats("chunk1", a1)
            prompt_wav = c1[..., -sr * 10:]  # last 10s continue
            torch.manual_seed(seed + 1)
            t2 = time.time()
            with torch.no_grad():
                c2full = model.generate(**inputs, input_values=prompt_wav,
                                        max_new_tokens=TOKENS,
                                        guidance_scale=GUIDANCE)
            dt2 = time.time() - t2
            a2 = c2full[0, 0].float().cpu().numpy()[prompt_wav.shape[-1]:]
            stats("chunk2-new", a2)
            # Level-match chunk2 head to chunk1 tail (continuations run hot),
            # 0.25s seam crossfade, peak-normalize (MusicGen exceeds +-1.0).
            n10 = sr * 10
            r1 = float(np.sqrt((a1[-n10:] ** 2).mean()))
            r2 = float(np.sqrt((a2[:n10] ** 2).mean()))
            g = r1 / r2 if r2 > 1e-6 else 1.0
            a2 = a2 * g
            nx = int(sr * 0.25)
            w = np.linspace(0, 1, nx).astype(np.float64)
            tail = a1[-nx:] * (1 - w) + a2[:nx] * w
            song = np.concatenate([a1[:-nx], tail, a2[nx:]])
            pk = float(np.abs(song).max())
            song = song / pk * 0.95 if pk > 1e-6 else song
            print(f"  match x{g:.3f} peaknorm x{0.95 / pk:.3f}", flush=True)
            stats("song-final", song)
            dur = len(song) / sr
            wav_path = f"{WORK}/{name}.wav"
            wavfile.write(wav_path, sr, (np.clip(song, -1, 1) * 32767).astype(np.int16))
            mp3_path = f"{CAND}/{name}.mp3"
            subprocess.run(
                [FF, "-hide_banner", "-loglevel", "error", "-y", "-i", wav_path,
                 "-af", f"afade=t=in:st=0:d=0.5,afade=t=out:st={dur - 2:.2f}:d=2",
                 "-codec:a", "libmp3lame", "-b:a", "192k", mp3_path], check=True)
            size = os.path.getsize(mp3_path)
            rec.update({"seconds": round(dur, 1), "gen_s": round(dt1 + dt2),
                       "chunk_s": [round(dt1), round(dt2)],
                       "mp3_bytes": size, "status": "ok"})
            print(f"  -> {mp3_path} {dur:.1f}s {size} bytes "
                  f"({'OK' if size <= 3 * 1024 * 1024 else 'OVER 3MB!'}) "
                  f"gen {dt1 + dt2:.0f}s", flush=True)
        except Exception as e:  # noqa: BLE001 - record and continue
            rec.update({"status": f"FAIL {type(e).__name__}: {str(e)[:150]}"})
            print(f"  FAILED: {rec['status']}", flush=True)
        manifest.append(rec)
        torch.cuda.empty_cache()
    with open(f"{WORK}/manifest.jsonl", "w", encoding="utf-8") as f:
        for r in manifest:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    ok = sum(1 for r in manifest if r["status"] == "ok")
    print(f"RESULT: {ok}/{len(manifest)} ok", flush=True)
    return 0 if ok >= 6 else 1


if __name__ == "__main__":
    sys.exit(main())
