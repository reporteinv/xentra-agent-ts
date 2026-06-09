# ============================================
# Xentra-PC-Agent v3.9
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
$EndpointPrimario = 'https://ag2.xentrasoft.com'
$EndpointRespaldo = 'https://ts.xentrasoft.com'
$AgentToken       = 'xnt_ungrd_2026'
$LogFile          = 'C:\Xentra\xentra-agent.log'
$MarcaLimpieza    = 'C:\Xentra\ultima-limpieza.txt'
$MarcaProgramas   = 'C:\Xentra\ultima-programas.txt'
$ArchivoIntervalo = 'C:\Xentra\intervalo.txt'
$ArchivoHash      = 'C:\Xentra\ultimo-hash.txt'
$BufferCSV        = 'C:\Xentra\buffer-offline.csv'
$MaxReintentos    = 5
$Version          = '3.9'

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

function Get-InfoLicenciaWindows {
    $result = @{
        win_activado      = $false
        win_licencia      = $null
        win_canal         = $null
        win_clave_parcial = $null
    }
    try {
        $slmgr = cscript.exe //NoLogo "$env:SystemRoot\System32\slmgr.vbs" /dli 2>$null
        if ($slmgr) {
            $slmgrStr = $slmgr -join "`n"
            # win_activado y win_licencia
            if ($slmgrStr -match 'License Status:\s*(.+)') {
                $statusRaw = $Matches[1].Trim()
                $result.win_licencia = $statusRaw
                $result.win_activado = ($statusRaw -like '*Licensed*')
            }
            # win_canal (License Type)
            if ($slmgrStr -match 'License Type:\s*(.+)') {
                $tipoRaw = $Matches[1].Trim()
                if     ($tipoRaw -like '*OEM*')    { $result.win_canal = 'OEM' }
                elseif ($tipoRaw -like '*Retail*')  { $result.win_canal = 'RETAIL' }
                elseif ($tipoRaw -like '*Volume*' -and $tipoRaw -like '*KMS*') { $result.win_canal = 'KMS' }
                elseif ($tipoRaw -like '*Volume*' -and $tipoRaw -like '*MAK*') { $result.win_canal = 'MAK' }
                elseif ($tipoRaw -like '*Volume*')  { $result.win_canal = 'VOLUME' }
                else                                { $result.win_canal = $tipoRaw }
            }
            # win_clave_parcial (Partial Product Key)
            if ($slmgrStr -match 'Partial Product Key:\s*([A-Z0-9]{5})') {
                $result.win_clave_parcial = $Matches[1].Trim()
            }
        }
    } catch {}
    # Fallback win_activado via CimInstance si slmgr no respondio
    if (-not $result.win_licencia) {
        try {
            $lic = Get-CimInstance SoftwareLicensingProduct -Filter "Name like 'Windows%' and LicenseStatus=1" -ErrorAction SilentlyContinue
            $result.win_activado = [bool]$lic
        } catch {}
    }
    return $result
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

function Get-InfoDiscos {
    try {
        $logicos = Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -eq 3 }
        $resultado = @()
        foreach ($d in $logicos) {
            $letra = $d.DeviceID.Replace(':','')
            $marca = $null
            $tipo  = $null
            $bus   = $null
            try {
                $diskNum = (Get-Partition -DriveLetter $letra -ErrorAction SilentlyContinue).DiskNumber
                if ($diskNum -ne $null) {
                    $pd = Get-PhysicalDisk | Where-Object { $_.DeviceID -eq $diskNum } | Select-Object -First 1
                    if ($pd) {
                        $marca = $pd.FriendlyName
                        $tipo  = $pd.MediaType
                        $bus   = $pd.BusType
                    }
                }
            } catch {}
            $temp     = $null
            $horas    = $null
            try {
                if ($diskNum -ne $null) {
                    $rel = Get-PhysicalDisk | Where-Object { $_.DeviceID -eq $diskNum } | Get-StorageReliabilityCounter -ErrorAction SilentlyContinue
                    if ($rel.Temperature -and $rel.Temperature -gt 0) { $temp = $rel.Temperature }
                    if ($rel.PowerOnHours -and $rel.PowerOnHours -gt 0) { $horas = $rel.PowerOnHours }
                }
            } catch {}
            $resultado += @{
                letra    = $d.DeviceID
                total_gb = [math]::Round($d.Size / 1GB, 2)
                libre_gb = [math]::Round($d.FreeSpace / 1GB, 2)
                marca    = $marca
                tipo     = $tipo
                bus      = $bus
                temp     = $temp
                horas    = $horas
            }
        }
        return $resultado
    } catch { return @() }
}

