from __future__ import annotations

import os
import re
import tempfile
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from punctuation_runtime import PunctuationRestorer
from whisper_runtime import MODEL_NAME, load_whisper_model


HOST = os.getenv("WHISPER_HOST", "127.0.0.1")
PORT = int(os.getenv("WHISPER_PORT", "9000"))
BEAM_SIZE = max(1, int(os.getenv("WHISPER_BEAM_SIZE", "5")))
MAX_SEGMENT_SECONDS = max(
    3.0, float(os.getenv("WHISPER_MAX_SEGMENT_SECONDS", "8"))
)
MAX_SEGMENT_CHARS = max(
    30, int(os.getenv("WHISPER_MAX_SEGMENT_CHARS", "70"))
)
PAUSE_BREAK_SECONDS = max(
    0.3, float(os.getenv("WHISPER_PAUSE_BREAK_SECONDS", "0.65"))
)
DEFAULT_LANGUAGE = os.getenv("WHISPER_DEFAULT_LANGUAGE", "zh").strip()
VAD_FILTER = os.getenv("WHISPER_VAD_FILTER", "1").strip() not in {
    "0",
    "false",
    "False",
}

state_lock = threading.Lock()
transcribe_lock = threading.Lock()
model_instance = None
punctuation_restorer = None
model_state: dict[str, Any] = {
    "status": "loading",
    "model": MODEL_NAME,
    "device": None,
    "compute_type": None,
    "error": None,
    "punctuation_status": "loading",
    "punctuation_error": None,
}


def set_model_state(**values: Any) -> None:
    with state_lock:
        model_state.update(values)


def get_model_state() -> dict[str, Any]:
    with state_lock:
        return dict(model_state)


def load_model_worker() -> None:
    global model_instance, punctuation_restorer
    try:
        model, device, compute_type = load_whisper_model()
        model_instance = model
        try:
            punctuation_restorer = PunctuationRestorer()
            set_model_state(
                punctuation_status="ready",
                punctuation_error=None,
            )
        except Exception as punctuation_error:
            punctuation_restorer = None
            set_model_state(
                punctuation_status="error",
                punctuation_error=str(punctuation_error),
            )
        set_model_state(
            status="ready",
            device=device,
            compute_type=compute_type,
            error=None,
        )
        print(
            f"Whisper ready: model={MODEL_NAME} device={device} "
            f"compute_type={compute_type}",
            flush=True,
        )
    except Exception as error:
        set_model_state(status="error", error=str(error))
        print(f"Whisper model failed to load: {error}", flush=True)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    thread = threading.Thread(target=load_model_worker, daemon=True)
    thread.start()
    yield


app = FastAPI(title="bilidown Local Whisper", version="1.0.0", lifespan=lifespan)


@app.get("/")
@app.get("/health")
def health() -> JSONResponse:
    status = get_model_state()
    code = 200 if status["status"] == "ready" else 503
    return JSONResponse(status, status_code=code)


def join_word(current_text: str, raw_word: str) -> str:
    if not current_text:
        return raw_word.lstrip()
    if raw_word.startswith((" ", "\t", "\n")):
        return f"{current_text.rstrip()} {raw_word.strip()}"
    return f"{current_text}{raw_word}"


def split_raw_segment(
    text: str,
    start: float,
    end: float,
) -> list[tuple[float, float, str]]:
    clean_text = " ".join(str(text or "").split()).strip()
    if not clean_text:
        return []

    sentence_parts = [
        part.strip()
        for part in re.split(r"(?<=[。！？!?；;])\s*", clean_text)
        if part.strip()
    ]
    if len(sentence_parts) > 1:
        duration = max(0.0, end - start)
        total_chars = sum(len(part) for part in sentence_parts) or 1
        cursor = start
        result = []
        for part in sentence_parts:
            part_duration = duration * (len(part) / total_chars)
            result.append((cursor, cursor + part_duration, part))
            cursor += part_duration
        return result

    duration = max(0.0, end - start)
    chunks = [
        clean_text[index : index + MAX_SEGMENT_CHARS]
        for index in range(0, len(clean_text), MAX_SEGMENT_CHARS)
    ]
    total_chars = len(clean_text) or 1
    cursor = start
    result = []
    for chunk in chunks:
        chunk_duration = duration * (len(chunk) / total_chars)
        result.append((cursor, cursor + chunk_duration, chunk))
        cursor += chunk_duration
    return result


