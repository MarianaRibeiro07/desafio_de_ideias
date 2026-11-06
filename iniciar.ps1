param(
    [ValidateRange(1024, 65535)]
    [int]$Porta = 8080
)

$ErrorActionPreference = 'Stop'
$ctiPhp = Get-Command php -ErrorAction Stop
$ctiNode = Get-Command node -ErrorAction Stop
$ctiWorker = $null
Push-Location $PSScriptRoot
try {
    $ctiModelCache = if ($env:CTI_MODEL_CACHE_PATH) { $env:CTI_MODEL_CACHE_PATH } else { Join-Path $PSScriptRoot 'storage/models' }
    if (!(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'ai/node_modules/@huggingface/transformers/package.json')) -or !(Test-Path -LiteralPath (Join-Path $ctiModelCache 'ready.json'))) {
        Write-Host 'Preparando IA local. A primeira execucao precisa de internet para baixar os modelos.'
        & (Join-Path $PSScriptRoot 'preparar-ia.ps1')
    }
    $env:CTI_NODE_PATH = $ctiNode.Source
    & $ctiPhp.Source bin/console.php init
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao inicializar o banco CTI Escuta.' }
    $ctiStorage = if ($env:CTI_STORAGE_PATH) { $env:CTI_STORAGE_PATH } else { Join-Path $PSScriptRoot 'storage' }
    $ctiWorker = Start-Process -FilePath $ctiPhp.Source -ArgumentList @('bin/console.php', 'analysis:work') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $ctiStorage 'analysis-worker.log') -RedirectStandardError (Join-Path $ctiStorage 'analysis-errors.log') -PassThru
    Write-Host "CTI Escuta: http://localhost:$Porta"
    Write-Host 'IA e transcricao locais em segundo plano.'
    Write-Host 'Use Ctrl+C para encerrar o servidor.'
    & $ctiPhp.Source -d upload_max_filesize=6M -d post_max_size=7M -S "127.0.0.1:$Porta" -t public public/router.php
    if ($LASTEXITCODE -ne 0) { throw 'O servidor PHP encerrou com erro.' }
}
finally {
    if ($ctiWorker -and !$ctiWorker.HasExited) {
        & taskkill.exe /PID $ctiWorker.Id /T /F | Out-Null
    }
    Pop-Location
}
