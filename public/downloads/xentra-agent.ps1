# ============================================
# Xentra-Agent v2.4
# Modo: POLL (cada 10min) | LIMPIEZA (diaria hora random)
# Programas: 1 vez al dia
# ============================================

param([switch]$Limpiar)

$ErrorActionPreference = 'SilentlyContinue'

# Ignorar errores SSL en equipos con certificados desactualizados
add-type @"
    using System.Net;
    using System.Security.Cryptography.X509Certificates;
    public class TrustAllCertsPolicy : ICertificatePolicy {
        public bool CheckValidationResult(
            ServicePoint srvPoint, X509Certificate certificate,
            WebRequest request, int certificateProblem) {
            return true;
        }
    }
"@
[System.Net.ServicePointManager]::CertificatePolicy = New-Object TrustAllCertsPolicy
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$EndpointBase       = 'https://agent.xentrasoft.com'
$AgentToken         = '202c4b46a4f2f3b184cc2019cdd8d6cd37773d84922bfd1580f6270c9c436e39'
$LogFile            = 'C:\Xentra\xentra-agent.log'
$MarcaArchivo       = 'C:\Xentra\ultima-limpieza.txt'
$MarcaProgramas     = 'C:\Xentra\ultima-programas.txt'
$MaxReintentos      = 5

function Write-Log {
    param($msg)
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Add-Content -Path $LogFile -Value $line
}

function Rotar-Log {
    if (-not (Test-Path $LogFile)) { return }
    $archivo = Get-Item $LogFile
    if (((Get-Date) - $archivo.CreationTime).Days -ge 30) {
        Remove-Item $LogFile -Force -ErrorAction SilentlyContinue
        Write-Log "=== Log rotado (30 dias) ==="
    }
}

function Invoke-ConReintentos {
    param($uri, $method, $body, $contentType, $timeout)
    $intento = 0
    while ($intento -lt $MaxReintentos) {
        try {
            $params = @{
                Uri        = $uri
                Method     = $method
                Headers    = @{ 'X-Agent-Token' = $AgentToken }
                TimeoutSec = $timeout
            }
            if ($body)        { $params.Body        = $body }
            if ($contentType) { $params.ContentType = $contentType }
            return Invoke-RestMethod @params
        } catch {
            $intento++
            if ($intento -lt $MaxReintentos) {
                Write-Log "Reintento $intento/$MaxReintentos para $uri"
                Start-Sleep -Seconds (3 * $intento)
            } else {
                throw $_
            }
        }
    }
}

function Enviar-Programas {
    param($serial)
    try {
        $programas = Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
            Where-Object { $_.DisplayName -ne $null } |
            Select-Object @{N='nombre';E={$_.DisplayName}},
                          @{N='version';E={$_.DisplayVersion}},
                          @{N='fabricante';E={$_.Publisher}}
        $programas64 = Get-ItemProperty 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
            Where-Object { $_.DisplayName -ne $null } |
            Select-Object @{N='nombre';E={$_.DisplayName}},
                          @{N='version';E={$_.DisplayVersion}},
                          @{N='fabricante';E={$_.Publisher}}
        $todos = @($programas) + @($programas64) | Sort-Object nombre -Unique
        $payloadProgramas = @{ serial = $serial; programas = $todos } | ConvertTo-Json -Depth 3
        $bytesPayload = [System.Text.Encoding]::UTF8.GetBytes($payloadProgramas)
        Invoke-ConReintentos "$EndpointBase/api/programas" 'Post' $bytesPayload 'application/json; charset=utf-8' 30
        Set-Content -Path $MarcaProgramas -Value (Get-Date).ToString('o')
        Write-Log "Programas enviados: $($todos.Count)"
    } catch { Write-Log "Error enviando programas: $_" }
}

