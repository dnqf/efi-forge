[CmdletBinding()]
param(
  [ValidateSet("check", "test", "catalog", "build", "native", "desktop-build", "full")]
  [string]$Task = "check",
  [string]$DataRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$localConfigPath = Join-Path $repoRoot ".efi-forge-workspace.local.json"

if ([string]::IsNullOrWhiteSpace($DataRoot)) {
  if (-not [string]::IsNullOrWhiteSpace($env:EFI_FORGE_DEV_DATA)) {
    $DataRoot = $env:EFI_FORGE_DEV_DATA
  } elseif (Test-Path -LiteralPath $localConfigPath) {
    $localConfig = Get-Content -Raw -Encoding UTF8 -LiteralPath $localConfigPath | ConvertFrom-Json
    if ($localConfig.schemaVersion -ne 1 -or [string]::IsNullOrWhiteSpace($localConfig.dataRoot)) {
      throw "Invalid local development workspace config: $localConfigPath"
    }
    $DataRoot = $localConfig.dataRoot
  } else {
    $DataRoot = Join-Path (Split-Path -Parent $repoRoot) "efi-forge-development-data"
  }
}

$dataRootPath = [System.IO.Path]::GetFullPath($DataRoot)
$volumeRoot = [System.IO.Path]::GetPathRoot($dataRootPath)
if ([string]::IsNullOrWhiteSpace($volumeRoot) -or $dataRootPath -eq $volumeRoot) {
  throw "The development data path cannot be a volume root: $dataRootPath"
}
$repoPrefix = $repoRoot.TrimEnd("\") + "\"
if (
  $dataRootPath.Equals($repoRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
  $dataRootPath.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)
) {
  throw "The development data path must stay outside the Git repository: $dataRootPath"
}

$npmCache = Join-Path $dataRootPath "cache\npm"
$cargoTarget = Join-Path $dataRootPath "build\cargo-target-current"
$temporaryRoot = Join-Path $dataRootPath "temp"
$artifactRoot = Join-Path $dataRootPath "artifacts\release-candidates"
foreach ($directory in @($npmCache, $cargoTarget, $temporaryRoot, $artifactRoot)) {
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
}

$minimumFreeBytes = if ($Task -in @("desktop-build", "full")) { 12GB } else { 2GB }
$drive = [System.IO.DriveInfo]::new($volumeRoot)
if ($drive.AvailableFreeSpace -lt $minimumFreeBytes) {
  $required = [math]::Round($minimumFreeBytes / 1GB, 1)
  $available = [math]::Round($drive.AvailableFreeSpace / 1GB, 1)
  throw "Insufficient development data disk space: ${required} GB required, ${available} GB available."
}

$env:EFI_FORGE_DEV_DATA = $dataRootPath
$env:npm_config_cache = $npmCache
$env:CARGO_TARGET_DIR = $cargoTarget
$env:TEMP = $temporaryRoot
$env:TMP = $temporaryRoot

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  Write-Host "> $FilePath $($Arguments -join ' ')" -ForegroundColor Cyan
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
  }
}

function Invoke-NativeChecks {
  Invoke-Checked "cargo" @("fmt", "--manifest-path", "src-tauri/Cargo.toml", "--", "--check")
  Invoke-Checked "cargo" @("clippy", "--manifest-path", "src-tauri/Cargo.toml", "--all-targets", "--all-features", "--", "-D", "warnings")
  Invoke-Checked "cargo" @("test", "--manifest-path", "src-tauri/Cargo.toml", "--all-features")
}

Push-Location $repoRoot
try {
  Write-Host "EFI Forge development data: $dataRootPath" -ForegroundColor Green
  switch ($Task) {
    "check" { Invoke-Checked "npm" @("run", "check") }
    "test" { Invoke-Checked "npm" @("test") }
    "catalog" { Invoke-Checked "npm" @("run", "test:catalog") }
    "build" { Invoke-Checked "npm" @("run", "build") }
    "native" { Invoke-NativeChecks }
    "desktop-build" { Invoke-Checked "npm" @("run", "desktop:build") }
    "full" {
      Invoke-Checked "npm" @("run", "check")
      Invoke-NativeChecks
      Invoke-Checked "cargo" @("test", "--manifest-path", "src-tauri/Cargo.toml", "--", "--ignored", "--test-threads=1")
      Invoke-Checked "npm" @("run", "desktop:build")
    }
  }
} finally {
  Pop-Location
}
