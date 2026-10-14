param([string]$Source = '', [string]$OutputDirectory = '')
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $Source) { $Source = Join-Path $root 'assets\app-icon-source.png' }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $root 'public' }
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$image = [Drawing.Image]::FromFile([IO.Path]::GetFullPath($Source))
$frames = New-Object System.Collections.Generic.List[object]
try {
    if ($image.Width -ne $image.Height) { throw 'Application icon must be square.' }
    foreach ($size in @(16, 24, 32, 48, 64, 128, 256)) {
        $bitmap = New-Object Drawing.Bitmap $size,$size,([Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
            $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $graphics.Clear([Drawing.Color]::Transparent)
            $graphics.DrawImage($image, 0, 0, $size, $size)
            $memory = New-Object IO.MemoryStream
            try {
                if ($size -eq 256) {
                    $bitmap.Save($memory, [Drawing.Imaging.ImageFormat]::Png)
                    [IO.File]::WriteAllBytes((Join-Path $OutputDirectory 'icon.png'), $memory.ToArray())
                } else {
                    # Small Windows icons use 32-bit DIBs with an alpha channel
                    # and a real transparency mask; the 256px frame uses PNG.
                    $writer = New-Object IO.BinaryWriter $memory
                    $maskStride = [int]([Math]::Ceiling($size / 32.0) * 4)
                    $writer.Write([uint32]40); $writer.Write([int32]$size); $writer.Write([int32]($size * 2))
                    $writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]0)
                    $writer.Write([uint32]($size * $size * 4 + $maskStride * $size))
                    foreach ($unused in 1..4) { $writer.Write([uint32]0) }
                    $rectangle = New-Object Drawing.Rectangle 0,0,$size,$size
                    $data = $bitmap.LockBits($rectangle, [Drawing.Imaging.ImageLockMode]::ReadOnly, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
                    try {
                        $pixels = New-Object byte[] ($size * $size * 4)
                        $row = New-Object byte[] ($size * 4)
                        for ($y = 0; $y -lt $size; $y++) {
                            [Runtime.InteropServices.Marshal]::Copy([IntPtr]::Add($data.Scan0, $y * $data.Stride), $row, 0, $row.Length)
                            [Array]::Copy($row, 0, $pixels, $y * $row.Length, $row.Length)
                        }
                    } finally { $bitmap.UnlockBits($data) }
                    for ($y = $size - 1; $y -ge 0; $y--) { $writer.Write($pixels, $y * $size * 4, $size * 4) }
                    for ($y = $size - 1; $y -ge 0; $y--) {
                        $mask = New-Object byte[] $maskStride
                        for ($x = 0; $x -lt $size; $x++) {
                            if ($pixels[($y * $size + $x) * 4 + 3] -eq 0) {
                                $index = [int][Math]::Floor($x / 8)
                                $mask[$index] = $mask[$index] -bor (128 -shr ($x % 8))
                            }
                        }
                        $writer.Write($mask)
                    }
                    $writer.Flush()
                }
                $frames.Add([PSCustomObject]@{Size=$size;Bytes=$memory.ToArray()})
            } finally { $memory.Dispose() }
        } finally { $graphics.Dispose(); $bitmap.Dispose() }
    }
    $stream = [IO.File]::Create((Join-Path $OutputDirectory 'icon.ico'))
    $writer = New-Object IO.BinaryWriter $stream
    try {
        $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$frames.Count)
        $offset = 6 + 16 * $frames.Count
        foreach ($frame in $frames) {
            $dimension = if ($frame.Size -eq 256) { 0 } else { $frame.Size }
            $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
            $writer.Write([byte]0); $writer.Write([byte]0)
            $writer.Write([uint16]1); $writer.Write([uint16]32)
            $writer.Write([uint32]$frame.Bytes.Length); $writer.Write([uint32]$offset)
            $offset += $frame.Bytes.Length
        }
        foreach ($frame in $frames) { $writer.Write([byte[]]$frame.Bytes) }
    } finally { $writer.Dispose(); $stream.Dispose() }
} finally { $image.Dispose() }
