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
echo         XENTRA-AGENT SETUP v2.3
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
echo  Instalando Xentra-Agent v2.3...
echo.
if not exist "C:\Xentra" mkdir "C:\Xentra"
copy /Y "%~dp0xentra-agent.ps1" "C:\Xentra\xentra-agent.ps1" > nul
powershell -Command "Unblock-File -Path 'C:\Xentra\xentra-agent.ps1'" > nul 2>&1
attrib +h "C:\Xentra" > nul 2>&1
del /F /Q "C:\Xentra\ultima-limpieza.txt" 2>nul

REM Tarea principal: polling + reporte rapido cada 10 minutos
schtasks /Create /TN "XentraAgent" /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Xentra\xentra-agent.ps1" /SC MINUTE /MO 10 /RU SYSTEM /RL HIGHEST /F > nul 2>&1

REM Tarea limpieza: hora random entre 1am y 5am
for /f %%H in ('powershell -Command "Get-Random -Minimum 1 -Maximum 5"') do set HORA=%%H
for /f %%M in ('powershell -Command "Get-Random -Minimum 0 -Maximum 59"') do set MIN=%%M
set HORA_ST=0%HORA%:%MIN%
if %HORA% GEQ 10 set HORA_ST=%HORA%:%MIN%
if %MIN% LSS 10 set HORA_ST=0%HORA%:0%MIN%
if %HORA% GEQ 10 if %MIN% LSS 10 set HORA_ST=%HORA%:0%MIN%

schtasks /Create /TN "XentraAgentLimpieza" /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Xentra\xentra-agent.ps1 -Limpiar" /SC DAILY /ST %HORA_ST% /RU SYSTEM /RL HIGHEST /F > nul 2>&1

REM Ejecutar limpieza inicial
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Xentra\xentra-agent.ps1" -Limpiar > nul 2>&1
REM Ejecutar reporte inicial inmediato
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Xentra\xentra-agent.ps1" > nul 2>&1

cls
echo.
echo  === Instalacion EXITOSA ===
echo  Tarea polling:  XentraAgent       - cada 10 minutos
echo  Tarea limpieza: XentraAgentLimpieza - diaria %HORA_ST%
echo.
pause
goto menu

:actualizar
cls
echo.
echo  Actualizando Xentra-Agent v2.3...
echo.
copy /Y "%~dp0xentra-agent.ps1" "C:\Xentra\xentra-agent.ps1" > nul 2>&1
powershell -Command "Unblock-File -Path 'C:\Xentra\xentra-agent.ps1'" > nul 2>&1
attrib +h "C:\Xentra" > nul 2>&1
del /F /Q "C:\Xentra\ultima-limpieza.txt" 2>nul

REM Actualizar tarea principal a 10 minutos
schtasks /Create /TN "XentraAgent" /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Xentra\xentra-agent.ps1" /SC MINUTE /MO 10 /RU SYSTEM /RL HIGHEST /F > nul 2>&1

REM Actualizar tarea limpieza con nueva hora random
for /f %%H in ('powershell -Command "Get-Random -Minimum 1 -Maximum 5"') do set HORA=%%H
for /f %%M in ('powershell -Command "Get-Random -Minimum 0 -Maximum 59"') do set MIN=%%M
set HORA_ST=0%HORA%:%MIN%
if %HORA% GEQ 10 set HORA_ST=%HORA%:%MIN%
if %MIN% LSS 10 set HORA_ST=0%HORA%:0%MIN%
if %HORA% GEQ 10 if %MIN% LSS 10 set HORA_ST=%HORA%:0%MIN%

schtasks /Create /TN "XentraAgentLimpieza" /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Xentra\xentra-agent.ps1 -Limpiar" /SC DAILY /ST %HORA_ST% /RU SYSTEM /RL HIGHEST /F > nul 2>&1

REM Ejecutar reporte inmediato
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Xentra\xentra-agent.ps1" > nul 2>&1

cls
echo.
echo  === Actualizacion EXITOSA ===
echo  Tarea polling:  XentraAgent       - cada 10 minutos
echo  Tarea limpieza: XentraAgentLimpieza - diaria %HORA_ST%
echo.
pause
goto menu

:desinstalar
cls
echo.
echo  Desinstalando Xentra-Agent...
echo.
for /f %%a in ('powershell -Command "(Get-CimInstance Win32_BIOS).SerialNumber.Trim()"') do set SERIAL=%%a
powershell -Command "try { Invoke-RestMethod -Uri 'https://agent.xentrasoft.com/api/pcs/%SERIAL%' -Method Delete -Headers @{'X-Agent-Token'='202c4b46a4f2f3b184cc2019cdd8d6cd37773d84922bfd1580f6270c9c436e39'} -TimeoutSec 10 } catch {}" > nul 2>&1
schtasks /Delete /TN "XentraAgent" /F 2>nul
schtasks /Delete /TN "XentraAgentLimpieza" /F 2>nul
attrib -h "C:\Xentra" 2>nul
rmdir /S /Q "C:\Xentra" 2>nul
cls
echo.
echo  === Desinstalacion EXITOSA ===
echo.
pause
goto menu
