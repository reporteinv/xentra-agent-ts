let campanaActiva = null;
let detalleActual = [];

async function cargarCampanas() {
  try {
    const res = await fetch('/api/limpieza/campanas');
    const campanas = await res.json();
    const grid = document.getElementById('lm-campanas');
    if (campanas.length === 0) {
      grid.innerHTML = '<p style="color:#888;font-size:0.85rem;">No hay campañas aún.</p>';
      return;
    }
    grid.innerHTML = campanas.map(c => `
      <div class="campana-card ${campanaActiva === c.id ? 'activa' : ''}" onclick="verDetalle(${c.id})">
        <div class="campana-fecha">${new Date(c.fecha_creacion).toLocaleString('es-CO')}</div>
        <div style="font-size:1.1rem;font-weight:600;margin-bottom:6px;">${c.total_pcs} PCs</div>
        <div class="campana-stats">
          <span style="color:#27ae60">✓ ${c.ejecutados}</span>
          <span style="color:#f39c12">⏳ ${c.pendientes}</span>
          <span style="color:#aaa">✗ ${c.expirados}</span>
        </div>
      </div>
    `).join('');
    if (!campanaActiva && campanas.length > 0) verDetalle(campanas[0].id);
  } catch(e) { console.error(e); }
}

async function verDetalle(id) {
  campanaActiva = id;
  try {
    const res = await fetch(`/api/limpieza/detalle/${id}`);
    const rows = await res.json();
    detalleActual = rows;

    const total = rows.length;
    const ejec = rows.filter(r => r.estado === 'ejecutado').length;
    const pend = rows.filter(r => r.estado === 'pendiente').length;
    const exp  = rows.filter(r => r.estado === 'expirado').length;

    document.getElementById('lm-kpis').style.display = 'grid';
    document.getElementById('lm-progreso').style.display = 'block';
    document.getElementById('lm-detalle-wrap').style.display = 'block';

    document.getElementById('kpi-total').textContent = total;
    document.getElementById('kpi-ejec').textContent = ejec;
    document.getElementById('kpi-pend').textContent = pend;
    document.getElementById('kpi-exp').textContent = exp;

    const pctEjec = total ? Math.round((ejec/total)*100) : 0;
    const pctPend = total ? Math.round((pend/total)*100) : 0;
    const pctExp  = total ? Math.round((exp/total)*100) : 0;
    document.getElementById('prog-ok').style.width = pctEjec + '%';
    document.getElementById('prog-pend').style.width = pctPend + '%';
    document.getElementById('prog-exp').style.width = pctExp + '%';
    document.getElementById('lm-prog-txt').textContent = `${ejec} / ${total} (${pctEjec}%)`;

    document.getElementById('lm-subtitulo').textContent = `Campaña del ${new Date(rows[0]?.fecha_creacion||Date.now()).toLocaleString('es-CO')}`;

    renderTabla(rows);
    cargarCampanas();
  } catch(e) { console.error(e); }
}

function renderTabla(rows) {
  const tbody = document.getElementById('lm-tbody');
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td><code style="color:#3498db;font-size:0.8rem">${r.serial}</code></td>
      <td>${r.nombre_equipo || '-'}</td>
      <td>${r.modelo || '-'}</td>
      <td><span class="badge-${r.estado === 'ejecutado' ? 'ejec' : r.estado === 'pendiente' ? 'pend' : 'exp'}">${r.estado}</span></td>
      <td style="font-size:0.8rem;color:#888">${r.fecha_ejecucion ? new Date(r.fecha_ejecucion).toLocaleString('es-CO') : '—'}</td>
      <td>${r.mb_liberados != null ? (r.mb_liberados/1024).toFixed(2)+' GB' : '—'}</td>
    </tr>
  `).join('');
}

function filtrarTabla() {
  const q = document.getElementById('lm-buscar').value.toLowerCase();
  const filtrado = detalleActual.filter(r =>
    (r.serial||'').toLowerCase().includes(q) ||
    (r.nombre_equipo||'').toLowerCase().includes(q) ||
    (r.modelo||'').toLowerCase().includes(q)
  );
  renderTabla(filtrado);
}

async function iniciarLimpieza() {
  if (!confirm('¿Iniciar limpieza masiva en todos los PCs activos?')) return;
  try {
    document.getElementById('btnLimpiarMasivo').disabled = true;
    document.getElementById('btnLimpiarMasivo').textContent = '⏳ Iniciando...';
    const res = await fetch('/api/limpiar-masivo', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      alert(`✅ Campaña creada: ${data.total} PCs en cola`);
      await cargarCampanas();
      verDetalle(data.campana_id);
    } else {
      alert('Error: ' + data.error);
    }
  } catch(e) {
    alert('Error al iniciar limpieza');
  } finally {
    document.getElementById('btnLimpiarMasivo').disabled = false;
    document.getElementById('btnLimpiarMasivo').textContent = '⚡ Nueva limpieza masiva';
  }
}

cargarCampanas();
setInterval(() => { if (campanaActiva) verDetalle(campanaActiva); }, 30000);
