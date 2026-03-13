param(
  [string]$Passphrase = "",
  [switch]$Push
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$WorkspaceRoot = 'C:\Users\vboxuser\.openclaw\workspace-finfak'
$OpenClawStateRoot = 'C:\Users\vboxuser\.openclaw-finfak'
$OutDir = Join-Path $ProjectRoot 'data\openclaw-full-backup'
$StageDir = Join-Path $ProjectRoot 'data\openclaw-full-backup-staging'
$ArchivePath = Join-Path $OutDir 'latest.zip'
$EncryptedPath = Join-Path $OutDir 'latest.enc'
$MetaPath = Join-Path $OutDir 'latest.meta.json'

if (-not $Passphrase) {
  $Passphrase = $env:OPENCLAW_B2_PASSPHRASE
}

if (-not $Passphrase) {
  throw 'Passphrase is required. Set -Passphrase or OPENCLAW_B2_PASSPHRASE.'
}

function Ensure-Dir([string]$Path) {
  if (-not (Test-Path $Path)) { New-Item -ItemType Directory -Path $Path -Force | Out-Null }
}

function Remove-PathIfExists([string]$Path) {
  if (Test-Path $Path) { Remove-Item -Path $Path -Recurse -Force }
}

function Copy-Tree([string]$Source, [string]$Dest) {
  if (Test-Path $Source) {
    Ensure-Dir (Split-Path -Parent $Dest)
    Copy-Item -Path $Source -Destination $Dest -Recurse -Force
  }
}

function Encrypt-FileAes([string]$InputFile, [string]$OutputFile, [string]$Secret) {
  $salt = New-Object byte[] 16
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($salt)

  $derive = New-Object System.Security.Cryptography.Rfc2898DeriveBytes($Secret, $salt, 200000, [System.Security.Cryptography.HashAlgorithmName]::SHA256)
  $key = $derive.GetBytes(32)
  $iv = $derive.GetBytes(16)

  $aes = [System.Security.Cryptography.Aes]::Create()
  $aes.Mode = [System.Security.Cryptography.CipherMode]::CBC
  $aes.Padding = [System.Security.Cryptography.PaddingMode]::PKCS7
  $aes.Key = $key
  $aes.IV = $iv

  $plain = [System.IO.File]::ReadAllBytes($InputFile)
  $ms = New-Object System.IO.MemoryStream
  $header = [System.Text.Encoding]::UTF8.GetBytes('OPENCLAW-B2-V1')
  $ms.Write($header, 0, $header.Length)
  $ms.Write($salt, 0, $salt.Length)

  $cs = New-Object System.Security.Cryptography.CryptoStream($ms, $aes.CreateEncryptor(), [System.Security.Cryptography.CryptoStreamMode]::Write)
  $cs.Write($plain, 0, $plain.Length)
  $cs.FlushFinalBlock()
  $cs.Dispose()

  [System.IO.File]::WriteAllBytes($OutputFile, $ms.ToArray())
  $ms.Dispose()
  $aes.Dispose()
  $derive.Dispose()
}

# stage snapshot
Remove-PathIfExists $StageDir
Ensure-Dir $StageDir
Ensure-Dir $OutDir

Copy-Tree $OpenClawStateRoot (Join-Path $StageDir 'openclaw-state')
Copy-Tree $WorkspaceRoot (Join-Path $StageDir 'workspace')

# remove local clutter / transient dirs from stage
$removeList = @(
  (Join-Path $StageDir 'workspace\projects\avanta-os\data\openclaw-full-backup-staging'),
  (Join-Path $StageDir 'workspace\projects\avanta-os\data\openclaw-full-backup\latest.zip')
)
foreach ($r in $removeList) { if (Test-Path $r) { Remove-Item -Path $r -Recurse -Force -ErrorAction SilentlyContinue } }

# pack + encrypt
if (Test-Path $ArchivePath) { Remove-Item $ArchivePath -Force }
if (Test-Path $EncryptedPath) { Remove-Item $EncryptedPath -Force }

Compress-Archive -Path (Join-Path $StageDir '*') -DestinationPath $ArchivePath -Force
Encrypt-FileAes -InputFile $ArchivePath -OutputFile $EncryptedPath -Secret $Passphrase
Remove-Item $ArchivePath -Force

$meta = [ordered]@{
  generatedAt = (Get-Date).ToString('o')
  version = 'OPENCLAW-B2-V1'
  mode = 'encrypted-full'
  includes = @(
    'C:\\Users\\vboxuser\\.openclaw-finfak (full state)',
    'C:\\Users\\vboxuser\\.openclaw\\workspace-finfak (full workspace)'
  )
  encryptedFile = 'data/openclaw-full-backup/latest.enc'
  warning = 'Contains encrypted full-state snapshot. Keep passphrase offline.'
}
$meta | ConvertTo-Json -Depth 8 | Set-Content -Path $MetaPath -Encoding UTF8

Remove-PathIfExists $StageDir

Push-Location $ProjectRoot
try {
  git add data/openclaw-full-backup/latest.enc data/openclaw-full-backup/latest.meta.json
  git diff --cached --quiet
  if ($LASTEXITCODE -eq 0) {
    Write-Host 'No B2 backup changes to commit.'
    exit 0
  }

  $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
  git commit -m "chore(backup): B2 encrypted full snapshot $stamp"

  if ($Push) {
    git push origin main
    git push backup main
    Write-Host 'B2 encrypted snapshot committed and pushed to origin + backup.'
  } else {
    Write-Host 'B2 encrypted snapshot committed locally (no push).'
  }
}
finally {
  Pop-Location
}
