# Поднимает окружение для локальной разработки: проверяет Docker, поднимает
# контейнер collapsar-postgres (если он остановлен), ждёт готовности БД и
# запускает uvicorn. Использование: из корня проекта -> .\scripts\dev-up.ps1
$ErrorActionPreference = "Stop"

Write-Host "== Проверка Docker ==" -ForegroundColor Cyan
try {
    docker info *> $null
} catch {
    Write-Host "Docker недоступен. Запустите Docker Desktop и повторите." -ForegroundColor Red
    exit 1
}

Write-Host "== Проверка контейнера collapsar-postgres ==" -ForegroundColor Cyan
$containerExists = docker ps -a --filter "name=^collapsar-postgres$" --format "{{.Names}}"
if (-not $containerExists) {
    Write-Host "Контейнер collapsar-postgres не найден. Поднимите его вручную (docker run/docker-compose) и повторите." -ForegroundColor Red
    exit 1
}

$isRunning = docker ps --filter "name=^collapsar-postgres$" --format "{{.Names}}"
if (-not $isRunning) {
    Write-Host "Контейнер остановлен — запускаю..." -ForegroundColor Yellow
    docker start collapsar-postgres | Out-Null
} else {
    Write-Host "Контейнер уже запущен." -ForegroundColor Green
}

Write-Host "== Ожидание готовности Postgres ==" -ForegroundColor Cyan
$ready = $false
for ($i = 0; $i -lt 20; $i++) {
    docker exec collapsar-postgres pg_isready -U collapsar *> $null
    if ($LASTEXITCODE -eq 0) {
        $ready = $true
        break
    }
    Start-Sleep -Seconds 1
}
if (-not $ready) {
    Write-Host "Postgres не ответил за 20 секунд — проверьте логи (docker logs collapsar-postgres)." -ForegroundColor Red
    exit 1
}
Write-Host "Postgres готов." -ForegroundColor Green

Write-Host "== Применение миграций ==" -ForegroundColor Cyan
python -m alembic upgrade head
if ($LASTEXITCODE -ne 0) {
    Write-Host "Миграции не применились — смотрите вывод выше." -ForegroundColor Red
    exit 1
}

Write-Host "== Запуск backend (uvicorn) ==" -ForegroundColor Cyan
# Без --reload: в этом окружении он периодически "молча" не подхватывал правки
# в файлах (см. историю отладки) — надёжнее перезапускать скрипт руками после правок.
Write-Host "Ctrl+C для остановки. После правок в коде — Ctrl+C и запустить скрипт заново." -ForegroundColor DarkGray
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
