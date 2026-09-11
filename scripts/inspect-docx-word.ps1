param([Parameter(Mandatory = $true)][string[]]$InputPath)

$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  foreach ($path in $InputPath) {
    $fullPath = [System.IO.Path]::GetFullPath($path)
    $document = $word.Documents.Open($fullPath, $false, $true)
    try {
      $document.Repaginate()
      Write-Output (([System.IO.Path]::GetFileName($fullPath)) + '|pages=' + $document.ComputeStatistics(2) + '|sections=' + $document.Sections.Count + '|tables=' + $document.Tables.Count)
    } finally {
      $document.Close($false)
      [void][Runtime.InteropServices.Marshal]::ReleaseComObject($document)
    }
  }
} finally {
  $word.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word)
}
