param([switch]$Stop, [switch]$NoBrowser, [int]$Port = 0)
$ErrorActionPreference = 'Stop'
$appDirectory = [IO.Path]::GetFullPath($PSScriptRoot)
$serverPath = Join-Path $appDirectory 'server.mjs'
$packagePath = Join-Path $appDirectory 'package.json'
$pidPath = Join-Path $appDirectory '.server-process.json'
$packagedLauncher = Join-Path $appDirectory 'scripts\PlayNextLauncher.exe'
$launcherPath = Join-Path $appDirectory 'Play Next.exe'
$originalPort = $env:PORT
$preferredPort = if ($Port) { $Port } elseif ($env:PORT) { [int]$env:PORT } else { 3210 }
$sha = [Security.Cryptography.SHA256]::Create()
try { $hashBytes = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($appDirectory.ToLowerInvariant())) }
finally { $sha.Dispose() }
$instanceId = (-join ($hashBytes | ForEach-Object { $_.ToString('x2') })).Substring(0, 24)
$expectedVersion = if (Test-Path -LiteralPath $packagePath) { (Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json).version } else { $null }

function Sync-Launcher {
    if (-not (Test-Path -LiteralPath $packagedLauncher -PathType Leaf)) { return }
    $needsCopy = -not (Test-Path -LiteralPath $launcherPath -PathType Leaf)
    if (-not $needsCopy) {
        $needsCopy = (Get-FileHash -LiteralPath $packagedLauncher -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $launcherPath -Algorithm SHA256).Hash
    }
    if ($needsCopy) { Copy-Item -LiteralPath $packagedLauncher -Destination $launcherPath -Force }

    # Old releases used these launch commands. Remove only small project-owned
    # wrappers that still call this copy's start.ps1; unrelated files are kept.
    $legacyFiles = @(Get-ChildItem -LiteralPath $appDirectory -File | Where-Object { $_.Extension -in @('.cmd', '.bat') })
    foreach ($info in $legacyFiles) {
        $legacy = $info.FullName
        $text = if ($info.Length -le 4096) { Get-Content -LiteralPath $legacy -Raw -ErrorAction SilentlyContinue } else { '' }
        if ($text -match '(?i)start\.ps1' -and $text -match '(?i)powershell') { Remove-Item -LiteralPath $legacy -Force }
    }
}

function Get-AppHealth([int]$CheckPort) {
    try { return Invoke-RestMethod -Uri "http://127.0.0.1:$CheckPort/api/health" -TimeoutSec 1 }
    catch { return $null }
}

function Get-MatchingProcess($Record) {
    if (-not $Record -or -not $Record.processId -or -not $Record.createdAt) { return $null }
    $running = Get-Process -Id ([int]$Record.processId) -ErrorAction SilentlyContinue
    if (-not $running -or $running.ProcessName -ne 'node') { return $null }
    if ($running.StartTime.ToUniversalTime().ToString('o') -ne $Record.createdAt) { return $null }
    if ($Record.executablePath -and [IO.Path]::GetFullPath($running.Path) -ne [IO.Path]::GetFullPath($Record.executablePath)) { return $null }
    return $running
}

function Show-App([int]$ReadyPort) {
    $url = "http://127.0.0.1:$ReadyPort"
    if (-not $NoBrowser) { Start-Process -FilePath $url }
    Write-Host "Play Next is ready: $url"
    Write-Host 'Play Next stops automatically after its last browser tab closes.'
}

