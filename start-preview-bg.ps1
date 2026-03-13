$ErrorActionPreference = 'Stop'
$hostIp = '127.0.0.1'
$port = 8800

$conn = Get-NetTCPConnection -LocalAddress $hostIp -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($conn) {
  try { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction Stop } catch {}
  Start-Sleep -Milliseconds 300
}

$wd = Split-Path -Parent $MyInvocation.MyCommand.Path
$cmd = "cd `"$wd`"; node .\server.js"
Start-Process powershell -ArgumentList "-NoProfile", "-WindowStyle", "Minimized", "-Command", $cmd | Out-Null
Write-Host "Avanta-OS preview restarted in background: http://$hostIp`:$port/"
