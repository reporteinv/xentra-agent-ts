@echo off
chcp 65001 >nul

:: Auto-elevar permisos ??? fuerza ventana CMD elevada
fltMC >nul 2>&1
if %errorlevel% neq 0 (
    powershell -Command "Start-Process cmd -ArgumentList '/c cd /d ""%~dp0"" && ""%~f0""' -Verb RunAs -WorkingDirectory '%~dp0'"
    exit /b
)

:: Guardar ruta DESPUES de elevar (ya somos admin)
set "SRCDIR=%~dp0"
cd /d "%SRCDIR%"

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
if "%OPCION%"=="4" goto salir
goto menu

:crear_lanzadores
echo  Creando lanzadores...
echo @echo off > "C:\Xentra\run.bat"
echo powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Xentra\xentra-agent.ps1" >> "C:\Xentra\run.bat"
echo @echo off > "C:\Xentra\run-poll.bat"
echo powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Xentra\xentra-agent.ps1" -Poll >> "C:\Xentra\run-poll.bat"
echo @echo off > "C:\Xentra\run-limpieza.bat"
echo powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Xentra\xentra-agent.ps1" -Limpiar >> "C:\Xentra\run-limpieza.bat"
goto :eof

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
call :crear_lanzadores
echo  [1/5] OK
echo.
echo  [2/5] Creando tareas programadas...
schtasks /Delete /TN "XentraAgentUI" /F > nul 2>&1
schtasks /Create /TN "XentraAgent"     /TR "C:\Xentra\run.bat"          /SC MINUTE /MO 20 /RU SYSTEM /RL HIGHEST /F > nul 2>&1
schtasks /Create /TN "XentraAgentPoll" /TR "C:\Xentra\run-poll.bat"     /SC MINUTE /MO 1  /RU SYSTEM /RL HIGHEST /F > nul 2>&1
echo  [2/5] OK
echo.
echo  [3/5] Calculando hora de limpieza...
for /f %%H in ('powershell -Command "Get-Random -Minimum 1 -Maximum 5"') do set HORA=%%H
for /f %%M in ('powershell -Command "Get-Random -Minimum 0 -Maximum 59"') do set MIN=%%M
set HORA_ST=0%HORA%:%MIN%
if %HORA% GEQ 10 set HORA_ST=%HORA%:%MIN%
if %MIN% LSS 10 set HORA_ST=0%HORA%:0%MIN%
if %HORA% GEQ 10 if %MIN% LSS 10 set HORA_ST=%HORA%:0%MIN%
schtasks /Create /TN "XentraAgentLimpieza" /TR "C:\Xentra\run-limpieza.bat" /SC DAILY /ST %HORA_ST% /RU SYSTEM /RL HIGHEST /F > nul 2>&1
echo  [3/5] OK - Limpieza diaria: %HORA_ST%
echo.
echo  [4/5] Ejecutando agente inicial...
powershell -Command "Start-Process 'C:\Xentra\run.bat' -WindowStyle Hidden"
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
goto salir

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
call :crear_lanzadores
echo  [1/5] OK
echo.
echo  [2/5] Actualizando tareas programadas...
schtasks /Delete /TN "XentraAgentUI" /F > nul 2>&1
schtasks /Create /TN "XentraAgent"     /TR "C:\Xentra\run.bat"          /SC MINUTE /MO 20 /RU SYSTEM /RL HIGHEST /F > nul 2>&1
schtasks /Create /TN "XentraAgentPoll" /TR "C:\Xentra\run-poll.bat"     /SC MINUTE /MO 1  /RU SYSTEM /RL HIGHEST /F > nul 2>&1
echo  [2/5] OK
echo.
echo  [3/5] Calculando hora de limpieza...
for /f %%H in ('powershell -Command "Get-Random -Minimum 1 -Maximum 5"') do set HORA=%%H
for /f %%M in ('powershell -Command "Get-Random -Minimum 0 -Maximum 59"') do set MIN=%%M
set HORA_ST=0%HORA%:%MIN%
if %HORA% GEQ 10 set HORA_ST=%HORA%:%MIN%
if %MIN% LSS 10 set HORA_ST=0%HORA%:0%MIN%
if %HORA% GEQ 10 if %MIN% LSS 10 set HORA_ST=%HORA%:0%MIN%
schtasks /Create /TN "XentraAgentLimpieza" /TR "C:\Xentra\run-limpieza.bat" /SC DAILY /ST %HORA_ST% /RU SYSTEM /RL HIGHEST /F > nul 2>&1
echo  [3/5] OK - Limpieza diaria: %HORA_ST%
echo.
echo  [4/5] Ejecutando agente...
powershell -Command "Start-Process 'C:\Xentra\run.bat' -WindowStyle Hidden"
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
goto salir

:desinstalar
cls
echo.
echo  Desinstalando...
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
goto salir

:salir
exit
