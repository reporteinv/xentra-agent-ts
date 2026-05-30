# ============================================
# Xentra-PC-Agent v3.3
# Xentrasoft - Agente universal por cliente
# ============================================

param([switch]$Limpiar, [switch]$Poll)

$ErrorActionPreference = 'SilentlyContinue'

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

$EmpresaId        = '26'
$EndpointPrimario = 'https://ts.xentrasoft.com'
$EndpointRespaldo = 'https://app.xentrasoft.com'
$EndpointAg2      = 'https://ag2.xentrasoft.com'
$AgentToken       = 'xnt_473ab41349459abb698a1cc0eae6e212'
$LogFile          = 'C:\Xentra\xentra-agent.log'
$MarcaLimpieza    = 'C:\Xentra\ultima-limpieza.txt'
$MarcaProgramas   = 'C:\Xentra\ultima-programas.txt'
$ArchivoIntervalo = 'C:\Xentra\intervalo.txt'
$MaxReintentos    = 5
$Version          = '3.3'

$IntervaloMin = 20
if (Test-Path $ArchivoIntervalo) {
    try {
        $v = [int](Get-Content $ArchivoIntervalo -Raw).Trim()
        if ($v -in @(10,20,30)) { $IntervaloMin = $v }
    } catch {}
}

function Write-Log {
    param($msg)
    try {
        $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
        Add-Content -Path $LogFile -Value $line -ErrorAction Stop
    } catch {}
}

function RotarLog {
    try {
        if (-not (Test-Path $LogFile)) { return }
        $archivo   = Get-Item $LogFile
        $porDias   = (((Get-Date) - $archivo.CreationTime).Days -ge 30)
        $porTamano = ($archivo.Length -gt 5MB)
        if ($porDias -or $porTamano) {
            $razon = if ($porTamano) { "tamano $([math]::Round($archivo.Length/1MB,1))MB" } else { "30 dias" }
            Remove-Item $LogFile -Force -ErrorAction SilentlyContinue
            Write-Log "=== Log rotado ($razon) ==="
        }
    } catch {}
}

function Invoke-Api {
    param($url, $method, $body, $contentType, $timeout)
    $params = @{
        Uri        = $url
        Method     = $method
        Headers    = @{ 'X-Agent-Token' = $AgentToken; 'User-Agent' = "XentraAgent/$Version" }
        TimeoutSec = $timeout
    }
    if ($body)        { $params.Body        = $body }
    if ($contentType) { $params.ContentType = $contentType }
    return Invoke-RestMethod @params
}

function Invoke-ConReintentos {
    param($url, $method, $body, $contentType, $timeout)
    $intento = 0
    while ($intento -lt $MaxReintentos) {
        try {
            return Invoke-Api $url $method $body $contentType $timeout
        } catch {
            $intento++
            if ($intento -lt $MaxReintentos) {
                Write-Log "Reintento $intento/$MaxReintentos para $url"
                Start-Sleep -Seconds (3 * $intento)
            } else { throw $_ }
        }
    }
}

function Invoke-ConFailover {
    param($path, $method, $body, $contentType, $timeout)
    try {
        return Invoke-ConReintentos "$EndpointPrimario$path" $method $body $contentType $timeout
    } catch {
        Write-Log "Primario fallo, intentando respaldo..."
        return Invoke-ConReintentos "$EndpointRespaldo$path" $method $body $contentType $timeout
    }
}

function Enviar-Json {
    param($path, $objeto, $timeout)
    $json = $objeto | ConvertTo-Json -Depth 3
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    return Invoke-ConFailover $path 'Post' $bytes 'application/json' $timeout
}

function Get-TipoEquipo {
    try {
        $chassis = (Get-CimInstance Win32_SystemEnclosure).ChassisTypes | Select-Object -First 1
        $laptops = @(8,9,10,11,12,14,18,21)
        if ($laptops -contains $chassis) { return 'Laptop' } else { return 'Desktop' }
    } catch { return 'Desconocido' }
}

