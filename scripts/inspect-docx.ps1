param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$archive = [System.IO.Compression.ZipFile]::OpenRead($InputPath)
try {
  $entry = $archive.GetEntry('word/document.xml')
  if (-not $entry) { throw 'word/document.xml was not found' }

  $reader = [System.IO.StreamReader]::new($entry.Open())
  try { [xml]$xml = $reader.ReadToEnd() } finally { $reader.Dispose() }

  $ns = [System.Xml.XmlNamespaceManager]::new($xml.NameTable)
  $ns.AddNamespace('w', 'http://schemas.openxmlformats.org/wordprocessingml/2006/main')
  $body = $xml.SelectSingleNode('//w:body', $ns)
  $lines = [System.Collections.Generic.List[string]]::new()
  $paragraphNumber = 0
  $tableNumber = 0

  foreach ($node in $body.ChildNodes) {
    if ($node.LocalName -eq 'p') {
      $paragraphNumber++
      $styleNode = $node.SelectSingleNode('./w:pPr/w:pStyle', $ns)
      $style = if ($styleNode) { $styleNode.GetAttribute('val', $ns.LookupNamespace('w')) } else { '' }
      $text = (($node.SelectNodes('.//w:t', $ns) | ForEach-Object { $_.InnerText }) -join '')
      $lines.Add(('P{0:D4}|{1}|{2}' -f $paragraphNumber, $style, $text))
    } elseif ($node.LocalName -eq 'tbl') {
      $tableNumber++
      $lines.Add(('TABLE {0} BEGIN' -f $tableNumber))
      $rowNumber = 0
      foreach ($row in $node.SelectNodes('./w:tr', $ns)) {
        $rowNumber++
        $cells = foreach ($cell in $row.SelectNodes('./w:tc', $ns)) {
          (($cell.SelectNodes('.//w:p', $ns) | ForEach-Object {
            (($_.SelectNodes('.//w:t', $ns) | ForEach-Object { $_.InnerText }) -join '')
          }) -join ' / ')
        }
        $lines.Add(('R{0:D3}|{1}' -f $rowNumber, ($cells -join ' || ')))
      }
      $lines.Add(('TABLE {0} END' -f $tableNumber))
    }
  }

  $directory = Split-Path -Parent $OutputPath
  if ($directory) { [System.IO.Directory]::CreateDirectory($directory) | Out-Null }
  [System.IO.File]::WriteAllLines($OutputPath, $lines, [System.Text.UTF8Encoding]::new($false))
} finally {
  $archive.Dispose()
}
