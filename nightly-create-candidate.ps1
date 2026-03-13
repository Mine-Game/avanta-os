param(
  [string]$Title = "Nightly improvement",
  [string]$Summary = "Auto-generated candidate from nightly self-improvement run",
  [int]$Impact = 7,
  [int]$Risk = 3,
  [string]$ApiBase = "http://127.0.0.1:8811",
  [string]$PreviewUrl = ""
)

$ErrorActionPreference = 'Stop'

$nightlyLogPath = Join-Path $PSScriptRoot "data\lab\nightly-script-log.jsonl"
if (!(Test-Path (Split-Path $nightlyLogPath -Parent))) {
  New-Item -ItemType Directory -Path (Split-Path $nightlyLogPath -Parent) -Force | Out-Null
}

$body = @{
  title = $Title
  summary = $Summary
  impact = $Impact
  risk = $Risk
}
if ($PreviewUrl) {
  $body.previewUrl = $PreviewUrl
}

try {
  $response = Invoke-RestMethod -Uri "$ApiBase/api/lab/nightly-candidate" -Method POST -ContentType "application/json" -Body ($body | ConvertTo-Json)
  $log = @{
    at = (Get-Date).ToString('o')
    status = 'success'
    apiBase = $ApiBase
    title = $Title
    candidateId = $response.item.id
    previewUrl = $response.item.previewUrl
  } | ConvertTo-Json -Compress
  Add-Content -Path $nightlyLogPath -Value $log
  $response
} catch {
  $err = $_.Exception.Message
  $log = @{
    at = (Get-Date).ToString('o')
    status = 'failed'
    apiBase = $ApiBase
    title = $Title
    error = $err
  } | ConvertTo-Json -Compress
  Add-Content -Path $nightlyLogPath -Value $log
  throw
}
