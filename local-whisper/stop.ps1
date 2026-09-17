$ErrorActionPreference = "Stop"

$pidFile = "F:\bilidown-whisper\server.pid"
if (-not (Test-Path $pidFile)) {
    Write-Output "Local Whisper is not running."
    exit 0
}

$serverPid = [int](Get-Content $pidFile -Raw).Trim()

function Stop-ProcessTree {
    param([int]$ProcessId)

    $children = Get-CimInstance Win32_Process `
        -Filter "ParentProcessId = $ProcessId" `
        -ErrorAction SilentlyContinue
    foreach ($child in $children) {
        Stop-ProcessTree -ProcessId $child.ProcessId
    }
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

$process = Get-Process -Id $serverPid -ErrorAction SilentlyContinue
if ($process) {
    Stop-ProcessTree -ProcessId $serverPid
    Write-Output "Stopped Local Whisper (PID $serverPid and child processes)."
} else {
    Write-Output "Local Whisper process was not running."
}

Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
