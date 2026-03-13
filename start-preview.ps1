$ErrorActionPreference = 'Stop'
$hostIp = '127.0.0.1'
$port = 8800
Write-Host "Starting Avanta-OS preview on http://$hostIp`:$port/"
node .\server.js
