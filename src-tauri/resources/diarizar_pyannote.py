#!/usr/bin/env python3
"""Diarizacion con pyannote community-1 para ColorDubber.

Lo invoca el backend Rust (transcribir_video, diarizador="pyannote"):
    python diarizar_pyannote.py --wav audio_16k_mono.wav --out turns.json

Lee el WAV en memoria con soundfile (pyannote 4.x decodifica archivos con
torchcodec, que en Windows exige DLLs shared de ffmpeg en PATH; asi se evita).
Usa exclusive_speaker_diarization: un solo speaker por instante, ideal para
alinear contra subtitulos. Vuelca {"turns": [{inicio, fin, speaker}]}.

Requiere: torch, pyannote.audio>=4, soundfile, login HF con acceso aceptado a
pyannote/speaker-diarization-community-1 (modelo gated).
"""
from __future__ import annotations

import argparse
import json
import sys


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--wav", required=True, help="WAV 16 kHz mono")
    ap.add_argument("--out", required=True, help="JSON de salida con turns")
    ap.add_argument("--device", default="cpu",
                    help="cpu o cuda (el backend decide; default cpu)")
    args = ap.parse_args()

    import torch
    import soundfile as sf
    from pyannote.audio import Pipeline

    device = args.device if args.device in ("cpu", "cuda") else "cpu"
    if device == "cuda" and not torch.cuda.is_available():
        print("cuda pedido pero no disponible, usando cpu", file=sys.stderr)
        device = "cpu"

    pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-community-1")
    pipeline.to(torch.device(device))

    wav, sr = sf.read(args.wav, dtype="float32", always_2d=True)
    out = pipeline({"waveform": torch.from_numpy(wav.T), "sample_rate": sr})

    turns = [{"inicio": float(t.start), "fin": float(t.end), "speaker": str(s)}
             for t, _, s in out.exclusive_speaker_diarization.itertracks(yield_label=True)]
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"turns": turns, "device": device}, f)
    print(f"pyannote: {len(turns)} turns en {device}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
