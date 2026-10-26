# Windows half of recycle.sh: sends each path to the Recycle Bin, and leaves in place any path the bin would delete for good.
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Paths)
Add-Type -AssemblyName Microsoft.VisualBasic

# Where the shell cannot recycle it deletes for good, and the no-confirmation flag below silences that warning.
function Get-Refusal([string]$Path) {
  $qualifier = Split-Path -Qualifier $Path
  if (-not $qualifier) { return 'its drive could not be read' }
  if ([System.IO.DriveInfo]::new($qualifier).DriveType -ne 'Fixed') { return "$qualifier is not a local fixed drive, so it has no Recycle Bin" }
  $guid = [regex]::Match([string](Get-Volume -DriveLetter $qualifier.Substring(0, 1) -ErrorAction SilentlyContinue).UniqueId, '\{[^}]+\}').Value
  $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\BitBucket\Volume\$guid"
  $settings = if ($guid) { Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue }
  if ($null -eq $settings -or $null -eq $settings.MaxCapacity) { return "the Recycle Bin settings for $qualifier could not be read" }
  if ($settings.NukeOnDelete) { return "the Recycle Bin is turned off on $qualifier" }
  $item = Get-Item -LiteralPath $Path -Force
  $bytes = if ($item.PSIsContainer) { (Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum } else { $item.Length }
  if ($bytes -ge $settings.MaxCapacity * 1MB) { return "it is bigger than the $($settings.MaxCapacity) MB Recycle Bin on $qualifier" }
  return $null
}

$status = 0
foreach ($path in $Paths) {
  try {
    $refusal = Get-Refusal $path
    if ($refusal) { throw "left '$path' in place, $refusal; it would be deleted for good" }
    if (Test-Path -LiteralPath $path -PathType Container) {
      [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($path, 'OnlyErrorDialogs', 'SendToRecycleBin')
    } else {
      [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($path, 'OnlyErrorDialogs', 'SendToRecycleBin')
    }
  } catch {
    [Console]::Error.WriteLine("rm (to the bin): $($_.Exception.Message)")
    $status = 1
  }
}
exit $status
