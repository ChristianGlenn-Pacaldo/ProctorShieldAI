param(
  [string]$SourcePath = 'docs/_working/ProctorShield_AI_Final_Defense_Study_Guide_2026-09-09.html',
  [string]$OutputPath = 'docs/defense/ProctorShield_AI_Final_Defense_Study_Guide_2026-09-09.docx'
)

$ErrorActionPreference = 'Stop'
$source = [IO.Path]::GetFullPath($SourcePath)
$output = [IO.Path]::GetFullPath($OutputPath)
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($output)) | Out-Null

$word = $null
$document = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $word.ScreenUpdating = $false
  $document = $word.Documents.Open($source, $false, $true)
  $document.SaveAs2($output, 16)
  Write-Output "docx=$output"
  Write-Output "pages=$($document.ComputeStatistics(2))"
} finally {
  if ($document) { $document.Close($false) }
  if ($word) { $word.Quit() }
  if ($document) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) }
  if ($word) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($word) }
}