function Get-InfoRed {
    try {
        $adaptadores = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' }
        $wifi  = $adaptadores | Where-Object { $_.PhysicalMediaType -like '*802.11*' } | Select-Object -First 1
        $cable = $adaptadores | Where-Object { $_.PhysicalMediaType -like '*802.3*' -and $_.InterfaceDescription -notlike '*VirtualBox*' -and $_.InterfaceDescription -notlike '*Loopback*' } | Select-Object -First 1
        $activo = if ($cable) { $cable } elseif ($wifi) { $wifi } else { $adaptadores | Select-Object -First 1 }
        return @{
            mac       = if ($activo) { $activo.MacAddress } else { $null }
            adaptador = if ($activo) { $activo.InterfaceDescription } else { $null }
            velocidad = if ($activo) { "$($activo.LinkSpeed)" } else { $null }
            tipo_red  = if ($wifi -and -not $cable) { 'WiFi' } elseif ($cable) { 'Cable' } else { 'Desconocido' }
        }
    } catch { return @{ mac=$null; adaptador=$null; velocidad=$null; tipo_red=$null } }
}

function Get-InfoOffice {
    try {
        $c2r = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Office\ClickToRun\Configuration' -ErrorAction SilentlyContinue
        if ($c2r) { return @{ producto=$c2r.ProductReleaseIds; version=$c2r.VersionToReport } }
        $msi = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Office\*\*\Registration' -ErrorAction SilentlyContinue | Where-Object { $_.ProductName } | Select-Object -First 1
        if ($msi) { return @{ producto=$msi.ProductName; version=$msi.Version } }
    } catch {}
    return @{ producto=$null; version=$null }
}

function Get-WinActivado {
    try {
        $lic = Get-CimInstance SoftwareLicensingProduct -Filter "Name like 'Windows%' and LicenseStatus=1" -ErrorAction SilentlyContinue
        return [bool]$lic
    } catch { return $false }
}

function Get-InfoDiscoC {
    try {
        $partNum = (Get-Partition -DriveLetter C -ErrorAction SilentlyContinue).DiskNumber
        $disco = Get-PhysicalDisk | Where-Object { $_.DeviceID -eq $partNum } | Select-Object -First 1
        if ($disco) {
            $smart = $null
            try { $smart = $disco | Get-StorageReliabilityCounter -ErrorAction SilentlyContinue } catch {}
            return @{
                tipo     = $disco.MediaType
                marca    = $disco.FriendlyName
                bus      = $disco.BusType
                salud    = $disco.HealthStatus
                temp     = if ($smart) { $smart.Temperature } else { $null }
                desgaste = if ($smart) { $smart.Wear } else { $null }
            }
        }
    } catch {}
    return @{ tipo=$null; marca=$null; bus=$null; salud=$null; temp=$null; desgaste=$null }
}

function Get-CpuTemp {
    try {
        $temps = Get-WmiObject MSAcpi_ThermalZoneTemperature -Namespace root/wmi -ErrorAction SilentlyContinue |
                 ForEach-Object { [math]::Round($_.CurrentTemperature/10 - 273.15, 1) } |
                 Measure-Object -Maximum
        return $temps.Maximum
    } catch { return $null }
}
function Get-Antivirus {
    try {
        $av = Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction SilentlyContinue
        return ($av | ForEach-Object { $_.displayName }) -join ', '
    } catch { return $null }
}

