param(
  [switch]$Push
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$WorkspaceRoot = 'C:\Users\vboxuser\.openclaw\workspace-finfak'
$OpenClawStateRoot = 'C:\Users\vboxuser\.openclaw-finfak'
$BackupDir = Join-Path $ProjectRoot 'data\openclaw-safe-backup'

function Ensure-Dir([string]$Path) {
  if (-not (Test-Path $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }
}

function Copy-FileSafe([string]$Source, [string]$Dest) {
  Ensure-Dir (Split-Path -Parent $Dest)
  Copy-Item -Path $Source -Destination $Dest -Force
}

function Redact-JsonText([string]$jsonText) {
  $redacted = $jsonText
  $patterns = @(
    '(?i)"token"\s*:\s*"[^"]*"',
    '(?i)"apiKey"\s*:\s*"[^"]*"',
    '(?i)"password"\s*:\s*"[^"]*"',
    '(?i)"cookie"\s*:\s*"[^"]*"',
    '(?i)"secret"\s*:\s*"[^"]*"'
  )
  foreach ($p in $patterns) {
    $redacted = [Regex]::Replace($redacted, $p, { param($m) ($m.Value -replace ':\s*"[^"]*"', ': "***REDACTED***"') })
  }
  return $redacted
}

# recreate snapshot folder
if (Test-Path $BackupDir) {
  Remove-Item -Path $BackupDir -Recurse -Force
}
Ensure-Dir $BackupDir

# 1) OpenClaw state (safe subset)
$openclawJson = Join-Path $OpenClawStateRoot 'openclaw.json'
if (Test-Path $openclawJson) {
  $openclawRaw = Get-Content -Raw -Path $openclawJson
  $openclawSafe = Redact-JsonText $openclawRaw
  Ensure-Dir (Join-Path $BackupDir 'openclaw-state')
  Set-Content -Path (Join-Path $BackupDir 'openclaw-state\openclaw.json') -Value $openclawSafe -Encoding UTF8
}

$cronJobs = Join-Path $OpenClawStateRoot 'cron\jobs.json'
if (Test-Path $cronJobs) {
  Copy-FileSafe $cronJobs (Join-Path $BackupDir 'openclaw-state\cron\jobs.json')
}

# 2) Workspace memory/docs (safe subset)
$workspaceFiles = @(
  'AGENTS.md',
  'SOUL.md',
  'USER.md',
  'IDENTITY.md',
  'MEMORY.md',
  'HEARTBEAT.md',
  'TOOLS.md',
  'memory\backup-repo-url.txt'
)
foreach ($rel in $workspaceFiles) {
  $src = Join-Path $WorkspaceRoot $rel
  if (Test-Path $src) {
    Copy-FileSafe $src (Join-Path $BackupDir ('workspace\' + $rel))
  }
}

$memoryDir = Join-Path $WorkspaceRoot 'memory'
if (Test-Path $memoryDir) {
  Get-ChildItem -Path $memoryDir -Filter '*.md' -File | ForEach-Object {
    $dest = Join-Path $BackupDir ('workspace\memory\' + $_.Name)
    Copy-FileSafe $_.FullName $dest
  }
}

$manifest = @{
  generatedAt = (Get-Date).ToString('o')
  profile = 'finfak'
  mode = 'safe'
  excludes = @('tokens','api keys','passwords','cookies','session files','auth-profiles')
  included = @(
    'openclaw-state/openclaw.json (redacted)',
    'openclaw-state/cron/jobs.json',
    'workspace/*.md + memory/*.md'
  )
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -Path (Join-Path $BackupDir 'MANIFEST.json') -Encoding UTF8

Push-Location $ProjectRoot
try {
  git add data/openclaw-safe-backup
  git diff --cached --quiet
  if ($LASTEXITCODE -eq 0) {
    Write-Host 'No backup changes to commit.'
    exit 0
  }

  $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
  git commit -m "chore(backup): safe OpenClaw snapshot $stamp"

  if ($Push) {
    git push origin main
    git push backup main
    Write-Host 'Backup snapshot committed and pushed to origin + backup.'
  } else {
    Write-Host 'Backup snapshot committed locally (no push).'
  }
}
finally {
  Pop-Location
}
