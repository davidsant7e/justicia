# Quita los ganchos globales de La Justicia y la extensión de VS Code / Kiro.
# Tu clave queda en %APPDATA%\Justicia\config.json: bórrala a mano si quieres.

$motor = Join-Path $PSScriptRoot "nucleo\justicia.js"
if (Get-Command node -ErrorAction SilentlyContinue) { node $motor desinstalar --global }
foreach ($editor in @("code", "kiro")) {
    if (Get-Command $editor -ErrorAction SilentlyContinue) {
        & $editor --uninstall-extension davidsant7e.la-justicia | Out-Null
        Write-Host "Extensión quitada de $editor."
    }
}
Write-Host "Listo."
