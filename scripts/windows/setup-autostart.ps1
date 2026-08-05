#Requires -RunAsAdministrator
<#
Одноразовая настройка автозапуска COLLAPSAR на этой машине: PostgreSQL, backend
(uvicorn) и cloudflared-туннель поднимаются сами при входе в Windows под текущим
пользователем и перезапускаются, если упадут. Реализовано через Планировщик
заданий (а не "настоящие" Windows-службы) — заведение служб для PostgreSQL на
Windows требует отдельной учётки с правами на каталог данных (NetworkService и
т.п.), это лишняя возня для рабочей машины; задания планировщика проще и
запускаются от того же пользователя, которому и так принадлежит база.

Запускать ОДИН РАЗ: правый клик по файлу -> "Запуск от имени администратора".
Повторный запуск безопасен — старые задания пересоздаются.
#>

$ErrorActionPreference = "Stop"
$User = "$env:USERDOMAIN\$env:USERNAME"

$ProjectRoot = "C:\Users\GX274B\source\repos\Crm_Reports — копия\GeneralReport"
$PgData = "C:\Users\GX274B\pgdata_collapsar"
$PgBin = "C:\Program Files\PostgreSQL\17\bin"

$Tasks = @(
    @{
        Name  = "CollapsarPostgres"
        Exec  = "$PgBin\pg_ctl.exe"
        Args  = "start -D `"$PgData`" -l `"$PgData\server.log`" -w"
        Delay = "PT5S"
    },
    @{
        Name    = "CollapsarBackend"
        Exec    = "$ProjectRoot\.venv\Scripts\python.exe"
        Args    = "-m uvicorn app.main:app --host 127.0.0.1 --port 8000"
        WorkDir = $ProjectRoot
        Delay   = "PT15S"
    },
    @{
        Name  = "CollapsarTunnel"
        Exec  = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
        Args  = "tunnel --config `"C:\Users\GX274B\.cloudflared\config.yml`" run collapsar"
        Delay = "PT20S"
    }
)

foreach ($t in $Tasks) {
    if (Get-ScheduledTask -TaskName $t.Name -ErrorAction SilentlyContinue) {
        Write-Host "Задание $($t.Name) уже есть — пересоздаю"
        Unregister-ScheduledTask -TaskName $t.Name -Confirm:$false
    }

    $actionParams = @{ Execute = $t.Exec; Argument = $t.Args }
    if ($t.WorkDir) { $actionParams.WorkingDirectory = $t.WorkDir }
    $action = New-ScheduledTaskAction @actionParams

    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $User
    $trigger.Delay = $t.Delay

    # RestartCount/RestartInterval — перезапуск задания, если процесс упал;
    # ExecutionTimeLimit=0 — иначе планировщик по умолчанию убивает задание
    # через 72 часа, а нам нужен вечно работающий процесс
    $settings = New-ScheduledTaskSettingsSet `
        -RestartCount 999 `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries

    Register-ScheduledTask -TaskName $t.Name -Action $action -Trigger $trigger `
        -Settings $settings -User $User -RunLevel Limited | Out-Null
    Write-Host "Создано задание $($t.Name)"
}

Write-Host "`nЗапускаю сейчас же, не дожидаясь следующего входа в систему..."
foreach ($t in $Tasks) {
    Start-ScheduledTask -TaskName $t.Name
    Start-Sleep -Seconds 3
}

Write-Host "`nПроверка через 10 секунд..."
Start-Sleep -Seconds 10
Get-ScheduledTask -TaskName "Collapsar*" | Get-ScheduledTaskInfo | Format-Table TaskName, LastRunTime, LastTaskResult

Write-Host "`nЕсли LastTaskResult не 0 — смотри логи:"
Write-Host "  Postgres: $PgData\server.log"
Write-Host "  Backend:  вывод в консоль не сохраняется (задание без окна) — если не поднялся, запусти вручную для диагностики:"
Write-Host "    & `"$ProjectRoot\.venv\Scripts\python.exe`" -m uvicorn app.main:app --host 127.0.0.1 --port 8000"
