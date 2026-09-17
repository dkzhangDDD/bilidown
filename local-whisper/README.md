# bilidown local Whisper

This folder runs a local OpenAI-compatible Whisper endpoint for bilidown.

## Runtime

- Virtual environment: `F:\bilidown-whisper\venv`
- Model cache: `F:\bilidown-whisper\models`
- Logs: `F:\bilidown-whisper\logs`
- Endpoint: `http://127.0.0.1:9000/v1/audio/transcriptions`
- Punctuation endpoint: `http://127.0.0.1:9000/v1/punctuation`
- Health check: `http://127.0.0.1:9000/health`
- Startup shortcut: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\bilidown Local Whisper.lnk`

The default model is `large-v3-turbo`. The server tries CUDA first and falls
back to CPU if the GPU runtime cannot be loaded.

Chinese transcription uses word timestamps and sentence-aware splitting.
Punctuation is restored by the sherpa-onnx CT-Transformer Chinese/English
int8 model, the same CT-Transformer model family used by FunASR.

The startup shortcut runs `start.ps1` hidden after Windows login. It exits
without creating a duplicate server if port 9000 is already listening.

## Commands

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
powershell -ExecutionPolicy Bypass -File .\stop.ps1
```

The server only listens on loopback and does not expose the model to the LAN.
