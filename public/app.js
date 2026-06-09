let coloresPc = {};
const _colMapPc = {red:'#e74c3c', yellow:'#f39c12', green:'#27ae60', blue:'#3498db'};

async function cargarColoresPc() {
  try {
    const r = await fetch('/api/pcs/colores');
    coloresPc = await r.json();
  } catch(e) { coloresPc = {}; }
}

let pcsData = [];

async function cargarPcs() {
  try {
    const res = await fetch('/api/pcs');
    pcsData = await res.json();
    document.getElementById('totalPcs').textContent = pcsData.length;
    renderTabla(pcsData);
  } catch (err) {
    console.error(err);
  }
}

let paginaActual = 1;

let sortCol = "ultimo_reporte";
let sortDir = "desc";

function sortData(data) {
  return [...data].sort((a, b) => {
    let va = a[sortCol], vb = b[sortCol];
    if (sortCol === "mb_liberados_ultima" || sortCol === "espacio_libre_gb") { va = parseFloat(va) || 0; vb = parseFloat(vb) || 0; }
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "string") va = va.toLowerCase();
    if (typeof vb === "string") vb = vb.toLowerCase();
    if (va < vb) return sortDir === "asc" ? -1 : 1;
    if (va > vb) return sortDir === "asc" ? 1 : -1;
    return 0;
  });
}

function setSort(col) {
  if (sortCol === col) {
    sortDir = sortDir === "asc" ? "desc" : "asc";
  } else {
    sortCol = col;
    sortDir = "asc";
  }
  renderTabla(pcsData);
}

function renderTabla(data) {
  data = sortData(data);
  const tbody = document.getElementById('tablaPcs');
  const porPagina = parseInt(document.getElementById('porPagina').value);

  // Paginación
  const total = data.length;
  const inicio = porPagina === 0 ? 0 : (paginaActual - 1) * porPagina;
  const fin = porPagina === 0 ? total : Math.min(inicio + porPagina, total);
  const pagData = porPagina === 0 ? data : data.slice(inicio, fin);

  if (!pagData.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:2rem;color:#999">Sin PCs registrados</td></tr>';
    renderPaginacion(0, 0, 0);
    return;
  }

  tbody.innerHTML = pagData.map(pc => `
    <tr data-id="${pc.id}">
      <td><span class="badge ${pc.estado} pc-estado">${pc.estado}</span></td>
      <td><span style="width:9px;height:9px;border-radius:50%;display:inline-block;margin-right:5px;vertical-align:middle;background:${coloresPc[pc.id] ? _colMapPc[coloresPc[pc.id]] : 'transparent'}"></span><code style="cursor:pointer; color:#3498db;" onclick="verHistorial(${pc.id}, '${pc.serial}')">${pc.serial}</code></td>
      <td>${pc.modelo_oficial || pc.modelo || '-'}</td>
      <td>${pc.usuario ? pc.usuario.split('\\').pop() : '-'}</td>
      <td>${pc.ip_local || '-'}</td>
      <td>${pc.disco_libre_gb ? `
      <div style="font-size:0.8rem;color:#555;margin-bottom:3px">
      ${Math.round(pc.disco_libre_gb)} GB libres de ${Math.round(pc.disco_total_gb)} GB
      </div>
      <div style="background:#eee;border-radius:4px;height:8px;width:100%">
      <div style="background:${Math.round((pc.disco_libre_gb/pc.disco_total_gb)*100) < 20 ? '#e74c3c' : Math.round((pc.disco_libre_gb/pc.disco_total_gb)*100) < 40 ? '#f39c12' : '#27ae60'};
                height:8px;border-radius:4px;
                width:${Math.round((pc.disco_libre_gb/pc.disco_total_gb)*100)}%">
      </div>
      </div>
      <div style="font-size:0.75rem;color:#888;margin-top:2px">
       ${Math.round((pc.disco_libre_gb/pc.disco_total_gb)*100)}% libre
      </div>` : '-'}</td>
	<td>${formatFecha(pc.ultimo_reporte)}</td>
      <td>${pc.mb_liberados_ultima != null ? (pc.mb_liberados_ultima / 1024).toFixed(1) + ' GB' : '-'}</td>
      <td style='text-align:center;vertical-align:middle'><div class="config-dropdown" style="position:relative;display:inline-block">
        <button class="btn-config" style="display:block;margin:auto" onclick="toggleConfig(this, event)">⚙️</button>
        <div class="config-menu" style="display:none;position:absolute;right:0;bottom:110%;background:var(--menu-bg,white);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.2);min-width:180px;z-index:500;overflow:hidden;border:1px solid var(--menu-border,#eee);">
          <div class="cmenu-header">⚙️ ${pc.serial}</div>
<a href="#" onclick="forzarLimpieza(${pc.id},'${pc.nombre_equipo}',this);cerrarConfigs();return false;" class="cmenu-item">⚡ Forzar limpieza</a>
          <a href="#" onclick="verDetalles(${pc.id});cerrarConfigs();return false;" class="cmenu-item">🖥️ Detalles</a>
          <a href="#" onclick="verProgramas('${pc.serial}','${pc.nombre_equipo}');cerrarConfigs();return false;" class="cmenu-item">📋 Programas</a>
          <a href="#" onclick="verRed('${pc.serial}','${pc.nombre_equipo}');cerrarConfigs();return false;" class="cmenu-item">📡 Red</a>
          <a href="#" onclick="eliminarPC('${pc.serial}','${pc.nombre_equipo}');cerrarConfigs();return false;" class="cmenu-item cmenu-danger">🗑️ Eliminar PC</a>
        </div>
      </div></td>
    </tr>      
  `).join('');

  renderPaginacion(total, inicio + 1, fin);
  aplicarColumnas();
}