function Get-InfoMonitores {
    try {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
        $pantallas = [System.Windows.Forms.Screen]::AllScreens
        $resultado = @()
        foreach ($p in $pantallas) {
            $resultado += @{
                nombre     = $p.DeviceName
                resolucion = "$($p.Bounds.Width)x$($p.Bounds.Height)"
                primario   = $p.Primary
            }
        }
        return $resultado
    } catch { return @() }
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
    # Detectar fabricante primero - evita instalar modulos innecesarios
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

function Get-InfoRam {
    try {
        $modulos = Get-CimInstance Win32_PhysicalMemory
        $resultado = @()
        $ffMap = @{8='DIMM';12='SO-DIMM';13='SO-DIMM';17='DIMM';24='DDR3';26='DDR4'}
        foreach ($m in $modulos) {
            $ff = if ($ffMap.ContainsKey([int]$m.FormFactor)) { $ffMap[[int]$m.FormFactor] } else { $null }
            $resultado += @{
                slot     = $m.BankLabel
                marca    = $m.Manufacturer
                gb       = [math]::Round($m.Capacity / 1GB, 0)
                mhz      = $m.Speed
                tipo     = $ff
            }
        }
        return $resultado
    } catch { return @() }
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
        $infoLic = Get-InfoLicenciaWindows
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
        $ipObj = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '169.*' -and $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '172.17.*' } | Select-Object -First 1
        $ip    = if ($ipObj) { $ipObj.IPAddress } else { $null }
        $ipTipo = if ($ipObj) { if ($ipObj.PrefixOrigin -eq 'Manual') { 'Estatica' } else { 'DHCP' } } else { $null }
        $ram_marca = ((Get-CimInstance Win32_PhysicalMemory | Select-Object -First 1).Manufacturer)
        return @{
            empresa_id      = [int]$EmpresaId
            serial          = $serial
            nombre_equipo   = $cs.Name
            modelo          = $cs.Model
            tipo_equipo     = Get-TipoEquipo
            usuario         = $usuario
            ip_local        = $ip
            ip_tipo         = $ipTipo
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
            win_activado    = $infoLic.win_activado
            win_licencia    = $infoLic.win_licencia
            win_canal       = $infoLic.win_canal
            win_clave_parcial = $infoLic.win_clave_parcial
            fecha_inst_so   = $os.InstallDate.ToString('yyyy-MM-dd')
            ultimo_update   = $upd
            bitlocker       = $bl
            dominio         = $cs.Domain
            office_producto = $infoO.producto
            office_version  = $infoO.version
            antivirus       = Get-Antivirus
            resolucion      = if ($vc.CurrentHorizontalResolution) { "$($vc.CurrentHorizontalResolution)x$($vc.CurrentVerticalResolution)" } else { $null }
            impresora          = (Get-CimInstance Win32_Printer | Where-Object { $_.Default -eq $true } | Select-Object -First 1).Name
            hojas_impresas_hoy = & {
                try {
                    $hoy = (Get-Date).Date
                    $ev  = Get-WinEvent -LogName "Microsoft-Windows-PrintService/Operational" -ErrorAction SilentlyContinue |
                           Where-Object { $_.Id -eq 307 -and $_.TimeCreated -ge $hoy }
                    if ($ev) { ($ev | ForEach-Object { [int]"$($_.Properties[7].Value)" } | Measure-Object -Sum).Sum }
                    else { 0 }
                } catch { 0 }
            }
            uptime_horas    = [math]::Round(((Get-Date) - $boot).TotalHours, 1)
            version_agente  = $Version
            garantia_status = $infoHP.garantia_status
            garantia_inicio = $infoHP.garantia_inicio
            garantia_fin    = $infoHP.garantia_fin
            bateria         = Get-InfoBateria
            discos          = Get-InfoDiscos
            monitores       = Get-InfoMonitores
            ram_modulos     = Get-InfoRam
        }
    } catch { Write-Log "ERROR recolectando datos: $_"; return $null }
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

