$ErrorActionPreference = 'Stop'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$scriptPath = Join-Path $PSScriptRoot 'verify-jev-live.mjs'
Write-Host 'TypeSafe JEV: 모델 조회 1회 + 영어 합성 판단 1회'
Write-Host '시험 코드에 있는 영어 합성 기억 3개만 전송합니다.'
Write-Host 'TypeSafe 크레딧을 사용합니다. 자동 재시도와 키 저장은 없습니다.'
Write-Host '아래에 API 키를 붙여넣으세요. 입력은 숨겨집니다. 취소: Ctrl+C'
$secureKey = Read-Host 'TypeSafe API 키' -AsSecureString
$pointer = [IntPtr]::Zero
$child = $null
$finished = $false
try {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
  $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  if ([string]::IsNullOrWhiteSpace($plainKey) -or $plainKey.Length -gt 4096 -or $plainKey.Contains("`n") -or $plainKey.Contains("`r")) {
    throw 'API 키 입력 형식이 올바르지 않습니다.'
  }
  $start = New-Object System.Diagnostics.ProcessStartInfo
  $start.FileName = $nodePath
  $start.Arguments = '"' + $scriptPath + '"'
  $start.WorkingDirectory = Split-Path $PSScriptRoot -Parent
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardInput = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $child = New-Object System.Diagnostics.Process
  $child.StartInfo = $start
  if (-not $child.Start()) { throw '격리된 JEV 시험을 시작하지 못했습니다.' }
  $outputTask = $child.StandardOutput.ReadToEndAsync()
  $errorTask = $child.StandardError.ReadToEndAsync()
  $child.StandardInput.WriteLine($plainKey)
  $child.StandardInput.Close()
  $plainKey = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  $pointer = [IntPtr]::Zero
  if (-not $child.WaitForExit(45000)) { throw '격리된 JEV 시험이 45초를 초과했습니다.' }
  $finished = $true
  $outputTask.GetAwaiter().GetResult() | Write-Host
  $errorTask.GetAwaiter().GetResult() | Write-Host
  if ($child.ExitCode -ne 0) { throw 'JEV 시험이 통과하지 못했습니다. 위의 결과를 확인하세요.' }
} finally {
  $plainKey = $null
  if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  $secureKey.Dispose()
  if ($child) {
    if (-not $finished) { try { if (-not $child.HasExited) { $child.Kill() } } catch {} }
    $child.Dispose()
  }
}
