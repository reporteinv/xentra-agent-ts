@echo off
chcp 65001 >nul

net session >nul 2>&1
if %errorlevel% neq 0 (
    cls
    echo.
    echo  ERROR: Ejecuta como ADMINISTRADOR.
    echo  Clic derecho - Ejecutar como administrador
    echo.
    pause
    exit /b 1
)

:menu
cls
echo.
echo  ========================================
echo                SETUP v3.3
echo  ========================================
echo.
echo   1. Instalar
echo   2. Actualizar
echo   3. Desinstalar
echo   4. Salir
echo.
echo  ========================================
echo.
set /p OPCION= Seleccione una opcion (1-4): 

if "%OPCION%"=="1" goto instalar
if "%OPCION%"=="2" goto actualizar
if "%OPCION%"=="3" goto desinstalar
if "%OPCION%"=="4" exit /b 0
goto menu

:instalar
cls
echo.
echo  Instalando  v3.3...
echo.
if not exist "C:\Xentra" mkdir "C:\Xentra"
copy /Y "%~dp0xentra-pc-agent.ps1" "C:\Xentra\xentra-agent.ps1" > nul
powershell -Command "Unblock-File -Path 'C:\Xentra\xentra-agent.ps1'" > nul 2>&1
attrib +h "C:\Xentra" > nul 2>&1
del /F /Q "C:\Xentra\ultima-limpieza.txt" 2>nul
del /F /Q "C:\Xentra\ultima-programas.txt" 2>nul

REM Eliminar tarea UI problematica si existe
schtasks /Delete /TN "XentraAgentUI" /F > nul 2>&1

REM Tarea principal cada 10 minutos
schtasks /Create /TN "XentraAgent" /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Xentra\xentra-agent.ps1" /SC MINUTE /MO 10 /RU SYSTEM /RL HIGHEST /F > nul 2>&1

REM Tarea polling comandos cada 1 minuto
schtasks /Create /TN "XentraAgentPoll" /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Xentra\xentra-agent.ps1 -Poll" /SC MINUTE /MO 1 /RU SYSTEM /RL HIGHEST /F > nul 2>&1

REM Tarea limpieza diaria hora random 1-5am
for /f %%H in ('powershell -Command "Get-Random -Minimum 1 -Maximum 5"') do set HORA=%%H
for /f %%M in ('powershell -Command "Get-Random -Minimum 0 -Maximum 59"') do set MIN=%%M
set HORA_ST=0%HORA%:%MIN%
if %HORA% GEQ 10 set HORA_ST=%HORA%:%MIN%
if %MIN% LSS 10 set HORA_ST=0%HORA%:0%MIN%
if %HORA% GEQ 10 if %MIN% LSS 10 set HORA_ST=%HORA%:0%MIN%
schtasks /Create /TN "XentraAgentLimpieza" /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Xentra\xentra-agent.ps1 -Limpiar" /SC DAILY /ST %HORA_ST% /RU SYSTEM /RL HIGHEST /F > nul 2>&1

REM Ejecucion inicial en background
start /B powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Xentra\xentra-agent.ps1" -Limpiar
start /B powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Xentra\xentra-agent.ps1"

cls
echo.
echo  === Instalacion EXITOSA ===
echo  Agente:   C:\Xentra\xentra-agent.ps1
echo  Polling:  XentraAgent - cada 10 minutos
echo  Limpieza: XentraAgentLimpieza - diaria %HORA_ST%
echo.
pause
goto menu

:actualizar
cls
echo.
echo  Actualizando  v3.3...
echo.
copy /Y "%~dp0xentra-pc-agent.ps1" "C:\Xentra\xentra-agent.ps1" > nul 2>&1
powershell -Command "Unblock-File -Path 'C:\Xentra\xentra-agent.ps1'" > nul 2>&1
attrib +h "C:\Xentra" > nul 2>&1

REM Eliminar tarea UI problematica si existe
schtasks /Delete /TN "XentraAgentUI" /F > nul 2>&1

REM Tarea principal cada 10 minutos
schtasks /Create /TN "XentraAgent" /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Xentra\xentra-agent.ps1" /SC MINUTE /MO 10 /RU SYSTEM /RL HIGHEST /F > nul 2>&1

REM Tarea polling comandos cada 1 minuto
schtasks /Create /TN "XentraAgentPoll" /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Xentra\xentra-agent.ps1 -Poll" /SC MINUTE /MO 1 /RU SYSTEM /RL HIGHEST /F > nul 2>&1

for /f %%H in ('powershell -Command "Get-Random -Minimum 1 -Maximum 5"') do set HORA=%%H
for /f %%M in ('powershell -Command "Get-Random -Minimum 0 -Maximum 59"') do set MIN=%%M
set HORA_ST=0%HORA%:%MIN%
if %HORA% GEQ 10 set HORA_ST=%HORA%:%MIN%
if %MIN% LSS 10 set HORA_ST=0%HORA%:0%MIN%
if %HORA% GEQ 10 if %MIN% LSS 10 set HORA_ST=%HORA%:0%MIN%
schtasks /Create /TN "XentraAgentLimpieza" /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Xentra\xentra-agent.ps1 -Limpiar" /SC DAILY /ST %HORA_ST% /RU SYSTEM /RL HIGHEST /F > nul 2>&1

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Xentra\xentra-agent.ps1" > nul 2>&1

cls
echo.
echo  === Actualizacion EXITOSA ===
echo  Polling:  XentraAgent - cada 10 minutos
echo  Limpieza: XentraAgentLimpieza - diaria %HORA_ST%
echo.
pause
goto menu

:desinstalar
cls
echo.
echo  Desinstalando ...
echo.
for /f %%a in ('powershell -Command "(Get-CimInstance Win32_BIOS).SerialNumber.Trim()"') do set SERIAL=%%a
powershell -Command "try { Invoke-RestMethod -Uri 'https://ag2.xentrasoft.com/api/pcs/%SERIAL%' -Method Delete -Headers @{'X-Agent-Token'='xnt_ungrd_2026'} -TimeoutSec 10 } catch { try { Invoke-RestMethod -Uri 'https://app.xentrasoft.com/api/pc/pcs/%SERIAL%' -Method Delete -Headers @{'X-Agent-Token'='xnt_ungrd_2026'} -TimeoutSec 10 } catch {} }" > nul 2>&1
schtasks /Delete /TN "XentraAgent" /F 2>nul
schtasks /Delete /TN "XentraAgentPoll" /F 2>nul
schtasks /Delete /TN "XentraAgentLimpieza" /F 2>nul
schtasks /Delete /TN "XentraAgentUI" /F 2>nul
attrib -h "C:\Xentra" 2>nul
rmdir /S /Q "C:\Xentra" 2>nul
cls
echo.
echo  === Desinstalacion EXITOSA ===
echo.
pause
goto menu
