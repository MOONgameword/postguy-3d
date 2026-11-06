Add-Type -AssemblyName System.Drawing
$glyphs = @{}
$family = [System.Drawing.FontFamily]::new('Microsoft YaHei')
foreach ($codepoint in @(0x5C0F,0x718A,0x5FEB,0x9001,0x5F00,0x59CB,0x8D27)) {
  $character = [char]$codepoint
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $path.AddString([string]$character, $family, [int][System.Drawing.FontStyle]::Bold, 200, [System.Drawing.PointF]::new(0,0), [System.Drawing.StringFormat]::GenericTypographic)
  $path.Flatten([System.Drawing.Drawing2D.Matrix]::new(), .35)
  $bounds = $path.GetBounds()
  $contours = [System.Collections.Generic.List[object]]::new()
  $points = $path.PathPoints; $types = $path.PathTypes
  $contour = [System.Collections.Generic.List[object]]::new()
  for ($i=0; $i -lt $points.Count; $i++) {
    if (($types[$i] -band 7) -eq 0 -and $contour.Count) { $contours.Add($contour.ToArray()); $contour.Clear() }
    $contour.Add(@([Math]::Round(($points[$i].X-$bounds.X-$bounds.Width/2)/200,5),[Math]::Round(-($points[$i].Y-$bounds.Y-$bounds.Height/2)/200,5)))
    if ($types[$i] -band 128) { $contours.Add($contour.ToArray()); $contour.Clear() }
  }
  $glyphs[[string]$character] = @{ contours=$contours.ToArray(); width=$bounds.Width/200; height=$bounds.Height/200 }
  $path.Dispose()
}
$family.Dispose()
$out = Join-Path $PSScriptRoot '..\assets\ui\intro-glyphs.json'
$glyphs | ConvertTo-Json -Depth 10 -Compress | Set-Content -LiteralPath $out -Encoding utf8
Write-Output "Saved $out"