function Get-InfoBateria {
    try {
        $bat1 = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $bat1) { return $null }
        $batSt = Get-CimInstance -Namespace root/wmi -ClassName BatteryStatus -ErrorAction SilentlyContinue | Select-Object -First 1
        $batFull = Get-CimInstance -Namespace root/wmi -ClassName BatteryFullChargedCapacity -ErrorAction SilentlyContinue | Select-Object -First 1
        $fulCap = if ($batFull) { $batFull.FullChargedCapacity } else { $null }
        $disCap = $null
        try {
            $tmpXml = "C:\Xentra\bat_tmp.xml"
            powercfg /batteryreport /output $tmpXml /xml 2>$null | Out-Null
            if (Test-Path $tmpXml) {
                $xb = [xml](Get-Content $tmpXml)
                $disCap = [int]$xb.BatteryReport.Batteries.Battery.DesignCapacity
                Remove-Item $tmpXml -Force -ErrorAction SilentlyContinue
            }
        } catch {}
        $deg = if ($disCap -and $fulCap -and $disCap -gt 0) { [math]::Round((1 - $fulCap/$disCap)*100, 1) } else { $null }
        return @{
            carga_pct            = $bat1.EstimatedChargeRemaining
            cargando             = if ($batSt) { [bool]$batSt.Charging } else { $null }
            conectado_corriente  = if ($batSt) { [bool]$batSt.PowerOnline } else { $null }
            capacidad_diseno_mwh = $disCap
            capacidad_actual_mwh = $fulCap
            degradacion_pct      = $deg
        }
    } catch { return $null }
}


# ============================================================
# GARANTIA POR FABRICANTE
# Agregar nuevos fabricantes aqui segun se vayan integrando
# ============================================================

function Get-GarantiaHP {
    try {
        if (-not (Get-Module -ListAvailable -Name HP.ClientManagement -ErrorAction SilentlyContinue)) {
            Write-Log "[HP] Instalando HPCMSL..."
            $nuget = Get-PackageProvider -Name NuGet -ErrorAction SilentlyContinue
            if (-not $nuget -or $nuget.Version -lt [Version]"2.8.5") {
                Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5 -Force -ErrorAction SilentlyContinue | Out-Null
            }
            $psget = Get-Module -ListAvailable -Name PowerShellGet | Sort-Object Version -Descending | Select-Object -First 1
            if (-not $psget -or $psget.Version -lt [Version]"2.2.5") {
                Install-Module -Name PowerShellGet -Force -AllowClobber -ErrorAction SilentlyContinue | Out-Null
            }
            Install-Module -Name HPCMSL -Force -AcceptLicense -ErrorAction SilentlyContinue | Out-Null
        }
        Import-Module HP.ClientManagement -ErrorAction SilentlyContinue
        if (-not (Get-Command Get-HPWarrantyInfo -ErrorAction SilentlyContinue)) { return $null }
        $w      = Get-HPWarrantyInfo
        $inicio = if ($w.WarrantyStartDate) { ([datetime]$w.WarrantyStartDate).ToString('yyyy-MM-dd') } else { $null }
        $fin    = if ($w.WarrantyEndDate)   { ([datetime]$w.WarrantyEndDate).ToString('yyyy-MM-dd')   } else { $null }
        $estado = if ($w.Status) { $w.Status } else { $null }
        Write-Log "[HP] Garantia: $estado | Fin: $fin"
        return @{ garantia_status=$estado; garantia_inicio=$inicio; garantia_fin=$fin }
    } catch { Write-Log "[HP] Error: $_"; return $null }
}

# LENOVO - pendiente de implementar
# function Get-GarantiaLenovo {
#     TODO: usar Lenovo Warranty API
#     https://pcsupport.lenovo.com/us/en/warrantylookup
#     return @{ garantia_status=$null; garantia_inicio=$null; garantia_fin=$null }
# }

# DELL - pendiente de implementar
# function Get-GarantiaDell {
#     TODO: usar Dell Warranty API (requiere API key en TechDirect)
#     https://developer.dell.com/apis/5702/versions/1.0.0/docs/
#     return @{ garantia_status=$null; garantia_inicio=$null; garantia_fin=$null }
# }

function Get-HPGarantia {
    # Detectar fabricante primero — evita instalar modulos innecesarios
    $fab = (Get-CimInstance Win32_ComputerSystem).Manufacturer
    Write-Log "[GARANTIA] Fabricante detectado: $fab"

    if ($fab -like '*HP*' -or $fab -like '*Hewlett*') {
        $r = Get-GarantiaHP
        if ($r) { return $r }
    }
    # elseif ($fab -like '*Lenovo*') { return Get-GarantiaLenovo }
    # elseif ($fab -like '*Dell*')   { return Get-GarantiaDell   }

    Write-Log "[GARANTIA] Fabricante sin soporte de garantia: $fab"
    return @{ garantia_status=$null; garantia_inicio=$null; garantia_fin=$null }
}