def build_transcript_segments(segments: Any) -> list[dict[str, Any]]:
    output_segments: list[dict[str, Any]] = []
    current_start = None
    current_end = None
    current_text = ""

    def flush() -> None:
        nonlocal current_start, current_end, current_text
        text = " ".join(current_text.split()).strip()
        if text and current_start is not None and current_end is not None:
            output_segments.append(
                {
                    "id": len(output_segments),
                    "seek": int(current_start * 100),
                    "start": float(current_start),
                    "end": float(current_end),
                    "text": text,
                    "tokens": [],
                    "temperature": 0.0,
                }
            )
        current_start = None
        current_end = None
        current_text = ""

    for segment in segments:
        words = getattr(segment, "words", None)
        if not words:
            for part_start, part_end, text in split_raw_segment(
                segment.text,
                float(segment.start or 0),
                float(segment.end or 0),
            ):
                output_segments.append(
                    {
                        "id": len(output_segments),
                        "seek": int(part_start * 100),
                        "start": part_start,
                        "end": part_end,
                        "text": text,
                        "tokens": [],
                        "temperature": 0.0,
                    }
                )
            continue

        for word in words:
            word_start = max(0.0, float(word.start or 0))
            word_end = max(word_start, float(word.end or word_start))
            if current_start is None:
                current_start = word_start
            gap = max(0.0, word_start - (current_end or word_start))
            current_text = join_word(current_text, str(word.word or ""))
            current_end = word_end

            elapsed = max(0.0, current_end - current_start)
            text = " ".join(current_text.split()).strip()
            last_char = text[-1:] if text else ""
            hard_boundary = last_char in "。！？!?…"
            soft_boundary = last_char in "，,；;：:"
            pause_boundary = gap >= PAUSE_BREAK_SECONDS and elapsed >= 1.5
            size_boundary = (
                elapsed >= MAX_SEGMENT_SECONDS
                or len(text) >= MAX_SEGMENT_CHARS
            )

            if (
                (hard_boundary and (elapsed >= 1.2 or len(text) >= 12))
                or pause_boundary
                or size_boundary
                or (soft_boundary and elapsed >= 4.0)
            ):
                flush()

    flush()
    return output_segments


class PunctuationRequest(BaseModel):
    text: str | None = None
    texts: list[str] | None = None


@app.post("/v1/punctuation", response_model=None)
def punctuation_endpoint(request: PunctuationRequest) -> JSONResponse:
    status = get_model_state()
    if status["punctuation_status"] == "error":
        raise HTTPException(
            status_code=500,
            detail=(
                "Punctuation model failed to load: "
                f"{status['punctuation_error']}"
            ),
        )
    if status["punctuation_status"] != "ready":
        raise HTTPException(
            status_code=503,
            detail="Punctuation model is still loading.",
        )

    if request.text is not None:
        return JSONResponse(
            {"text": punctuation_restorer.add_punctuation(request.text)}
        )
    if request.texts is not None:
        return JSONResponse(
            {
                "texts": punctuation_restorer.add_punctuation_batch(
                    request.texts
                )
            }
        )
    raise HTTPException(status_code=400, detail="Provide text or texts.")


def normalize_zh_punctuation(text: str) -> str:
    translation = str.maketrans(
        {
            ",": "，",
            "?": "？",
            "!": "！",
            ":": "：",
            ";": "；",
        }
    )
    return text.translate(translation)


def restore_punctuation(
    segments: list[dict[str, Any]],
    language: str | None,
) -> list[dict[str, Any]]:
    if language != "zh":
        return segments

    terminal_punctuation = "。！？!?…"
    soft_punctuation = "，,；;：:"
    question_markers = (
        "吗",
        "呢",
        "么",
        "什么",
        "为什么",
        "怎么",
        "是否",
        "哪",
        "谁",
        "多少",
        "几",
    )

    for index, segment in enumerate(segments):
        text = normalize_zh_punctuation(str(segment["text"] or "").strip())
        if not text:
            segment["text"] = ""
            continue

        last_char = text[-1]
        is_last = index == len(segments) - 1

        if last_char in terminal_punctuation:
            segment["text"] = text
            continue

        if last_char in soft_punctuation:
            if is_last:
                text = f"{text[:-1]}。"
            segment["text"] = text
            continue

        next_segment = segments[index + 1] if not is_last else None
        next_gap = (
            max(
                0.0,
                float(next_segment.get("start") or 0)
                - float(segment.get("end") or 0),
            )
            if next_segment
            else 0.0
        )

        if is_last:
            text = f"{text}。"
        elif any(marker in text[-14:] for marker in question_markers):
            text = f"{text}？"
        elif next_gap >= 0.9:
            text = f"{text}。"
        else:
            text = f"{text}，"
        segment["text"] = text

    return segments


