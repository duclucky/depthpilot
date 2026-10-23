param([string]$Destination = (Join-Path (Join-Path $env:LOCALAPPDATA 'DepthPilot') 'app'),[switch]$NoLaunch,[switch]$NoShortcut)
$ErrorActionPreference = 'Stop'
$installNode = Join-Path $PSScriptRoot 'runtime/node.exe'
if (-not (Test-Path -LiteralPath $installNode)) { throw 'Use the Windows download, not the source archive. Extract the whole folder first.' }
$installArguments = @((Join-Path $PSScriptRoot 'scripts/install.mjs'), '--destination', $Destination)
if ($NoLaunch) { $installArguments += '--no-launch' }
if ($NoShortcut) { $installArguments += '--no-shortcut' }
& $installNode @installArguments
if ($LASTEXITCODE -ne 0) { throw 'Installation did not finish. Your existing profile was not removed.' }
