param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
        & $Python -m venv .venv
        if ($LASTEXITCODE -ne 0) { throw 'Python 3.13 설치와 실행 경로를 확인하세요.' }
    }
    & '.\.venv\Scripts\python.exe' -m pip install -r requirements-speech.txt
    if ($LASTEXITCODE -ne 0) { throw '로컬 음성 패키지 설치 실패' }
    & '.\.venv\Scripts\python.exe' scripts/speech_worker.py --download-only
    if ($LASTEXITCODE -ne 0) { throw '음성 모델 다운로드 실패' }
    Write-Host '로컬 한국어 음성 인식 준비 완료'
} finally { Pop-Location }
