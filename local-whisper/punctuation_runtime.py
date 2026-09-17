from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable

import sherpa_onnx


DEFAULT_MODEL = Path(
    r"F:\bilidown-whisper\models"
    r"\sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8"
    r"\model.int8.onnx"
)
MODEL_PATH = Path(os.getenv("WHISPER_PUNCT_MODEL", str(DEFAULT_MODEL)))
NUM_THREADS = max(1, int(os.getenv("WHISPER_PUNCT_THREADS", "4")))


class PunctuationRestorer:
    def __init__(self, model_path: Path = MODEL_PATH) -> None:
        if not model_path.is_file():
            raise FileNotFoundError(
                f"Punctuation model not found: {model_path}"
            )
        config = sherpa_onnx.OfflinePunctuationConfig(
            model=sherpa_onnx.OfflinePunctuationModelConfig(
                ct_transformer=str(model_path),
                num_threads=NUM_THREADS,
            )
        )
        self.model = sherpa_onnx.OfflinePunctuation(config)

    def add_punctuation(self, text: str) -> str:
        value = str(text or "").strip()
        if not value:
            return ""
        return self.model.add_punctuation(value).strip()

    def add_punctuation_batch(self, texts: Iterable[str]) -> list[str]:
        return [self.add_punctuation(text) for text in texts]