function Recolectar-Datos {
    try {
        $serial  = (Get-CimInstance Win32_BIOS).SerialNumber.Trim()
        $cs      = Get-CimInstance Win32_ComputerSystem
        $os      = Get-CimInstance Win32_OperatingSystem
        $infoRed = Get-InfoRed
        $infoD   = Get-InfoDiscoC
        $infoO   = Get-InfoOffice
        $infoHP  = Get-HPGarantia
        $disco   = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
        $bb      = Get-CimInstance Win32_BaseBoard
        $bios    = Get-CimInstance Win32_BIOS
        $vc      = Get-CimInstance Win32_VideoController | Select-Object -First 1
        $boot    = $os.LastBootUpTime
        $usuario = $cs.UserName
        if (-not $usuario) { $usuario = $env:USERNAME }
        if ($usuario -match '\$') { $usuario = '' }
        $verWin  = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').DisplayVersion
        if (-not $verWin) { $verWin = $os.Version }
        $upd = $null
        try {
            $hu = Get-HotFix | Where-Object { $_.InstalledOn } | Sort-Object InstalledOn -Descending | Select-Object -First 1
            if ($hu) { $upd = $hu.InstalledOn.ToString('yyyy-MM-dd') }
        } catch {}
        $bl = $null
        try { $bv = Get-BitLockerVolume -MountPoint C: -ErrorAction SilentlyContinue; $bl = ($bv.ProtectionStatus -eq 'On') } catch {}
        $ip = (Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp,Manual | Where-Object { $_.IPAddress -notlike '169.*' -and $_.IPAddress -ne '127.0.0.1' } | Select-Object -First 1).IPAddress
        $ram_marca = ((Get-CimInstance Win32_PhysicalMemory | Select-Object -First 1).Manufacturer)
        return @{
            empresa_id      = [int]$EmpresaId
            serial          = $serial
            nombre_equipo   = $cs.Name
            modelo          = $cs.Model
            tipo_equipo     = Get-TipoEquipo
            usuario         = $usuario
            ip_local        = $ip
            mac             = $infoRed.mac
            tipo_red        = $infoRed.tipo_red
            adaptador_red   = $infoRed.adaptador
            velocidad_red   = $infoRed.velocidad
            ram_gb          = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
            ram_libre_gb    = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
            marca_ram       = $ram_marca
            procesador      = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name.Trim()
            gpu             = $vc.Name
            motherboard     = "$($bb.Manufacturer) $($bb.Product)".Trim()
            bios_version    = $bios.SMBIOSBIOSVersion
            disco_total_gb  = [math]::Round($disco.Size / 1GB, 2)
            disco_libre_gb  = [math]::Round($disco.FreeSpace / 1GB, 2)
            tipo_disco      = $infoD.tipo
            marca_disco     = $infoD.marca
            bus_disco       = $infoD.bus
            disco_salud     = $infoD.salud
            disco_temp      = $infoD.temp
            disco_desgaste  = $infoD.desgaste
            cpu_temp        = Get-CpuTemp
            version_windows = $verWin
            arquitectura    = $os.OSArchitecture
            win_activado    = Get-WinActivado
            fecha_inst_so   = $os.InstallDate.ToString('yyyy-MM-dd')
            ultimo_update   = $upd
            bitlocker       = $bl
            dominio         = $cs.Domain
            office_producto = $infoO.producto
            office_version  = $infoO.version
            antivirus       = Get-Antivirus
            resolucion      = if ($vc.CurrentHorizontalResolution) { "$($vc.CurrentHorizontalResolution)x$($vc.CurrentVerticalResolution)" } else { $null }
            impresora       = (Get-CimInstance Win32_Printer | Where-Object { $_.Default -eq $true } | Select-Object -First 1).Name
            uptime_horas    = [math]::Round(((Get-Date) - $boot).TotalHours, 1)
            version_agente  = $Version
            garantia_status = $infoHP.garantia_status
            garantia_inicio = $infoHP.garantia_inicio
            garantia_fin    = $infoHP.garantia_fin
            bateria         = Get-InfoBateria
        }
    } catch { Write-Log "ERROR recolectando datos: $_"; return $null }
}


