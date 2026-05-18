async function cargarDashboard() {
  try {
    const res = await fetch("/api/stats");
    const data = await res.json();

    // KPIs
    document.getElementById("kpiTotal").textContent = data.kpis.total_pcs;
    document.getElementById("kpiActivos").textContent = data.kpis.activos;
    document.getElementById("kpiAlerta").textContent = data.kpis.alerta;
    document.getElementById("kpiInactivos").textContent = data.kpis.inactivos;
    document.getElementById("kpiMB").textContent = formatMB(
      data.mb_total_liberado,
    );

    // Top 10 PCs (barras horizontales)
    new Chart(document.getElementById("chartTopPcs"), {
      type: "bar",
      data: {
        labels: data.top_pcs.map((p) =>
          p.usuario ? p.usuario.split("\\").pop() : p.nombre_equipo,
        ),
        datasets: [
          {
            label: "GB liberados",
            data: data.top_pcs.map((p) =>
              parseFloat((p.total_liberado / 1024).toFixed(2)),
            ),
            backgroundColor: "#3498db",
          },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { title: { display: true, text: "GB liberados" } },
        },
      },
    });

    // Limpiezas por dia (linea)
    new Chart(document.getElementById("chartPorDia"), {
      type: "line",
      data: {
        labels: data.por_dia.map((d) => formatFechaCorta(d.dia)),
        datasets: [
          {
            label: "Cantidad de limpiezas",
            data: data.por_dia.map((d) => d.cantidad),
            borderColor: "#3498db",
            backgroundColor: "rgba(52,152,219,0.1)",
            yAxisID: "y",
            tension: 0.3,
            fill: true,
          },
          {
            label: "GB liberados",
            data: data.por_dia.map((d) =>
              parseFloat((d.mb_dia / 1024).toFixed(2)),
            ),
            borderColor: "#9b59b6",
            backgroundColor: "rgba(155,89,182,0.1)",
            yAxisID: "y1",
            tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true,
        interaction: { mode: "index", intersect: false },
        scales: {
          y: {
            position: "left",
            title: { display: true, text: "Cantidad" },
            ticks: { stepSize: 1, precision: 0 },
          },
          y1: {
            position: "right",
            title: { display: true, text: "GB liberados" },
            grid: { drawOnChartArea: false },
          },
        },
      },
    });
  } catch (err) {
    console.error("Error cargando dashboard:", err);
  }
}

function formatMB(mb) {
  mb = parseFloat(mb);
  return (mb / 1024).toFixed(1) + " GB";
}

function formatFechaCorta(f) {
  const d = new Date(f);
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit" });
}

cargarDashboard();

async function cargarStatsProgramas() {
  try {
    const res = await fetch("/api/stats/programas");
    const data = await res.json();
    document.getElementById("kpi-total-prog").textContent =
      data.totales.total_registros.toLocaleString("es-CO");
    document.getElementById("kpi-unicos-prog").textContent =
      data.totales.total_unicos.toLocaleString("es-CO");
    document.getElementById("kpi-pcs-prog").textContent =
      data.totales.total_pcs;
    const labels = data.top10.map((p) =>
      p.nombre.length > 30 ? p.nombre.substring(0, 30) + "…" : p.nombre,
    );
    const valores = data.top10.map((p) => p.total_pcs);
    if (
      window.chartProgramas &&
      typeof window.chartProgramas.destroy === "function"
    )
      window.chartProgramas.destroy();
    const canvas = document.getElementById("chartProgramas");
    Chart.getChart(canvas)?.destroy();
    window.chartProgramas = new Chart(
      document.getElementById("chartProgramas"),
      {
        type: "bar",
        data: {
          labels,
          datasets: [
            {
              label: "PCs",
              data: valores,
              backgroundColor: "#3498db",
              borderRadius: 4,
            },
          ],
        },
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (ctx) => ` ${ctx.raw} PCs` } },
          },
          scales: {
            x: {
              grid: { color: "rgba(128,128,128,0.1)" },
              ticks: { color: "#888", stepSize: 1 },
            },
            y: {
              grid: { display: false },
              ticks: { color: "#555", font: { size: 11 } },
            },
          },
        },
      },
    );
  } catch (e) {
    console.error("Error stats programas:", e);
  }
}

