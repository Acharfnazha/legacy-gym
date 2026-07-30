# Legacy Gym - creates a Desktop shortcut with the app icon.
# Run:  npm run shortcut     (or right-click > Run with PowerShell)

$root = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'Legacy Gym.lnk'

# Prefer the packaged exe if it exists (dist build), otherwise dev electron
$packagedExe = Join-Path $root 'dist\win-unpacked\LegacyGym.exe'
$devElectron = Join-Path $root 'node_modules\electron\dist\electron.exe'

$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($shortcutPath)

if (Test-Path $packagedExe) {
    $sc.TargetPath = $packagedExe
    $sc.WorkingDirectory = Split-Path $packagedExe
    # icon comes from the exe itself (official Legacy Gym logo embedded via rcedit)
    $sc.IconLocation = "$packagedExe,0"
} elseif (Test-Path $devElectron) {
    $sc.TargetPath = $devElectron
    $sc.Arguments = '"' + $root + '"'
    $sc.WorkingDirectory = $root
    $icon = Join-Path $root 'assets\icon.ico'
    if (Test-Path $icon) { $sc.IconLocation = $icon }
} else {
    Write-Host 'App not found. Run npm install first.' -ForegroundColor Red
    exit 1
}
$sc.Description = 'Legacy Gym Management System'
$sc.Save()

Write-Host "Desktop shortcut created: $shortcutPath" -ForegroundColor Green
