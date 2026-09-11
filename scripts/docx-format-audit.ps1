param([Parameter(Mandatory = $true)][string]$InputPath)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead([System.IO.Path]::GetFullPath($InputPath))
try {
  $entry = $archive.GetEntry('word/document.xml')
  $reader = [System.IO.StreamReader]::new($entry.Open())
  try { [xml]$xml = $reader.ReadToEnd() } finally { $reader.Dispose() }
  $ns = [System.Xml.XmlNamespaceManager]::new($xml.NameTable)
  $ns.AddNamespace('w', 'http://schemas.openxmlformats.org/wordprocessingml/2006/main')
  $wNs = $ns.LookupNamespace('w')
  $index = 0
  foreach ($paragraph in $xml.SelectNodes('//w:body/w:p', $ns)) {
    $index++
    if ($index -gt 30) { break }
    $text = (($paragraph.SelectNodes('.//w:t', $ns) | ForEach-Object { $_.InnerText }) -join '')
    if (-not $text) { continue }
    $pStyle = $paragraph.SelectSingleNode('./w:pPr/w:pStyle', $ns)
    $align = $paragraph.SelectSingleNode('./w:pPr/w:jc', $ns)
    $run = $paragraph.SelectSingleNode('./w:r[1]', $ns)
    $font = $run.SelectSingleNode('./w:rPr/w:rFonts', $ns)
    $size = $run.SelectSingleNode('./w:rPr/w:sz', $ns)
    $bold = $run.SelectSingleNode('./w:rPr/w:b', $ns)
    Write-Output ('P{0:D2}|style={1}|align={2}|font={3}|sizeHalfPt={4}|bold={5}|{6}' -f $index,
      $(if ($pStyle) { $pStyle.GetAttribute('val', $wNs) } else { '' }),
      $(if ($align) { $align.GetAttribute('val', $wNs) } else { '' }),
      $(if ($font) { $font.GetAttribute('ascii', $wNs) } else { '' }),
      $(if ($size) { $size.GetAttribute('val', $wNs) } else { '' }),
      [bool]$bold,
      $text)
  }
} finally { $archive.Dispose() }
