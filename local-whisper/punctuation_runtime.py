from __future__ import annotations

import os
import re
from bisect import bisect_right
from pathlib import Path
from typing import Any, Iterable

import sherpa_onnx


DEFAULT_MODEL = Path(
    r"F:\bilidown-whisper\models"
    r"\sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8"
    r"\model.int8.onnx"
)
MODEL_PATH = Path(os.getenv("WHISPER_PUNCT_MODEL", str(DEFAULT_MODEL)))
NUM_THREADS = max(1, int(os.getenv("WHISPER_PUNCT_THREADS", "4")))
PUNCTUATION_CHARS = set("，。！？!?…；;：:,.、")


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


def normalize_for_alignment(text: str) -> str:
    return "".join(
        char for char in text if char not in PUNCTUATION_CHARS and not char.isspace()
    )


def punctuate_timed_units(
    units: list[dict[str, Any]],
    restorer: PunctuationRestorer,
) -> list[dict[str, Any]]:
    usable_units = [
        unit
        for unit in units
        if str(unit.get("text") or "").strip()
    ]
    if not usable_units:
        return []

    plain_texts = [
        re.sub(r"[，。！？!?…；;：:,.、]+", "", str(unit["text"] or "")).strip()
        for unit in usable_units
    ]
    punctuated_text = restorer.add_punctuation(" ".join(plain_texts))

    normalized_texts = [normalize_for_alignment(text) for text in plain_texts]
    original_flat = "".join(normalized_texts)
    punctuated_flat = normalize_for_alignment(punctuated_text)
    offsets = [0]
    for text in normalized_texts:
        offsets.append(offsets[-1] + len(text))

    punct_positions = list(range(len(punctuated_flat) + 1))
    if len(punctuated_flat) == len(original_flat):
        position_map = punct_positions
    else:
        position_map = [
            round(index * len(original_flat) / max(1, len(punctuated_flat)))
            for index in punct_positions
        ]

    chunks = [
        chunk
        for chunk in re.split(r"(?<=[。！？!?…])", punctuated_text)
        if chunk.strip()
    ]
    output: list[dict[str, Any]] = []
    cursor = 0

    for index, chunk in enumerate(chunks):
        chunk = " ".join(chunk.split()).strip()
        normalized_chunk = normalize_for_alignment(chunk)
        if not normalized_chunk:
            continue

        start_punct = cursor
        end_punct = cursor + len(normalized_chunk)
        cursor = end_punct

        start_original = position_map[
            min(start_punct, len(position_map) - 1)
        ]
        end_original = position_map[min(end_punct, len(position_map) - 1)]

        start_unit = max(
            0,
            min(len(offsets) - 2, bisect_right(offsets, start_original) - 1),
        )
        end_unit = max(
            start_unit,
            min(len(offsets) - 2, bisect_right(offsets, end_original) - 1),
        )

        output.append(
            {
                "text": chunk,
                "start": float(usable_units[start_unit]["start"] or 0),
                "end": float(usable_units[end_unit]["end"] or 0),
            }
        )

    return output
