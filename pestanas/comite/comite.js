let listaFiltrada = [];
let indiceComite = 0;
let indiceFotoPasarela = 0;

function poblarSucursales() {
  const sel = document.getElementById('selSucursalComite');
  if (!sel) return;
  const valorAnterior = sel.value || 'TODAS';
  const sedes = Array.from(new Set(
    listaComite.map(x => String(x.sucursal || '').trim().toUpperCase()).filter(Boolean)
  )).sort();

  sel.innerHTML = '<option value="TODAS">Todas las sedes</option>' +
    sedes.map(s => `<option value="${s}">${s}</option>`).join('');

  if (sedes.includes(valorAnterior)) {
    sel.value = valorAnterior;
  }
}

function obtenerClaveVotoUsuario() {
  const mapa = {
    OSMEL: 'vOsmel',
    ANGELICA: 'vAngelica',
    ORLANDO: 'vOrlando',
    ANDRES: 'vAndres'
  };
  return mapa[usuarioActivo] || '';
}

function aplicarFiltrosComite() {
  const sede = document.getElementById('selSucursalComite')?.value || 'TODAS';
  const estado = document.getElementById('selEstadoComite')?.value || 'TODOS';
  const texto = (document.getElementById('txtBuscarComite')?.value || '').trim().toLowerCase();
  const claveVoto = obtenerClaveVotoUsuario();

  listaFiltrada = listaComite.filter(item => {
    const sucItem = String(item.sucursal || '').trim().toUpperCase();
    if (sede !== 'TODAS' && sucItem !== sede) return false;

    const votos = [item.vOsmel, item.vAngelica, item.vOrlando, item.vAndres];
    const completos = votos.every(v => v && String(v).trim() !== '');
    const miVoto = claveVoto ? String(item[claveVoto] || '').trim() : '';

    if (estado === 'PENDIENTES_MI_VOTO' && (!claveVoto || miVoto !== '')) return false;
    if (estado === 'COMPLETOS_4_4' && !completos) return false;
    if (estado === 'INCOMPLETOS' && completos) return false;

    if (texto) {
      const blob = `${item.codigo || ''} ${item.descripcion || ''} ${item.seriales || ''} ${item.observacion || ''} ${sucItem}`.toLowerCase();
      if (!blob.includes(texto)) return false;
    }
    return true;
  });

  if (indiceComite >= listaFiltrada.length) indiceComite = 0;
  if (indiceComite < 0) indiceComite = 0;
  indiceFotoPasarela = 0;
  renderFichaComite();
}

function renderComite() {
  poblarSucursales();
  aplicarFiltrosComite();
}

function moverComite(delta) {
  if (!listaFiltrada.length) return;
  indiceComite = (indiceComite + delta + listaFiltrada.length) % listaFiltrada.length;
  indiceFotoPasarela = 0;
  renderFichaComite();
}

function cambiarFotoPasarela(delta, totalFotos) {
  if (!totalFotos || totalFotos <= 1) return;
  indiceFotoPasarela = (indiceFotoPasarela + delta + totalFotos) % totalFotos;
  renderFichaComite();
}

