# Probe transformers MusicGen API: timing + continuation kwargs.
# Usage: dance-venv python scripts/gen-probe.py [model-id]
import os
import sys
import time

os.environ.setdefault("HF_HOME", "D:/Meta_hackerton/scratch/bgm-models")
import torch  # noqa: E402
from transformers import (MusicgenForConditionalGeneration,  # noqa: E402
                          MusicgenProcessor)

MODEL = sys.argv[1] if len(sys.argv) > 1 else "facebook/musicgen-small"
DT = torch.float32 if (len(sys.argv) > 2 and sys.argv[2] == "fp32") else torch.float16
print("dtype:", DT, flush=True)
print("cuda:", torch.cuda.is_available(),
      torch.cuda.get_device_name(0) if torch.cuda.is_available() else "",
      flush=True)
t0 = time.time()
processor = MusicgenProcessor.from_pretrained(MODEL)
model = MusicgenForConditionalGeneration.from_pretrained(
    MODEL, dtype=DT).to("cuda")
model.eval()
print(f"loaded {MODEL} in {time.time() - t0:.0f}s "
      f"sr={model.config.sampling_rate}", flush=True)
PROMPT = ("Epic orchestral battle theme, instrumental, D minor, fast tempo "
          "150 BPM, driving war drums, staccato strings, bold brass stabs, "
          "video game battle music")
inputs = processor(text=[PROMPT], padding=True, return_tensors="pt").to("cuda")
torch.cuda.reset_peak_memory_stats()
torch.manual_seed(42)
t0 = time.time()
with torch.no_grad():
    wav = model.generate(**inputs, max_new_tokens=250, guidance_scale=3.0)
dt = time.time() - t0
print(f"5s gen: {dt:.1f}s shape={tuple(wav.shape)} "
      f"peakvram={torch.cuda.max_memory_allocated() / 1e9:.2f}GB "
      f"rms={wav.float().pow(2).mean().sqrt().item():.4f}", flush=True)
sr = model.config.sampling_rate
prompt_wav = wav[..., -sr * 5:]
for kw in ("input_values", "audio_values"):
    try:
        torch.manual_seed(43)
        t0 = time.time()
        with torch.no_grad():
            wav2 = model.generate(**inputs, **{kw: prompt_wav},
                                  max_new_tokens=125, guidance_scale=3.0)
        print(f"CONT {kw}: OK {time.time() - t0:.1f}s shape={tuple(wav2.shape)}",
              flush=True)
    except Exception as e:  # noqa: BLE001 - probing API surface
        print(f"CONT {kw}: FAIL {type(e).__name__}: {str(e)[:220]}", flush=True)
print("PROBE DONE", flush=True)
