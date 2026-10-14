param([Parameter(Mandatory = $true)][string]$PackageDirectory, [string]$WebViewPackage = '')
$ErrorActionPreference = 'Stop'
$sourceDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$PackageDirectory = [IO.Path]::GetFullPath($PackageDirectory)
$sdkVersion = '1.0.4258.31'
$sdkHash = '56f7f4b8bf9aee4b8efefbbdd4f67d5f74ebd1b100ed0806da71bf76af481aa9'
if (-not $WebViewPackage) { $WebViewPackage = Join-Path $sourceDirectory "downloads\microsoft.web.webview2.$sdkVersion.nupkg" }
if ((Get-FileHash -LiteralPath $WebViewPackage -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sdkHash) { throw 'WebView2 SDK checksum mismatch. Use the pinned official NuGet package.' }
$desktopDirectory = Join-Path $PackageDirectory 'runtime\desktop'
New-Item -ItemType Directory -Path $desktopDirectory -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead([IO.Path]::GetFullPath($WebViewPackage))
try {
    $files = @{
        'lib/net462/Microsoft.Web.WebView2.Core.dll' = 'Microsoft.Web.WebView2.Core.dll'
        'lib/net462/Microsoft.Web.WebView2.WinForms.dll' = 'Microsoft.Web.WebView2.WinForms.dll'
        'runtimes/win-x64/native/WebView2Loader.dll' = 'WebView2Loader.dll'
        'LICENSE.txt' = 'LICENSE.txt'
        'NOTICE.txt' = 'NOTICE.txt'
    }
    foreach ($entryName in $files.Keys) {
        $entry = $archive.GetEntry($entryName)
        if (-not $entry) { throw "WebView2 package is missing $entryName" }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $desktopDirectory $files[$entryName]), $true)
    }
} finally { $archive.Dispose() }
$iconPath = Join-Path $PackageDirectory 'scripts\PlayNext.ico'
New-Item -ItemType Directory -Path (Split-Path -Parent $iconPath) -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $sourceDirectory 'public\icon.ico') -Destination $iconPath
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'The Windows .NET Framework compiler was not found.' }
$launcher = Join-Path $PackageDirectory 'Play Next.exe'
& $compiler /nologo /target:winexe /platform:x64 /optimize+ "/out:$launcher" "/win32icon:$iconPath" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Net.Http.dll /reference:System.Web.Extensions.dll "/reference:$desktopDirectory\Microsoft.Web.WebView2.Core.dll" "/reference:$desktopDirectory\Microsoft.Web.WebView2.WinForms.dll" (Join-Path $sourceDirectory 'launcher\PlayNextLauncher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Could not build the Play Next desktop application.' }
Copy-Item -LiteralPath $launcher -Destination (Join-Path $PackageDirectory 'scripts\PlayNextLauncher.exe') -Force
