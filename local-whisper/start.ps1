$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtimeRoot = "F:\bilidown-whisper"
$python = Join-Path $runtimeRoot "venv\Scripts\python.exe"
$logRoot = Join-Path $runtimeRoot "logs"
$pidFile = Join-Path $runtimeRoot "server.pid"
$healthUrl = "http://127.0.0.1:9000/health"

New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    if ($health.status -eq "ready") {
        Write-Output "Local Whisper is already running on http://127.0.0.1:9000"
        exit 0
    }
} catch {
    # Start the service below.
}

$listener = Get-NetTCPConnection `
    -LocalAddress "127.0.0.1" `
    -LocalPort 9000 `
    -State Listen `
    -ErrorAction SilentlyContinue
if ($listener) {
    Write-Output "Local Whisper is already listening on http://127.0.0.1:9000"
    exit 0
}

if (-not (Test-Path $python)) {
    throw "Python runtime not found: $python"
}

$env:HF_ENDPOINT = "https://hf-mirror.com"
$env:HF_HUB_DISABLE_XET = "1"
$env:HF_HUB_DISABLE_TELEMETRY = "1"
$env:TOKENIZERS_PARALLELISM = "false"
$env:WHISPER_MODEL = Join-Path $runtimeRoot "models\large-v3-turbo"
$env:WHISPER_MODEL_DIR = Join-Path $runtimeRoot "models"
$env:WHISPER_DEVICE = "auto"
$env:WHISPER_COMPUTE_TYPE = "auto"
$env:WHISPER_HOST = "127.0.0.1"
$env:WHISPER_PORT = "9000"
$env:WHISPER_PUNCT_MODEL = Join-Path $runtimeRoot "models\sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8\model.int8.onnx"

$stdout = Join-Path $logRoot "server.out.log"
$stderr = Join-Path $logRoot "server.err.log"
$process = Start-Process `
    -FilePath $python `
    -ArgumentList "-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", "9000" `
    -WorkingDirectory $scriptRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru

Set-Content -Path $pidFile -Value $process.Id
Write-Output "Started Local Whisper (PID $($process.Id))."
Write-Output "Endpoint: http://127.0.0.1:9000/v1/audio/transcriptions"
Write-Output "Logs: $logRoot"
