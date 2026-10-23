[CmdletBinding()]
param(
    [string]$Destination,
    [string]$DownloadDirectory,
    [string]$ArchivePath,
    [switch]$NoLaunch,
    [switch]$NoShortcut
)
$ErrorActionPreference = 'Stop'
$DepthPilotVersion = '0.2.2'
$DepthPilotSHA256 = '17bb8313caf4b75a91c59d04d5590a201fe2ff54e0d821f6b35a4dc26a80e0cf'
$DepthPilotURL = 'https://github.com/duclucky/depthpilot/releases/download/v0.2.2/DepthPilot-0.2.2-windows-x64.zip'
function Get-DepthPilotSHA256([string]$Path) {
    $DepthPilotStream = [IO.File]::OpenRead($Path)
    $DepthPilotHasher = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($DepthPilotHasher.ComputeHash($DepthPilotStream)).Replace('-', '').ToLowerInvariant() }
    finally { $DepthPilotStream.Dispose(); $DepthPilotHasher.Dispose() }
}
if (-not [Environment]::Is64BitOperatingSystem) { throw 'DepthPilot needs 64-bit Windows.' }
if (-not $env:LOCALAPPDATA) { throw 'Open PowerShell as your normal Windows user.' }
if (-not $Destination) { $Destination = Join-Path $env:LOCALAPPDATA 'DepthPilot\app' }
if (-not $DownloadDirectory) { $DownloadDirectory = Join-Path $env:LOCALAPPDATA 'DepthPilot\downloads' }
if ($ArchivePath) {
    $DepthPilotArchive = (Resolve-Path -LiteralPath $ArchivePath).Path
    Write-Host 'Checking your existing DepthPilot download...'
    if ((Get-DepthPilotSHA256 $DepthPilotArchive) -ne $DepthPilotSHA256) {
        throw 'SHA-256 check failed. Nothing was installed. Download the official Windows 0.2.2 package again.'
    }
}
$DepthPilotWork = Join-Path $DownloadDirectory ($DepthPilotVersion + '-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $DepthPilotWork | Out-Null
if (-not $ArchivePath) {
    $DepthPilotArchive = Join-Path $DepthPilotWork 'DepthPilot.zip'
    Write-Host 'Downloading DepthPilot 0.2.2 from GitHub Releases...'
    Invoke-WebRequest -UseBasicParsing -Uri $DepthPilotURL -OutFile $DepthPilotArchive
}
Write-Host 'Verifying the tested package...'
if ((Get-DepthPilotSHA256 $DepthPilotArchive) -ne $DepthPilotSHA256) {
    throw 'SHA-256 check failed. Nothing was installed. Download the official Windows 0.2.2 package again.'
}
Write-Host 'Extracting DepthPilot...'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::ExtractToDirectory($DepthPilotArchive, $DepthPilotWork)
$DepthPilotApp = Join-Path $DepthPilotWork ('DepthPilot-' + $DepthPilotVersion)
$DepthPilotNode = Join-Path $DepthPilotApp 'runtime\node.exe'
$DepthPilotInstaller = Join-Path $DepthPilotApp 'scripts\install.mjs'
$DepthPilotArguments = @($DepthPilotInstaller, '--destination', $Destination)
if ($NoLaunch) { $DepthPilotArguments += '--no-launch' }
if ($NoShortcut) { $DepthPilotArguments += '--no-shortcut' }
Write-Host 'Installing for your Windows user. Your existing profile stays in place...'
& $DepthPilotNode @DepthPilotArguments
if ($LASTEXITCODE -ne 0) { throw 'Installation did not finish. Stop and close an existing DepthPilot app before trying again. Your profile was not removed.' }
Write-Host 'Done. Return using the DepthPilot shortcut or Open DepthPilot.bat.'
