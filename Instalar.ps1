# XI · La Justicia — instalación en Windows.
#   1. Revisa que estén Node.js y git.
#   2. Instala los ganchos de git para TODOS tus repositorios (sirven en Visual Studio, Android Studio y la terminal).
#   3. Guarda tu clave de Gemini (opcional).
#   4. Instala la extensión en VS Code y en Kiro si están.
# Para quitarlo todo: Desinstalar.bat.

$ErrorActionPreference = "Stop"
$motor = Join-Path $PSScriptRoot "nucleo\justicia.js"
$vsix = Get-ChildItem (Join-Path $PSScriptRoot "dist") -Filter "*.vsix" | Sort-Object Name | Select-Object -Last 1

Write-Host "XI · La Justicia" -ForegroundColor Yellow

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Falta Node.js. Instálalo con:  winget install OpenJS.NodeJS.LTS   y vuelve a ejecutar Instalar.bat." -ForegroundColor Red
    exit 1
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "Falta git. Instálalo con:  winget install Git.Git   y vuelve a ejecutar Instalar.bat." -ForegroundColor Red
    exit 1
}
Write-Host ("Node " + (node --version) + " y " + (git --version) + " encontrados.")

# 1) ganchos para todos los repositorios
$anterior = git config --global core.hooksPath
if ($anterior -and -not ($anterior -like "*justicia*")) {
    Write-Host "Ojo: ya tenías core.hooksPath = $anterior. Se reemplaza por los ganchos de La Justicia." -ForegroundColor Yellow
}
node $motor instalar --global

# 2) clave de Gemini
$actual = $env:GEMINI_API_KEY
$config = Join-Path $env:APPDATA "Justicia\config.json"
if (-not $actual -and -not (Test-Path $config)) {
    Write-Host ""
    Write-Host "Pega tu clave de Gemini (aistudio.google.com → API keys) para que el mensaje lo escriba la IA."
    Write-Host "Deja vacío para usar solo reglas simples. Se guarda en $config."
    $segura = Read-Host "Clave de Gemini" -AsSecureString
    $clave = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($segura))
    if ($clave) { node $motor configurar $clave }
}

# 3) extensión para VS Code y Kiro
foreach ($editor in @("code", "kiro")) {
    if (Get-Command $editor -ErrorAction SilentlyContinue) {
        if ($vsix) {
            & $editor --install-extension $vsix.FullName --force | Out-Null
            Write-Host "Extensión instalada en $editor."
        }
    } else {
        Write-Host "No encontré '$editor' en la terminal (si lo tienes: Extensiones → ··· → Instalar desde VSIX → $($vsix.FullName))."
    }
}

Write-Host ""
Write-Host "Listo. En VS Code / Kiro usa el botón de la balanza en la vista de Git." -ForegroundColor Green
Write-Host "En Visual Studio: lee visual-studio\LEEME.md para agregar el botón «La Justicia: sugerir mensaje»."
