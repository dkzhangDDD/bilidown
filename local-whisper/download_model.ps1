$ErrorActionPreference = "Stop"

$runtimeRoot = "F:\bilidown-whisper"
$target = Join-Path $runtimeRoot "models\large-v3-turbo"
$baseUrl = "https://hf-mirror.com/mobiuslabsgmbh/faster-whisper-large-v3-turbo/resolve/main"
$files = @(
    "config.json",
    "preprocessor_config.json",
    "model.bin",
    "tokenizer.json",
    "vocabulary.json"
)

New-Item -ItemType Directory -Force -Path $target | Out-Null

foreach ($file in $files) {
    $destination = Join-Path $target $file
    $url = "$baseUrl/$file"
    Write-Output "Downloading $file"
    & curl.exe `
        --location `
        --fail `
        --retry 8 `
        --retry-delay 5 `
        --continue-at - `
        --output $destination `
        $url
    if ($LASTEXITCODE -ne 0) {
        throw "Download failed for $file (exit code $LASTEXITCODE)"
    }
}

Write-Output "Model files are ready in $target"

$punctuationArchive = Join-Path $runtimeRoot "models\sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8.tar.bz2"
$punctuationUrl = "https://github.com/k2-fsa/sherpa-onnx/releases/download/punctuation-models/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8.tar.bz2"
if (-not (Test-Path $punctuationArchive)) {
    Write-Output "Downloading Chinese/English punctuation model"
    & curl.exe --location --fail --retry 8 --retry-delay 5 --continue-at - --output $punctuationArchive $punctuationUrl
    if ($LASTEXITCODE -ne 0) {
        throw "Punctuation model download failed (exit code $LASTEXITCODE)"
    }
}

$venvPython = Join-Path $runtimeRoot "venv\Scripts\python.exe"
& $venvPython -c "import tarfile; tarfile.open(r'$punctuationArchive', 'r:bz2').extractall(r'$runtimeRoot\models')"
if ($LASTEXITCODE -ne 0) {
    throw "Punctuation model extraction failed (exit code $LASTEXITCODE)"
}

Write-Output "Punctuation model is ready in $runtimeRoot\models"
