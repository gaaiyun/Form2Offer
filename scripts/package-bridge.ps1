[CmdletBinding()]
param([switch]$Force)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$bridgeRoot = Join-Path $projectRoot 'bridge'
$packageJson = Get-Content -Raw -LiteralPath (Join-Path $bridgeRoot 'package.json') | ConvertFrom-Json
$releaseName = "Form2Offer-Bridge-win-x64-v$($packageJson.version)"
$distRoot = Join-Path $projectRoot 'dist'
$releaseDir = Join-Path $distRoot $releaseName
$zipPath = Join-Path $distRoot "$releaseName.zip"
$checksumPath = "$zipPath.sha256"

foreach ($target in @($releaseDir, $zipPath, $checksumPath)) {
  if (Test-Path -LiteralPath $target) {
    if ($Force) { Remove-Item -LiteralPath $target -Recurse -Force }
    else { throw "Release target already exists: $target" }
  }
}

New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $releaseDir 'bin') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $releaseDir 'src') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $bridgeRoot 'package.json') -Destination $releaseDir
Copy-Item -LiteralPath (Join-Path $bridgeRoot 'README.md') -Destination $releaseDir
Copy-Item -LiteralPath (Join-Path $bridgeRoot 'start-bridge.ps1') -Destination $releaseDir
Copy-Item -LiteralPath (Join-Path $bridgeRoot 'bin\form2offer-bridge.js') -Destination (Join-Path $releaseDir 'bin')
Copy-Item -Path (Join-Path $bridgeRoot 'src\*') -Destination (Join-Path $releaseDir 'src')
Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE') -Destination $releaseDir
Copy-Item -LiteralPath (Join-Path $projectRoot 'NOTICE') -Destination $releaseDir

Compress-Archive -Path (Join-Path $releaseDir '*') -DestinationPath $zipPath -CompressionLevel Optimal
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash.ToLowerInvariant()
Set-Content -LiteralPath $checksumPath -Value "$hash  $releaseName.zip" -Encoding utf8NoBOM

Write-Output "Release directory: $releaseDir"
Write-Output "Release archive: $zipPath"
Write-Output "SHA256: $hash"