function Ejecutar-Script {
    param($scriptB64)
    $tmp = "C:\Xentra\cmd_$(Get-Date -Format 'yyyyMMddHHmmss').ps1"
    try {
        $sc = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($scriptB64))
        Set-Content -Path $tmp -Value $sc -Encoding UTF8
        $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $tmp 2>&1
        return ($out | Out-String).Trim()
    } catch { return "Error: $_" }
    finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
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
        'ejecutar_script' {
            $script = if ($resp.params -is [string]) { ($resp.params | ConvertFrom-Json).script } else { $resp.params.script }
            $res.output = if ($script) { Ejecutar-Script $script } else { "Error: script no proporcionado" }
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
# A-01: Hash SHA256 para evitar envios redundantes
# ============================================
function Get-HashInventario {
    param($datos)
    # Campos estables que determinan si el hardware cambio
    $campos = @(
        $datos.serial, $datos.nombre_equipo, $datos.modelo,
        $datos.procesador, $datos.ram_gb, $datos.disco_total_gb,
        $datos.tipo_disco, $datos.marca_disco, $datos.bus_disco,
        $datos.version_windows, $datos.arquitectura,
        $datos.office_producto, $datos.office_version,
        $datos.gpu, $datos.motherboard, $datos.bios_version,
        $datos.dominio, $datos.win_activado,
        $datos.garantia_status, $datos.garantia_fin,
        $datos.tipo_equipo, $datos.mac, $datos.ip_tipo,
        $datos.win_canal, $datos.win_licencia, $datos.win_clave_parcial
    )
    $str = ($campos | ForEach-Object { if ($_ -ne $null) { $_.ToString() } else { '' } }) -join '|'
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($str)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $hash = ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join ''
    return $hash
}

function Test-InventarioCambio {
    param($hashActual)
    if (-not (Test-Path $ArchivoHash)) { return $true }
    try {
        $hashAnterior = (Get-Content $ArchivoHash -Raw).Trim()
        return ($hashActual -ne $hashAnterior)
    } catch { return $true }
}

function Set-HashInventario {
    param($hash)
    try { Set-Content -Path $ArchivoHash -Value $hash -Encoding UTF8 } catch {}
}

# ============================================
# A-02: Buffer offline CSV para FortiGuard
# ============================================
function Guardar-Buffer {
    param($datos)
    try {
        $fila = ($datos.Keys | Sort-Object | ForEach-Object {
            $v = $datos[$_]
            if ($v -eq $null) { '""' }
            else { '"' + $v.ToString().Replace('"','""') + '"' }
        }) -join ','
        if (-not (Test-Path $BufferCSV)) {
            $header = ($datos.Keys | Sort-Object) -join ','
            Set-Content -Path $BufferCSV -Value $header -Encoding UTF8
        }
        Add-Content -Path $BufferCSV -Value $fila -Encoding UTF8
        Write-Log "[BUFFER] Datos guardados offline: $BufferCSV"
    } catch { Write-Log "[BUFFER] Error guardando: $_" }
}

function Enviar-Buffer {
    if (-not (Test-Path $BufferCSV)) { return }
    try {
        $lineas = Get-Content $BufferCSV -Encoding UTF8
        if ($lineas.Count -lt 2) { Remove-Item $BufferCSV -Force -ErrorAction SilentlyContinue; return }
        Write-Log "[BUFFER] Intentando reenviar $($lineas.Count - 1) registros offline..."
        $resp = Invoke-ConFailover '/api/pc/buffer-csv' 'Post' ([System.Text.Encoding]::UTF8.GetBytes(($lineas -join "`n"))) 'text/csv' 20
        if ($resp) {
            Write-Log "[BUFFER] Reenvio exitoso. Limpiando buffer."
            Remove-Item $BufferCSV -Force -ErrorAction SilentlyContinue
        } else {
            Write-Log "[BUFFER] Servidor no respondio, buffer conservado."
        }
    } catch { Write-Log "[BUFFER] Error en reenvio: $_" }
}

# ============================================
# MAIN
# ============================================
# MIGRACION: detectar agente viejo y limpiar
# ============================================
$psActual = 'C:\Xentra\xentra-agent.ps1'
if (Test-Path $psActual) {
    $contenido = Get-Content $psActual -Raw -ErrorAction SilentlyContinue
    # El agente viejo declaraba: $VersionActual = '2.x'
    # Detectar solo si existe como asignacion real (no dentro de un regex)
    if ($contenido -match '(?m)^\s*\$VersionActual\s*=\s*[''"]') {
        Write-Log "[MIGRACION] Agente viejo detectado - recreando tareas..."
        schtasks /Delete /TN "XentraAgent"         /F 2>$null
        schtasks /Delete /TN "XentraAgentPoll"     /F 2>$null
        schtasks /Delete /TN "XentraAgentLimpieza" /F 2>$null
        schtasks /Delete /TN "XentraAgentUI"       /F 2>$null
        Remove-Item 'C:\Xentra\ultimo-hash.txt' -Force -ErrorAction SilentlyContinue
        Write-Log "[MIGRACION] Tareas eliminadas - el agente nuevo creara las correctas"
    }
}

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
    try { Enviar-Json '/api/pc/reportar' $datos 30; Write-Log "Reporte limpieza OK" } catch { Write-Log "ERROR: $_" }
    Enviar-Programas $datos.serial
    Write-Log "=== Fin LIMPIEZA ==="
    exit 0
}