function renderPaginacion(total, desde, hasta) {
  let el = document.getElementById('paginacion');
  if (!el) {
    el = document.createElement('div');
    el.id = 'paginacion';
    el.style.cssText = 'padding:1rem 0;display:flex;gap:0.5rem;align-items:center;font-size:0.9rem;color:#555';
    document.querySelector('main').appendChild(el);
  }

  const porPagina = parseInt(document.getElementById('porPagina').value);
  if (porPagina === 0 || total === 0) { el.innerHTML = ''; return; }

  const totalPags = Math.ceil(total / porPagina);
  el.innerHTML = `
    <span>Mostrando ${desde}–${hasta} de ${total}</span>
    <button onclick="irPagina(${paginaActual - 1})" ${paginaActual === 1 ? 'disabled' : ''}>‹ Anterior</button>
    <span>Página ${paginaActual} de ${totalPags}</span>
    <button onclick="irPagina(${paginaActual + 1})" ${paginaActual === totalPags ? 'disabled' : ''}>Siguiente ›</button>
  `;
}

function irPagina(n) {
  const porPagina = parseInt(document.getElementById('porPagina').value);
  const totalPags = Math.ceil(pcsData.length / porPagina);
  if (n < 1 || n > totalPags) return;
  paginaActual = n;
  renderTabla(pcsData);
}

function cambiarPagina() {
  paginaActual = 1;
  renderTabla(pcsData);
}


function formatFecha(f) {
  if (!f) return '-';
  const d = new Date(f);
  return d.toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
}

document.getElementById('buscar').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase().trim();
  if (!q) { renderTabla(pcsData); return; }
  const filtrados = pcsData.filter(pc =>
    pc.nombre_equipo?.toLowerCase().includes(q) ||
    pc.serial?.toLowerCase().includes(q) ||
    pc.usuario?.toLowerCase().includes(q)
  );
  renderTabla(filtrados);
});

cargarColoresPc().then(() => cargarPcs());
setInterval(cargarPcs, 60000);


// Dropdown de exportar
function toggleDropdown() {
  document.getElementById('exportMenu').classList.toggle('open');
}

// Cerrar si se hace clic fuera
document.addEventListener('click', (e) => {
  if (!e.target.closest('.dropdown')) {
    document.getElementById('exportMenu')?.classList.remove('open');
  }
});
setInterval(() => location.reload(), 600000);

// Forzar limpieza desde el panel
async function forzarLimpieza(pc_id, nombre, btn) {
  if (!confirm(`¿Forzar limpieza en ${nombre}?\n\nEl PC ejecutará la limpieza en los próximos 30 minutos.`)) return;

  btn.disabled = true;
  btn.textContent = '⏳';

  try {
    const res = await fetch('/api/comandos/crear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pc_id: parseInt(pc_id), comando: 'limpiar' })
    });
    const data = await res.json();
    if (data.ok) {
      btn.textContent = '✅';
      btn.title = 'Comando enviado — esperando PC';
      setTimeout(() => { btn.textContent = '⚡'; btn.disabled = false; }, 5000);
    } else {
      btn.textContent = '❌';
      btn.disabled = false;
    }
  } catch (err) {
    btn.textContent = '❌';
    btn.disabled = false;
  }
}

// Modal historial
// Modal historial
let _historialPcId = null;
async function verHistorial(pc_id, serial) {
  _historialPcId = pc_id;
  document.getElementById('modalTitulo').textContent = `Historial — ${serial}`;
  document.getElementById('modalHistorial').style.display = 'flex';
  document.getElementById('tablaHistorial').innerHTML = '<tr><td colspan="3" style="text-align:center;padding:1rem;color:#999">Cargando...</td></tr>';
  document.getElementById('sinHistorial').style.display = 'none';

  try {
    const res = await fetch(`/api/pcs/${pc_id}/historial`);
    const data = await res.json();
    const tbody = document.getElementById('tablaHistorial');

    if (!data.length) {
      tbody.innerHTML = '';
      document.getElementById('sinHistorial').style.display = 'block';
      return;
    }

    tbody.innerHTML = data.map((h, i) => `
      <tr style="background:${i % 2 === 0 ? '#f9fafb' : 'white'}">
        <td style="padding:0.6rem; text-align:center; font-size:0.85rem; border-bottom:1px solid #eee">
          ${formatFecha(h.fecha)}
        </td>
        <td style="padding:0.6rem; text-align:center; font-size:0.85rem; border-bottom:1px solid #eee; color:${parseFloat(h.mb_liberados) > 0 ? '#27ae60' : '#999'}">
          ${h.mb_liberados != null ? (h.mb_liberados / 1024).toFixed(1) + ' GB' : '-'}
        </td>
        <td style="padding:0.6rem; text-align:center; font-size:0.85rem; border-bottom:1px solid #eee">
          ${h.espacio_libre_gb ? Math.round(h.espacio_libre_gb) + ' GB' : '-'}
        </td>
      </tr>
    `).join('');
  } catch (err) {
    document.getElementById('tablaHistorial').innerHTML =
      '<tr><td colspan="3" style="text-align:center;padding:1rem;color:#e74c3c">Error cargando historial</td></tr>';
  }
}

