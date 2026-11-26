let filtroKpiPanel = 'todos';
let filtroTiendaPanel = 'TODAS';
let chartDecisionesInst = null;
let chartSedesInst = null;

function renderDashboard() {
  const todasTiendas = new Set([
    ...listaComite.map(x => String(x.sucursal || '').trim().toUpperCase()).filter(Boolean),
    ...listaFaltantesGlobal.map(x => String(x.sucursal || '').trim().toUpperCase()).filter(Boolean),
    ...listaSobrantesGlobal.map(x => String(x.sucursal || '').trim().toUpperCase()).filter(Boolean)
  ]);
  const tiendasArr = ['TODAS', ...Array.from(todasTiendas).sort()];
  if (!tiendasArr.includes(filtroTiendaPanel)) filtroTiendaPanel = 'TODAS';

  const tabsCont = document.getElementById('panelTiendasTabs');
  if (tabsCont) {
    tabsCont.innerHTML = tiendasArr.map(t => `
      <div class="col-6 col-sm-4 col-md-3">
        <button type="button" class="btn-dash-tienda-tab ${filtroTiendaPanel === t ? 'activo' : ''}" onclick="seleccionarTiendaPanel('${t.replace(/'/g, "\\'")}')">
          ${t === 'TODAS' ? '🌐 Todas las Sedes' : '🏪 ' + t}
        </button>
      </div>
    `).join('');
  }

  const comiteFiltrado = filtroTiendaPanel === 'TODAS'
    ? listaComite
    : listaComite.filter(x => String(x.sucursal || '').trim().toUpperCase() === filtroTiendaPanel);

  const faltFiltrado = filtroTiendaPanel === 'TODAS'
    ? listaFaltantesGlobal
    : listaFaltantesGlobal.filter(x => String(x.sucursal || '').trim().toUpperCase() === filtroTiendaPanel);

  const sobFiltrado = filtroTiendaPanel === 'TODAS'
    ? listaSobrantesGlobal
    : listaSobrantesGlobal.filter(x => String(x.sucursal || '').trim().toUpperCase() === filtroTiendaPanel);

  const esCompleto4de4 = (x) => {
    const votes = [x.vOsmel, x.vAngelica, x.vOrlando, x.vAndres];
    return votes.every(v => v && String(v).trim() !== '');
  };

  const aprobados = comiteFiltrado.filter(esCompleto4de4);
  const pendientes = comiteFiltrado.filter(x => !esCompleto4de4(x));
  const sinFotos = comiteFiltrado.filter(x => !x.foto1 || !x.foto2);
  const totalCostoComite = comiteFiltrado.reduce((acc, x) => acc + limpiarNumeroLike(x.costoTotal || x.costoUnit || 0), 0);
  const totalFaltValor = faltFiltrado.reduce((acc, x) => acc + limpiarNumeroLike(x.valorCobro || x.valorTotal || 0), 0);
  const totalFaltCant = faltFiltrado.reduce((acc, x) => acc + limpiarNumeroLike(x.faltante || x.cantidad || 0), 0);
  const totalSobCant = sobFiltrado.reduce((acc, x) => acc + limpiarNumeroLike(x.sobrante || x.cantidad || 0), 0);
  const totalSobValor = sobFiltrado.reduce((acc, x) => acc + limpiarNumeroLike(x.valorSobrante || x.valorTotal || 0), 0);

  document.getElementById('dashTotalLotes').innerText = comiteFiltrado.length;
  document.getElementById('dashTotalCosto').innerText = '$' + totalCostoComite.toLocaleString('es-CO');
  document.getElementById('dashAprobados').innerText = aprobados.length;
  document.getElementById('dashPendientes').innerText = pendientes.length;
  document.getElementById('dashFaltantesValor').innerText = '$' + totalFaltValor.toLocaleString('es-CO');
  document.getElementById('dashFaltantesCant').innerText = `${totalFaltCant} und.`;
  document.getElementById('dashSobrantesCant').innerText = totalSobCant;
  document.getElementById('dashSobrantesValor').innerText = '$' + totalSobValor.toLocaleString('es-CO');
  document.getElementById('dashSinFotos').innerText = sinFotos.length;

  ['todos', 'aprobados', 'pendientes', 'faltantes', 'sobrantes', 'sinfotos'].forEach(k => {
    const card = document.getElementById(`kpiCard_${k}`);
    if (card) card.classList.toggle('kpi-seleccionado', filtroKpiPanel === k);
  });

  renderGraficasPanel(comiteFiltrado, faltFiltrado);
  renderTablaDetallePanel(comiteFiltrado, aprobados, pendientes, faltFiltrado, sobFiltrado, sinFotos);
}

function seleccionarFiltroKpiPanel(filtro) {
  filtroKpiPanel = filtro;
  renderDashboard();
}

function seleccionarTiendaPanel(tienda) {
  filtroTiendaPanel = tienda;
  renderDashboard();
}

