<#
Быстрое обновление после изменений в коде: подтягивает свежий код из git,
ставит зависимости, накатывает миграции, пересобирает фронт и перезапускает
backend. Постоянные сервисы (Postgres, туннель) не трогает — их незачем
дёргать на каждый деплой.

Запуск: .\scripts\windows\redeploy.ps1
Флаг -NoGit — обновить/пересобрать без git pull (если правишь код прямо тут).
#>
param(
    [switch]$NoGit
)

$ErrorActionPreference = "Stop"
$ProjectRoot = "C:\Users\GX274B\source\repos\Crm_Reports — копия\GeneralReport"
Set-Location $ProjectRoot

if (-not $NoGit) {
    Write-Host "==> git pull"
    git pull
}

Write-Host "==> Python-зависимости"
& ".\.venv\Scripts\python.exe" -m pip install -q -r requirements.txt

Write-Host "==> Миграции БД"
& ".\.venv\Scripts\python.exe" -m alembic upgrade head

Write-Host "==> Сборка фронтенда"
Push-Location "frontend"
npm install
npm run build
Pop-Location

Write-Host "==> Перезапуск backend"
$task = Get-ScheduledTask -TaskName "CollapsarBackend" -ErrorAction SilentlyContinue
if ($task) {
    # задание планировщика (см. setup-autostart.ps1) — обычно можно
    # остановить/запустить от своего же пользователя без повышения прав
    Stop-ScheduledTask -TaskName "CollapsarBackend" -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Start-ScheduledTask -TaskName "CollapsarBackend"
    Write-Host "backend перезапущен через Планировщик заданий"
} else {
    Write-Host "Задание CollapsarBackend не найдено — останавливаю процесс вручную и перезапускаю в фоне"
    Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
        Where-Object { $_.CommandLine -like "*uvicorn app.main:app*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    Start-Sleep -Seconds 1
    Start-Process -FilePath ".\.venv\Scripts\python.exe" `
        -ArgumentList "-m uvicorn app.main:app --host 127.0.0.1 --port 8000" `
        -WorkingDirectory $ProjectRoot -WindowStyle Hidden
}

Start-Sleep -Seconds 3
Write-Host "==> Проверка"
try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8000/health" -TimeoutSec 5
    Write-Host "OK: $($health | ConvertTo-Json -Compress)"
} catch {
    Write-Host "ОШИБКА: backend не отвечает на /health — $($_.Exception.Message)"
}
