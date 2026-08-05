<#
Быстрая проверка состояния стека: задания планировщика + локальный /health +
публичный домен.
#>
Write-Host "== Задания планировщика =="
Get-ScheduledTask -TaskName "Collapsar*" -ErrorAction SilentlyContinue |
    Get-ScheduledTaskInfo |
    Format-Table TaskName, LastRunTime, LastTaskResult, NextRunTime

Write-Host "`n== Локальный backend (127.0.0.1:8000) =="
try {
    Invoke-RestMethod -Uri "http://127.0.0.1:8000/health" -TimeoutSec 5 | ConvertTo-Json -Compress
} catch {
    Write-Host "НЕДОСТУПЕН: $($_.Exception.Message)"
}

Write-Host "`n== Публичный домен (starwarsmycollapsar.ru) =="
try {
    Invoke-RestMethod -Uri "https://starwarsmycollapsar.ru/health" -TimeoutSec 10 | ConvertTo-Json -Compress
} catch {
    Write-Host "НЕДОСТУПЕН: $($_.Exception.Message)"
}
