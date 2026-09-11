param(
  [Parameter(Mandatory = $true)][string[]]$DocumentPaths
)

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  foreach ($path in $DocumentPaths) {
    $resolved = [System.IO.Path]::GetFullPath($path)
    $document = $word.Documents.Open($resolved)
    try {
      $document.Repaginate()
      foreach ($tableOfContents in $document.TablesOfContents) { $tableOfContents.Update() }
      $document.Fields.Update() | Out-Null
      $document.Save()
      Write-Output ("validated=" + $resolved + "; pages=" + $document.ComputeStatistics(2) + "; toc=" + $document.TablesOfContents.Count)
    } finally {
      $document.Close(0)
    }
  }
} finally {
  $word.Quit()
  [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($word) | Out-Null
}
