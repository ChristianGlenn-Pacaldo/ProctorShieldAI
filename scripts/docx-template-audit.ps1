param([Parameter(Mandatory = $true)][string]$InputPath)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$fullPath = [System.IO.Path]::GetFullPath($InputPath)
$archive = [System.IO.Compression.ZipFile]::OpenRead($fullPath)
try {
  $entry = $archive.GetEntry('word/document.xml')
  $reader = [System.IO.StreamReader]::new($entry.Open())
  try { [xml]$xml = $reader.ReadToEnd() } finally { $reader.Dispose() }
  $ns = [System.Xml.XmlNamespaceManager]::new($xml.NameTable)
  $ns.AddNamespace('w', 'http://schemas.openxmlformats.org/wordprocessingml/2006/main')
  $sect = $xml.SelectSingleNode('//w:body/w:sectPr[last()]', $ns)
  $size = $sect.SelectSingleNode('./w:pgSz', $ns)
  $margins = $sect.SelectSingleNode('./w:pgMar', $ns)
  $wNs = $ns.LookupNamespace('w')
  Write-Output ('file=' + [System.IO.Path]::GetFileName($fullPath))
  Write-Output ('sha256=' + (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash)
  Write-Output ('packageParts=' + $archive.Entries.Count)
  Write-Output ('pageWidthTwips=' + $size.GetAttribute('w', $wNs))
  Write-Output ('pageHeightTwips=' + $size.GetAttribute('h', $wNs))
  Write-Output ('orientation=' + $size.GetAttribute('orient', $wNs))
  Write-Output ('marginTopTwips=' + $margins.GetAttribute('top', $wNs))
  Write-Output ('marginRightTwips=' + $margins.GetAttribute('right', $wNs))
  Write-Output ('marginBottomTwips=' + $margins.GetAttribute('bottom', $wNs))
  Write-Output ('marginLeftTwips=' + $margins.GetAttribute('left', $wNs))
  $styles = $xml.SelectNodes('//w:pPr/w:pStyle', $ns) | ForEach-Object { $_.GetAttribute('val', $wNs) } | Sort-Object -Unique
  Write-Output ('paragraphStyles=' + ($styles -join ','))
} finally {
  $archive.Dispose()
}
