param(
  [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
  [string[]]$BridgeArgs
)

$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $BridgeArgs -or $BridgeArgs.Count -eq 0) {
  $BridgeArgs = @('serve')
}
if ($BridgeArgs -notcontains '--data-dir' -and -not $env:FORM2OFFER_BRIDGE_DATA_DIR) {
  $defaultDataDir = if (Test-Path -LiteralPath 'G:\') { 'G:\Form2Offer\BridgeData' } else { Join-Path $env:LOCALAPPDATA 'Form2Offer\BridgeData' }
  $BridgeArgs += @('--data-dir', $defaultDataDir)
}
& node (Join-Path $bridgeRoot 'bin\form2offer-bridge.js') @BridgeArgs