# MODO NORMAL
$datos = Recolectar-Datos
if (-not $datos) { Write-Log "Error recolectando datos"; exit 1 }

# A-01: Hash SHA256 - solo reportar si el inventario cambio
$hashActual = Get-HashInventario $datos
$cambio = Test-InventarioCambio $hashActual

try {
    $resp = Invoke-ConFailover "/api/pc/comandos/$($datos.serial)" 'Get' $null $null 15
    if ($resp.hay) { Procesar-Comando $resp $datos; exit 0 }
} catch { Write-Log "Error polling: $_" }

if ($cambio) {
    # A-02: Intentar enviar; si falla, guardar en buffer
    $enviado = $false
    try {
        $r = Enviar-Json '/api/pc/reportar' $datos 20
        if ($r -ne $null) {
            Set-HashInventario $hashActual
            $enviado = $true
            Write-Log "Reporte OK - inventario cambio detectado (IP: $($datos.ip_local) | Disco: $($datos.disco_libre_gb) GB | v$Version)"
        }
    } catch {}
    if (-not $enviado) {
        Write-Log "Sin conexion - guardando en buffer offline"
        Guardar-Buffer $datos
    }
} else {
    Write-Log "Sin cambios en inventario - omitiendo reporte (hash: $($hashActual.Substring(0,8))...)"
}

# A-02: Intentar reenviar buffer si hay conexion
Enviar-Buffer
$ep = $false
if (Test-Path $MarcaProgramas) {
    if (((Get-Date) - [datetime](Get-Content $MarcaProgramas)).Days -ge 1) { $ep = $true }
} else { $ep = $true }
if ($ep) { Enviar-Programas $datos.serial }
Verificar-Tareas

