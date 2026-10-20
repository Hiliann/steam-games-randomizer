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
    'package.json', 'server.mjs', 'start.ps1',
    'LICENSE', 'THIRD_PARTY_NOTICES.md', 'public\update-controller.js', 'public\library-view.js', 'public\settings-controller.js', 'public\appearance-controller.js',
    'lib\steam.mjs', 'lib\owned.mjs', 'lib\steam-cache.mjs', 'lib\exclusions.mjs', 'lib\profile.mjs', 'public\index.html', 'public\app.js', 'public\exclusions.js', 'public\profile.js',
    'lib\install-size.mjs', 'lib\display-settings.mjs', 'public\display.js',
    'lib\online-sizes.mjs', 'lib\request-gate.mjs', 'lib\store-details.mjs', 'public\online-sizes.js', 'public\descriptions.js',
    'lib\windows-integration.mjs', 'lib\update-check.mjs', 'lib\update-installer.mjs', 'lib\steam-launch.mjs', 'lib\app-settings.mjs', 'lib\ui-settings.mjs', 'lib\backup.mjs',
    'lib\browser-sessions.mjs', 'lib\desktop-owner.mjs', 'lib\session-frames.mjs', 'lib\update-state.mjs', 'lib\diagnostics.mjs', 'public\diagnostics.js', 'public\diagnostics-controller.js',
    'scripts\windows-integration.ps1', 'scripts\launch-steam.ps1', 'scripts\apply-update.ps1', 'scripts\update-common.ps1', 'public\update-flow.js', 'public\system.js', 'public\app-settings.js', 'public\ui-settings.js', 'public\i18n.js', 'public\i18n-en.js', 'public\i18n-uk.js', 'public\i18n-es.js', 'public\i18n-pt-br.js', 'public\i18n-de.js', 'public\backup.js', 'public\browser-session.js',
    'public\randomizer.js', 'public\workspace.js', 'public\filter-presets.js', 'public\store-details.js', 'public\collections.js', 'public\toast.js', 'public\game-details.js', 'public\draw-animation.js', 'public\decision.js', 'public\scroll-activity.js', 'public\startup.js', 'public\style.css', 'public\responsive.css', 'public\desktop.css', 'public\icon.svg', 'public\icon.png', 'public\icon.ico'
)
foreach ($relativeFile in $releaseFiles) {
    $destination = Join-Path $packageDirectory $(if ($relativeFile -eq 'LICENSE') { 'runtime\PlayNext-LICENSE.txt' } else { $relativeFile })
    $parent = Split-Path -Parent $destination
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
    Copy-Item -LiteralPath (Join-Path $sourceDirectory $relativeFile) -Destination $destination -ErrorAction Stop
}
& (Join-Path $PSScriptRoot 'build-desktop.ps1') -PackageDirectory $packageDirectory
$launcher = Join-Path $packageDirectory 'Play Next.exe'
$release = [ordered]@{
    app = 'Play Next'
    version = $package.version
    platform = 'Windows 10/11 x64'
    runtime = "Node.js $nodeVersion"
    runtimeSource = "https://nodejs.org/dist/v$nodeVersion/$nodeArchiveName"
    runtimeArchiveSha256 = $actualHash
    runtimeExecutableSha256 = (Get-FileHash -LiteralPath (Join-Path $packagedRuntimeDirectory 'node.exe')).Hash.ToLowerInvariant()
    personalDataIncluded = $false
    desktopHost = 'Windows Forms + Microsoft Edge WebView2'
    webView2Sdk = '1.0.4258.31'
}
$release | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $packageDirectory 'release.json') -Encoding UTF8
$manifestFiles = Get-ChildItem -LiteralPath $packageDirectory -File -Recurse | Where-Object { $_.FullName -ne $launcher } | ForEach-Object {
    $relative = $_.FullName.Substring($packageDirectory.Length + 1).Replace('\', '/')
    [ordered]@{ path = $relative; bytes = [long]$_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
}
$bootstrapFiles = @([ordered]@{ path = 'Play Next.exe'; bytes = [long](Get-Item -LiteralPath $launcher).Length; sha256 = (Get-FileHash -LiteralPath $launcher -Algorithm SHA256).Hash.ToLowerInvariant() })
# bootstrapFiles is separate so updaters from 1.7/1.8 can ignore the new root
# launcher and still install the verified copy under scripts. start.ps1 then syncs it.
$manifest = [ordered]@{ version = 1; appVersion = $package.version; files = @($manifestFiles); bootstrapFiles = $bootstrapFiles }
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $packageDirectory 'release-manifest.json') -Encoding UTF8
Compress-Archive -LiteralPath $packageDirectory -DestinationPath $zipPath -CompressionLevel Optimal
$zipHash = (Get-FileHash -LiteralPath $zipPath).Hash.ToLowerInvariant()
"$zipHash  $releaseName.zip" | Set-Content -LiteralPath "$zipPath.sha256" -Encoding ASCII
[PSCustomObject]@{ Archive = $zipPath; Bytes = (Get-Item -LiteralPath $zipPath).Length; Sha256 = $zipHash; Runtime = $nodeVersion } | ConvertTo-Json
