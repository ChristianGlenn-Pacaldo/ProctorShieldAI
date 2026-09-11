param(
  [Parameter(Mandatory = $true)][string]$DocumentPath,
  [Parameter(Mandatory = $true)][string]$FindText,
  [Parameter(Mandatory = $true)][string]$ReplacementText
)

$ErrorActionPreference = 'Stop'
$resolved = [System.IO.Path]::GetFullPath($DocumentPath)
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $document = $word.Documents.Open($resolved, $false, $false)
  try {
    $find = $document.Content.Find
    $find.ClearFormatting()
    $find.Replacement.ClearFormatting()
    $changed = $find.Execute($FindText, $false, $false, $false, $false, $false, $true, 1, $false, $ReplacementText, 2)
    if (-not $changed) { throw 'Requested document text was not found' }
    $document.Repaginate()
    $document.Save()
    Write-Output ('updated=' + $resolved + ';pages=' + $document.ComputeStatistics(2))
  } finally {
    $document.Close($false)
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($document)
  }
} finally {
  $word.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word)
}