# ============================================================
# SNMP + Print Log - Lectura impresoras de red
# ============================================================
function Get-InfoImpresoras {
    $Community = "public"
    $Puerto    = 161
    $TimeoutMs = 3000

    $OIDMap = @{
        Modelo      = "1.3.6.1.2.1.1.1.0"
        Serial      = "1.3.6.1.2.1.43.5.1.1.17.1"
        TotalPaginas= "1.3.6.1.2.1.43.10.2.1.4.1.1"
        TonerN1     = "1.3.6.1.2.1.43.11.1.1.9.1.1"
        TonerMax1   = "1.3.6.1.2.1.43.11.1.1.8.1.1"
        TonerColor1 = "1.3.6.1.2.1.43.12.1.1.4.1.1"
        TonerN2     = "1.3.6.1.2.1.43.11.1.1.9.1.2"
        TonerMax2   = "1.3.6.1.2.1.43.11.1.1.8.1.2"
        TonerColor2 = "1.3.6.1.2.1.43.12.1.1.4.1.2"
        TonerN3     = "1.3.6.1.2.1.43.11.1.1.9.1.3"
        TonerMax3   = "1.3.6.1.2.1.43.11.1.1.8.1.3"
        TonerColor3 = "1.3.6.1.2.1.43.12.1.1.4.1.3"
        TonerN4     = "1.3.6.1.2.1.43.11.1.1.9.1.4"
        TonerMax4   = "1.3.6.1.2.1.43.11.1.1.8.1.4"
        TonerColor4 = "1.3.6.1.2.1.43.12.1.1.4.1.4"
        PapelNivel  = "1.3.6.1.2.1.43.8.2.1.10.1.1"
        PapelMax    = "1.3.6.1.2.1.43.8.2.1.9.1.1"
        ToshBN      = "1.3.6.1.4.1.1129.2.3.50.1.3.21.6.1.2.1.3"
        ToshColor   = "1.3.6.1.4.1.1129.2.3.50.1.3.21.6.1.2.1.1"
    }

    function Encode-OID($oidStr) {
        $parts = $oidStr.TrimStart('.') -split '\.'
        $bytes = [System.Collections.Generic.List[byte]]::new()
        $bytes.Add([byte](40*[int]$parts[0]+[int]$parts[1]))
        for ($i=2;$i -lt $parts.Length;$i++) {
            $val=[int]$parts[$i]
            if ($val -lt 128) { $bytes.Add([byte]$val) }
            else {
                $tmp=[System.Collections.Generic.List[byte]]::new()
                while ($val -gt 0) { $tmp.Insert(0,[byte]($val -band 0x7F));$val=$val -shr 7 }
                for ($j=0;$j -lt $tmp.Count-1;$j++) { $bytes.Add([byte]($tmp[$j] -bor 0x80)) }
                $bytes.Add($tmp[$tmp.Count-1])
            }
        }
        return $bytes.ToArray()
    }
    function Encode-Length($len) {
        if ($len -lt 128) { return [byte[]]@($len) }
        elseif ($len -lt 256) { return [byte[]]@(0x81,$len) }
        else { return [byte[]]@(0x82,($len -shr 8) -band 0xFF,$len -band 0xFF) }
    }
    function Wrap-TLV($tag,[byte[]]$content) {
        return [byte[]](@([byte]$tag)+(Encode-Length $content.Length)+$content)
    }
    function Read-TLV-At([byte[]]$buf,[int]$pos) {
        if ($pos -ge $buf.Length) { return $null }
        $tag=$buf[$pos];$pos++
        $lb=$buf[$pos];$pos++
        if (($lb -band 0x80) -ne 0) {
            $nb=$lb -band 0x7F;$len=0
            for ($k=0;$k -lt $nb;$k++){$len=($len -shl 8) -bor $buf[$pos];$pos++}
        } else { $len=$lb }
        if ($pos+$len -gt $buf.Length) { return $null }
        [byte[]]$data=if($len -gt 0){$buf[$pos..($pos+$len-1)]}else{@()}
        return @{Tag=$tag;Data=$data;Len=$len;NextPos=$pos+$len}
    }
    function Bytes-ULong([byte[]]$b){[long]$v=0;foreach($x in $b){$v=($v -shl 8) -bor $x};return $v}
    function Bytes-Long([byte[]]$b){
        [long]$v=0;foreach($x in $b){$v=($v -shl 8) -bor $x}
        if($b.Length -gt 0 -and ($b[0] -band 0x80) -ne 0){$v=$v-([long]1 -shl ($b.Length*8))}
        return $v
    }
    function Parse-SNMP([byte[]]$r) {
        try {
            $s=Read-TLV-At $r 0;if($null -eq $s -or $s.Tag -ne 0x30){return $null}
            [byte[]]$sd=$s.Data;$p=0
            $v=Read-TLV-At $sd $p;$p=$v.NextPos
            $c=Read-TLV-At $sd $p;$p=$c.NextPos
            $pdu=Read-TLV-At $sd $p;if($null -eq $pdu -or $pdu.Tag -ne 0xA2){return $null}
            [byte[]]$pd=$pdu.Data;$p2=0
            $ri=Read-TLV-At $pd $p2;$p2=$ri.NextPos
            $es=Read-TLV-At $pd $p2;$p2=$es.NextPos
            if($es.Data.Length -gt 0 -and $es.Data[0] -ne 0){return $null}
            $ei=Read-TLV-At $pd $p2;$p2=$ei.NextPos
            $vbl=Read-TLV-At $pd $p2;if($null -eq $vbl -or $vbl.Tag -ne 0x30){return $null}
            [byte[]]$vbld=$vbl.Data
            $vb=Read-TLV-At $vbld 0;if($null -eq $vb -or $vb.Tag -ne 0x30){return $null}
            [byte[]]$vbd=$vb.Data;$p4=0
            $ot=Read-TLV-At $vbd $p4;$p4=$ot.NextPos
            $vt=Read-TLV-At $vbd $p4;if($null -eq $vt){return $null}
            switch($vt.Tag){
                0x02{return Bytes-Long  $vt.Data}
                0x04{return([System.Text.Encoding]::ASCII.GetString($vt.Data) -replace '[^\x20-\x7E]','').Trim()}
                0x05{return $null}
                0x41{return Bytes-ULong $vt.Data}
                0x42{return Bytes-ULong $vt.Data}
                0x43{return Bytes-ULong $vt.Data}
                default{return $null}
            }
        } catch {return $null}
    }
    function SNMP-Get([string]$IP,[string]$OID) {
        try {
            [byte[]]$ob=Encode-OID $OID
            [byte[]]$ot=Wrap-TLV 0x06 $ob
            [byte[]]$nt=@(0x05,0x00)
            [byte[]]$vb=Wrap-TLV 0x30 ($ot+$nt)
            [byte[]]$vbl=Wrap-TLV 0x30 $vb
            [byte[]]$ri=@(0x02,0x01,[byte](Get-Random -Min 1 -Max 127))
            [byte[]]$es=@(0x02,0x01,0x00)
            [byte[]]$ei=@(0x02,0x01,0x00)
            [byte[]]$pdu=Wrap-TLV 0xA0 ($ri+$es+$ei+$vbl)
            [byte[]]$cb=[System.Text.Encoding]::ASCII.GetBytes($Community)
            [byte[]]$ct=@([byte]0x04)+(Encode-Length $cb.Length)+$cb
            [byte[]]$vt=@(0x02,0x01,0x01)
            [byte[]]$msg=Wrap-TLV 0x30 ($vt+$ct+$pdu)
            $udp=New-Object System.Net.Sockets.UdpClient
            $udp.Client.ReceiveTimeout=$TimeoutMs
            $udp.Connect($IP,$Puerto)
            [void]$udp.Send($msg,$msg.Length)
            $rem=New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any,0)
            [byte[]]$resp=$udp.Receive([ref]$rem)
            $udp.Close()
            if($null -eq $resp -or $resp.Length -eq 0){return $null}
            return Parse-SNMP $resp
        } catch {return $null}
    }

    $ips=[System.Collections.Generic.List[hashtable]]::new()
    try {
        $puertos=Get-PrinterPort -ErrorAction SilentlyContinue |
                 Where-Object{$_.PrinterHostAddress -match '^\d+\.\d+\.\d+\.\d+'}
        foreach($p in $puertos){
            $nom=(Get-Printer -ErrorAction SilentlyContinue |
                  Where-Object{$_.PortName -eq $p.Name}|Select-Object -First 1).Name
            $ips.Add(@{IP=$p.PrinterHostAddress;Nombre=if($nom){$nom}else{$p.Name}})
        }
    } catch {}
    if($ips.Count -eq 0){
        try {
            Get-WmiObject Win32_Printer -ErrorAction SilentlyContinue |
            Where-Object{$_.PortName -match '^\d+\.\d+\.\d+\.\d+'} |
            ForEach-Object{$ips.Add(@{IP=$_.PortName;Nombre=$_.Name})}
        } catch {}
    }
    $vistas=@{};$unicas=@()
    foreach($i in $ips){if(-not $vistas[$i.IP]){$vistas[$i.IP]=$true;$unicas+=$i}}

    $resultados=@()
    foreach($imp in $unicas){
        $IP=$imp.IP
        $ping=Test-Connection -ComputerName $IP -Count 1 -Quiet -ErrorAction SilentlyContinue
        if(-not $ping){continue}
        $modelo=SNMP-Get $IP $OIDMap.Modelo
        $serial=SNMP-Get $IP $OIDMap.Serial
        $total =SNMP-Get $IP $OIDMap.TotalPaginas
        $bn    =SNMP-Get $IP $OIDMap.ToshBN
        $color =SNMP-Get $IP $OIDMap.ToshColor
        $papN  =SNMP-Get $IP $OIDMap.PapelNivel
        $papM  =SNMP-Get $IP $OIDMap.PapelMax
        $marca="Desconocida"
        if($modelo -match "TOSHIBA")        {$marca="Toshiba"}
        elseif($modelo -match "HP|Hewlett") {$marca="HP"}
        elseif($modelo -match "XEROX")      {$marca="Xerox"}
        elseif($modelo -match "EPSON")      {$marca="Epson"}
        elseif($modelo -match "BROTHER")    {$marca="Brother"}
        elseif($modelo -match "CANON")      {$marca="Canon"}
        elseif($modelo -match "RICOH")      {$marca="Ricoh"}
        elseif($modelo -match "KYOCERA")    {$marca="Kyocera"}
        $toners=@()
        foreach($i in 1..4){
            $n=SNMP-Get $IP $OIDMap["TonerN$i"]
            $m=SNMP-Get $IP $OIDMap["TonerMax$i"]
            $c=SNMP-Get $IP $OIDMap["TonerColor$i"]
            if($null -ne $n -and $null -ne $m -and [long]$m -gt 0){
                $toners+=@{color=$c;nivel=$n;maximo=$m;pct=[math]::Round(([long]$n/[long]$m)*100,1)}
            }
        }
        $resultados+=@{
            ip=$IP;nombre_win=$imp.Nombre;marca=$marca;modelo=$modelo
            serial=$serial;total_paginas=$total;paginas_bn=$bn;paginas_color=$color
            papel_nivel=$papN;papel_max=$papM;toner=$toners
            timestamp=(Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')
        }
    }
    return $resultados
}

