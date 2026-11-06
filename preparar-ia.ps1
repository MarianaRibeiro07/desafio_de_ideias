$ErrorActionPreference = 'Stop'
$ctiNode = Get-Command node -ErrorAction Stop
$ctiNpm = Get-Command npm.cmd -ErrorAction Stop
Push-Location $PSScriptRoot
try {
    & $ctiNpm.Source ci --prefix ai --cache storage/npm-cache --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar o motor de IA.' }
    & $ctiNode.Source ai/setup.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao baixar ou validar os modelos de IA.' }
}
finally {
    Pop-Location
}
