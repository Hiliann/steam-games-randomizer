param(
    [ValidateSet('Status', 'DesktopOn', 'DesktopOff', 'StartupOn', 'StartupOff')]
    [string]$Action = 'Status'
)
$ErrorActionPreference = 'Stop'
$appDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$startScript = Join-Path $appDirectory 'start.ps1'
$root = $env:SystemRoot
if (-not $root) { $root = $env:SYSTEMROOT }
$powershell = Join-Path $root 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shell = New-Object -ComObject WScript.Shell
$desktopLink = Join-Path $shell.SpecialFolders.Item('Desktop') 'Play Next.lnk'
$startupLink = Join-Path $shell.SpecialFolders.Item('Startup') 'Play Next.lnk'

function Get-Arguments([bool]$NoBrowser) {
    $arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $startScript + '"'
    if ($NoBrowser) { $arguments += ' -NoBrowser' }
    return $arguments
}

function Test-ManagedLink([string]$Path, [bool]$NoBrowser) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    try {
        $shortcut = $shell.CreateShortcut($Path)
        return [IO.Path]::GetFullPath($shortcut.TargetPath) -eq [IO.Path]::GetFullPath($powershell) -and $shortcut.Arguments -eq (Get-Arguments $NoBrowser)
    } catch { return $false }
}

function Set-ManagedLink([string]$Path, [bool]$NoBrowser) {
    $shortcut = $shell.CreateShortcut($Path)
    $shortcut.TargetPath = $powershell
    $shortcut.Arguments = Get-Arguments $NoBrowser
    $shortcut.WorkingDirectory = $appDirectory
    $shortcut.WindowStyle = 7
    $shortcut.Description = 'Play Next - Steam Games Randomizer'
    $shortcut.IconLocation = (Join-Path $root 'System32\shell32.dll') + ',137'
    $shortcut.Save()
}

function Remove-ManagedLink([string]$Path, [bool]$NoBrowser) {
    if (Test-ManagedLink $Path $NoBrowser) { Remove-Item -LiteralPath $Path }
}

switch ($Action) {
    'DesktopOn' { Set-ManagedLink $desktopLink $false }
    'DesktopOff' { Remove-ManagedLink $desktopLink $false }
    'StartupOn' { Set-ManagedLink $startupLink $true }
    'StartupOff' { Remove-ManagedLink $startupLink $true }
}

[ordered]@{
    supported = $true
    desktopShortcut = Test-ManagedLink $desktopLink $false
    startup = Test-ManagedLink $startupLink $true
} | ConvertTo-Json -Compress
