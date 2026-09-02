param([Parameter(Mandatory = $true)][string]$Uri)
$ErrorActionPreference = 'Stop'
if ($Uri -notmatch '^steam://(run|install)/[1-9][0-9]{0,9}$') { throw 'Invalid Steam URI.' }
Start-Process -FilePath $Uri