function renderGraficasPanel(comiteArr, faltArr) {
  const ctxDec = document.getElementById('chartDecisiones');
  const ctxSed = document.getElementById('chartSedes');
  if (!ctxDec || !ctxSed || typeof Chart === 'undefined') return;

  const conteoDec = {};
  comiteArr.forEach(x => {
    const d = String(x.decisionFinal || x.decision || 'Pendiente').trim() || 'Pendiente';
    conteoDec[d] = (conteoDec[d] || 0) + 1;
  });

  if (chartDecisionesInst) chartDecisionesInst.destroy();
  chartDecisionesInst = new Chart(ctxDec, {
    type: 'doughnut',
    data: {
      labels: Object.keys(conteoDec),
      datasets: [{
        data: Object.values(conteoDec),
        backgroundColor: ['#5b6ef5', '#10b981', '#ec4899', '#f59e0b', '#64748b']
      }]
    },
    options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
  });

  const porSede = {};
  comiteArr.forEach(x => {
    const s = String(x.sucursal || 'SIN SEDE').trim().toUpperCase();
    if (!porSede[s]) porSede[s] = { comite: 0, falt: 0 };
    porSede[s].comite += limpiarNumeroLike(x.costoTotal || x.costoUnit || 0);
  });
  faltArr.forEach(x => {
    const s = String(x.sucursal || 'SIN SEDE').trim().toUpperCase();
    if (!porSede[s]) porSede[s] = { comite: 0, falt: 0 };
    porSede[s].falt += limpiarNumeroLike(x.valorCobro || x.valorTotal || 0);
  });

  const sedesTop = Object.keys(porSede).slice(0, 8);
  if (chartSedesInst) chartSedesInst.destroy();
  chartSedesInst = new Chart(ctxSed, {
    type: 'bar',
    data: {
      labels: sedesTop,
      datasets: [
        { label: 'Comité ($)', data: sedesTop.map(s => porSede[s].comite), backgroundColor: '#8b5cf6' },
        { label: 'Faltantes ($)', data: sedesTop.map(s => porSede[s].falt), backgroundColor: '#ec4899' }
      ]
    },
    options: { responsive: true, scales: { y: { beginAtZero: true } } }
  });
}

function renderTablaDetallePanel(comiteArr, aprobados, pendientes, faltArr, sobArr, sinFotos) {
  const tbody = document.getElementById('cuerpoTablaPanel');
  if (!tbody) return;

  let filas = [];
  if (filtroKpiPanel === 'aprobados') {
    filas = aprobados.map(x => ({
      sede: x.sucursal || '-',
      codigo: x.codigo || '-',
      producto: x.descripcion || '-',
      cant: x.cantidad || 1,
      valor: limpiarNumeroLike(x.costoTotal || x.costoUnit || 0),
      estado: '✅ Aprobado 4/4'
    }));
  } else if (filtroKpiPanel === 'pendientes') {
    filas = pendientes.map(x => ({
      sede: x.sucursal || '-',
      codigo: x.codigo || '-',
      producto: x.descripcion || '-',
      cant: x.cantidad || 1,
      valor: limpiarNumeroLike(x.costoTotal || x.costoUnit || 0),
      estado: '⏳ Pendiente voto'
    }));
  } else if (filtroKpiPanel === 'faltantes') {
    filas = faltArr.map(x => ({
      sede: x.sucursal || '-',
      codigo: x.codigo || '-',
      producto: x.descripcion || '-',
      cant: x.faltante || x.cantidad || 1,
      valor: limpiarNumeroLike(x.valorCobro || x.valorTotal || 0),
      estado: '🚨 Faltante cobro'
    }));
  } else if (filtroKpiPanel === 'sobrantes') {
    filas = sobArr.map(x => ({
      sede: x.sucursal || '-',
      codigo: x.codigo || '-',
      producto: x.descripcion || '-',
      cant: x.sobrante || x.cantidad || 1,
      valor: limpiarNumeroLike(x.valorSobrante || x.valorTotal || 0),
      estado: '➕ Sobrante'
    }));
  } else if (filtroKpiPanel === 'sinfotos') {
    filas = sinFotos.map(x => ({
      sede: x.sucursal || '-',
      codigo: x.codigo || '-',
      producto: x.descripcion || '-',
      cant: x.cantidad || 1,
      valor: limpiarNumeroLike(x.costoTotal || x.costoUnit || 0),
      estado: '📸 Falta foto'
    }));
  } else {
    filas = comiteArr.map(x => ({
      sede: x.sucursal || '-',
      codigo: x.codigo || '-',
      producto: x.descripcion || '-',
      cant: x.cantidad || 1,
      valor: limpiarNumeroLike(x.costoTotal || x.costoUnit || 0),
      estado: x.decisionFinal || x.decision || 'En revisión'
    }));
  }

  if (filas.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">Sin registros para este filtro.</td></tr>';
    return;
  }

  tbody.innerHTML = filas.map(f => `
    <tr>
      <td><span class="badge bg-light text-dark border">${f.sede}</span></td>
      <td class="font-monospace fw-bold">${f.codigo}</td>
      <td>${f.producto}</td>
      <td class="text-end">${f.cant}</td>
      <td class="text-end fw-bold">$${Number(f.valor || 0).toLocaleString('es-CO')}</td>
      <td><span class="badge bg-secondary">${f.estado}</span></td>
    </tr>
  `).join('');
}

function exportarPanelCSV() {
  const rows = [...document.querySelectorAll('#tablaPanelDetalle tr')];
  if (rows.length <= 1) return;
  const csv = rows.map(tr =>
    [...tr.children].map(td => `"${td.innerText.replace(/"/g, '""')}"`).join(';')
  ).join('\n');
  const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Panel_Auditoria_HTC_${filtroTiendaPanel}.csv`;
  a.click();
}