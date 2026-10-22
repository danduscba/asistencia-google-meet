# Genera las imágenes para las tiendas a partir de los HTML de tienda/.
# Uso: powershell -ExecutionPolicy Bypass -File herramientas/capturas.ps1
$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
$src = Join-Path $root "tienda"
$out = Join-Path $src "imagenes"
New-Item -ItemType Directory -Force $out | Out-Null

$browser = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { throw "No se encontró Edge ni Chrome." }

# El navegador escribe avisos inofensivos en stderr; no tratarlos como error.
$ErrorActionPreference = "Continue"

$images = @(
  @{ html = "captura-1-ranking.html";  png = "captura-1-ranking.png";  w = 1280; h = 800 },
  @{ html = "captura-2-en-vivo.html";  png = "captura-2-en-vivo.png";  w = 1280; h = 800 },
  @{ html = "captura-3-exportar.html"; png = "captura-3-exportar.png"; w = 1280; h = 800 },
  @{ html = "promo-440x280.html";      png = "promo-440x280.png";      w = 440;  h = 280 }
)

foreach ($img in $images) {
  $url = ([System.Uri](Join-Path $src $img.html)).AbsoluteUri
  $png = Join-Path $out $img.png
  & $browser --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files `
    --force-device-scale-factor=1 --blink-settings=preferredColorScheme=1 `
    --virtual-time-budget=3000 "--window-size=$($img.w),$($img.h)" "--screenshot=$png" $url 2>$null | Out-Null
  Write-Host "Generada tienda/imagenes/$($img.png)"
}