try {
    Sync-Launcher
    if ($preferredPort -lt 1024 -or $preferredPort -gt 65535) { throw 'Choose a port between 1024 and 65535.' }
    $record = $null
    if (Test-Path -LiteralPath $pidPath) {
        try { $record = Get-Content -LiteralPath $pidPath -Raw | ConvertFrom-Json }
        catch { Write-Host 'Ignoring an invalid saved process record.' }
    }
    $matchingProcess = Get-MatchingProcess $record
    if ($Stop) {
        if ($matchingProcess) {
            $savedPort = if ($record.port) { [int]$record.port } else { $preferredPort }
            $health = Get-AppHealth $savedPort
            $wrongHealth = $health -and ($health.app -ne 'steam-games-randomizer' -or $health.instanceId -ne $instanceId -or ($health.processId -and [int]$health.processId -ne [int]$record.processId))
            if ($wrongHealth) { throw 'The saved Play Next process could not be verified, so it was not stopped.' }
            Stop-Process -Id ([int]$record.processId)
            Wait-Process -Id ([int]$record.processId) -Timeout 5 -ErrorAction SilentlyContinue
            Write-Host 'Play Next stopped.'
        } else { Write-Host 'This copy is not running. No other processes were stopped.' }
        if (Test-Path -LiteralPath $pidPath) { Remove-Item -LiteralPath $pidPath }
        exit 0
    }

    if (-not (Test-Path -LiteralPath $serverPath)) { throw 'Extract the entire ZIP into a normal folder before starting Play Next.' }
    if ($matchingProcess) {
        $savedPort = if ($record.port) { [int]$record.port } else { $preferredPort }
        $health = Get-AppHealth $savedPort
        if ($health.app -eq 'steam-games-randomizer' -and $health.version -eq $expectedVersion -and $health.instanceId -eq $instanceId -and [int]$health.processId -eq [int]$record.processId) {
            Show-App $savedPort
            exit 0
        }
        Stop-Process -Id ([int]$record.processId)
        Wait-Process -Id ([int]$record.processId) -Timeout 5 -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath $pidPath) { Remove-Item -LiteralPath $pidPath }
    }

    $bundledNode = Join-Path $appDirectory 'runtime\node.exe'
    $nodeExecutable = $null
    if (Test-Path -LiteralPath $bundledNode) {
        if (-not [Environment]::Is64BitOperatingSystem) { throw 'Play Next requires 64-bit Windows.' }
        $nodeExecutable = $bundledNode
    } else {
        # Source checkouts may use an installed Node; releases always use runtime/node.exe.
        $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
        if ($nodeCommand) { $nodeExecutable = $nodeCommand.Source }
    }
    if (-not $nodeExecutable) { throw 'runtime\node.exe is missing. Extract the complete application ZIP, or install Node.js 22+ for the source version.' }
    $versionText = & $nodeExecutable --version
    if ($LASTEXITCODE -ne 0 -or $versionText -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22) { throw 'Could not run Node.js 22+. Use the complete Windows x64 application package.' }

    # Bind attempts, not a network scan: an occupied local port is left untouched.
    for ($offset = 0; $offset -lt 10 -and ($preferredPort + $offset) -le 65535; $offset++) {
        $candidatePort = $preferredPort + $offset
        $env:PORT = [string]$candidatePort
        $errorLog = Join-Path $appDirectory '.server-error.log'
        $outputLog = Join-Path $appDirectory '.server-output.log'
        $process = Start-Process -FilePath $nodeExecutable -ArgumentList ('"' + $serverPath + '"') -WorkingDirectory $appDirectory -WindowStyle Hidden -RedirectStandardError $errorLog -RedirectStandardOutput $outputLog -PassThru
        $ready = $false
        for ($attempt = 0; $attempt -lt 25; $attempt++) {
            Start-Sleep -Milliseconds 120
            $process.Refresh()
            if ($process.HasExited) { break }
            $health = Get-AppHealth $candidatePort
            if ($health.app -eq 'steam-games-randomizer' -and $health.instanceId -eq $instanceId) { $ready = $true; break }
        }
        if ($ready) {
            try {
                $process.Refresh()
                @{ processId = $process.Id; createdAt = $process.StartTime.ToUniversalTime().ToString('o'); executablePath = $process.Path; port = $candidatePort; instanceId = $instanceId } | ConvertTo-Json | Set-Content -LiteralPath $pidPath -Encoding UTF8
            } catch {
                if (-not $process.HasExited) { $process.Kill() }
                throw 'The app folder is not writable. Move the extracted folder to Desktop or Documents and try again.'
            }
            Show-App $candidatePort
            exit 0
        }
        if (-not $process.HasExited) { $process.Kill(); throw 'The server did not respond. See .server-error.log in the app folder.' }
        $errorText = Get-Content -LiteralPath $errorLog -Raw -ErrorAction SilentlyContinue
        $portUnavailable = $errorText -match 'already in use|EADDRINUSE|listen EACCES: permission denied 127\.0\.0\.1:'
        if (-not $portUnavailable) { throw "Could not start Play Next. $errorText" }
        $existing = Get-AppHealth $candidatePort
        if ($existing.app -eq 'steam-games-randomizer' -and $existing.version -eq $expectedVersion -and $existing.instanceId -eq $instanceId -and $existing.processId) { Show-App $candidatePort; exit 0 }
    }
    throw 'No free local port was available. Close the other copy, or run start.ps1 -Port 3310.'
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
} finally { $env:PORT = $originalPort }
