param(
    [string]$NodeZip = '',
    [string]$ChecksumFile = '',
    [string]$RuntimeDirectory = '',
    [string]$OutputDirectory = ''
)
$ErrorActionPreference = 'Stop'
$sourceDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$nodeVersion = '24.20.0'
$nodeFolder = "node-v$nodeVersion-win-x64"
$nodeArchiveName = "$nodeFolder.zip"
if (-not $NodeZip) { $NodeZip = Join-Path $sourceDirectory "downloads\$nodeArchiveName" }
if (-not $ChecksumFile) { $ChecksumFile = Join-Path $sourceDirectory 'downloads\SHASUMS256.txt' }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $sourceDirectory 'dist' }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$package = Get-Content -LiteralPath (Join-Path $sourceDirectory 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$releaseName = "PlayNext-$($package.version)-win-x64"
$packageDirectory = Join-Path $OutputDirectory $releaseName
$zipPath = Join-Path $OutputDirectory "$releaseName.zip"
if ((Test-Path -LiteralPath $packageDirectory) -or (Test-Path -LiteralPath $zipPath)) { throw 'This release already exists. Choose an empty output directory; existing releases are never overwritten.' }

$pinnedArchiveHash = '6cac9ffbca8f6a47091e4b5c772e0606049c3871cb67d900c0cedde630e545ba'
if ($RuntimeDirectory) {
    # Reuse only the exact runtime previously extracted from the official archive.
    $RuntimeDirectory = [IO.Path]::GetFullPath($RuntimeDirectory)
    $pinnedFiles = @{
        'node.exe' = '5c976096e04e5c2c1f091938926234cc9fbebfe9787ddd149351b3b0ecc707b5'
        'LICENSE' = 'ed34dd8e3f0a78dbaf00d0444ce8e285b015b765379c2e17880455f70370f8e9'
    }
    foreach ($name in $pinnedFiles.Keys) {
        $hash = (Get-FileHash -LiteralPath (Join-Path $RuntimeDirectory $name) -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($hash -ne $pinnedFiles[$name]) { throw "Verified runtime checksum mismatch: $name" }
    }
    $actualHash = $pinnedArchiveHash
} else {
    $expectedHash = $null
    foreach ($line in (Get-Content -LiteralPath $ChecksumFile)) {
        if ($line -match ('^([a-fA-F0-9]{64})\s+\*?' + [regex]::Escape($nodeArchiveName) + '$')) { $expectedHash = $Matches[1].ToLowerInvariant() }
    }
    if ($expectedHash -ne $pinnedArchiveHash) { throw 'The official checksum does not match the pinned Node.js release.' }
    $actualHash = (Get-FileHash -LiteralPath $NodeZip -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $expectedHash) { throw 'Node.js archive SHA-256 verification failed.' }
}

New-Item -ItemType Directory -Path $packageDirectory -Force | Out-Null
$packagedRuntimeDirectory = Join-Path $packageDirectory 'runtime'
New-Item -ItemType Directory -Path $packagedRuntimeDirectory | Out-Null
if ($RuntimeDirectory) {
    foreach ($name in @('node.exe', 'LICENSE')) { Copy-Item -LiteralPath (Join-Path $RuntimeDirectory $name) -Destination (Join-Path $packagedRuntimeDirectory $name) }
} else {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead([IO.Path]::GetFullPath($NodeZip))
    try {
    # Extract only named official files, never arbitrary ZIP entries.
    foreach ($entryName in @('node.exe', 'LICENSE')) {
        $entry = $archive.GetEntry("$nodeFolder/$entryName")
        if (-not $entry) { throw "Node.js archive is missing $entryName" }
        $destination = Join-Path $packagedRuntimeDirectory $entryName
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $false)
    }
    } finally { $archive.Dispose() }
}

# This allowlist excludes process records, logs, Steam data, local paths, tests,
# cached covers, settings, source archives and any other machine-specific files.
$releaseFiles = @(
    'package.json', 'server.mjs', 'start.ps1', 'Start.cmd', 'Stop.cmd',
    'README.md', 'README.en.md', 'READ ME FIRST.txt', 'THIRD_PARTY_NOTICES.md',
    'lib\steam.mjs', 'lib\owned.mjs', 'lib\steam-cache.mjs', 'lib\exclusions.mjs', 'lib\profile.mjs', 'public\index.html', 'public\app.js', 'public\exclusions.js', 'public\profile.js',
    'lib\install-size.mjs', 'lib\display-settings.mjs', 'public\display.js',
    'lib\online-sizes.mjs', 'public\online-sizes.js',
    'public\randomizer.js', 'public\style.css', 'public\responsive.css', 'public\icon.svg'
)
foreach ($relativeFile in $releaseFiles) {
    $destination = Join-Path $packageDirectory $relativeFile
    $parent = Split-Path -Parent $destination
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
    Copy-Item -LiteralPath (Join-Path $sourceDirectory $relativeFile) -Destination $destination -ErrorAction Stop
}
$release = [ordered]@{
    app = 'Play Next'
    version = $package.version
    platform = 'Windows 10/11 x64'
    runtime = "Node.js $nodeVersion"
    runtimeSource = "https://nodejs.org/dist/v$nodeVersion/$nodeArchiveName"
    runtimeArchiveSha256 = $actualHash
    runtimeExecutableSha256 = (Get-FileHash -LiteralPath (Join-Path $packagedRuntimeDirectory 'node.exe')).Hash.ToLowerInvariant()
    personalDataIncluded = $false
}
$release | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $packageDirectory 'release.json') -Encoding UTF8
Compress-Archive -LiteralPath $packageDirectory -DestinationPath $zipPath -CompressionLevel Optimal
$zipHash = (Get-FileHash -LiteralPath $zipPath).Hash.ToLowerInvariant()
"$zipHash  $releaseName.zip" | Set-Content -LiteralPath "$zipPath.sha256" -Encoding ASCII
[PSCustomObject]@{ Archive = $zipPath; Bytes = (Get-Item -LiteralPath $zipPath).Length; Sha256 = $zipHash; Runtime = $nodeVersion } | ConvertTo-Json
