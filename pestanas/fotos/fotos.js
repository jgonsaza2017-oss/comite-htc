let loteFotosSeleccionado = null;
let fotoAuditoriaBase64 = { 1: '', 2: '' };

function obtenerListaSerialesFoto(item) {
  if (!item) return [];
  const raw = item.seriales ?? item.serial ?? '';
  if (Array.isArray(raw)) {
    return raw.map(s => String(s || '').trim()).filter(Boolean);
  }
  return String(raw)
    .split(/[\n,;]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function renderInfoDetalleFoto(item) {
  let detalleEl = document.getElementById('detalleEstadoSerialesFoto');
  if (!detalleEl) {
    const panel = document.getElementById('panelEditorFotosAuditoria');
    const tituloEl = document.getElementById('tituloLoteFotos');
    if (!panel || !tituloEl) return;

    detalleEl = document.createElement('div');
    detalleEl.id = 'detalleEstadoSerialesFoto';
    detalleEl.className = 'p-3 mb-3 rounded-3 border bg-light';
    tituloEl.parentElement.insertAdjacentElement('afterend', detalleEl);
  }

  const estadoTxt = String(item.estado || item.estadoTienda || '').trim();
  const obsTxt = String(item.observacion || item.novedad || item.obs || '').trim();
  const lineaEstadoObs = [estadoTxt, obsTxt].filter(Boolean).join(' — ') || 'Sin novedad registrada en tienda.';
  const seriales = obtenerListaSerialesFoto(item);

  const serialesHtml = seriales.length
    ? seriales.map(sn => `<span class="badge rounded-pill bg-white text-primary border border-primary-subtle px-2 py-1 me-1 mb-1">${sn}</span>`).join('')
    : '<span class="text-muted small">Sin seriales registrados</span>';

  detalleEl.innerHTML = `
    <div class="small fw-bold text-uppercase text-primary mb-1" style="letter-spacing: 0.4px;">ESTADO Y OBSERVACIÓN EN TIENDA</div>
    <div class="small text-dark mb-2">${lineaEstadoObs}</div>
    <div class="border-top pt-2 d-flex flex-wrap align-items-center gap-1">
      <span class="small fw-bold text-dark me-1">Seriales (${seriales.length}):</span>
      ${serialesHtml}
    </div>
  `;
}

function poblarSucursalesFotos() {
  const sel = document.getElementById('selSucursalFotos');
  if (!sel) return;
  const anterior = sel.value || 'TODAS';
  const sedes = Array.from(new Set(
    listaComite.map(x => String(x.sucursal || '').trim().toUpperCase()).filter(Boolean)
  )).sort();

  sel.innerHTML = '<option value="TODAS">Todas las sedes</option>' +
    sedes.map(s => `<option value="${s}">${s}</option>`).join('');

  if (sedes.includes(anterior)) sel.value = anterior;
}

function renderTablaFotos() {
  poblarSucursalesFotos();
  const cont = document.getElementById('listaLotesFotos');
  if (!cont) return;

  const sede = document.getElementById('selSucursalFotos')?.value || 'TODAS';
  const q = (document.getElementById('txtBuscarFotos')?.value || '').trim().toLowerCase();

  const filtrados = listaComite.filter(x => {
    const suc = String(x.sucursal || '').trim().toUpperCase();
    if (sede !== 'TODAS' && suc !== sede) return false;
    if (q) {
      const texto = `${x.codigo || ''} ${x.descripcion || ''} ${suc}`.toLowerCase();
      if (!texto.includes(q)) return false;
    }
    return true;
  });

  if (!filtrados.length) {
    cont.innerHTML = '<div class="text-center text-muted small py-3">No hay lotes disponibles para cargar fotos.</div>';
    return;
  }

  cont.innerHTML = filtrados.map((item, idx) => {
    const tiene1 = Boolean(item.foto1);
    const tiene2 = Boolean(item.foto2);
    const estadoBadge = (tiene1 && tiene2)
      ? '<span class="badge bg-success">2/2 Fotos</span>'
      : `<span class="badge bg-warning text-dark">${(tiene1 ? 1 : 0) + (tiene2 ? 1 : 0)}/2 Fotos</span>`;

    return `
      <div class="lote-item ${loteFotosSeleccionado && loteFotosSeleccionado.codigo === item.codigo && loteFotosSeleccionado.sucursal === item.sucursal ? 'seleccionado' : ''}" onclick="seleccionarLoteFotos(${idx})">
        <div class="d-flex justify-content-between align-items-center gap-2">
          <div>
            <span class="badge bg-dark">${item.codigo || 'SIN-COD'}</span>
            <span class="badge bg-light text-dark border">${item.sucursal || 'SIN SEDE'}</span>
            <strong class="ms-1 small">${item.descripcion || 'Producto'}</strong>
          </div>
          ${estadoBadge}
        </div>
      </div>
    `;
  }).join('');
}

function seleccionarLoteFotos(idx) {
  const sede = document.getElementById('selSucursalFotos')?.value || 'TODAS';
  const q = (document.getElementById('txtBuscarFotos')?.value || '').trim().toLowerCase();

  const filtrados = listaComite.filter(x => {
    const suc = String(x.sucursal || '').trim().toUpperCase();
    if (sede !== 'TODAS' && suc !== sede) return false;
    if (q) {
      const texto = `${x.codigo || ''} ${x.descripcion || ''} ${suc}`.toLowerCase();
      if (!texto.includes(q)) return false;
    }
    return true;
  });

  const item = filtrados[idx];
  if (!item) return;

  loteFotosSeleccionado = item;
  fotoAuditoriaBase64 = {
    1: (item.foto1 && item.foto1.startsWith('data:image')) ? item.foto1 : '',
    2: (item.foto2 && item.foto2.startsWith('data:image')) ? item.foto2 : ''
  };

  document.getElementById('panelEditorFotosAuditoria').classList.remove('d-none');
  document.getElementById('tituloLoteFotos').innerText = `${item.codigo || ''} · ${item.sucursal || ''} — ${item.descripcion || ''}`;
  renderInfoDetalleFoto(item);
  document.getElementById('audImg1').src = item.foto1 || 'https://via.placeholder.com/250x180?text=Foto+1';
  document.getElementById('audImg2').src = item.foto2 || 'https://via.placeholder.com/250x180?text=Foto+2';
  document.getElementById('msgGuardadoFotosAud').innerText = '';
  renderTablaFotos();
}

function cerrarEditorFotosAuditoria() {
  loteFotosSeleccionado = null;
  document.getElementById('panelEditorFotosAuditoria').classList.add('d-none');
}

function aplicarFotoCamaraAuditoria(numFoto, base64) {
  fotoAuditoriaBase64[numFoto] = base64;
  const imgEl = document.getElementById(numFoto === 1 ? 'audImg1' : 'audImg2');
  if (imgEl) imgEl.src = base64;
  document.getElementById('msgGuardadoFotosAud').innerText = `✓ Foto ${numFoto} lista para guardar.`;
}

async function capturarFotoAuditoriaLocal(numFoto, inputEl) {
  const file = inputEl.files[0];
  if (!file) return;
  try {
    const base64 = await comprimirImagenRapida(file, 640, 0.58);
    inputEl.value = '';
    aplicarFotoCamaraAuditoria(numFoto, base64);
  } catch (e) {
    document.getElementById('msgGuardadoFotosAud').innerText = '⚠️ Error al procesar la imagen.';
  }
}

async function guardarFotosLoteAuditoria() {
  if (!loteFotosSeleccionado) return;
  const btn = document.getElementById('btnGuardarFotosLote');
  const msg = document.getElementById('msgGuardadoFotosAud');
  btn.disabled = true;
  msg.innerText = 'Subiendo fotos a Google Drive...';

  try {
    const envios = [];
    [1, 2].forEach(num => {
      if (fotoAuditoriaBase64[num]) {
        envios.push(
          fetch(API_URL, {
            method: 'POST',
            body: JSON.stringify({
              accion: 'foto',
              fila: loteFotosSeleccionado.fila || loteFotosSeleccionado.rowIndex || '',
              codigo: loteFotosSeleccionado.codigo || '',
              numFoto: num,
              base64Data: fotoAuditoriaBase64[num]
            })
          }).then(r => r.json()).then(res => ({ num, res }))
        );
      }
    });

    const resultados = await Promise.all(envios);
    let okCount = 0;
    resultados.forEach(({ num, res }) => {
      if (res && res.ok) {
        okCount += 1;
        if (res.fotoUrl) {
          loteFotosSeleccionado[`foto${num}`] = normalizarUrlFotoDrive(res.fotoUrl);
        }
      }
    });

    if (okCount > 0) {
      msg.innerText = '✅ Fotos guardadas correctamente.';
      renderTablaFotos();
    } else {
      msg.innerText = '⚠️ No se pudieron guardar las fotos.';
    }
  } catch (e) {
    msg.innerText = '⚠️ Error de conexión al guardar las fotos.';
  } finally {
    btn.disabled = false;
  }
}