from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Callable


def configure_nvidia_dlls() -> None:
    site_packages = Path(sys.prefix) / "Lib" / "site-packages"
    nvidia_root = site_packages / "nvidia"
    if not nvidia_root.is_dir():
        return
    for folder in nvidia_root.glob("*/bin"):
        if folder.is_dir() and hasattr(os, "add_dll_directory"):
            os.add_dll_directory(str(folder))


os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

configure_nvidia_dlls()

from faster_whisper import WhisperModel


MODEL_CACHE = Path(
    os.getenv("WHISPER_MODEL_DIR", r"F:\bilidown-whisper\models")
)
MODEL_NAME = os.getenv(
    "WHISPER_MODEL", str(MODEL_CACHE / "large-v3-turbo")
)
REQUESTED_DEVICE = os.getenv("WHISPER_DEVICE", "auto").strip().lower()
REQUESTED_COMPUTE_TYPE = os.getenv(
    "WHISPER_COMPUTE_TYPE", "auto"
).strip()
CPU_THREADS = max(1, int(os.getenv("WHISPER_CPU_THREADS", "8")))
ALLOW_CPU_FALLBACK = os.getenv(
    "WHISPER_ALLOW_CPU_FALLBACK", "1"
).strip() not in {"0", "false", "False"}


def _create_model(device: str, compute_type: str) -> WhisperModel:
    MODEL_CACHE.mkdir(parents=True, exist_ok=True)
    return WhisperModel(
        MODEL_NAME,
        device=device,
        compute_type=compute_type,
        cpu_threads=CPU_THREADS,
        num_workers=1,
        download_root=str(MODEL_CACHE),
    )


def load_whisper_model(
    log: Callable[[str], None] = print,
) -> tuple[WhisperModel, str, str]:
    log(f"Loading Whisper model '{MODEL_NAME}'.")
    log(f"Model cache: {MODEL_CACHE}")

    if REQUESTED_DEVICE in {"auto", "cuda"}:
        try:
            compute_type = (
                "int8_float16"
                if REQUESTED_COMPUTE_TYPE == "auto"
                else REQUESTED_COMPUTE_TYPE
            )
            log(f"Trying CUDA with compute_type={compute_type}.")
            model = _create_model("cuda", compute_type)
            return model, "cuda", compute_type
        except Exception as error:
            if REQUESTED_DEVICE == "cuda" and not ALLOW_CPU_FALLBACK:
                raise
            log(f"CUDA load failed, falling back to CPU: {error}")

    compute_type = (
        "int8"
        if REQUESTED_COMPUTE_TYPE in {"auto", "int8_float16", "float16"}
        else REQUESTED_COMPUTE_TYPE
    )
    log(f"Loading CPU model with compute_type={compute_type}.")
    model = _create_model("cpu", compute_type)
    return model, "cpu", compute_type
