[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $projectRoot 'manifest.json'
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$releaseName = "Form2Offer-v$($manifest.version)"
$distRoot = Join-Path $projectRoot 'dist'
$releaseDir = Join-Path $distRoot $releaseName
$zipPath = Join-Path $distRoot "$releaseName.zip"
$checksumPath = "$zipPath.sha256"

foreach ($target in @($releaseDir, $zipPath, $checksumPath)) {
  if (Test-Path -LiteralPath $target) {
    throw "Release target already exists: $target"
  }
}

New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'manifest.json') -Destination $releaseDir
Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE') -Destination $releaseDir
Copy-Item -LiteralPath (Join-Path $projectRoot 'NOTICE') -Destination $releaseDir
Copy-Item -LiteralPath (Join-Path $projectRoot 'PRIVACY.md') -Destination $releaseDir
Copy-Item -LiteralPath (Join-Path $projectRoot 'sample-profile.json') -Destination $releaseDir
Copy-Item -LiteralPath (Join-Path $projectRoot 'src') -Destination $releaseDir -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'icons') -Destination $releaseDir -Recurse

Compress-Archive -Path (Join-Path $releaseDir '*') -DestinationPath $zipPath -CompressionLevel Optimal
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash.ToLowerInvariant()
Set-Content -LiteralPath $checksumPath -Value "$hash  $releaseName.zip" -Encoding utf8NoBOM

Write-Output "Release directory: $releaseDir"
Write-Output "Release archive: $zipPath"
Write-Output "SHA256: $hash"