function Ejecutar-Limpieza {
    $disco      = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
    $libreAntes = [math]::Round($disco.FreeSpace / 1GB, 2)
    $totalGB    = [math]::Round($disco.Size / 1GB, 2)
    Write-Log "Disco antes: $libreAntes GB / $totalGB GB"
    $rutas = @(
        "$env:TEMP\*",
        "$env:WINDIR\Temp\*",
        "$env:WINDIR\Prefetch\*",
        "$env:LOCALAPPDATA\Temp\*",
        "C:\Users\*\AppData\Local\Temp\*",
        "$env:WINDIR\SoftwareDistribution\Download\*"
    )
    foreach ($ruta in $rutas) {
        Remove-Item -Path $ruta -Recurse -Force -ErrorAction SilentlyContinue
        Write-Log "Limpiado: $ruta"
    }
    try { Clear-RecycleBin -Force -ErrorAction SilentlyContinue; Write-Log "Papelera vaciada" } catch {}
    Write-Log "Aplicando politicas de grupo..."
    Start-Process "gpupdate" -ArgumentList "/force" -Wait -NoNewWindow -ErrorAction SilentlyContinue
    Write-Log "Politicas de grupo aplicadas"
    Start-Sleep -Seconds 2
    $discoPost    = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
    $libreDespues = [math]::Round($discoPost.FreeSpace / 1GB, 2)
    $mbLiberados  = [math]::Round(($libreDespues - $libreAntes) * 1024, 2)
    if ($mbLiberados -lt 0) { $mbLiberados = 0 }
    Write-Log "Disco despues: $libreDespues GB | Liberados: $mbLiberados MB"
    return @{ libre = $libreDespues; total = $totalGB; liberado = $mbLiberados }
}

if (Test-Path 'C:\Xentra') { attrib +h 'C:\Xentra' 2>$null }
Rotar-Log

try {
    $serial       = (Get-CimInstance Win32_BIOS).SerialNumber.Trim()
    $nombreEquipo = $env:COMPUTERNAME
    $usuario      = (Get-CimInstance Win32_ComputerSystem).UserName
    if (-not $usuario) { $usuario = $env:USERNAME }
    if ($usuario -match '\$$') { $usuario = '' }
    $modelo       = (Get-CimInstance Win32_ComputerSystem).Model
    $ramGB        = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
    $procesador   = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name.Trim()
    $verWindows   = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').DisplayVersion
    if (-not $verWindows) { $verWindows = (Get-CimInstance Win32_OperatingSystem).Version }
    $disco        = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
    $discoLibreGB = [math]::Round($disco.FreeSpace / 1GB, 2)
    $discoTotalGB = [math]::Round($disco.Size / 1GB, 2)
    $ipLocal      = (Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp,Manual |
                     Where-Object { $_.IPAddress -notlike '169.*' -and $_.IPAddress -ne '127.0.0.1' } |
                     Select-Object -First 1).IPAddress
} catch {
    Write-Log "ERROR recolectando datos: $_"
    exit 1
}

if ($Limpiar) {
    Write-Log "=== Inicio modo LIMPIEZA ==="
    $hoyLimpiar = $false
    if (Test-Path $MarcaArchivo) {
        $ultimaFecha = [datetime](Get-Content $MarcaArchivo)
        $diasDesde   = ((Get-Date) - $ultimaFecha).Days
        if ($diasDesde -ge 3) { $hoyLimpiar = $true }
    } else {
        $hoyLimpiar = $true
    }
    if (-not $hoyLimpiar) {
        Write-Log "Limpieza omitida - aun no han pasado 3 dias"
        exit 0
    }
    Write-Log "Equipo: $nombreEquipo | Serial: $serial | IP: $ipLocal | Usuario: $usuario"
    $resultado = Ejecutar-Limpieza
    Set-Content -Path $MarcaArchivo -Value (Get-Date).ToString('o')
    $payloadCompleto = @{
        serial              = $serial
        nombre_equipo       = $nombreEquipo
        modelo              = $modelo
        usuario             = $usuario
        ip_local            = $ipLocal
        espacio_libre_gb    = $resultado.libre
        espacio_total_gb    = $resultado.total
        mb_liberados_ultima = $resultado.liberado
        ultima_limpieza     = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
        ram_gb              = $ramGB
        procesador          = $procesador
        version_windows     = $verWindows
    } | ConvertTo-Json
    try {
        $response = Invoke-ConReintentos "$EndpointBase/api/reportar" 'Post' $payloadCompleto 'application/json' 30
        Write-Log "Reporte completo OK: $($response.mensaje)"
    } catch { Write-Log "ERROR reporte completo: $_" }
    Enviar-Programas $serial
    Write-Log "=== Fin modo LIMPIEZA ==="
    exit 0
}

