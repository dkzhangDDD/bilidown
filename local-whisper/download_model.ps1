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