def apply_punctuation_model(
    segments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if punctuation_restorer is None or not segments:
        return segments

    compact_texts = [
        re.sub(r"[，。！？；：、,.!?;:]+", "", str(segment["text"] or "")).strip()
        for segment in segments
    ]
    punctuated_texts = punctuation_restorer.add_punctuation_batch(compact_texts)
    for segment, punctuated in zip(segments, punctuated_texts):
        if punctuated:
            segment["text"] = punctuated
    return segments


def transcribe_file(path: str, language: str | None) -> dict[str, Any]:
    status = get_model_state()
    if status["status"] == "error":
        raise HTTPException(
            status_code=500,
            detail=f"Whisper model failed to load: {status['error']}",
        )
    if status["status"] != "ready":
        raise HTTPException(
            status_code=503,
            detail="Whisper model is still loading. Try again shortly.",
        )

    if model_instance is None:
        raise HTTPException(status_code=503, detail="Whisper model is unavailable.")

    effective_language = language or DEFAULT_LANGUAGE or None
    initial_prompt = None
    if effective_language == "zh":
        initial_prompt = (
            "以下是普通话内容。请使用自然语句断句，并输出简体中文标点。"
        )

    if not transcribe_lock.acquire(blocking=False):
        raise HTTPException(
            status_code=429,
            detail=(
                "Local Whisper is already transcribing another request. "
                "Wait for it to finish before retrying."
            ),
        )

    started_at = time.perf_counter()
    print("Transcription started.", flush=True)
    try:
        segments, info = model_instance.transcribe(
            path,
            beam_size=BEAM_SIZE,
            vad_filter=VAD_FILTER,
            language=effective_language,
            word_timestamps=True,
            condition_on_previous_text=False,
            initial_prompt=initial_prompt,
        )
        output_segments = restore_punctuation(
            apply_punctuation_model(build_transcript_segments(segments)),
            effective_language,
        )
        text_parts = [segment["text"] for segment in output_segments]
    except Exception as error:
        elapsed = time.perf_counter() - started_at
        print(
            f"Transcription failed after {elapsed:.2f}s: {error}",
            flush=True,
        )
        raise
    finally:
        transcribe_lock.release()

    elapsed = time.perf_counter() - started_at
    print(
        f"Transcription completed in {elapsed:.2f}s "
        f"with {len(output_segments)} segments.",
        flush=True,
    )

    return {
        "task": "transcribe",
        "language": info.language or "auto",
        "duration": float(info.duration or 0),
        "text": " ".join(text_parts).strip(),
        "segments": output_segments,
    }


async def handle_transcription(
    file: UploadFile,
    response_format: str,
    language: str | None,
) -> JSONResponse | PlainTextResponse:
    suffix = Path(file.filename or "audio.m4a").suffix.lower() or ".m4a"
    temp_dir = Path(tempfile.gettempdir()) / "bilidown-whisper"
    temp_dir.mkdir(parents=True, exist_ok=True)
    temp_path = None

    try:
        with tempfile.NamedTemporaryFile(
            delete=False,
            suffix=suffix,
            dir=temp_dir,
        ) as temp_file:
            temp_path = temp_file.name
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                temp_file.write(chunk)

        result = await run_in_threadpool(transcribe_file, temp_path, language)
        if response_format == "text":
            return PlainTextResponse(result["text"])
        if response_format == "json":
            return JSONResponse({"text": result["text"]})
        return JSONResponse(result)
    finally:
        await file.close()
        if temp_path:
            try:
                Path(temp_path).unlink(missing_ok=True)
            except OSError:
                pass


@app.post("/v1/audio/transcriptions", response_model=None)
@app.post("/inference", response_model=None)
async def transcriptions(
    file: UploadFile = File(...),
    model: str | None = Form(default=None),
    response_format: str = Form(default="verbose_json"),
    language: str | None = Form(default=None),
) -> JSONResponse | PlainTextResponse:
    del model
    return await handle_transcription(file, response_format, language)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
