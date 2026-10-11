param([int]$Port=8790,[switch]$NoOpen,[switch]$Demo,[string]$Library='')
$ErrorActionPreference='Stop'
$root=$PSScriptRoot
$python=$null
$pythonArgs=@()
$cmd=Get-Command python -ErrorAction SilentlyContinue
if($cmd -and $cmd.Source -notlike '*WindowsApps*'){$python=$cmd.Source}
if(!$python){$cmd=Get-Command py -ErrorAction SilentlyContinue;if($cmd){$python=$cmd.Source;$pythonArgs=@('-3')}}
if(!$python){
  $bundled=Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
  if(Test-Path -LiteralPath $bundled){$python=$bundled}
}
if(!$python){throw 'Python 3.10+ is required. Install Python, then run this launcher again.'}
$output=Join-Path $root 'local\run'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$url="http://127.0.0.1:$Port/"
$up=$false
try{$health=Invoke-RestMethod "$($url)api/health" -TimeoutSec 2;$up=$health.tool -eq 'tw-map-editor' -and $health.root -eq $root}catch{}
if(!$up){
  $script=Join-Path $root 'server.py'
  $argsList=$pythonArgs+@('-B',('"'+$script+'"'),'--port',"$Port")
  if($Demo){$argsList+=@('--demo')}
  if($Library){$argsList+=@('--library',('"'+$Library+'"'))}
  $proc=Start-Process -FilePath $python -ArgumentList $argsList -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $output 'server.stdout.log') -RedirectStandardError (Join-Path $output 'server.stderr.log') -PassThru
  $proc.Id | Set-Content -LiteralPath (Join-Path $output 'server.pid')
  for($i=0;$i -lt 40;$i++){
    try{$health=Invoke-RestMethod "$($url)api/health" -TimeoutSec 1;if($health.tool -eq 'tw-map-editor' -and $health.root -eq $root){$up=$true;break}}catch{}
    if($proc.HasExited){throw 'Server failed; inspect local/run/server.stderr.log. Try another -Port if busy.'}
    Start-Sleep -Milliseconds 250
  }
  if(!$up){throw 'Server readiness timed out. Inspect local/run/server.stderr.log.'}
}
if(!$NoOpen){Start-Process $url}
Write-Output "tw Map Editor ready: $url"
