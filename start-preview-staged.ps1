param(
  [int]$Port = 8811,
  [switch]$Background
)

$ErrorActionPreference = 'Stop'
if ($Port -eq 8800) {
  throw 'Port 8800 is reserved for production preview. Use a staged sandbox port (8811-8999).'
}

$hostIp = '127.0.0.1'

if ($Background) {
  $conn = Get-NetTCPConnection -LocalAddress $hostIp -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($conn) {
    try { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction Stop } catch {}
    Start-Sleep -Milliseconds 300
  }

  $wd = Split-Path -Parent $MyInvocation.MyCommand.Path
  $cmd = "cd `"$wd`"; `$env:AVANTA_PORT=$Port; node .\server.js"
  Start-Process powershell -ArgumentList "-NoProfile", "-WindowStyle", "Minimized", "-Command", $cmd | Out-Null
  Write-Host "Avanta-OS staged preview started in background: http://$hostIp`:$Port/"
  exit 0
}

Write-Host "Starting Avanta-OS staged preview on http://$hostIp`:$Port/"
$env:AVANTA_PORT = "$Port"
node .\server.js
