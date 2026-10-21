param(
  [string]$Source = 'D:\小邮差\城市资源\人行道',
  [string]$Out = (Join-Path $PSScriptRoot '..\assets\surfaces')
)
# Manhole cover textures (512x512). Both source maps are cropped to the cover's
# circle so it fills the texture exactly: CircleGeometry's UVs are the inscribed
# circle of the unit square, so no alpha channel is needed.
#   井盖2.png     485x487, flat cel-shaded colours, circle bbox x 2..484, y 0..484 (transparent outside)
#   井盖法线.png  512x512, circle bbox x 8..495, y 8..496
Add-Type -AssemblyName System.Drawing
$jobs = @(
  @{ In = '井盖2.png';    Out = 'manhole-v2-base-512.jpg';   Crop = @(2, 0, 483, 485) },
  @{ In = '井盖法线.png'; Out = 'manhole-v1-normal-512.png'; Crop = @(8, 8, 488, 489) }
)
$jpeg = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$jpegParams = New-Object System.Drawing.Imaging.EncoderParameters 1
$jpegParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]92)
foreach ($job in $jobs) {
  $img = [System.Drawing.Image]::FromFile((Join-Path $Source $job.In))
  $canvas = New-Object System.Drawing.Bitmap 512, 512, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($canvas)
  # Outside the circle: dark iron for the base, flat normal for the normal map.
  $g.Clear($(if ($job.Out -like '*normal*') { [System.Drawing.Color]::FromArgb(128, 128, 255) } else { [System.Drawing.Color]::FromArgb(70, 70, 74) }))
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $attr = New-Object System.Drawing.Imaging.ImageAttributes
  $attr.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
  $c = $job.Crop
  $g.DrawImage($img, (New-Object System.Drawing.Rectangle 0, 0, 512, 512), $c[0], $c[1], $c[2], $c[3], [System.Drawing.GraphicsUnit]::Pixel, $attr)
  $g.Dispose(); $img.Dispose()
  $path = Join-Path $Out $job.Out
  if ($job.Out.EndsWith('.jpg')) { $canvas.Save($path, $jpeg, $jpegParams) } else { $canvas.Save($path, [System.Drawing.Imaging.ImageFormat]::Png) }
  $canvas.Dispose()
  '{0} -> {1} ({2} bytes)' -f $job.In, $job.Out, (Get-Item $path).Length
}
