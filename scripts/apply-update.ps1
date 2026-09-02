param(
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$DownloadUrl,
    [Parameter(Mandatory = $true)][string]$ChecksumUrl,
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][int]$Port
)
$ErrorActionPreference = 'Stop'
$appDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$logPath = Join-Path $appDirectory '.update.log'
$temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) ("PlayNextUpdate-" + [guid]::NewGuid().ToString('N'))
$backupDirectory = Join-Path $temporaryDirectory 'backup'
$replaced = New-Object System.Collections.Generic.List[string]
$created = New-Object System.Collections.Generic.List[string]

function Write-UpdateLog([string]$Message) {
    $line = "$(Get-Date -Format o) $Message"
    Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}
function Resolve-SafeTarget([string]$RelativePath) {
    if (-not $RelativePath -or [IO.Path]::IsPathRooted($RelativePath) -or $RelativePath -match '(^|/|\\)\.\.($|/|\\)') { throw "Unsafe manifest path: $RelativePath" }
    $normalized = $RelativePath.Replace('/', [IO.Path]::DirectorySeparatorChar)
    $target = [IO.Path]::GetFullPath((Join-Path $appDirectory $normalized))
    if (-not $target.StartsWith($appDirectory + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Path leaves app directory: $RelativePath" }
    $top = $RelativePath.Replace('\', '/').Split('/')[0]
    if (@('data', '.git', 'dist', 'downloads') -contains $top -or $RelativePath -match '(^|/)(\.server|.*\.log)') { throw "Protected path in manifest: $RelativePath" }
    if ((@('lib', 'public', 'runtime', 'scripts') -notcontains $top) -and (@('package.json', 'server.mjs', 'start.ps1', 'Start.cmd', 'Stop.cmd', 'README.md', 'README.en.md', 'READ ME FIRST.txt', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md', 'release.json') -notcontains $RelativePath)) { throw "Unexpected manifest path: $RelativePath" }
    return $target
}
function Start-PlayNext {
    $starter = Join-Path $appDirectory 'start.ps1'
    if (Test-Path -LiteralPath $starter) {
        $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$starter`" -NoBrowser -Port $Port"
        Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WorkingDirectory $appDirectory -WindowStyle Hidden
    }
}

try {
    if ($Version -notmatch '^\d+\.\d+\.\d+$' -or $Port -lt 1 -or $Port -gt 65535 -or $ProcessId -lt 1) { throw 'Invalid installer arguments.' }
    $escapedVersion = [regex]::Escape($Version)
    if ($DownloadUrl -notmatch "^https://github\.com/Hiliann/steam-games-randomizer/releases/download/v$escapedVersion/PlayNext-$escapedVersion-win-x64\.zip$") { throw 'Unexpected release URL.' }
    if ($ChecksumUrl -notmatch "^https://github\.com/Hiliann/steam-games-randomizer/releases/download/v$escapedVersion/PlayNext-$escapedVersion-win-x64\.zip\.sha256$") { throw 'Unexpected checksum URL.' }
    New-Item -ItemType Directory -Path $temporaryDirectory, $backupDirectory -Force | Out-Null
    $archivePath = Join-Path $temporaryDirectory 'release.zip'
    $checksumPath = Join-Path $temporaryDirectory 'release.zip.sha256'
    Write-UpdateLog "Downloading Play Next $Version."
    Invoke-WebRequest -UseBasicParsing -Uri $DownloadUrl -OutFile $archivePath
    Invoke-WebRequest -UseBasicParsing -Uri $ChecksumUrl -OutFile $checksumPath
    $checksumText = (Get-Content -LiteralPath $checksumPath -Raw -Encoding ASCII).Trim()
    if ($checksumText -notmatch '^([a-fA-F0-9]{64})\s+PlayNext-[0-9]+\.[0-9]+\.[0-9]+-win-x64\.zip$') { throw 'Invalid checksum file.' }
    $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $Matches[1].ToLowerInvariant()) { throw 'Release checksum mismatch.' }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
        $expectedRoot = "PlayNext-$Version-win-x64/"
        if ($archive.Entries.Count -gt 1000) { throw 'Release contains too many files.' }
        $totalBytes = [long]0
        foreach ($entry in $archive.Entries) {
            $name = $entry.FullName.Replace('\', '/')
            if (-not $name.StartsWith($expectedRoot, [StringComparison]::Ordinal) -or $name -match '(^|/)\.\.(/|$)' -or $name.StartsWith('/')) { throw "Unsafe archive entry: $name" }
            $totalBytes += $entry.Length
            if ($totalBytes -gt 350MB) { throw 'Release is too large.' }
        }
        [IO.Compression.ZipFileExtensions]::ExtractToDirectory($archive, $temporaryDirectory)
    } finally { $archive.Dispose() }

    $packageDirectory = Join-Path $temporaryDirectory "PlayNext-$Version-win-x64"
    $release = Get-Content -LiteralPath (Join-Path $packageDirectory 'release.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $manifest = Get-Content -LiteralPath (Join-Path $packageDirectory 'release-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($release.app -ne 'Play Next' -or $release.version -ne $Version -or $manifest.version -ne 1 -or $manifest.appVersion -ne $Version -or -not $manifest.files) { throw 'Release metadata mismatch.' }
    if ($manifest.files.Count -gt 500) { throw 'Manifest contains too many files.' }
    $seen = @{}
    foreach ($item in $manifest.files) {
        if ($item.path -isnot [string] -or $item.sha256 -notmatch '^[a-fA-F0-9]{64}$' -or $item.bytes -isnot [long] -and $item.bytes -isnot [int]) { throw 'Invalid manifest entry.' }
        $relative = $item.path.Replace('\', '/')
        if ($seen.ContainsKey($relative)) { throw "Duplicate manifest entry: $relative" }
        $seen[$relative] = $true
        [void](Resolve-SafeTarget $relative)
        $source = [IO.Path]::GetFullPath((Join-Path $packageDirectory $relative.Replace('/', [IO.Path]::DirectorySeparatorChar)))
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing release file: $relative" }
        $sourceInfo = Get-Item -LiteralPath $source
        if ($sourceInfo.Length -ne [long]$item.bytes -or (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $item.sha256.ToLowerInvariant()) { throw "Manifest verification failed: $relative" }
    }

    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($process) { $process.WaitForExit(60000) | Out-Null }
    if (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) { throw 'Play Next did not stop in time.' }

    foreach ($item in $manifest.files) {
        $relative = $item.path.Replace('\', '/')
        $source = Join-Path $packageDirectory $relative.Replace('/', [IO.Path]::DirectorySeparatorChar)
        $target = Resolve-SafeTarget $relative
        $parent = Split-Path -Parent $target
        if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
        if (Test-Path -LiteralPath $target -PathType Leaf) {
            $backup = Join-Path $backupDirectory $relative.Replace('/', [IO.Path]::DirectorySeparatorChar)
            $backupParent = Split-Path -Parent $backup
            if (-not (Test-Path -LiteralPath $backupParent)) { New-Item -ItemType Directory -Path $backupParent -Force | Out-Null }
            Copy-Item -LiteralPath $target -Destination $backup
            $replaced.Add($relative)
        } else { $created.Add($relative) }
        $incoming = "$target.update-$([guid]::NewGuid().ToString('N')).tmp"
        Copy-Item -LiteralPath $source -Destination $incoming
        Move-Item -LiteralPath $incoming -Destination $target -Force
    }
    Write-UpdateLog "Play Next $Version installed. User data was not modified."
    Start-PlayNext
} catch {
    Write-UpdateLog "Update failed: $($_.Exception.Message)"
    foreach ($relative in $created) {
        $target = Resolve-SafeTarget $relative
        Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
    }
    foreach ($relative in $replaced) {
        $backup = Join-Path $backupDirectory $relative.Replace('/', [IO.Path]::DirectorySeparatorChar)
        $target = Resolve-SafeTarget $relative
        if (Test-Path -LiteralPath $backup) { Copy-Item -LiteralPath $backup -Destination $target -Force }
    }
    Start-PlayNext
} finally {
    Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
