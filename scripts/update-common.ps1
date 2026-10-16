# Shared, testable updater. Production always uses the fixed GitHub URLs.
function Resolve-UpdateTarget([string]$Root,[string]$Relative) {
    if (-not $Relative -or [IO.Path]::IsPathRooted($Relative)) { throw 'Unsafe manifest path.' }
    $parts=$Relative.Replace('\','/').Split('/')
    if ($parts.Count -eq 0 -or @($parts | Where-Object { -not $_ -or $_ -in @('.','..') -or $_.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0 -or $_.EndsWith('.') -or $_.EndsWith(' ') -or $_ -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)' }).Count) { throw 'Unsafe manifest path.' }
    $top=$parts[0]
    if (@('data','.git','dist','downloads') -contains $top -or $Relative -match '(^|/)(\.server|.*\.log)') { throw 'Protected path in manifest.' }
    $rootFiles=@('package.json','server.mjs','start.ps1','Start.cmd','Stop.cmd','Play Next.exe','LICENSE','THIRD_PARTY_NOTICES.md','release.json','release-manifest.json')
    if (@('lib','public','runtime','scripts') -notcontains $top -and $rootFiles -notcontains $Relative) { throw 'Unexpected manifest path.' }
    $full=[IO.Path]::GetFullPath((Join-Path $Root $Relative.Replace('/',[IO.Path]::DirectorySeparatorChar)))
    if (-not $full.StartsWith($Root+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Path leaves app directory.' }
    $part=$full
    while ($part -and $part.Length -ge $Root.Length) {
        if ((Test-Path -LiteralPath $part) -and ((Get-Item -LiteralPath $part).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Linked application paths cannot be updated.' }
        $part=[IO.Path]::GetDirectoryName($part)
    }
    return $full
}
function Read-UpdateRequest([string]$Root,[string]$Attempt) {
    $file=Join-Path $Root 'data\update-request.json'
    if (-not (Test-Path -LiteralPath $file)) { return $null }
    if ((Get-Item -LiteralPath $file).Length -gt 16384) { throw 'Invalid update request.' }
    $request=Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($request.attemptId -eq $Attempt) { return $request }
    return $null
}
function Assert-UpdateContinuing([string]$Root,[string]$Attempt) {
    if ((Read-UpdateRequest $Root $Attempt).action -eq 'cancel') { throw [OperationCanceledException]::new('Update cancelled.') }
}
function Write-UpdateState([string]$Root,[hashtable]$State) {
    $directory=Join-Path $Root 'data'
    if ((Test-Path -LiteralPath $directory) -and ((Get-Item -LiteralPath $directory).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Linked data directory.' }
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $file=Join-Path $directory 'update-status.json'
    if (Test-Path -LiteralPath $file) {
        $previous=Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($previous.attemptId -ne $State.attemptId) { throw 'Update attempt superseded.' }
    }
    $State.updatedAt=[DateTime]::UtcNow.ToString('o')
    $incoming=$file+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
    [IO.File]::WriteAllText($incoming,($State | ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
    try {
        for ($retry=0; ; $retry++) {
            try {
                if ([IO.File]::Exists($file)) { [IO.File]::Replace($incoming,$file,[NullString]::Value) }
                else { [IO.File]::Move($incoming,$file) }
                break
            } catch [IO.IOException] {
                if ($retry -ge 9) { throw }
                Start-Sleep -Milliseconds 50
            }
        }
    } finally { if ([IO.File]::Exists($incoming)) { [IO.File]::Delete($incoming) } }
}
function Get-UpdateDownload([string]$Uri,[string]$Destination,[long]$Limit,[string]$Root,[hashtable]$State) {
    Add-Type -AssemblyName System.Net.Http
    [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
    $client=[Net.Http.HttpClient]::new()
    $cancellation=[Threading.CancellationTokenSource]::new()
    $cancellation.CancelAfter(300000)
    $response=$null; $stream=$null; $output=$null
    try {
        $client.DefaultRequestHeaders.UserAgent.ParseAdd('Play-Next-Updater')
        $response=$client.GetAsync($Uri,[Net.Http.HttpCompletionOption]::ResponseHeadersRead,$cancellation.Token).GetAwaiter().GetResult()
        $null=$response.EnsureSuccessStatusCode()
        if ($response.Content.Headers.ContentLength -gt $Limit) { throw 'Release download is too large.' }
        $stream=$response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $output=[IO.File]::Open($Destination,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        $buffer=New-Object byte[] 65536
        $received=[long]0; $lastWrite=[DateTime]::UtcNow
        while ($true) {
            Assert-UpdateContinuing $Root $State.attemptId
            $reading=$stream.ReadAsync($buffer,0,$buffer.Length,$cancellation.Token)
            while (-not $reading.Wait(250)) { Assert-UpdateContinuing $Root $State.attemptId }
            $count=$reading.GetAwaiter().GetResult()
            if ($count -eq 0) { break }
            $received+=$count
            if ($received -gt $Limit) { throw 'Release download is too large.' }
            $output.Write($buffer,0,$count)
            if ($Limit -gt 1MB -and ([DateTime]::UtcNow-$lastWrite).TotalMilliseconds -ge 500) {
                $State.receivedBytes=$received; $State.totalBytes=[long]$response.Content.Headers.ContentLength
                Write-UpdateState $Root $State; $lastWrite=[DateTime]::UtcNow
            }
        }
        if ($response.Content.Headers.ContentLength -and $received -ne $response.Content.Headers.ContentLength) { throw 'Incomplete release download.' }
    } finally {
        $cancellation.Cancel()
        if ($output) { $output.Dispose() }; if ($stream) { $stream.Dispose() }; if ($response) { $response.Dispose() }
        $client.Dispose(); $cancellation.Dispose()
    }
}
function Test-UpdatePackage([string]$Root,[string]$ArchivePath,[string]$ChecksumPath,[string]$Version,[string]$Temporary) {
    $checksum=(Get-Content -LiteralPath $ChecksumPath -Raw -Encoding ASCII).Trim()
    $name='PlayNext-'+$Version+'-win-x64.zip'
    if ($checksum -notmatch ('^([a-fA-F0-9]{64})\s+'+[regex]::Escape($name)+'$')) { throw 'Invalid checksum file.' }
    if ((Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Matches[1].ToLowerInvariant()) { throw 'Release checksum mismatch.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive=[IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
        $prefix='PlayNext-'+$Version+'-win-x64/'
        $seen=@{}; $total=[long]0
        if ($archive.Entries.Count -gt 1000) { throw 'Too many archive entries.' }
        foreach ($entry in $archive.Entries) {
            $entryName=$entry.FullName.Replace('\','/')
            if (-not $entryName.StartsWith($prefix,[StringComparison]::Ordinal) -or $entryName -match '(^|/)\.\.(/|$)') { throw 'Unsafe archive entry.' }
            $relative=$entryName.Substring($prefix.Length)
            $total+=$entry.Length; if ($total -gt 350MB) { throw 'Extracted release too large.' }
            if (-not $relative -or $relative.EndsWith('/')) {
                if ($entry.Length -ne 0) { throw 'Invalid archive directory.' }
                if ($relative) { $null=Resolve-UpdateTarget $Root $relative.TrimEnd('/') }
                continue
            }
            $null=Resolve-UpdateTarget $Root $relative
            if ($seen.ContainsKey($relative)) { throw 'Duplicate archive entry.' }; $seen[$relative]=$true
        }
        [IO.Compression.ZipFileExtensions]::ExtractToDirectory($archive,$Temporary)
    } finally { $archive.Dispose() }
    $package=Join-Path $Temporary ('PlayNext-'+$Version+'-win-x64')
    $release=Get-Content -LiteralPath (Join-Path $package 'release.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $manifest=Get-Content -LiteralPath (Join-Path $package 'release-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($release.app -ne 'Play Next' -or $release.version -ne $Version -or $manifest.version -ne 1 -or $manifest.appVersion -ne $Version -or -not $manifest.files) { throw 'Release metadata mismatch.' }
    $files=@($manifest.files)+@($manifest.bootstrapFiles)
    if ($files.Count -gt 510) { throw 'Too many manifest entries.' }
    $listed=@{}
    foreach ($item in $files) {
        if ($item.path -isnot [string] -or $item.sha256 -notmatch '^[a-fA-F0-9]{64}$' -or ($item.bytes -isnot [long] -and $item.bytes -isnot [int]) -or $item.bytes -lt 0) { throw 'Invalid manifest entry.' }
        $relative=$item.path.Replace('\','/')
        $null=Resolve-UpdateTarget $Root $relative
        if ($listed.ContainsKey($relative)) { throw 'Duplicate manifest entry.' }; $listed[$relative]=$true
        $source=Resolve-UpdateTarget $package $relative
        if (-not (Test-Path -LiteralPath $source -PathType Leaf) -or (Get-Item -LiteralPath $source).Length -ne $item.bytes -or (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $item.sha256.ToLowerInvariant()) { throw 'Manifest verification failed.' }
    }
    foreach ($critical in @('package.json','server.mjs','start.ps1','runtime/node.exe','Play Next.exe','scripts/PlayNextLauncher.exe','scripts/apply-update.ps1')) { if (-not $listed.ContainsKey($critical)) { throw 'Incomplete application release.' } }
    if ($seen.Count -ne $listed.Count+1 -or -not $seen.ContainsKey('release-manifest.json')) { throw 'Archive has unlisted files.' }
    foreach ($relative in $listed.Keys) { if (-not $seen.ContainsKey($relative)) { throw 'Archive is missing a listed file.' } }
    return @{Directory=$package;Files=$files}
}
function Start-UpdatedPlayNext([string]$Root,[int]$DesktopProcessId,[int]$Port,[bool]$Minimized) {
    if ($DesktopProcessId -gt 0) {
        $launcher=Join-Path $Root 'Play Next.exe'
        if ($Minimized) { Start-Process -FilePath $launcher -ArgumentList '--minimized' -WorkingDirectory $Root -WindowStyle Hidden | Out-Null }
        else { Start-Process -FilePath $launcher -WorkingDirectory $Root -WindowStyle Normal | Out-Null }
    } else {
        $starter=Join-Path $Root 'start.ps1'
        Start-Process -FilePath 'powershell.exe' -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "'+$starter+'" -NoBrowser -Port '+$Port) -WorkingDirectory $Root -WindowStyle Hidden | Out-Null
    }
}
function Invoke-PlayNextUpdate {
    param([string]$Version,[string]$DownloadUrl,[string]$ChecksumUrl,[int]$ProcessId,[int]$Port,[string]$AttemptId,[int]$DesktopProcessId=0,[switch]$Automatic,[string]$AppDirectory,
        [scriptblock]$Download={param($Uri,$Destination,$Limit,$Root,$State) Get-UpdateDownload $Uri $Destination $Limit $Root $State})
    $ErrorActionPreference='Stop'
    $appRoot=[IO.Path]::GetFullPath($AppDirectory)
    if ($Version -notmatch '^\d+\.\d+\.\d+$' -or $AttemptId -notmatch '^[a-f0-9]{32}$' -or $Port -lt 1 -or $Port -gt 65535 -or $ProcessId -lt 1 -or $DesktopProcessId -lt 0) { throw 'Invalid installer arguments.' }
    $asset='https://github.com/Hiliann/steam-games-randomizer/releases/download/v'+$Version+'/PlayNext-'+$Version+'-win-x64.zip'
    if ($DownloadUrl -cne $asset -or $ChecksumUrl -cne ($asset+'.sha256')) { throw 'Unexpected release URL.' }
    $temporaryRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    $temporary=[IO.Path]::GetFullPath((Join-Path $temporaryRoot ('PlayNextUpdate-'+[guid]::NewGuid().ToString('N'))))
    if (-not $temporary.StartsWith($temporaryRoot,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($temporary) -notmatch '^PlayNextUpdate-[a-f0-9]{32}$') { throw 'Unsafe temporary directory.' }
    $backup=Join-Path $temporary 'backup'
    $replaced=New-Object System.Collections.Generic.List[string]; $created=New-Object System.Collections.Generic.List[string]
    $state=@{version=1;attemptId=$AttemptId;targetVersion=$Version;stage='starting';automatic=[bool]$Automatic;startedAt=[DateTime]::UtcNow.ToString('o');updatedAt=[DateTime]::UtcNow.ToString('o');updaterProcessId=$PID;reason=$null;receivedBytes=0;totalBytes=0}
    $appStopped=$false; $keepBackup=$false; $minimized=$false
    try {
        Write-UpdateState $appRoot $state
        New-Item -ItemType Directory -Path $temporary,$backup | Out-Null
        $state.stage='downloading';Write-UpdateState $appRoot $state
        $archive=Join-Path $temporary 'release.zip';$checksum=Join-Path $temporary 'release.zip.sha256'
        & $Download $DownloadUrl $archive 150MB $appRoot $state
        $state.receivedBytes=(Get-Item -LiteralPath $archive).Length;$state.totalBytes=$state.receivedBytes
        & $Download $ChecksumUrl $checksum 2048 $appRoot $state
        Assert-UpdateContinuing $appRoot $AttemptId
        $state.stage='verifying';Write-UpdateState $appRoot $state
        $verified=Test-UpdatePackage $appRoot $archive $checksum $Version $temporary
        Assert-UpdateContinuing $appRoot $AttemptId
        $state.stage='ready';Write-UpdateState $appRoot $state
        $deadline=[DateTime]::UtcNow.AddMinutes(10)
        do {
            Assert-UpdateContinuing $appRoot $AttemptId
            $request=Read-UpdateRequest $appRoot $AttemptId
            if ($request.action -eq 'apply') { break }
            if ([DateTime]::UtcNow -gt $deadline) { throw 'Timed out waiting to apply.' }
            Start-Sleep -Milliseconds 250
        } while ($true)
        $minimized=$request.restartMinimized -eq $true
        $state.stage='applying';Write-UpdateState $appRoot $state
        $process=Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
        if ($process) {
            if ($process.ProcessName -ne 'node' -or $process.Path -ne (Join-Path $appRoot 'runtime\node.exe')) { throw 'Could not verify local service.' }
            if (-not $process.WaitForExit(60000)) { throw 'Play Next did not stop in time.' }
        }
        if ($DesktopProcessId -gt 0) {
            $desktopProcess=Get-Process -Id $DesktopProcessId -ErrorAction SilentlyContinue
            if ($desktopProcess) {
                if ($desktopProcess.ProcessName -notin @('Play Next','PlayNextLauncher') -or [IO.Path]::GetDirectoryName($desktopProcess.Path) -notin @($appRoot,(Join-Path $appRoot 'scripts'))) { throw 'Could not verify desktop host.' }
                if (-not $desktopProcess.WaitForExit(60000)) { throw 'Close the Play Next window before updating.' }
            }
        }
        $appStopped=$true
        foreach ($item in $verified.Files) {
            $relative=$item.path.Replace('\','/');$target=Resolve-UpdateTarget $appRoot $relative
            New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force | Out-Null
            if (Test-Path -LiteralPath $target) {
                $previous=Join-Path $backup $relative
                New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($previous)) -Force | Out-Null
                Copy-Item -LiteralPath $target -Destination $previous;$replaced.Add($relative)
            } else { $created.Add($relative) }
            $incoming=$target+'.update-'+[guid]::NewGuid().ToString('N')+'.tmp'
            try {
                Copy-Item -LiteralPath (Join-Path $verified.Directory $relative) -Destination $incoming
                Move-Item -LiteralPath $incoming -Destination $target -Force
            } finally { if ([IO.File]::Exists($incoming)) { [IO.File]::Delete($incoming) } }
        }
        # Keep the manifest in the rollback as well, not just executable files.
        $manifestTarget=Resolve-UpdateTarget $appRoot 'release-manifest.json'
        if (Test-Path -LiteralPath $manifestTarget) { Copy-Item -LiteralPath $manifestTarget -Destination (Join-Path $backup 'release-manifest.json');$replaced.Add('release-manifest.json') }
        else { $created.Add('release-manifest.json') }
        Copy-Item -LiteralPath (Join-Path $verified.Directory 'release-manifest.json') -Destination $manifestTarget -Force
        $state.stage='complete';Write-UpdateState $appRoot $state
        Start-UpdatedPlayNext $appRoot $DesktopProcessId $Port $minimized
    } catch {
        $failure=$_
        $cancelled=$false
        try { $cancelled=(Read-UpdateRequest $appRoot $AttemptId).action -eq 'cancel' } catch {}
        $state.stage=if ($cancelled -and -not $appStopped) {'cancelled'} else {'failed'}
        $state.reason=if ($state.stage -eq 'cancelled') {'cancelled'} elseif (-not $appStopped) {'prepare-failed'} else {'apply-failed'}
        if ($appStopped) {
            try {
                foreach ($relative in $created) { Remove-Item -LiteralPath (Resolve-UpdateTarget $appRoot $relative) -Force -ErrorAction SilentlyContinue }
                foreach ($relative in $replaced) { Copy-Item -LiteralPath (Join-Path $backup $relative) -Destination (Resolve-UpdateTarget $appRoot $relative) -Force }
            } catch { $keepBackup=$true;$state.reason='rollback-failed' }
        }
        try { Add-Content -LiteralPath (Join-Path $appRoot '.update.log') -Value ([DateTime]::UtcNow.ToString('o')+' '+$failure.Exception.Message+' Backup: '+$backup) -Encoding UTF8 } catch {}
        try { Write-UpdateState $appRoot $state } catch {}
        # Failed downloads leave the current app alive. Restart only if replacement
        # actually required it to stop, and never retry the same failure in a loop.
        if ($appStopped -and -not $keepBackup) { Start-UpdatedPlayNext $appRoot $DesktopProcessId $Port $minimized }
    } finally {
        if (-not $keepBackup -and (Test-Path -LiteralPath $temporary)) { Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue }
    }
}