try {
    $resp = Invoke-ConReintentos "$EndpointBase/api/comandos/$serial" 'Get' $null $null 15
    if ($resp.hay) {
        Write-Log "=== Comando remoto: $($resp.comando) (id=$($resp.id)) ==="
        $resultado = Ejecutar-Limpieza
        $payloadCmd = @{
            id               = $resp.id
            estado           = 'completado'
            mb_liberados     = $resultado.liberado
            espacio_libre_gb = $resultado.libre
        } | ConvertTo-Json
        Invoke-ConReintentos "$EndpointBase/api/comandos/resultado" 'Post' $payloadCmd 'application/json' 15
        Write-Log "Resultado comando enviado OK"
        exit 0
    }
} catch { Write-Log "Error polling: $_" }

$payloadRapido = @{
    serial           = $serial
    nombre_equipo    = $nombreEquipo
    modelo           = $modelo
    usuario          = $usuario
    ip_local         = $ipLocal
    espacio_libre_gb = $discoLibreGB
    espacio_total_gb = $discoTotalGB
    ram_gb           = $ramGB
    procesador       = $procesador
    version_windows  = $verWindows
} | ConvertTo-Json

try {
    Invoke-ConReintentos "$EndpointBase/api/reportar" 'Post' $payloadRapido 'application/json' 20
    Write-Log "Reporte rapido OK (IP: $ipLocal | Disco: $discoLibreGB GB)"
} catch { Write-Log "ERROR reporte rapido: $_" }

$enviarProgramas = $false
if (Test-Path $MarcaProgramas) {
    $ultimaFechaProg = [datetime](Get-Content $MarcaProgramas)
    if (((Get-Date) - $ultimaFechaProg).Days -ge 1) { $enviarProgramas = $true }
} else {
    $enviarProgramas = $true
}
if ($enviarProgramas) { Enviar-Programas $serial }

$tareaMain = schtasks /Query /TN "XentraAgent" /FO LIST 2>$null
if (-not $tareaMain) {
    Write-Log "ALERTA: Recreando tarea XentraAgent..."
    $cmdArgs = @('/Create','/TN','XentraAgent',
        '/TR','powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Xentra\xentra-agent.ps1',
        '/SC','MINUTE','/MO','10','/RU','SYSTEM','/RL','HIGHEST','/F')
    Start-Process schtasks -ArgumentList $cmdArgs -Wait -NoNewWindow
    Write-Log "Tarea XentraAgent recreada"
}

$tareaLimpieza = schtasks /Query /TN "XentraAgentLimpieza" /FO LIST 2>$null
if (-not $tareaLimpieza) {
    Write-Log "ALERTA: Recreando tarea XentraAgentLimpieza..."
    $hora   = Get-Random -Minimum 1 -Maximum 5
    $minuto = Get-Random -Minimum 0 -Maximum 59
    $horaST = '{0:D2}:{1:D2}' -f $hora, $minuto
    $cmdArgs2 = @('/Create','/TN','XentraAgentLimpieza',
        '/TR','powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Xentra\xentra-agent.ps1 -Limpiar',
        '/SC','DAILY','/ST',$horaST,'/RU','SYSTEM','/RL','HIGHEST','/F')
    Start-Process schtasks -ArgumentList $cmdArgs2 -Wait -NoNewWindow
    Write-Log "Tarea XentraAgentLimpieza recreada a las $horaST"
}

Write-Log "Ciclo normal OK"