function Enviar-Json-Ambos {
    param($path, $objeto, $timeout)
    $json  = $objeto | ConvertTo-Json -Depth 3
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    # Enviar a ts (principal)
    try {
        Invoke-ConReintentos "$EndpointPrimario$path" 'Post' $bytes 'application/json' $timeout | Out-Null
        Write-Log "Reporte OK → ts"
    } catch { Write-Log "ERROR ts: $_" }
    # Enviar a ag2 (paralelo)
    try {
        Invoke-ConReintentos "$EndpointAg2$path" 'Post' $bytes 'application/json' $timeout | Out-Null
        Write-Log "Reporte OK → ag2"
    } catch { Write-Log "ERROR ag2: $_" }
}

function Ejecutar-Limpieza {
    $disco      = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
    $libreAntes = [math]::Round($disco.FreeSpace / 1GB, 2)
    $totalGB    = [math]::Round($disco.Size / 1GB, 2)
    Write-Log "Disco antes: $libreAntes GB / $totalGB GB"
    $rutas = @("$env:TEMP\*","$env:WINDIR\Temp\*","$env:WINDIR\Prefetch\*","$env:LOCALAPPDATA\Temp\*","C:\Users\*\AppData\Local\Temp\*","$env:WINDIR\SoftwareDistribution\Download\*")
    foreach ($ruta in $rutas) { Remove-Item -Path $ruta -Recurse -Force -ErrorAction SilentlyContinue }
    try { Clear-RecycleBin -Force -ErrorAction SilentlyContinue } catch {}
    Start-Process "gpupdate" -ArgumentList "/force" -Wait -NoNewWindow -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    $dp   = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
    $libD = [math]::Round($dp.FreeSpace / 1GB, 2)
    $mbL  = [math]::Round(($libD - $libreAntes) * 1024, 2)
    if ($mbL -lt 0) { $mbL = 0 }
    Write-Log "Disco despues: $libD GB | Liberados: $mbL MB"
    return @{ libre=$libD; total=$totalGB; liberado=$mbL }
}

function Enviar-Programas {
    param($serial)
    try {
        $p32 = Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | Select-Object @{N='nombre';E={$_.DisplayName}},@{N='version';E={$_.DisplayVersion}},@{N='fabricante';E={$_.Publisher}},@{N='fecha_instalacion';E={$_.InstallDate}}
        $p64 = Get-ItemProperty 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | Select-Object @{N='nombre';E={$_.DisplayName}},@{N='version';E={$_.DisplayVersion}},@{N='fabricante';E={$_.Publisher}},@{N='fecha_instalacion';E={$_.InstallDate}}
        $todos = @($p32) + @($p64) | Sort-Object nombre -Unique
        Enviar-Json '/api/pc/programas' @{ serial=$serial; empresa_id=[int]$EmpresaId; programas=$todos } 30
        Set-Content -Path $MarcaProgramas -Value (Get-Date).ToString('o')
        Write-Log "Programas enviados: $($todos.Count)"
    } catch { Write-Log "Error enviando programas: $_" }
}



function Actualizar-Agente {
    try {
        Write-Log "Iniciando auto-actualizacion..."
        $serialActual = (Get-CimInstance Win32_BIOS).SerialNumber.Trim()
        $nv = Invoke-ConFailover "/api/pc/agente/ps1?serial=$serialActual" 'Get' $null $null 30
        if ($nv -and $nv.Length -gt 100) {
            $nv = $nv -replace '26', $EmpresaId
            $tmp = 'C:\Xentra\xentra-agent-nuevo.ps1'
            Set-Content -Path $tmp -Value $nv -Encoding UTF8
            Copy-Item $tmp 'C:\Xentra\xentra-agent.ps1' -Force
            Remove-Item $tmp -Force -ErrorAction SilentlyContinue
            $nuevaVer = (Select-String -Path 'C:\Xentra\xentra-agent.ps1' -Pattern "Version\s*=\s*'([^']+)'").Matches[0].Groups[1].Value
            $fecha = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
            Write-Log "Agente actualizado a v$nuevaVer"
            return "Actualizado OK - v$nuevaVer ($fecha)"
        }
        return "Error: respuesta invalida"
    } catch { Write-Log "Error actualizando: $_"; return "Error: $_" }
}

