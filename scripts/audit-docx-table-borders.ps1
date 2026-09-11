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
  $tables = $xml.SelectNodes('//w:tbl', $ns)
  $diagonals = $xml.SelectNodes('//w:tblBorders/w:tl2br | //w:tblBorders/w:tr2bl | //w:tcBorders/w:tl2br | //w:tcBorders/w:tr2bl', $ns)
  $enabled = @($diagonals | Where-Object { $_.GetAttribute('val', $wNs) -notin @('', 'nil', 'none') })
  Write-Output (([System.IO.Path]::GetFileName($InputPath)) + '|tables=' + $tables.Count + '|diagonalEntries=' + $diagonals.Count + '|enabledDiagonals=' + $enabled.Count)
} finally { $archive.Dispose() }
