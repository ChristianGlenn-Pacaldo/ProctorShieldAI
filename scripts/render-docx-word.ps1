param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$inputFullPath = [System.IO.Path]::GetFullPath($InputPath)
$outputFullPath = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($outputFullPath) | Out-Null

$word = $null
$document = $null
$xps = Join-Path $outputFullPath 'render.xps'

try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $document = $word.Documents.Open($inputFullPath, $false, $true)
  # ExportAsFixedFormat performs pagination itself. Calling Repaginate first can
  # stall for HTML-derived documents on some Word installations.
  $document.ExportAsFixedFormat($xps, 1)
  $pageCount = $document.ComputeStatistics(2)
} finally {
  if ($document) { $document.Close($false) }
  if ($word) { $word.Quit() }
  if ($document) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($document) }
  if ($word) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word) }
}

Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName ReachFramework

$xpsDocument = [System.Windows.Xps.Packaging.XpsDocument]::new($xps, [System.IO.FileAccess]::Read)
try {
  $sequence = $xpsDocument.GetFixedDocumentSequence()
  $paginator = $sequence.DocumentPaginator
  for ($index = 0; $index -lt $paginator.PageCount; $index++) {
    $page = $paginator.GetPage($index)
    $width = [Math]::Max(1, [int][Math]::Ceiling($page.Size.Width))
    $height = [Math]::Max(1, [int][Math]::Ceiling($page.Size.Height))
    $bitmap = New-Object System.Windows.Media.Imaging.RenderTargetBitmap($width, $height, 96, 96, ([System.Windows.Media.PixelFormats]::Pbgra32))
    $bitmap.Render($page.Visual)
    $encoder = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
    $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
    $pagePath = Join-Path $outputFullPath ('page-{0}.png' -f ($index + 1))
    $stream = [System.IO.File]::Open($pagePath, [System.IO.FileMode]::Create)
    try { $encoder.Save($stream) } finally { $stream.Dispose() }
  }
  Write-Output ('pages=' + $paginator.PageCount)
  if ($pageCount -ne $paginator.PageCount) {
    Write-Warning ('Word reported ' + $pageCount + ' pages but XPS rendered ' + $paginator.PageCount)
  }
} finally {
  $xpsDocument.Close()
}
