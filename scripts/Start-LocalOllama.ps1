param([Parameter(Mandatory=$true)][string]$Root)
$ErrorActionPreference='Stop'
$Root=[IO.Path]::GetFullPath($Root)
$exe=Join-Path $Root 'runtime\0.34.0\ollama.exe'
if(!(Test-Path -LiteralPath $exe)){throw "Install verified Ollama 0.34.0 at $exe first."}
$listeners=@(Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue)
if($listeners.Count){
  foreach($listener in $listeners){
    $owner=Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
    if($owner.ExecutablePath -ne $exe -or $listener.LocalAddress -ne '127.0.0.1'){throw 'Port 11434 belongs to another server. It was not changed.'}
  }
  $status=Invoke-RestMethod 'http://127.0.0.1:11434/api/version' -TimeoutSec 5
  if($status.version -ne '0.34.0'){throw 'Unexpected Ollama version.'}
  Write-Output 'Local Ollama is already ready at http://127.0.0.1:11434';exit 0
}
$env:OLLAMA_HOST='127.0.0.1:11434'
$env:OLLAMA_MODELS=Join-Path $Root 'models'
$env:OLLAMA_NO_CLOUD='1'
$env:OLLAMA_FLASH_ATTENTION='1'
$env:OLLAMA_KV_CACHE_TYPE='q8_0'
$env:OLLAMA_NUM_PARALLEL='1'
$env:OLLAMA_MAX_LOADED_MODELS='1'
$env:OLLAMA_KEEP_ALIVE='5m'
$logs=Join-Path $Root 'logs';New-Item -ItemType Directory -Force -Path $logs|Out-Null
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$process=Start-Process -FilePath $exe -ArgumentList 'serve' -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logs "$stamp.stdout.log") -RedirectStandardError (Join-Path $logs "$stamp.stderr.log")
@{pid=$process.Id;startedAt=$process.StartTime.ToUniversalTime().ToString('o');exe=$exe}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $Root 'server-owner.json') -Encoding UTF8
for($i=0;$i -lt 30;$i++){
  if($process.HasExited){throw "Ollama exited. See $logs"}
  try{$status=Invoke-RestMethod 'http://127.0.0.1:11434/api/version' -TimeoutSec 1;if($status.version -eq '0.34.0'){Write-Output 'Local Ollama is ready at http://127.0.0.1:11434';exit 0}}catch{}
  Start-Sleep -Milliseconds 500
}
throw "Ollama readiness timed out. See $logs"
