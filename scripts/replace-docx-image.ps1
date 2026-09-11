param(
  [Parameter(Mandatory = $true)][string]$DocumentPath,
  [Parameter(Mandatory = $true)][string]$EntryName,
  [Parameter(Mandatory = $true)][string]$ImagePath
)

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$archive = [System.IO.Compression.ZipFile]::Open($DocumentPath, [System.IO.Compression.ZipArchiveMode]::Update)
try {
  $existing = $archive.GetEntry($EntryName)
  if (-not $existing) { throw "Document entry '$EntryName' was not found" }
  $existing.Delete()
  $replacement = $archive.CreateEntry($EntryName, [System.IO.Compression.CompressionLevel]::Optimal)
  $input = [System.IO.File]::OpenRead($ImagePath)
  $output = $replacement.Open()
  try { $input.CopyTo($output) } finally { $output.Dispose(); $input.Dispose() }
} finally {
  $archive.Dispose()
}