function Get-TrabajosImpresion {
    $marcaPath='C:\Xentra\ultima-impresion.txt'
    try {
        wevtutil set-log "Microsoft-Windows-PrintService/Operational" /enabled:true 2>$null
        $desde=$null
        if(Test-Path $marcaPath){
            try{$desde=[datetime](Get-Content $marcaPath -Raw).Trim()}catch{}
        }
        $eventos=Get-WinEvent -LogName "Microsoft-Windows-PrintService/Operational" -ErrorAction SilentlyContinue |
                 Where-Object{$_.Id -eq 307}
        if($null -ne $desde){
            $eventos=$eventos|Where-Object{$_.TimeCreated -gt $desde}
        } else {
            $ayer=(Get-Date).AddHours(-24)
            $eventos=$eventos|Where-Object{$_.TimeCreated -gt $ayer}
        }
        if($null -eq $eventos -or @($eventos).Count -eq 0){return @()}
        $trabajos=@($eventos)|ForEach-Object{
            @{
                fecha    =$_.TimeCreated.ToString('yyyy-MM-ddTHH:mm:ss')
                usuario  ="$($_.Properties[2].Value)"
                impresora="$($_.Properties[4].Value)"
                paginas  =[int]"$($_.Properties[7].Value)"
                documento="$($_.Properties[1].Value)"
            }
        }
        Set-Content -Path $marcaPath -Value (Get-Date).ToString('o') -Encoding UTF8
        return $trabajos
    } catch {return @()}
}


# Reporte SNMP impresoras
try {
    $impresoras = Get-InfoImpresoras
    $trabajos   = Get-TrabajosImpresion
    if ($impresoras.Count -gt 0 -or $trabajos.Count -gt 0) {
        $payload = @{
            serial     = $datos.serial
            empresa_id = [int]$EmpresaId
            impresoras = $impresoras
            trabajos   = $trabajos
            timestamp  = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')
        }
        Enviar-Json '/api/impresora/snmp-reporte' $payload 20
        Write-Log "SNMP: $($impresoras.Count) impresora(s), $($trabajos.Count) trabajo(s) enviados"
    } else {
        Write-Log "SNMP: Sin impresoras de red detectadas"
    }
} catch { Write-Log "SNMP Error: $_" }

Write-Log "Ciclo normal OK v$Version (intervalo: ${IntervaloMin}min)"
