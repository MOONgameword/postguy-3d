param(
  [string]$Source = 'D:\小邮差\城市资源\人行道',
  [string]$Out = (Join-Path $PSScriptRoot '..\assets\surfaces')
)
# Converts the sidewalk source set into game textures (512x512).
#  - slab: copied as-is (base JPEG, normal PNG).
#  - tactile: the source tile is 4 guidance bars over a row of dots. Only the bar
#    part (rows 0..TactileCrop) is kept, then turned 90deg clockwise so the bars run
#    along the street (game UV: u along the road, v across the strip). The normal
#    map is rotated with the same turn: R' = G, G' = 1 - R (OpenGL, +Y up).
Add-Type -AssemblyName System.Drawing
$TactileCrop = 414
$jpeg = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$jpegParams = New-Object System.Drawing.Imaging.EncoderParameters 1
$jpegParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]92)

function Render([System.Drawing.Image]$img, [System.Drawing.Rectangle]$src, [System.Drawing.Imaging.ColorMatrix]$matrix, [bool]$rotate) {
  $bmp = New-Object System.Drawing.Bitmap $src.Width, $src.Height, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $attr = New-Object System.Drawing.Imaging.ImageAttributes
  if ($matrix) { $attr.SetColorMatrix($matrix) }
  $attr.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
  $g.DrawImage($img, (New-Object System.Drawing.Rectangle 0, 0, $src.Width, $src.Height), $src.X, $src.Y, $src.Width, $src.Height, [System.Drawing.GraphicsUnit]::Pixel, $attr)
  $g.Dispose()
  if ($rotate) { $bmp.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipNone) }
  $out = New-Object System.Drawing.Bitmap 512, 512, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($out)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $attr = New-Object System.Drawing.Imaging.ImageAttributes
  $attr.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
  $g.DrawImage($bmp, (New-Object System.Drawing.Rectangle 0, 0, 512, 512), 0, 0, $bmp.Width, $bmp.Height, [System.Drawing.GraphicsUnit]::Pixel, $attr)
  $g.Dispose(); $bmp.Dispose()
  return $out
}

$rotateNormal = New-Object System.Drawing.Imaging.ColorMatrix
# GDI+ row-vector convention: [r g b a 1] x M
$rotateNormal.Matrix00 = 0; $rotateNormal.Matrix01 = -1; $rotateNormal.Matrix02 = 0
$rotateNormal.Matrix10 = 1; $rotateNormal.Matrix11 = 0;  $rotateNormal.Matrix12 = 0
$rotateNormal.Matrix22 = 1; $rotateNormal.Matrix33 = 1
$rotateNormal.Matrix40 = 0; $rotateNormal.Matrix41 = 1;  $rotateNormal.Matrix42 = 0

$jobs = @(
  @{ In = '石板路.png';     Out = 'slab-v3-base-512.jpg';      Crop = $false; Normal = $false },
  @{ In = '石板路法线.png'; Out = 'slab-v3-normal-512.png';    Crop = $false; Normal = $true },
  @{ In = '盲道.png';       Out = 'tactile-v3-base-512.jpg';   Crop = $true;  Normal = $false },
  @{ In = '盲道法线.png';   Out = 'tactile-v3-normal-512.png'; Crop = $true;  Normal = $true }
)
foreach ($job in $jobs) {
  $img = [System.Drawing.Image]::FromFile((Join-Path $Source $job.In))
  $h = if ($job.Crop) { [int][Math]::Round($TactileCrop * $img.Height / 512) } else { $img.Height }
  $rect = New-Object System.Drawing.Rectangle 0, 0, $img.Width, $h
  $matrix = if ($job.Crop -and $job.Normal) { $rotateNormal } else { $null }
  $result = Render $img $rect $matrix $job.Crop
  $img.Dispose()
  $path = Join-Path $Out $job.Out
  if ($job.Out.EndsWith('.jpg')) { $result.Save($path, $jpeg, $jpegParams) } else { $result.Save($path, [System.Drawing.Imaging.ImageFormat]::Png) }
  $result.Dispose()
  '{0} -> {1} ({2} bytes)' -f $job.In, $job.Out, (Get-Item $path).Length
}