function renderFichaComite() {
  const cont = document.getElementById('tarjetaComiteActual');
  const barra = document.getElementById('barraFlotanteComite');
  const counterEl = document.getElementById('contadorComite');
  if (!cont) return;

  if (!listaFiltrada.length) {
    cont.innerHTML = `
      <div class="card p-4 text-center">
        <div class="fw-bold text-muted mb-1">No hay lotes para mostrar con este filtro</div>
        <small class="text-muted">Cambia la sucursal o el filtro de votos, o actualiza los datos.</small>
      </div>
    `;
    if (barra) barra.classList.add('d-none');
    return;
  }

  const item = listaFiltrada[indiceComite];
  const fotos = [item.foto1, item.foto2].filter(f => f && String(f).trim() !== '');
  if (indiceFotoPasarela >= fotos.length) indiceFotoPasarela = 0;
  const fotoActual = fotos[indiceFotoPasarela] || 'https://via.placeholder.com/400x240?text=Sin+Foto';

  const votos = [
    { rol: 'Oswal', val: item.vOsmel || '-' },
    { rol: 'Angélica', val: item.vAngelica || '-' },
    { rol: 'Orlando', val: item.vOrlando || '-' },
    { rol: 'Andrés', val: item.vAndres || '-' }
  ];
  const votosCompletos = votos.every(v => v.val !== '-');

  const serialesArr = String(item.seriales || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const costoUnit = limpiarNumeroLike(item.costoUnit || 0);
  const costoTotal = limpiarNumeroLike(item.costoTotal || (costoUnit * (item.cantidad || 1)));

  cont.innerHTML = `
    <div class="ficha-card p-3 mb-3">
      <div class="ficha-top-meta">
        <div class="d-flex flex-wrap align-items-center gap-1">
          <span class="pill-meta pill-code">${item.codigo || 'SIN-COD'}</span>
          <span class="pill-meta pill-store">${item.sucursal || 'SIN SEDE'}</span>
          <span class="pill-meta pill-days">${item.dias || 0} días</span>
        </div>
        <span class="pill-meta ${votosCompletos ? 'status-aprobado' : 'status-progreso'}">
          ${votosCompletos ? '✓ Comité 4/4 Completo' : '⏳ En evaluación'}
        </span>
      </div>

      <h6 class="fw-bold text-dark mb-2">${item.descripcion || 'Producto sin descripción'}</h6>

      <div class="linea-datos-prod mb-3">
        <span><strong>Cant:</strong> ${item.cantidad || 1}</span>
        <span class="dato-sep">|</span>
        <span><strong>Costo unit:</strong> $${costoUnit.toLocaleString('es-CO')}</span>
        <span class="dato-sep">|</span>
        <span><strong>Total lote:</strong> $${costoTotal.toLocaleString('es-CO')}</span>
      </div>

      <div class="pasarela-box mb-3">
        <img src="${fotoActual}" alt="Evidencia" class="pasarela-img" onclick="ampliarFoto('${fotoActual.replace(/'/g, "\\'")}')">
        ${fotos.length > 0 ? `<span class="pasarela-contador">${indiceFotoPasarela + 1} / ${fotos.length}</span>` : ''}
        ${fotos.length > 1 ? `
          <button type="button" class="pasarela-btn prev" onclick="cambiarFotoPasarela(-1, ${fotos.length})">‹</button>
          <button type="button" class="pasarela-btn next" onclick="cambiarFotoPasarela(1, ${fotos.length})">›</button>
        ` : ''}
      </div>

      <div class="novedad-box-pro">
        <span class="novedad-label">Estado y Observación en Tienda</span>
        <div class="novedad-texto">${item.estado || 'Sin estado'} — ${item.observacion || 'Sin observación registrada'}</div>
        ${serialesArr.length > 0 ? `
          <div class="seriales-row-pro">
            <span class="fw-bold text-muted">Seriales (${serialesArr.length}):</span>
            ${serialesArr.slice(0, 4).map(s => `<span class="serial-chip">${s}</span>`).join('')}
            ${serialesArr.length > 4 ? `<button type="button" class="btn-seriales-pill" onclick="abrirModalSerialesComite()">Ver todos (${serialesArr.length})</button>` : ''}
          </div>
        ` : ''}
      </div>

      <div class="row g-2 mb-3">
        ${votos.map(v => `
          <div class="col-6 col-md-3">
            <div class="border rounded-3 p-2 bg-light text-center">
              <div class="text-muted fw-bold" style="font-size: 0.68rem;">${v.rol}</div>
              <div class="fw-bold text-dark small mt-1">${v.val}</div>
            </div>
          </div>
        `).join('')}
      </div>

      <div class="row g-2">
        <div class="col-6 col-md-4">
          <button type="button" class="btn-decision btn-desc w-100" onclick="emitirVotoComite('Descuento')">💸 Descuento</button>
        </div>
        <div class="col-6 col-md-4">
          <button type="button" class="btn-decision btn-obs w-100" onclick="emitirVotoComite('Obsequio / Merch')">🎁 Obsequio</button>
        </div>
        <div class="col-6 col-md-4">
          <button type="button" class="btn-decision btn-tras w-100" onclick="emitirVotoComite('Traslado')">🚚 Traslado</button>
        </div>
        <div class="col-6 col-md-6">
          <button type="button" class="btn-decision btn-reem w-100" onclick="emitirVotoComite('Reempaque')">📦 Reempaque</button>
        </div>
        <div class="col-12 col-md-6">
          <button type="button" class="btn-decision btn-baja w-100" onclick="emitirVotoComite('Baja')">🗑️ Dar de Baja</button>
        </div>
      </div>
    </div>
  `;

  if (counterEl) counterEl.innerText = `${indiceComite + 1} de ${listaFiltrada.length}`;
  if (barra && vistaActual === 'comite' && usuarioActivo && usuarioActivo !== 'JOHAN_OSCAR') {
    barra.classList.remove('d-none');
  }
}

function abrirModalSerialesComite() {
  const item = listaFiltrada[indiceComite];
  if (!item) return;
  const seriales = String(item.seriales || '').split(',').map(s => s.trim()).filter(Boolean);
  serialesModalActuales = seriales;
  document.getElementById('modalSerialesTitulo').innerText = `${item.codigo} · ${item.descripcion || ''}`;
  document.getElementById('modalSerialesSubtitulo').innerText = `Sede: ${item.sucursal || '-'} · ${seriales.length} seriales`;
  document.getElementById('modalSerialesLista').innerHTML = seriales.length
    ? seriales.map(s => `<div class="py-1 px-2 border-bottom font-monospace small">${s}</div>`).join('')
    : '<div class="text-muted small">Sin seriales registrados.</div>';
  new bootstrap.Modal(document.getElementById('modalSeriales')).show();
}

async function emitirVotoComite(decision) {
  const item = listaFiltrada[indiceComite];
  if (!item) return;
  const claveVoto = obtenerClaveVotoUsuario();
  if (!claveVoto) {
    alert('Selecciona un perfil del Comité Gerencial para emitir un voto.');
    return;
  }

  item[claveVoto] = decision;
  renderFichaComite();

  try {
    await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({
        accion: 'registrar_voto_comite',
        usuario: usuarioActivo,
        fila: item.fila || item.rowIndex || '',
        sucursal: item.sucursal || '',
        codigo: item.codigo || '',
        voto: decision
      })
    });
  } catch (e) {
    console.warn('Error enviando voto a Sheets:', e);
  }

  if (indiceComite < listaFiltrada.length - 1) {
    indiceComite += 1;
    indiceFotoPasarela = 0;
    renderFichaComite();
  }
}