// Gráfica PCs por Área
async function cargarGraficaAreas() {
  try {
    const res = await fetch("/api/stats/areas");
    const data = await res.json();

    const areasValidas = [
      "Apoyo",
      "Juridico",
      "Subdireccion",
      "GTI",
      "Admin",
      "SecGeneral",
      "Planeacion",
      "Reduccion",
      "Financi",
      "GRC",
      "CDI",
      "Conocimiento",
      "Simex",
      "Control",
      "Comunicaciones",
    ];

    const filtrado = data
      .map((d) => ({
        area: areasValidas.includes(d.area) ? d.area : "Otros",
        total: d.total,
      }))
      .reduce((acc, cur) => {
        const found = acc.find((a) => a.area === cur.area);
        if (found) found.total += cur.total;
        else acc.push({ ...cur });
        return acc;
      }, [])
      .sort((a, b) => b.total - a.total);

    const colores = [
      "#2952a3",
      "#4a90d9",
      "#e74c3c",
      "#2ecc71",
      "#f39c12",
      "#9b59b6",
      "#1abc9c",
      "#e67e22",
      "#34495e",
      "#e91e63",
      "#00bcd4",
      "#8bc34a",
      "#ff5722",
      "#607d8b",
      "#795548",
      "#ff9800",
      "#aaa",
    ];

    const canvas = document.getElementById("chartAreas");
    if (!canvas) return;
    Chart.getChart(canvas)?.destroy();
    new Chart(canvas, {
      type: "bar",
      data: {
        labels: filtrado.map((d) => d.area),
        datasets: [
          {
            label: "PCs",
            data: filtrado.map((d) => d.total),
            backgroundColor: "#2952a3",
            borderRadius: 6,
            borderSkipped: false,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.parsed.y} PCs` } },
        },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1 } },
          x: { grid: { display: false } },
        },
      },
    });
  } catch (e) {
    console.error("Error graficaAreas:", e);
  }
}

cargarGraficaAreas();

async function cargarGraficaModelos() {
  try {
    const res = await fetch("/api/stats/modelos");
    const datos = await res.json();

    // KPI cards por modelo
    const kpiDiv = document.getElementById("kpi-modelos");
    const colores = ["#3498db", "#2ecc71", "#e67e22", "#9b59b6"];
    kpiDiv.innerHTML = datos
      .map(
        (d, i) => `
      <div style="background:#f8f9fa;border-radius:8px;padding:1rem;border-left:4px solid ${colores[i] || "#bbb"}">
        <p style="font-size:12px;color:#888;margin:0 0 4px;font-weight:600;text-transform:uppercase;">${d.modelo}</p>
        <p style="font-size:24px;font-weight:500;margin:0 0 4px;">${d.total} PCs</p>
        <p style="font-size:12px;color:#888;margin:0;">Activos: ${d.activos} </p>
      </div>
    `,
      )
      .join("");

    // Gráfica dona
    if (
      window.chartModelos &&
      typeof window.chartModelos.destroy === "function"
    )
      window.chartModelos.destroy();
    window.chartModelos = new Chart(document.getElementById("chartModelos"), {
      type: "doughnut",
      data: {
        labels: datos.map((d) => d.modelo),
        datasets: [
          {
            data: datos.map((d) => d.total),
            backgroundColor: colores,
            borderWidth: 2,
            borderColor: "#fff",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "right" },
          tooltip: {
            callbacks: { label: (ctx) => ` ${ctx.label}: ${ctx.parsed} PCs` },
          },
        },
      },
    });
  } catch (e) {
    console.error("Error graficaModelos:", e);
  }
}
cargarGraficaModelos();
