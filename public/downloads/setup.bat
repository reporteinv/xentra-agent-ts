@echo off
set "SRCDIR=%~dp0"
cd /d "%~dp0"
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
echo                SETUP v3.9
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
if "%OPCION%"=="4" exit
goto menu

:instalar
cls
echo.
echo  ========================================
echo                SETUP v3.9
echo  ========================================
echo.
echo  [0/5] Limpiando instalacion previa...
schtasks /Delete /TN "XentraAgent" /F > nul 2>&1
schtasks /Delete /TN "XentraAgentPoll" /F > nul 2>&1
schtasks /Delete /TN "XentraAgentLimpieza" /F > nul 2>&1
schtasks /Delete /TN "XentraAgentUI" /F > nul 2>&1
attrib -h "C:\Xentra" > nul 2>&1
if exist "C:\Xentra" rmdir /S /Q "C:\Xentra" > nul 2>&1
echo  [0/5] OK
echo.
echo  [1/5] Preparando directorio...
if not exist "C:\Xentra" mkdir "C:\Xentra"
copy /Y "%SRCDIR%xentra-agent.ps1" "C:\Xentra\xentra-agent.ps1" > nul
powershell -Command "Unblock-File -Path 'C:\Xentra\xentra-agent.ps1'" > nul 2>&1
attrib +h "C:\Xentra" > nul 2>&1
del /F /Q "C:\Xentra\ultima-limpieza.txt" 2>nul
del /F /Q "C:\Xentra\ultima-programas.txt" 2>nul
del /F /Q "C:\Xentra\ultimo-hash.txt" 2>nul
echo  [1/5] OK
echo.
echo  [2/5] Creando tareas programadas...
schtasks /Delete /TN "XentraAgentUI" /F > nul 2>&1
schtasks /Create /TN "XentraAgent" /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Xentra\xentra-agent.ps1" /SC MINUTE /MO 20 /RU SYSTEM /RL HIGHEST /F > nul 2>&1
schtasks /Create /TN "XentraAgentPoll" /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Xentra\xentra-agent.ps1 -Poll" /SC MINUTE /MO 1 /RU SYSTEM /RL HIGHEST /F > nul 2>&1
echo  [2/5] OK
echo.
echo  [3/5] Calculando hora de limpieza...
for /f %%H in ('powershell -Command "Get-Random -Minimum 1 -Maximum 5"') do set HORA=%%H
for /f %%M in ('powershell -Command "Get-Random -Minimum 0 -Maximum 59"') do set MIN=%%M
set HORA_ST=0%HORA%:%MIN%
if %HORA% GEQ 10 set HORA_ST=%HORA%:%MIN%
if %MIN% LSS 10 set HORA_ST=0%HORA%:0%MIN%
if %HORA% GEQ 10 if %MIN% LSS 10 set HORA_ST=%HORA%:0%MIN%
schtasks /Create /TN "XentraAgentLimpieza" /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Xentra\xentra-agent.ps1 -Limpiar" /SC DAILY /ST %HORA_ST% /RU SYSTEM /RL HIGHEST /F > nul 2>&1
echo  [3/5] OK - Limpieza diaria: %HORA_ST%
echo.
echo  [4/5] Ejecutando agente inicial...
start /B powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Xentra\xentra-agent.ps1"
echo  [4/5] OK
echo.
echo  [5/5] Listo.
echo.
echo  ========================================
echo   === Instalacion EXITOSA ===
echo   Agente:   v3.9
echo   Polling:  cada 20 min
echo   Limpieza: diaria %HORA_ST%
echo  ========================================
echo.
timeout /t 5 /nobreak >nul
exit

:actualizar
cls
echo.
echo  ========================================
echo                SETUP v3.9
echo  ========================================
echo.
echo  [1/5] Copiando agente...
copy /Y "%SRCDIR%xentra-agent.ps1" "C:\Xentra\xentra-agent.ps1" > nul 2>&1
powershell -Command "Unblock-File -Path 'C:\Xentra\xentra-agent.ps1'" > nul 2>&1
attrib +h "C:\Xentra" > nul 2>&1
echo  [1/5] OK
echo.
echo  [2/5] Actualizando tareas programadas...
schtasks /Delete /TN "XentraAgentUI" /F > nul 2>&1
schtasks /Create /TN "XentraAgent" /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Xentra\xentra-agent.ps1" /SC MINUTE /MO 20 /RU SYSTEM /RL HIGHEST /F > nul 2>&1
schtasks /Create /TN "XentraAgentPoll" /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Xentra\xentra-agent.ps1 -Poll" /SC MINUTE /MO 1 /RU SYSTEM /RL HIGHEST /F > nul 2>&1
echo  [2/5] OK
echo.
echo  [3/5] Calculando hora de limpieza...
for /f %%H in ('powershell -Command "Get-Random -Minimum 1 -Maximum 5"') do set HORA=%%H
for /f %%M in ('powershell -Command "Get-Random -Minimum 0 -Maximum 59"') do set MIN=%%M
set HORA_ST=0%HORA%:%MIN%
if %HORA% GEQ 10 set HORA_ST=%HORA%:%MIN%
if %MIN% LSS 10 set HORA_ST=0%HORA%:0%MIN%
if %HORA% GEQ 10 if %MIN% LSS 10 set HORA_ST=%HORA%:0%MIN%
schtasks /Create /TN "XentraAgentLimpieza" /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Xentra\xentra-agent.ps1 -Limpiar" /SC DAILY /ST %HORA_ST% /RU SYSTEM /RL HIGHEST /F > nul 2>&1
echo  [3/5] OK - Limpieza diaria: %HORA_ST%
echo.
echo  [4/5] Ejecutando agente...
start /B powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Xentra\xentra-agent.ps1"
echo  [4/5] OK
echo.
echo  [5/5] Listo.
echo.
echo  ========================================
echo   === Actualizacion EXITOSA ===
echo   Agente:   v3.9
echo   Polling:  cada 20 min
echo   Limpieza: diaria %HORA_ST%
echo  ========================================
echo.
timeout /t 5 /nobreak >nul
exit

:desinstalar
cls
echo.
echo  Desinstalando ...
echo.
for /f %%a in ('powershell -Command "(Get-CimInstance Win32_BIOS).SerialNumber.Trim()"') do set SERIAL=%%a
powershell -Command "try { Invoke-RestMethod -Uri 'https://ag2.xentrasoft.com/api/pc/pcs/%SERIAL%' -Method Delete -Headers @{'X-Agent-Token'='xnt_ungrd_2026'} -TimeoutSec 10 } catch { try { Invoke-RestMethod -Uri 'https://ts.xentrasoft.com/api/pc/pcs/%SERIAL%' -Method Delete -Headers @{'X-Agent-Token'='xnt_ungrd_2026'} -TimeoutSec 10 } catch {} }" > nul 2>&1
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
timeout /t 3 /nobreak >nul
exit