function Mostrar-Mensaje {
    param($texto, $titulo)
    try {
        msg.exe * /time:30 "$titulo - $texto" 2>$null
        return "Mensaje enviado"
    } catch { return "Error: $_" }
}

function Cambiar-Intervalo {
    param([int]$nuevoMin)
    if ($nuevoMin -notin @(10,20,30)) { return "Error: valor invalido. Use 10, 20 o 30" }
    try {
        Set-Content -Path $ArchivoIntervalo -Value $nuevoMin -Encoding UTF8
        $script:IntervaloMin = $nuevoMin
        Start-Process schtasks -ArgumentList @(
            '/Create','/TN','XentraAgent',
            '/TR','powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Xentra\xentra-agent.ps1',
            '/SC','MINUTE','/MO',"$nuevoMin",
            '/RU','SYSTEM','/RL','HIGHEST','/F'
        ) -Wait -NoNewWindow -ErrorAction Stop
        Write-Log "Intervalo cambiado a $nuevoMin min"
        return "Intervalo actualizado a $nuevoMin minutos"
    } catch { Write-Log "Error cambiando intervalo: $_"; return "Error: $_" }
}

function Procesar-Comando {
    param($resp, $datos)
    $res = @{ id=$resp.id; estado='completado'; output=$null }
    Write-Log "=== Comando: $($resp.comando) (id=$($resp.id)) ==="
    switch ($resp.comando) {
        'limpiar' {
            $r = Ejecutar-Limpieza
            $res.mb_liberados = $r.liberado; $res.espacio_libre_gb = $r.libre
            $res.output = "Liberados: $($r.liberado) MB"
        }
        'reiniciar' {
            $res.output = "Reiniciando..."
            try { Enviar-Json '/api/pc/comandos/resultado' $res 15 } catch {}
            Start-Sleep -Seconds 3; Restart-Computer -Force; return
        }
        'apagar' {
            $res.output = "Apagando..."
            try { Enviar-Json '/api/pc/comandos/resultado' $res 15 } catch {}
            Start-Sleep -Seconds 3; Stop-Computer -Force; return
        }
        'bloquear' { rundll32.exe user32.dll,LockWorkStation; $res.output = "Pantalla bloqueada" }
        'mensaje' {
            $txt = if ($resp.params.texto)  { $resp.params.texto }  else { 'Mensaje del administrador' }
            $tit = if ($resp.params.titulo) { $resp.params.titulo } else { 'Xentrasoft' }
            $res.output = Mostrar-Mensaje $txt $tit
        }
        'cerrar_sesion' {
            $res.output = "Cerrando sesion..."
            try { Enviar-Json '/api/pc/comandos/resultado' $res 15 } catch {}
            Start-Sleep -Seconds 2
            logoff
            return
        }
        'actualizar_agente' {
            $res.output = Actualizar-Agente
            try { Enviar-Json '/api/pc/comandos/resultado' $res 15 } catch {}
            Write-Log "Resultado: $($res.output)"
            exit 0
        }
        'cambiar_intervalo' {
            $min = if ($resp.params.minutos) { [int]$resp.params.minutos } else { 0 }
            $res.output = Cambiar-Intervalo $min
        }
        'inventario_ahora'  { Enviar-Programas $datos.serial; $res.output = "Inventario enviado" }
        'reporte_ahora'     { Enviar-Json '/api/pc/reportar' $datos 20; $res.output = "Reporte enviado" }
        default { $res.estado = 'error'; $res.output = "Comando desconocido: $($resp.comando)" }
    }
    try { Enviar-Json '/api/pc/comandos/resultado' $res 15 } catch { Write-Log "Error enviando resultado: $_" }
    Write-Log "Resultado: $($res.output)"
}