function cerrarHistorial() {
  document.getElementById('modalHistorial').style.display = 'none';
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') cerrarHistorial();
});

// Eliminar PC del panel
async function eliminarPC(serial, nombre) {
  if (!confirm(`¿Eliminar ${nombre || serial} del panel?\n\nEsto borrará el PC y su historial permanentemente.`)) return;
  try {
    const res = await fetch(`/api/pcs/${serial}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (data.ok) {
      cargarPcs();
    } else {
      alert('Error: ' + data.error);
    }
  } catch (err) {
    alert('Error al eliminar PC');
  }
}

// ============================================
// Control USB
// ============================================
let usbSerial = null;
let usbBloqueado = 1;

async function abrirUSB(serial, nombre, bloqueado) {
  usbSerial = serial;
  usbBloqueado = parseInt(bloqueado);
  document.getElementById('usbTitulo').textContent = `USB — ${nombre || serial}`;
  document.getElementById('modalUSB').style.display = 'flex';
  // Consultar estado real en tiempo real
  try {
    const res = await fetch(`/api/pcs/${serial}/usb-estado`);
    const data = await res.json();
    if (data.usb_bloqueado !== undefined) {
      usbBloqueado = data.usb_bloqueado;
    }
  } catch(e) {}
  actualizarModalUSB();
}

function actualizarModalUSB() {
  const estado = document.getElementById('usbEstado');
  const btn    = document.getElementById('usbBtn');
  if (usbBloqueado) {
    estado.innerHTML = '🔒 <strong style="color:#e74c3c">USB Bloqueado</strong>';
    btn.textContent  = '🔓 Habilitar USB';
    btn.style.background = '#27ae60';
  } else {
    estado.innerHTML = '🔓 <strong style="color:#27ae60">USB Habilitado</strong>';
    btn.textContent  = '🔒 Bloquear USB';
    btn.style.background = '#e74c3c';
  }
}

async function toggleUSB() {
  const nuevo = usbBloqueado ? 0 : 1;
  const btn   = document.getElementById('usbBtn');
  btn.disabled = true;
  btn.textContent = 'Aplicando...';

  try {
    const res = await fetch(`/api/pcs/${usbSerial}/usb`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bloqueado: nuevo })
    });
    const data = await res.json();
    if (data.ok) {
      usbBloqueado = nuevo;
      actualizarModalUSB();
      cargarPcs();
    } else {
      alert('Error: ' + data.error);
    }
  } catch (err) {
    alert('Error al cambiar estado USB');
  }
  btn.disabled = false;
}

function cerrarUSB() {
  document.getElementById('modalUSB').style.display = 'none';
}

function toggleConfig(btn, event) {
  if (event) event.stopPropagation();
  cerrarConfigs();
  const menu = btn.nextElementSibling;
  const rect = btn.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.zIndex = '9999';
  menu.style.right = (window.innerWidth - rect.right) + 'px';
  menu.style.left = 'auto';
  const spaceBelow = window.innerHeight - rect.bottom;
  if (spaceBelow < 180) {
    menu.style.bottom = (window.innerHeight - rect.top) + 'px';
    menu.style.top = 'auto';
  } else {
    menu.style.top = rect.bottom + 'px';
    menu.style.bottom = 'auto';
  }
  menu.style.display = 'block';
  setTimeout(() => {
    document.addEventListener("click", cerrarConfigs, { once: true });
  }, 50);
}
function cerrarConfigs() {
  document.querySelectorAll('.config-menu').forEach(m => m.style.display = 'none');
}

// ============================================
// Modal Programas
// ============================================
let todosLosProgramas = [];

async function verProgramas(serial, nombre) {
  document.getElementById('programasTitulo').textContent = `📋 Programas — ${nombre || serial}`;
  document.getElementById('modalProgramas').style.display = 'flex';
  document.getElementById('tablaProgramas').innerHTML = '<tr><td colspan="3" style="text-align:center;padding:1rem;color:#999">Cargando...</td></tr>';
  document.getElementById('sinProgramas').style.display = 'none';
  document.getElementById('buscarPrograma').value = '';

  try {
    const res = await fetch(`/api/programas/${serial}`);
    const data = await res.json();
    todosLosProgramas = data;
    renderProgramas(data);
  } catch (err) {
    document.getElementById('tablaProgramas').innerHTML =
      '<tr><td colspan="3" style="text-align:center;padding:1rem;color:#e74c3c">Error cargando programas</td></tr>';
  }
}

function renderProgramas(data) {
  const tbody = document.getElementById('tablaProgramas');
  if (!data.length) {
    tbody.innerHTML = '';
    document.getElementById('sinProgramas').style.display = 'block';
    return;
  }
  tbody.innerHTML = data.map((p, i) => `
    <tr style="background:${i % 2 === 0 ? '#f9fafb' : 'white'}">
      <td style="padding:0.5rem 0.7rem; font-size:0.85rem; border-bottom:1px solid #eee">${p.nombre || '-'}</td>
      <td style="padding:0.5rem 0.7rem; font-size:0.85rem; border-bottom:1px solid #eee; color:#7f8c8d">${p.version || '-'}</td>
      <td style="padding:0.5rem 0.7rem; font-size:0.85rem; border-bottom:1px solid #eee; color:#7f8c8d">${p.fabricante || '-'}</td>
    </tr>
  `).join('');
}

function filtrarProgramas() {
  const q = document.getElementById('buscarPrograma').value.toLowerCase();
  const filtrados = todosLosProgramas.filter(p =>
    (p.nombre || '').toLowerCase().includes(q) ||
    (p.fabricante || '').toLowerCase().includes(q)
  );
  renderProgramas(filtrados);
}

function cerrarProgramas() {
  document.getElementById('modalProgramas').style.display = 'none';
}

async function verDetalles(pc_id) {
  try {
    const res = await fetch(`/api/pcs/${pc_id}`);
    const pc = await res.json();
    document.getElementById('detalleTitulo').textContent = `🖥️ ${pc.nombre_equipo || pc.serial}`;
    const modeloImg = {
      'M75q-1': '/assets/M75q-1.png',
      'HP 240 G7 Notebook PC': '/assets/Hp240G7.png',
      'P520c Workstation': '/assets/P520c.png'
    };
    const imgSrc = modeloImg[pc.modelo] || null;
    const imgHtml = imgSrc ? `<div style="text-align:center;margin-bottom:12px;"><img src="${imgSrc}" style="max-height:120px;max-width:100%;object-fit:contain;border-radius:8px;"></div>` : '';
    // Helper grid cards
    const fmtF = f => { if(!f) return '—'; const d=new Date(f); if(isNaN(d)) return f; return d.toLocaleString('es-CO'); };
    const di = (l,v) => `<div class="det-item"><div class="det-label">${l}</div><div class="det-val">${v!=null&&v!==''?v:'—'}</div></div>`;
    const _discos = pc.discos ? (() => { let d = typeof pc.discos === "string" ? JSON.parse(pc.discos) : pc.discos; return Array.isArray(d) ? d : [d]; })() : [];
    const _mods = pc.ram_modulos ? (typeof pc.ram_modulos==='string'?JSON.parse(pc.ram_modulos):pc.ram_modulos) : [];
    const _mons = pc.monitores ? (typeof pc.monitores==='string'?JSON.parse(pc.monitores):pc.monitores) : [];
    const discosHtml = _discos.map(d => { let v=d.total_gb+' GB / '+d.libre_gb+' GB libre'; if(d.marca||d.tipo||d.bus) v+='<br>'+(d.marca||'')+(d.tipo&&d.bus?' ('+d.tipo+' '+d.bus+')':''); if(d.temp) v+='<br>Temp: '+d.temp+'°C'; if(d.horas) v+=' | '+d.horas+'h uso'; return di('Disco '+d.letra,v); }).join('');
    const ramHtml = (Array.isArray(_mods)?_mods:[_mods]).map((m,i)=>di('RAM Slot '+(i+1),m.gb+'GB '+(m.marca||'')+' '+(m.tipo||'')+' '+(m.mhz?m.mhz+'MHz':''))).join('');
    const _monsArr = Array.isArray(_mons)?_mons:[_mons];
    const monHtml = _monsArr.length > 0 ? di('Monitores', _monsArr.map((m,i)=>'<div>Monitor '+(i+1)+'&nbsp;&nbsp;'+m.resolucion+'</div>').join('')) : '';
    document.getElementById('detalleContenido').innerHTML = imgHtml + `<div class="detalles-grid">
      ${di('Serial', pc.serial)}
      ${di('Equipo', pc.nombre_equipo)}
      ${di('Tipo', pc.tipo_equipo)}
      ${di('Modelo', pc.modelo)}
      ${di('Usuario', pc.usuario ? pc.usuario.split('\\').pop() : null)}
      ${di('Dominio', pc.dominio)}
      ${di('Red '+(pc.ip_tipo?'<span style="display:inline-block;padding:1px 7px;border-radius:10px;font-size:0.75rem;font-weight:600;background:'+(pc.ip_tipo==='Estatica'?'#dcfce7;color:#166534':'#dbeafe;color:#1e40af')+'">'+pc.ip_tipo+'</span>':''), 'IP: '+(pc.ip_local||'—')+(pc.mac?'<br><span style="font-size:0.8rem;color:var(--text,#2c3e50)">MAC: '+pc.mac+'</span>':''))}
      ${di('Adaptador', (pc.adaptador_red||'')+(pc.tipo_red?'<br><span style="font-size:0.8rem;color:var(--text,#2c3e50)">'+(pc.tipo_red||'')+(pc.velocidad_red?' / '+pc.velocidad_red:'')+'</span>':''))}
      ${di('RAM', 'Total: '+(pc.ram_gb||'—')+' GB'+(pc.ram_libre_gb?'  /  Libre: '+pc.ram_libre_gb+' GB':''))}
      ${ramHtml}
      ${di('CPU', pc.procesador)}
      ${di('GPU', pc.gpu)}
      ${di('Temp. CPU', pc.cpu_temp ? pc.cpu_temp+' °C' : null)}
      ${di('Motherboard', pc.motherboard)}
      ${di('BIOS', pc.bios_version)}
      ${discosHtml}
      ${monHtml}
      <div style="grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        ${di('Windows', (pc.version_windows||'—')+' &nbsp; '+(pc.win_activado!=null?(pc.win_activado?'<span style="color:#22c55e">Activado</span>':'<span style="color:#ef4444">No activado</span>'):'—')+' &nbsp; '+(pc.arquitectura||'—')+'<br><span style="font-size:0.8rem;color:#888">Canal: '+(pc.win_canal||'—')+' &nbsp;|&nbsp; Licencia: '+(pc.win_licencia||'—')+' &nbsp;|&nbsp; Clave: '+(pc.win_clave_parcial?'-'+pc.win_clave_parcial:'—')+'</span>')}
        ${di('Office', (pc.office_producto||'—')+'<br><span style="font-size:0.8rem;color:#888">'+(pc.office_version||'—')+'</span>')}
      </div>
      ${di('Antivirus', (pc.antivirus||'—')+'<br><span style="font-size:0.8rem;color:#888">Bitlocker: '+(pc.bitlocker!=null?(pc.bitlocker?'Activado':'Desactivado'):'—')+'</span>')}
      ${di('Impresora', pc.impresora)}
      ${di('Hojas mes', pc.hojas_mes != null ? pc.hojas_mes+' págs' : null)}
      ${di('Uptime', pc.uptime_horas ? pc.uptime_horas+' hrs' : null)}
      ${di('Fecha Inst. SO', fmtF(pc.fecha_inst_so))}
      ${di('Ultimo Update', fmtF(pc.ultimo_update))}
      ${di('Ultimo Reporte', fmtF(pc.ultimo_reporte))}
      ${di('Version Agente', pc.version_agente)}
      ${di('Ultima Limpieza', fmtF(pc.ultima_limpieza))}
      ${di('MB Liberados', pc.mb_liberados_ultima!=null?(pc.mb_liberados_ultima/1024).toFixed(2)+' GB':null)}
    </div>`;
    // Seccion bateria
    let batHtml = '';
    const bat = pc.bateria ? (typeof pc.bateria === 'string' ? JSON.parse(pc.bateria) : pc.bateria) : null;
    if (bat && pc.tipo_equipo === 'Laptop') {
      const cargaPct = bat.carga_pct || 0;
      const colorBarra = cargaPct >= 50 ? '#22c55e' : cargaPct >= 20 ? '#f59e0b' : '#ef4444';
      const iconCarga = bat.cargando ? '⚡' : '🔌';
      const deg = bat.degradacion_pct != null ? bat.degradacion_pct + '%' : '—';
      const colorDeg = bat.degradacion_pct >= 30 ? '#ef4444' : bat.degradacion_pct >= 15 ? '#f59e0b' : '#22c55e';
      batHtml = `
      <div style="margin-top:0;padding-top:0;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div class="det-item">
            <div class="det-label">Carga</div>
            <div class="det-val" style="display:flex;align-items:center;gap:6px;">
              <div style="width:70px;height:6px;background:#e5e7eb;border-radius:3px;overflow:hidden;">
                <div style="width:${cargaPct}%;height:100%;background:${colorBarra};border-radius:3px;"></div>
              </div>
              <span>${cargaPct}%</span> ${iconCarga}
            </div>
            <div style="margin-top:8px;">
              <span class="det-label">Conectado &nbsp;</span><span class="det-val">${bat.conectado_corriente ? '<span style="color:#22c55e;">Sí</span>' : '<span style="color:#ef4444;">No</span>'}</span>
            </div>
          </div>
          <div class="det-item">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span class="det-label">Cap. Diseño</span><span class="det-val">${bat.capacidad_diseno_mwh ? Math.round(bat.capacidad_diseno_mwh/1000) + ' Wh' : '—'}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span class="det-label">Cap. Actual</span><span class="det-val">${bat.capacidad_actual_mwh ? Math.round(bat.capacidad_actual_mwh/1000) + ' Wh' : '—'}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span class="det-label">Degradación</span><span class="det-val" style="color:${colorDeg};">${deg}</span>
            </div>
          </div>
        </div>
      </div>`;
    }

    let garantiaHtml = '';
    if (pc.modelo_oficial || pc.garantia_fin) {
      const gStatus = pc.garantia_status || 'pendiente';
      const colores = { vigente: '#22c55e', por_vencer: '#f59e0b', vencida: '#ef4444' };
      const textos = { vigente: '🟢 Vigente', por_vencer: '🟡 Por vencer', vencida: '🔴 Vencida' };
      const color = colores[gStatus] || '#9ca3af';
      const texto = textos[gStatus] || '⚪ Sin datos';
      garantiaHtml = `
        <div style="margin-top:12px;padding-top:12px;">
          <div style="font-size:11px;color:#888;font-weight:600;margin-bottom:8px;display:flex;align-items:center;gap:4px;">
            🛡️ Garantía Lenovo
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
            <tr style="border-bottom:1px solid #eee">
              <td style="padding:0.5rem;color:#666;width:45%">Marca</td>
              <td style="padding:0.5rem;font-weight:600">${pc.marca || '—'}</td>
            </tr>
            <tr style="border-bottom:1px solid #eee">
              <td style="padding:0.5rem;color:#666;width:45%">Modelo oficial</td>
              <td style="padding:0.5rem;font-weight:600">${pc.modelo_oficial || '—'}</td>
            </tr>
            <tr style="border-bottom:1px solid #eee">
              <td style="padding:0.5rem;color:#666">Inicio garantía</td>
              <td style="padding:0.5rem;font-weight:600">${pc.garantia_inicio ? pc.garantia_inicio.substring(0,10) : '—'}</td>
            </tr>
            <tr style="border-bottom:1px solid #eee">
              <td style="padding:0.5rem;color:#666">Fin garantía</td>
              <td style="padding:0.5rem;font-weight:600">${pc.garantia_fin ? pc.garantia_fin.substring(0,10) : '—'}</td>
            </tr>
            <tr>
              <td style="padding:0.5rem;color:#666">Estado</td>
              <td style="padding:0.5rem;font-weight:600;color:${color}">${texto}</td>
            </tr>
          </table>
        </div>`;
    }
    document.getElementById('detalleContenido').innerHTML += batHtml;
    document.getElementById('detalleContenido').innerHTML += garantiaHtml;

    // Color y Observacion al final
    document.getElementById('detalleContenido').innerHTML += `
      <div style="margin-top:12px;padding-top:12px;">
        <label style="font-size:12px;color:#888;font-weight:600;display:block;margin-bottom:4px;">Color</label>
        <div style="display:flex;gap:8px;margin-bottom:10px;align-items:center;">
          <span class="pc-dot" data-color="" onclick="seleccionarColorPc(this)" style="width:18px;height:18px;border-radius:50%;background:transparent;border:1px solid #aaa;cursor:pointer;display:inline-block;${!coloresPc[pc.id] ? 'outline:2px solid #3498db;' : ''}"></span>
          <span class="pc-dot" data-color="red" onclick="seleccionarColorPc(this)" style="width:18px;height:18px;border-radius:50%;background:#e74c3c;cursor:pointer;display:inline-block;${coloresPc[pc.id]==='red' ? 'outline:2px solid #fff;' : ''}"></span>
          <span class="pc-dot" data-color="yellow" onclick="seleccionarColorPc(this)" style="width:18px;height:18px;border-radius:50%;background:#f39c12;cursor:pointer;display:inline-block;${coloresPc[pc.id]==='yellow' ? 'outline:2px solid #fff;' : ''}"></span>
          <span class="pc-dot" data-color="green" onclick="seleccionarColorPc(this)" style="width:18px;height:18px;border-radius:50%;background:#27ae60;cursor:pointer;display:inline-block;${coloresPc[pc.id]==='green' ? 'outline:2px solid #fff;' : ''}"></span>
          <span class="pc-dot" data-color="blue" onclick="seleccionarColorPc(this)" style="width:18px;height:18px;border-radius:50%;background:#3498db;cursor:pointer;display:inline-block;${coloresPc[pc.id]==='blue' ? 'outline:2px solid #fff;' : ''}"></span>
          <input type="hidden" id="pc-color-sel" value="${coloresPc[pc.id] || ''}">
          <button onclick="guardarColorPc(${pc.id})" style="padding:4px 10px;background:#555;color:white;border:none;border-radius:6px;cursor:pointer;font-size:12px;">Aplicar</button>
        </div>
        <label style="font-size:12px;color:#888;font-weight:600;display:block;margin-bottom:4px;">Observación</label>
        <textarea id="detalle-obs" rows="3" style="width:100%;padding:8px;border-radius:6px;border:1px solid #ddd;font-size:13px;resize:vertical;box-sizing:border-box;">${pc.observacion || ''}</textarea>
        <button id="btn-guardar-obs" onclick="guardarObservacion(${pc.id})" style="margin-top:6px;padding:6px 14px;background:#3498db;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;">💾 Guardar</button>
      </div>
    `;

    // Seccion IP lookup
    let ipHtml = '';
    if (pc.ip_lookup_fecha) {
      if (pc.ip_publica && parseFloat(pc.ip_lat) && parseFloat(pc.ip_lng)) {
        ipHtml = `
        <div style="margin-top:12px;padding-top:12px;">
          <div style="font-size:11px;color:#888;font-weight:600;margin-bottom:8px;display:flex;align-items:center;gap:4px;">
            🌐 Red — ip.guide
            <span style="margin-left:auto;background:#E6F1FB;color:#185FA5;padding:2px 8px;border-radius:20px;font-size:11px;">Remota</span>
          </div>
          <div id="ip-map-${pc.id}" style="height:180px;border-radius:8px;overflow:hidden;margin-bottom:10px;"></div>
          <table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
            <tr style="border-bottom:1px solid #eee"><td style="padding:0.4rem;color:#666">IP pública</td><td style="padding:0.4rem;font-weight:600">${pc.ip_local}</td></tr>
            <tr style="border-bottom:1px solid #eee"><td style="padding:0.4rem;color:#666">Organización</td><td style="padding:0.4rem;font-weight:600">${pc.ip_org || '—'}</td></tr>
            <tr style="border-bottom:1px solid #eee"><td style="padding:0.4rem;color:#666">País</td><td style="padding:0.4rem;font-weight:600">${pc.ip_pais || '—'}</td></tr>
            <tr style="border-bottom:1px solid #eee"><td style="padding:0.4rem;color:#666">Ciudad</td><td style="padding:0.4rem;font-weight:600">${pc.ip_ciudad || '—'}</td></tr>
            <tr><td style="padding:0.4rem;color:#666">Zona horaria</td><td style="padding:0.4rem;font-weight:600">${pc.ip_timezone || '—'}</td></tr>
          </table>
        </div>`;
      } else if (!pc.ip_publica) {
        ipHtml = `
        <div style="margin-top:12px;padding-top:12px;">
          <div style="font-size:11px;color:#888;font-weight:600;margin-bottom:8px;">
            🌐 Red
            <span style="margin-left:8px;background:#E1F5EE;color:#0F6E56;padding:2px 8px;border-radius:20px;font-size:11px;">Corporativa</span>
          </div>
          <div style="font-size:13px;color:#666;padding:4px 0;">IP privada — red interna</div>
        </div>`;
      }
    }
    document.getElementById('detalleContenido').innerHTML += ipHtml;

    // Inicializar mapa si hay coordenadas
    if (pc.ip_publica && parseFloat(pc.ip_lat) && parseFloat(pc.ip_lng)) {
      setTimeout(() => {
        if (typeof L === 'undefined') {
          const css = document.createElement('link');
          css.rel = 'stylesheet';
          css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
          document.head.appendChild(css);
          const js = document.createElement('script');
          js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
          js.onload = () => iniciarMapa(pc);
          document.head.appendChild(js);
        } else {
          iniciarMapa(pc);
        }
      }, 300);
    }

    document.getElementById('modalDetalles').style.display = 'flex';
  } catch(e) {
    alert('Error cargando detalles');
  }
}
function seleccionarColorPc(el) {
  document.querySelectorAll('.pc-dot').forEach(d => d.style.outline = 'none');
  el.style.outline = '2px solid #fff';
  document.getElementById('pc-color-sel').value = el.dataset.color;
}

async function guardarColorPc(pcId) {
  const color = document.getElementById('pc-color-sel').value;
  try {
    await fetch('/api/pcs/' + pcId + '/color', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ color })
    });
    coloresPc[pcId] = color;
    cargarPcs();
  } catch(e) { alert('Error guardando color'); }
}

async function guardarObservacion(pcId) {
  const obs = document.getElementById('detalle-obs').value;
  try {
    const r = await fetch('/api/pcs/' + pcId + '/observacion', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ observacion: obs })
    });
    const d = await r.json();
    if (d.ok) {
      const btn = document.getElementById('btn-guardar-obs');
      if (btn) { btn.textContent = '✅ Guardado'; }
      setTimeout(() => cerrarDetalles(), 1000);
    }
  } catch(e) { alert('Error guardando'); }
}

function cerrarDetalles() {
  document.getElementById('modalDetalles').style.display = 'none';
}

function makeDraggable(modal) {
  const inner = modal.querySelector('div');
  if (!inner || inner.dataset.draggable) return;
  inner.dataset.draggable = '1';
  inner.style.cursor = 'move';
  inner.style.userSelect = 'none';
  inner.querySelectorAll('textarea, input').forEach(el => el.style.userSelect = 'text');
  let ox, oy, startX, startY, dragging = false;
  inner.addEventListener('mousedown', e => {
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'A' || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    dragging = true;
    const rect = inner.getBoundingClientRect();
    startX = e.clientX; startY = e.clientY;
    ox = rect.left; oy = rect.top;
    inner.style.position = 'fixed';
    inner.style.margin = '0';
    inner.style.left = ox + 'px';
    inner.style.top = oy + 'px';
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    inner.style.left = (ox + e.clientX - startX) + 'px';
    inner.style.top  = (oy + e.clientY - startY) + 'px';
  });
  document.addEventListener('mouseup', () => { dragging = false; });
}

function initDraggables() {
  ['modalProgramas','modalUSB','modalHistorial','modalDetalles'].forEach(id => {
    const el = document.getElementById(id);
    if (el) makeDraggable(el);
  });
}
document.addEventListener('DOMContentLoaded', initDraggables);

const colVisibles = JSON.parse(localStorage.getItem('xentra_cols') || '[true,true,true,true,true,true,true,true]');

function toggleColMenu() {
  const menu = document.getElementById('colMenu');
  menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

function sincronizarChecks() {
  const checks = document.querySelectorAll('#colMenu input[type=checkbox]');
  checks.forEach((cb, idx) => { cb.checked = colVisibles[idx]; });
}

document.addEventListener('click', function(e) {
  if (!e.target.closest('.col-toggle-wrap')) {
    const menu = document.getElementById('colMenu');
    if (menu) menu.style.display = 'none';
  }
});

function toggleCol(idx) {
  colVisibles[idx] = !colVisibles[idx];
  localStorage.setItem('xentra_cols', JSON.stringify(colVisibles));
  aplicarColumnas();
}

function aplicarColumnas() {
  const tabla = document.getElementById('tablaPcs');
  if (!tabla) return;
  const rows = tabla.closest('table').querySelectorAll('tr');
  rows.forEach(tr => {
    const cells = tr.querySelectorAll('td, th');
    colVisibles.forEach((visible, idx) => {
      if (cells[idx]) cells[idx].style.display = visible ? '' : 'none';
    });
  });
}

sincronizarChecks();

function filtrarHistorial() {
  if (_historialPcId) verHistorial(_historialPcId, document.getElementById('modalTitulo').textContent.replace('Historial — ',''));
}

function _validarFechasHistorial() {
  const hoy = new Date().toISOString().slice(0, 10);
  const desde = document.getElementById('histDesde').value;
  const hasta = document.getElementById('histHasta').value;
  if (desde && desde > hoy) { alert('La fecha Desde no puede ser futura.'); return null; }
  if (hasta && hasta > hoy) { alert('La fecha Hasta no puede ser futura.'); return null; }
  if (desde && hasta && desde > hasta) { alert('Desde no puede ser mayor que Hasta.'); return null; }
  return { desde, hasta };
}
function exportarHistorialExcel() {
  const fechas = _validarFechasHistorial();
  if (!fechas) return;
  let url = `/api/export/historial-excel?pc_id=${_historialPcId}`;
  if (fechas.desde) url += `&desde=${fechas.desde}`;
  if (fechas.hasta) url += `&hasta=${fechas.hasta}`;
  window.open(url, '_blank');
}
function exportarHistorialPDF() {
  const fechas = _validarFechasHistorial();
  if (!fechas) return;
  let url = `/api/export/historial-pdf?pc_id=${_historialPcId}`;
  if (fechas.desde) url += `&desde=${fechas.desde}`;
  if (fechas.hasta) url += `&hasta=${fechas.hasta}`;
  window.open(url, '_blank');
}

function iniciarMapa(pc) {
  const mapId = 'ip-map-' + pc.id;
  const el = document.getElementById(mapId);
  if (!el || el._leaflet_id) return;
  const lat = parseFloat(pc.ip_lat);
  const lng = parseFloat(pc.ip_lng);
  const map = L.map(mapId, { zoomControl: true, attributionControl: false })
    .setView([lat, lng], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
  L.circleMarker([lat, lng], {
    radius: 10,
    fillColor: '#378ADD',
    color: '#185FA5',
    weight: 2,
    fillOpacity: 0.8
  }).addTo(map).bindPopup((pc.ip_local || '') + '<br>' + (pc.ip_org || '')).openPopup();
}

// ============================================
// EVENTOS DE RED
// ============================================
async function verRed(serial, nombre) {
  const modal = document.getElementById('modalRed');
  const titulo = document.getElementById('modalRedTitulo');
  const tabla = document.getElementById('tablaEventosRed');
  if (!modal) return;
  titulo.textContent = 'Eventos de Red — ' + (nombre || serial);
  tabla.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#aaa;padding:16px">Cargando...</td></tr>';
  modal.style.display = 'flex';
  try {
    const resp = await fetch('/api/eventos-red/' + serial, { credentials: 'include' });
    const data = await resp.json();
    if (!data.length) {
      tabla.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#aaa;padding:16px">Sin eventos registrados</td></tr>';
      return;
    }
    tabla.innerHTML = data.map(e => {
      const ts = new Date(e.timestamp).toLocaleString('es-CO');
      const tipoColor = { cable_desconectado:'#e74c3c', conflicto_ip:'#f39c12', wifi_desconectado:'#e74c3c', wifi_conectado:'#27ae60', dhcp_fallo:'#e74c3c' };
      const color = tipoColor[e.tipo] || '#aaa';
      return '<tr>' +
        '<td style="padding:6px 8px">' + ts + '</td>' +
        '<td style="padding:6px 8px">' + (e.adaptador||'—') + '</td>' +
        '<td style="padding:6px 8px;color:' + color + ';font-weight:600">' + (e.tipo||'—') + '</td>' +
        '<td style="padding:6px 8px;color:#e74c3c">' + (e.ip_anterior||'—') + '</td>' +
        '<td style="padding:6px 8px;color:#27ae60">' + (e.ip_nueva||'—') + '</td>' +
      '</tr>';
    }).join('');
  } catch(e) {
    tabla.innerHTML = '<tr><td colspan="5" style="color:#c0392b;padding:16px">Error cargando eventos</td></tr>';
  }
}
function cerrarRed() {
  document.getElementById('modalRed').style.display = 'none';
}
