param(
    [ValidateSet('Status', 'DesktopOn', 'DesktopOff', 'StartupOn', 'StartupOff')]
    [string]$Action = 'Status'
)
$ErrorActionPreference = 'Stop'
$appDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$startScript = Join-Path $appDirectory 'start.ps1'
$launcher = Join-Path $appDirectory 'Play Next.exe'
$root = $env:SystemRoot
if (-not $root) { $root = $env:SYSTEMROOT }
$powershell = Join-Path $root 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shell = New-Object -ComObject WScript.Shell
$desktopLink = Join-Path $shell.SpecialFolders.Item('Desktop') 'Play Next.lnk'
$startupLink = Join-Path $shell.SpecialFolders.Item('Startup') 'Play Next.lnk'

function Get-LegacyArguments([bool]$NoBrowser) {
    $arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $startScript + '"'
    if ($NoBrowser) { $arguments += ' -NoBrowser' }
    return $arguments
}

function Test-LegacyLink([string]$Path, [bool]$NoBrowser) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    try {
        $shortcut = $shell.CreateShortcut($Path)
        return [IO.Path]::GetFullPath($shortcut.TargetPath) -eq [IO.Path]::GetFullPath($powershell) -and $shortcut.Arguments -eq (Get-LegacyArguments $NoBrowser)
    } catch { return $false }
}

function Get-LauncherArguments([bool]$NoBrowser) {
    if ($NoBrowser) { return '--no-browser' }
    return ''
}

function Test-ManagedLink([string]$Path, [bool]$NoBrowser) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    try {
        $shortcut = $shell.CreateShortcut($Path)
        return [IO.Path]::GetFullPath($shortcut.TargetPath) -eq [IO.Path]::GetFullPath($launcher) -and $shortcut.Arguments -eq (Get-LauncherArguments $NoBrowser)
    } catch { return $false }
}

function Set-ManagedLink([string]$Path, [bool]$NoBrowser) {
    $shortcut = $shell.CreateShortcut($Path)
    if (Test-Path -LiteralPath $launcher -PathType Leaf) {
        $shortcut.TargetPath = $launcher
        $shortcut.Arguments = Get-LauncherArguments $NoBrowser
        $shortcut.IconLocation = $launcher + ',0'
    } else {
        # Development checkout fallback; packaged copies always contain the launcher.
        $shortcut.TargetPath = $powershell
        $shortcut.Arguments = Get-LegacyArguments $NoBrowser
        $shortcut.IconLocation = (Join-Path $root 'System32\shell32.dll') + ',137'
    }
    $shortcut.WorkingDirectory = $appDirectory
    $shortcut.WindowStyle = 7
    $shortcut.Description = 'Play Next - Steam Games Randomizer'
    $shortcut.Save()
}

function Remove-ManagedLink([string]$Path, [bool]$NoBrowser) {
    if ((Test-ManagedLink $Path $NoBrowser) -or (Test-LegacyLink $Path $NoBrowser)) { Remove-Item -LiteralPath $Path }
}

if (Test-Path -LiteralPath $launcher -PathType Leaf) {
    if (Test-LegacyLink $desktopLink $false) { Set-ManagedLink $desktopLink $false }
    if (Test-LegacyLink $startupLink $true) { Set-ManagedLink $startupLink $true }
}

switch ($Action) {
    'DesktopOn' { Set-ManagedLink $desktopLink $false }
    'DesktopOff' { Remove-ManagedLink $desktopLink $false }
    'StartupOn' { Set-ManagedLink $startupLink $true }
    'StartupOff' { Remove-ManagedLink $startupLink $true }
}

[ordered]@{
    supported = $true
    desktopShortcut = (Test-ManagedLink $desktopLink $false) -or (Test-LegacyLink $desktopLink $false)
    startup = (Test-ManagedLink $startupLink $true) -or (Test-LegacyLink $startupLink $true)
} | ConvertTo-Json -Compress
