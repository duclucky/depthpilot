& {
    $ErrorActionPreference = 'Stop'
    $DepthPilotURL = 'https://github.com/duclucky/depthpilot/releases/download/v0.3.2/DepthPilot-0.3.2-windows-x64.zip'
    $DepthPilotSHA256 = 'e3f4d2a282705cccf91a50dc7132700c00e2ea44e93623cc36bb11e8bfcc1934'
    $DepthPilotFolder = Join-Path $env:LOCALAPPDATA ('DepthPilot\downloads\0.3.2-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $DepthPilotFolder | Out-Null
    $DepthPilotZIP = Join-Path $DepthPilotFolder 'DepthPilot.zip'
    Write-Host 'Downloading and checking DepthPilot 0.3.2...'
    Invoke-WebRequest -UseBasicParsing -Uri $DepthPilotURL -OutFile $DepthPilotZIP
    $DepthPilotStream = [IO.File]::OpenRead($DepthPilotZIP)
    $DepthPilotHasher = [Security.Cryptography.SHA256]::Create()
    try { $DepthPilotActual = [BitConverter]::ToString($DepthPilotHasher.ComputeHash($DepthPilotStream)).Replace('-', '').ToLowerInvariant() }
    finally { $DepthPilotStream.Dispose(); $DepthPilotHasher.Dispose() }
    if ($DepthPilotActual -ne $DepthPilotSHA256) { throw 'SHA-256 check failed. Nothing was installed.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($DepthPilotZIP, $DepthPilotFolder)
    $DepthPilotApp = Join-Path $DepthPilotFolder 'DepthPilot-0.3.2'
    & (Join-Path $DepthPilotApp 'runtime\node.exe') (Join-Path $DepthPilotApp 'scripts\install.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Installation did not finish. Stop and close an existing DepthPilot app before trying again.' }
}
