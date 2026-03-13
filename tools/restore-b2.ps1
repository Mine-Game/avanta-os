param(
  [Parameter(Mandatory = $true)][string]$Passphrase,
  [string]$EncryptedFile = 'C:\Users\vboxuser\.openclaw\workspace-finfak\projects\avanta-os\data\openclaw-full-backup\latest.enc',
  [string]$RestoreRoot = 'C:\restore-openclaw-b2'
)

$ErrorActionPreference = 'Stop'

function Ensure-Dir([string]$Path) {
  if (-not (Test-Path $Path)) { New-Item -ItemType Directory -Path $Path -Force | Out-Null }
}

function Decrypt-FileAes([string]$InputFile, [string]$OutputFile, [string]$Secret) {
  $blob = [System.IO.File]::ReadAllBytes($InputFile)
  $header = [System.Text.Encoding]::UTF8.GetString($blob, 0, 13)
  if ($header -ne 'OPENCLAW-B2-V1') { throw 'Unknown encrypted snapshot format' }

  $salt = New-Object byte[] 16
  [Array]::Copy($blob, 13, $salt, 0, 16)
  $cipher = New-Object byte[] ($blob.Length - 29)
  [Array]::Copy($blob, 29, $cipher, 0, $cipher.Length)

  $derive = New-Object System.Security.Cryptography.Rfc2898DeriveBytes($Secret, $salt, 200000, [System.Security.Cryptography.HashAlgorithmName]::SHA256)
  $key = $derive.GetBytes(32)
  $iv = $derive.GetBytes(16)

  $aes = [System.Security.Cryptography.Aes]::Create()
  $aes.Mode = [System.Security.Cryptography.CipherMode]::CBC
  $aes.Padding = [System.Security.Cryptography.PaddingMode]::PKCS7
  $aes.Key = $key
  $aes.IV = $iv

  $ms = New-Object System.IO.MemoryStream
  $cs = New-Object System.Security.Cryptography.CryptoStream($ms, $aes.CreateDecryptor(), [System.Security.Cryptography.CryptoStreamMode]::Write)
  $cs.Write($cipher, 0, $cipher.Length)
  $cs.FlushFinalBlock()
  $cs.Dispose()

  [System.IO.File]::WriteAllBytes($OutputFile, $ms.ToArray())
  $ms.Dispose()
  $aes.Dispose()
  $derive.Dispose()
}

if (-not (Test-Path $EncryptedFile)) { throw "Encrypted backup not found: $EncryptedFile" }
Ensure-Dir $RestoreRoot

$zipPath = Join-Path $RestoreRoot 'snapshot.zip'
$extractPath = Join-Path $RestoreRoot 'snapshot'
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
if (Test-Path $extractPath) { Remove-Item $extractPath -Recurse -Force }

Decrypt-FileAes -InputFile $EncryptedFile -OutputFile $zipPath -Secret $Passphrase
Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force

Write-Host "Decrypted snapshot extracted to: $extractPath"
Write-Host 'Review files, then manually copy:'
Write-Host '  snapshot/openclaw-state  -> C:\Users\vboxuser\.openclaw-finfak'
Write-Host '  snapshot/workspace      -> C:\Users\vboxuser\.openclaw\workspace-finfak'
Write-Host 'After restore: run openclaw gateway restart'