function Verificar-Tareas {
    $t1 = schtasks /Query /TN "XentraAgent" /FO LIST 2>$null
    if (-not $t1) {
        Write-Log "Recreando tarea XentraAgent..."
        Start-Process schtasks -ArgumentList @('/Create','/TN','XentraAgent','/TR','powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Xentra\xentra-agent.ps1','/SC','MINUTE','/MO',"$IntervaloMin",'/RU','SYSTEM','/RL','HIGHEST','/F') -Wait -NoNewWindow
    }
    $t2 = schtasks /Query /TN "XentraAgentLimpieza" /FO LIST 2>$null
    if (-not $t2) {
        Write-Log "Recreando tarea XentraAgentLimpieza..."
        $h = Get-Random -Minimum 1 -Maximum 5; $m = Get-Random -Minimum 0 -Maximum 59
        $hST = '{0:D2}:{1:D2}' -f $h, $m
        Start-Process schtasks -ArgumentList @('/Create','/TN','XentraAgentLimpieza','/TR','powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Xentra\xentra-agent.ps1 -Limpiar','/SC','DAILY','/ST',$hST,'/RU','SYSTEM','/RL','HIGHEST','/F') -Wait -NoNewWindow
    }
    $t3 = schtasks /Query /TN "XentraAgentPoll" /FO LIST 2>$null
    if (-not $t3) {
        Write-Log "Recreando tarea XentraAgentPoll..."
        schtasks /Delete /TN "XentraAgentPoll" /F 2>$null
        schtasks /Create /TN "XentraAgentPoll" /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Xentra\xentra-agent.ps1 -Poll" /SC MINUTE /MO 1 /RU SYSTEM /RL HIGHEST /F 2>$null
        $xml = [xml](schtasks /Query /TN "XentraAgentPoll" /XML)
        $xml.Task.Settings.DisallowStartIfOnBatteries = "false"
        $xml.Task.Settings.StopIfGoingOnBatteries = "false"
        $xmlPath = "C:\Xentra\poll.xml"
        $xml.Save($xmlPath)
        schtasks /Delete /TN "XentraAgentPoll" /F 2>$null
        schtasks /Create /TN "XentraAgentPoll" /XML $xmlPath /F 2>$null
        Remove-Item $xmlPath -Force -ErrorAction SilentlyContinue
        Write-Log "Tarea XentraAgentPoll recreada sin restriccion bateria"
    }
}


# ============================================
# MONITOR RED / DHCP FIX
# ============================================
function Monitor-Red {
    try {
        # Solo ethernet fisico activo
        $adaptador = Get-NetAdapter -Physical | Where-Object {
            $_.MediaType -eq '802.3' -and $_.Status -eq 'Up'
        } | Select-Object -First 1
        if (-not $adaptador) { return }

        $ip = Get-NetIPAddress -InterfaceIndex $adaptador.InterfaceIndex `
              -AddressFamily IPv4 -ErrorAction SilentlyContinue |
              Where-Object { $_.IPAddress -notlike '169.254.*' }

        if (-not $ip) {
            Write-Log "[RED] Sin IP valida en $($adaptador.Name) - Renovando DHCP..."
            ipconfig /release "$($adaptador.Name)" | Out-Null
            Start-Sleep -Seconds 3
            ipconfig /renew "$($adaptador.Name)" | Out-Null
            $ipNueva = (Get-NetIPAddress -InterfaceIndex $adaptador.InterfaceIndex `
                -AddressFamily IPv4 -ErrorAction SilentlyContinue |
                Where-Object { $_.IPAddress -notlike '169.254.*' }).IPAddress
            $ipNueva = if ($ipNueva) { $ipNueva } else { 'sin-ip' }
            Write-Log "[RED] Nueva IP: $ipNueva"
            # Enviar evento al servidor
            try {
                $serial = (Get-CimInstance Win32_BIOS).SerialNumber.Trim()
                Enviar-Json '/api/pc/evento-red' @{
                    serial      = $serial
                    adaptador   = $adaptador.Name
                    tipo        = 'dhcp_fallo'
                    ip_anterior = '169.254.x.x'
                    ip_nueva    = $ipNueva
                    detalle     = 'DHCP renovado automaticamente por agente'
                } 10
                Write-Log "[RED] Evento enviado al servidor"
            } catch { Write-Log "[RED] Error enviando evento: $_" }
        }
    } catch { Write-Log "[RED] Error monitor: $_" }
}

