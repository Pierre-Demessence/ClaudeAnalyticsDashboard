# Builds the widget, copies it to %LOCALAPPDATA%\Claude Analytics Dashboard Widget and starts it.
# "Start with Windows" in the widget's menu points at that copy.
$ErrorActionPreference = 'Stop'

if (Get-Process cca-widget -ErrorAction SilentlyContinue) {
  throw 'The widget is running: right-click it and choose Quit first, or the exe is locked.'
}

cargo build --release --manifest-path "$PSScriptRoot/Cargo.toml"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$dir = Join-Path $env:LOCALAPPDATA 'Claude Analytics Dashboard Widget'
New-Item -ItemType Directory -Force $dir | Out-Null
$exe = Join-Path $dir 'cca-widget.exe'
Copy-Item "$PSScriptRoot/target/release/cca-widget.exe" $exe -Force
Start-Process $exe

# The widget was called "Claude Code Analytics Widget": drop its folder and its startup entry
# ("Start with Windows" is off until it is ticked again in the new widget's menu).
Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'Claude Code Analytics Widget' -ErrorAction SilentlyContinue
$oldDir = Join-Path $env:LOCALAPPDATA 'Claude Code Analytics Widget'
if (Test-Path $oldDir) { Remove-Item $oldDir -Recurse -Force }
Write-Host "Installed and started $exe"
