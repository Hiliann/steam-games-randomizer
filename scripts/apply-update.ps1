param(
    [Parameter(Mandatory=$true)][string]$Version,
    [Parameter(Mandatory=$true)][string]$DownloadUrl,
    [Parameter(Mandatory=$true)][string]$ChecksumUrl,
    [Parameter(Mandatory=$true)][int]$ProcessId,
    [Parameter(Mandatory=$true)][int]$Port,
    [Parameter(Mandatory=$true)][string]$AttemptId,
    [int]$DesktopProcessId=0,
    [switch]$Automatic
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'update-common.ps1')
Invoke-PlayNextUpdate @PSBoundParameters -AppDirectory ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')))