# ============================================
# MAIN
# ============================================
if (Test-Path 'C:\Xentra') { attrib +h 'C:\Xentra' 2>$null }
RotarLog

schtasks /Delete /TN "XentraAgentUI" /F 2>$null

# MODO POLL
if ($Poll) {
    Write-Log "[POLL] Iniciando..."
    try {
        $serialPoll = (Get-CimInstance Win32_BIOS).SerialNumber.Trim()
        Write-Log "[POLL] Serial: $serialPoll"
        $resp = Invoke-ConFailover "/api/pc/comandos/$serialPoll" 'Get' $null $null 15
        if ($resp.hay) {
            Write-Log "[POLL] Comando: $($resp.comando)"
            $dp = @{ serial=$serialPoll; empresa_id=[int]$EmpresaId; disco_libre_gb=0; disco_total_gb=0 }
            Procesar-Comando $resp $dp
        } else {
            Write-Log "[POLL] Sin comandos pendientes"
        }
    } catch { Write-Log "[POLL] Error: $_" }
    Monitor-Red
    Verificar-Tareas
    Write-Log "[POLL] Fin"
    exit 0
}

# MODO LIMPIEZA
if ($Limpiar) {
    Write-Log "=== Inicio LIMPIEZA ==="
    # Validar uptime: no ejecutar si el sistema lleva menos de 30 min encendido
    $uptime = (Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
    if ($uptime.TotalMinutes -lt 30) {
        Write-Log "Limpieza omitida: sistema recien encendido ($([int]$uptime.TotalMinutes) min uptime)"
        exit 0
    }
    $hoy = $false
    if (Test-Path $MarcaLimpieza) {
        if (((Get-Date) - [datetime](Get-Content $MarcaLimpieza)).Days -ge 3) { $hoy = $true }
    } else { $hoy = $true }
    if (-not $hoy) { Write-Log "Limpieza omitida"; exit 0 }
    $datos = Recolectar-Datos
    if (-not $datos) { Write-Log "Error recolectando datos"; exit 1 }
    $r = Ejecutar-Limpieza
    Set-Content -Path $MarcaLimpieza -Value (Get-Date).ToString('o')
    $datos.mb_liberados_ultima = $r.liberado
    $datos.ultima_limpieza     = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    $datos.disco_libre_gb      = $r.libre
    $datos.disco_total_gb      = $r.total
    Enviar-Json-Ambos '/api/pc/reportar' $datos 30
    Write-Log "Reporte limpieza OK"
    Enviar-Programas $datos.serial
    Write-Log "=== Fin LIMPIEZA ==="
    exit 0
}

# MODO NORMAL
$datos = Recolectar-Datos
if (-not $datos) { Write-Log "Error recolectando datos"; exit 1 }
try {
    $resp = Invoke-ConFailover "/api/pc/comandos/$($datos.serial)" 'Get' $null $null 15
    if ($resp.hay) { Procesar-Comando $resp $datos; exit 0 }
} catch { Write-Log "Error polling: $_" }
try {
    Enviar-Json-Ambos '/api/pc/reportar' $datos 20
    Write-Log "Reporte rapido OK (IP: $($datos.ip_local) | Disco: $($datos.disco_libre_gb) GB | v$Version)"
} catch { Write-Log "ERROR reporte rapido: $_" }
$ep = $false
if (Test-Path $MarcaProgramas) {
    if (((Get-Date) - [datetime](Get-Content $MarcaProgramas)).Days -ge 1) { $ep = $true }
} else { $ep = $true }
if ($ep) { Enviar-Programas $datos.serial }
Verificar-Tareas
Write-Log "Ciclo normal OK v$Version (intervalo: ${IntervaloMin}min)"
