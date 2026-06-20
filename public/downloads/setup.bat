@echo off
chcp 65001 >nul

:: Auto-elevar permisos
fltMC >nul 2>&1
if %errorlevel% neq 0 (
    powershell -Command "Start-Process cmd -ArgumentList '/c cd /d ""%~dp0"" && ""%~f0""' -Verb RunAs -WorkingDirectory '%~dp0'"
    exit /b
)

set "SRCDIR=%~dp0"
cd /d "%SRCDIR%"

:menu
cls
echo.
echo  ========================================
echo          XENTRASOFT SETUP v4.7.0
echo  ========================================
echo.
echo   1. Instalar
echo   2. Desinstalar
echo   3. Salir
echo.
echo  ========================================
echo.
set /p OPCION= Seleccione una opcion (1-3): 

if "%OPCION%"=="1" goto instalar
if "%OPCION%"=="2" goto desinstalar
if "%OPCION%"=="3" goto salir
goto menu

:instalar
cls
echo.
echo  ========================================
echo          XENTRASOFT SETUP v4.7.0
echo  ========================================
echo.
echo  [1/5] Limpiando instalacion previa...
schtasks /Delete /TN "XentraAgent"        /F >nul 2>&1
schtasks /Delete /TN "XentraAgentPoll"    /F >nul 2>&1
schtasks /Delete /TN "XentraAgentLogin"   /F >nul 2>&1
schtasks /Delete /TN "XentraAgentStartup" /F >nul 2>&1
schtasks /Delete /TN "XentraAgentLimpieza" /F >nul 2>&1
attrib -h "C:\Xentra" >nul 2>&1
if exist "C:\Xentra" rmdir /S /Q "C:\Xentra" >nul 2>&1
echo  [1/5] OK
echo.
echo  [2/5] Descargando agente...
mkdir "C:\Xentra" >nul 2>&1
powershell -Command "Invoke-WebRequest -Uri 'https://ag2.xentrasoft.com/downloads/xentra-agent.exe' -OutFile 'C:\Xentra\xentra-agent.exe' -UseBasicParsing"
if not exist "C:\Xentra\xentra-agent.exe" (
    echo  ERROR: No se pudo descargar el agente.
    echo  Verifique la conexion a Internet.
    pause
    goto salir
)
attrib +h "C:\Xentra" >nul 2>&1
echo  [2/5] OK
echo.
echo  [3/5] Registrando tareas programadas...
"C:\Xentra\xentra-agent.exe" --instalar
echo  [3/5] OK
echo.
echo  [4/5] Ejecutando primer reporte...
start "" /B "C:\Xentra\xentra-agent.exe"
echo  [4/5] OK
echo.
echo  [5/5] Listo.
echo.
echo  ========================================
echo   === Instalacion EXITOSA ===
echo   Agente: v4.7.0
echo   Reporte: cada 20 min
echo   Poll:    cada 1 min
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
powershell -Command "try { Invoke-RestMethod -Uri 'https://ag2.xentrasoft.com/api/pc/pcs/%SERIAL%' -Method Delete -Headers @{'X-Agent-Token'='xnt_ungrd_2026'} -TimeoutSec 10 } catch {}" >nul 2>&1
schtasks /Delete /TN "XentraAgent"        /F >nul 2>&1
schtasks /Delete /TN "XentraAgentPoll"    /F >nul 2>&1
schtasks /Delete /TN "XentraAgentLogin"   /F >nul 2>&1
schtasks /Delete /TN "XentraAgentStartup" /F >nul 2>&1
schtasks /Delete /TN "XentraAgentLimpieza" /F >nul 2>&1
attrib -h "C:\Xentra" >nul 2>&1
rmdir /S /Q "C:\Xentra" >nul 2>&1
cls
echo.
echo  === Desinstalacion EXITOSA ===
echo.
timeout /t 3 /nobreak >nul
goto salir

:salir
exit
