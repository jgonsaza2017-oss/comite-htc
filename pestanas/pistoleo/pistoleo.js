let sesionPistoleo = JSON.parse(localStorage.getItem('htc_sesion_pistoleo') || 'null');
let itemPistoleoFotoActual = null;
let sublistaPistoleoVista = 'FALTANTES';
let html5QrScanner = null;
let syncVivoEnCurso = false;
let intervaloSyncPistoleo = null;

function normalizarClavePistoleo(val) {
  let str = String(val ?? '').trim();
  if (!str) return '';
  if (/^\d+(\.\d+)?e\+\d+$/i.test(str)) {
    const num = Number(str);
    if (!Number.isNaN(num)) str = num.toFixed(0);
  }
  return str
    .replace(/\.0+$/, '')
    .replace(/\s+/g, '')
    .toUpperCase();
}

function obtenerAuditorActivoPistoleo() {
  return (document.getElementById('selAuditorMitad')?.value || 'AUDITOR 1').trim().toUpperCase();
}

function obtenerCampoFilaLike(cleanObj, posiblesClaves) {
  const keys = Object.keys(cleanObj);
  for (const buscada of posiblesClaves) {
    const target = buscada
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
    const matchKey = keys.find(k =>
      k.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() === target
    );
    if (matchKey !== undefined && String(cleanObj[matchKey] ?? '').trim() !== '') {
      return cleanObj[matchKey];
    }
  }
  return '';
}

function recalcularFisicoItem(item) {
  if (!item.fisicoPorAuditor || typeof item.fisicoPorAuditor !== 'object') {
    item.fisicoPorAuditor = {};
  }
  const sumaPorAuditor = Object.values(item.fisicoPorAuditor).reduce(
    (acc, n) => acc + (Number(n) || 0),
    0
  );
  const serialesUnicos = Array.isArray(item.serialesEscaneados)
    ? item.serialesEscaneados.length
    : 0;
  const totalCombinado = Math.max(sumaPorAuditor, serialesUnicos, Number(item.cantFisica || 0));
  item.cantFisica = Math.min(Number(item.cantTeorica || 0), totalCombinado);
}

function consolidarSesionesInventarioTotal(sesionBase, sesionEntrante) {
  if (!sesionBase) return sesionEntrante;
  if (!sesionEntrante) return sesionBase;

  const mapaItems = new Map();

  const absorberItem = (it) => {
    const cod = normalizarClavePistoleo(it.codigo);
    if (!cod) return;

    const serTeoricos = Array.from(
      new Set((it.serialesTeoricos || []).map(normalizarClavePistoleo).filter(Boolean))
    );
    const serEscaneados = Array.from(
      new Set((it.serialesEscaneados || []).map(normalizarClavePistoleo).filter(Boolean))
    );
    const mapaAud = { ...(it.fisicoPorAuditor || {}) };

    if (!mapaItems.has(cod)) {
      const nuevo = {
        ...it,
        codigo: cod,
        cantTeorica: Number(it.cantTeorica || 0),
        cantFisica: Number(it.cantFisica || 0),
        fisicoPorAuditor: mapaAud,
        serialesTeoricos: serTeoricos,
        serialesEscaneados: serEscaneados
      };
      recalcularFisicoItem(nuevo);
      mapaItems.set(cod, nuevo);
      return;
    }

    const actual = mapaItems.get(cod);
    actual.cantTeorica = Math.max(actual.cantTeorica, Number(it.cantTeorica || 0));
    actual.serialesTeoricos = Array.from(
      new Set([...(actual.serialesTeoricos || []), ...serTeoricos])
    );
    actual.serialesEscaneados = Array.from(
      new Set([...(actual.serialesEscaneados || []), ...serEscaneados])
    );

    if (!actual.fisicoPorAuditor) actual.fisicoPorAuditor = {};
    Object.entries(mapaAud).forEach(([aud, cant]) => {
      actual.fisicoPorAuditor[aud] = Math.max(
        Number(actual.fisicoPorAuditor[aud] || 0),
        Number(cant || 0)
      );
    });

    const sumaAuditores = Object.values(actual.fisicoPorAuditor).reduce(
      (acc, n) => acc + (Number(n) || 0),
      0
    );
    const maxDirecto = Math.max(
      Number(actual.cantFisica || 0),
      Number(it.cantFisica || 0),
      actual.serialesEscaneados.length,
      sumaAuditores
    );
    actual.cantFisica = Math.min(actual.cantTeorica, maxDirecto);

    if (Number(it.dias || 0) > Number(actual.dias || 0)) actual.dias = Number(it.dias);
    if (Number(it.costoUnit || 0) > 0) actual.costoUnit = Number(it.costoUnit);
    if (!actual.foto1 && it.foto1) actual.foto1 = it.foto1;
    if (!actual.foto2 && it.foto2) actual.foto2 = it.foto2;
    if (it.observacion && it.observacion !== 'Caja deteriorada y con polvo.') {
      actual.observacion = it.observacion;
    }
  };

  (sesionBase.items || []).forEach(absorberItem);
  (sesionEntrante.items || []).forEach(absorberItem);

  const itemsConsolidados = Array.from(mapaItems.values());
  const codigosValidos = new Set(itemsConsolidados.map(i => normalizarClavePistoleo(i.codigo)));
  const serialesValidos = new Set();
  itemsConsolidados.forEach(i => {
    (i.serialesTeoricos || []).forEach(s => serialesValidos.add(normalizarClavePistoleo(s)));
    (i.serialesEscaneados || []).forEach(s => serialesValidos.add(normalizarClavePistoleo(s)));
  });

  // Filtrar y unificar sobrantes (eliminando cualquier serial/código que ya exista en la base total)
  const mapaSobrantes = new Map();
  [...(sesionBase.sobrantes || []), ...(sesionEntrante.sobrantes || [])].forEach(s => {
    const codSob = normalizarClavePistoleo(s.codigo);
    const serSob = normalizarClavePistoleo(s.serial);
    if (codigosValidos.has(codSob) || serialesValidos.has(serSob) || serialesValidos.has(codSob)) {
      return;
    }
    const key = `${codSob}|${serSob}`;
    if (!mapaSobrantes.has(key)) {
      mapaSobrantes.set(key, { ...s, codigo: codSob, serial: serSob });
    } else {
      const prev = mapaSobrantes.get(key);
      prev.sobrante = Math.max(Number(prev.sobrante || 0), Number(s.sobrante || 0));
      prev.costoUnit = Number(s.costoUnit || prev.costoUnit || 0);
      prev.valorSobrante = prev.sobrante * prev.costoUnit;
    }
  });

  const crucesMap = new Map();
  [...(sesionBase.cruces || []), ...(sesionEntrante.cruces || [])].forEach(c => {
    const k = `${c.codigoSobrante}|${c.serialSobrante}|${c.codigoFaltante}`;
    if (!crucesMap.has(k)) crucesMap.set(k, c);
  });

  const auditoresUnidos = Array.from(
    new Set([
      ...(sesionBase.mitadesCargadas || []),
      ...(sesionEntrante.mitadesCargadas || []),
      sesionBase.auditor,
      sesionEntrante.auditor
    ].filter(Boolean))
  );

  return {
    ...sesionBase,
    ...sesionEntrante,
    sucursal: sesionEntrante.sucursal || sesionBase.sucursal,
    mitadesCargadas: auditoresUnidos,
    items: itemsConsolidados,
    sobrantes: Array.from(mapaSobrantes.values()),
    cruces: Array.from(crucesMap.values())
  };
}

function inicializarModuloPistoleo() {
  aplicarEtiquetasMinDiasPistoleo();
  if (sesionPistoleo && sesionPistoleo.items && sesionPistoleo.items.length > 0) {
    restaurarUIPistoleo();
  }
  if (!intervaloSyncPistoleo) {
    intervaloSyncPistoleo = setInterval(async () => {
      if (vistaActual === 'pistoleo' && sesionPistoleo && !syncVivoEnCurso && !document.hidden) {
        syncVivoEnCurso = true;
        try {
          const r = await fetch(API_URL);
          const d = await r.json();
          if (d.sesionVivo) {
            fusionarProgresoEnVivo(d.sesionVivo);
            const bdg = document.getElementById('badgeSyncVivoPistoleo');
            if (bdg) {
              const h = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
              bdg.innerText = `🟢 Sinc. ${h}`;
            }
          }
        } catch (e) {
          const bdg = document.getElementById('badgeSyncVivoPistoleo');
          if (bdg) bdg.innerText = '🟡 Offline local';
        } finally {
          syncVivoEnCurso = false;
        }
      }
    }, 4500);
  }
  setTimeout(() => enfocarPistola(), 120);
}

function enfocarPistola() {
  const inp = document.getElementById('inputPistolaBarcode');
  if (inp && vistaActual === 'pistoleo') inp.focus();
}

function actualizarBotonFotosUI() {
  const btn = document.getElementById('btnToggleFotos120');
  if (!btn) return;
  if (pedirFotosActivo) {
    btn.className = 'btn-toggle-fotos-estado modo-on';
    btn.innerHTML = `📸 Fotos &ge;${MIN_DIAS_COMITE}d: ON`;
  } else {
    btn.className = 'btn-toggle-fotos-estado modo-off';
    btn.innerHTML = `🚫 Fotos &ge;${MIN_DIAS_COMITE}d: OFF`;
  }
}

function alternarPedirFotos120() {
  pedirFotosActivo = !pedirFotosActivo;
  localStorage.setItem('htc_pedir_fotos_120', pedirFotosActivo ? '1' : '0');
  actualizarBotonFotosUI();
  enfocarPistola();
}

function aplicarEtiquetasMinDiasPistoleo() {
  const d = MIN_DIAS_COMITE;
  const inp = document.getElementById('inputMinDiasComite');
  if (inp) inp.value = d;
  actualizarBotonFotosUI();
  const badgeAlerta = document.getElementById('badgeAlertaObsDias');
  if (badgeAlerta) badgeAlerta.innerHTML = `⚠️ OBSOLESCENCIA &ge; ${d} DÍAS — TOMA FÍSICA OBLIGATORIA`;
  const lblBtnSub = document.getElementById('lblBtnSubDias');
  if (lblBtnSub) lblBtnSub.innerText = d;
}

function aprobarMinDiasComite() {
  const inp = document.getElementById('inputMinDiasComite');
  const num = Math.max(1, parseInt(inp?.value, 10) || 120);
  MIN_DIAS_COMITE = num;
  localStorage.setItem('htc_min_dias_comite', String(num));
  aplicarEtiquetasMinDiasPistoleo();

  const caja = document.getElementById('cajaControlDias');
  const btn = document.getElementById('btnAprobarDias');
  if (caja && btn) {
    caja.classList.add('aprobado-flash');
    btn.classList.add('confirmado');
    btn.innerText = '✓ Listo';
    setTimeout(() => {
      caja.classList.remove('aprobado-flash');
      btn.classList.remove('confirmado');
      btn.innerText = '✓ Aplicar';
    }, 1200);
  }
  if (sesionPistoleo) actualizarKPIsPistoleo();
  cargarDatos();
  enfocarPistola();
}

function subirYUnirMitadLike() {
  const file = document.getElementById('inputExcelLike')?.files[0];
  const auditorMitad = obtenerAuditorActivoPistoleo();
  let tiendaNombre = document.getElementById('txtTiendaPistoleo')?.value.trim().toUpperCase() || '';
  const msg = document.getElementById('msgCargaLike');

  if (!file) {
    msg.innerText = '📡 Unificando avances actuales desde Google Sheets...';
    unirseASesionVivo();
    return;
  }

  msg.innerText = `Leyendo base total de ${auditorMitad} y cruzando avances...`;

  const reader = new FileReader();
  reader.onload = async function(e) {
    const wb = XLSX.read(e.target.result, { type: 'array', raw: false });
    const hojaNombre = wb.SheetNames.includes('Toma(pistoleo)') ? 'Toma(pistoleo)' : wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[hojaNombre], { defval: '', raw: false });

    const mapa = {};
    let unidadesTotales = 0;

    rows.forEach(r => {
      const clean = {};
      Object.keys(r).forEach(k => clean[k.trim()] = r[k]);

      const rawCod = String(obtenerCampoFilaLike(clean, ['Codigo', 'Codigo Producto']) || '');
      const codigo = normalizarClavePistoleo(rawCod.split('(')[0]);
      const serial = normalizarClavePistoleo(obtenerCampoFilaLike(clean, ['Serial 1', 'Serial', 'Serial1', 'IMEI']));
      const desc = String(obtenerCampoFilaLike(clean, ['Descripcion', 'Producto']) || '').trim();
      const sucFila = String(obtenerCampoFilaLike(clean, ['Sucursal']) || '').trim().toUpperCase();

      if (!tiendaNombre && sucFila && !sucFila.includes('REGISTROS')) {
        tiendaNombre = sucFila;
        document.getElementById('txtTiendaPistoleo').value = tiendaNombre;
      }

      const dias = limpiarNumeroLike(obtenerCampoFilaLike(clean, ['Antiguedad', 'Dias en inventario']) || 0);
      const costo = limpiarNumeroLike(obtenerCampoFilaLike(clean, ['Costo de compra']) || 0);
      const estadoExcel = String(obtenerCampoFilaLike(clean, ['Novedades(estado)', 'Estado']) || '').trim();
      const obsExcel = String(obtenerCampoFilaLike(clean, ['Observacion']) || '').trim();
      const cantFila = limpiarNumeroLike(obtenerCampoFilaLike(clean, ['Existencias', 'Existencia', 'Cantidad']) || 1) || 1;

      if (!codigo || codigo === '0' || !desc || desc === '0') return;
      unidadesTotales += cantFila;

      if (!mapa[codigo]) {
        mapa[codigo] = {
          codigo,
          descripcion: desc,
          cantTeorica: 0,
          cantFisica: 0,
          fisicoPorAuditor: {},
          serialesTeoricos: [],
          serialesEscaneados: [],
          dias,
          costoUnit: costo,
          estado: estadoExcel || 'Bueno / funcional',
          observacion: obsExcel || 'Caja deteriorada y con polvo.',
          obsAdicional: '',
          esEstadoOtro: false,
          foto1: '',
          foto2: ''
        };
      }
      mapa[codigo].cantTeorica += cantFila;
      if (dias > mapa[codigo].dias) mapa[codigo].dias = dias;
      if (serial && serial !== 'NAN' && serial !== 'NONE' && !mapa[codigo].serialesTeoricos.includes(serial)) {
        mapa[codigo].serialesTeoricos.push(serial);
      }
    });

    const items = Object.values(mapa);
    if (items.length === 0) {
      msg.innerText = 'No se encontraron productos válidos en ese archivo Excel.';
      return;
    }

    const sucursalFinal = tiendaNombre || 'TIENDA';
    let sesionNueva = {
      sucursal: sucursalFinal,
      auditor: auditorMitad,
      mitadesCargadas: [auditorMitad],
      items,
      sobrantes: [],
      cruces: []
    };

    // 1) Combinar primero con lo que ya estaba pistoleado localmente si es la misma tienda
    if (sesionPistoleo && sesionPistoleo.sucursal === sucursalFinal) {
      sesionNueva = consolidarSesionesInventarioTotal(sesionPistoleo, sesionNueva);
    }

    // 2) Consultar la nube por si el otro auditor ya subió o pistoleó su parte en esta tienda
    try {
      const rRemoto = await fetch(API_URL);
      const dRemoto = await rRemoto.json();
      if (dRemoto.sesionVivo && dRemoto.sesionVivo.sucursal === sucursalFinal) {
        sesionNueva = consolidarSesionesInventarioTotal(dRemoto.sesionVivo, sesionNueva);
      }
    } catch (err) {}

    // 3) Publicar en la nube el estado ya consolidado para que no pise al otro auditor
    fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({ accion: 'iniciar_sesion_vivo', sesion: sesionNueva })
    })
    .then(r => r.json())
    .then(res => {
      if (res.ok && res.sesion) {
        sesionPistoleo = consolidarSesionesInventarioTotal(sesionNueva, res.sesion);
        guardarSesionPistoleoLocal();
        restaurarUIPistoleo();
        if (typeof poblarSucursales === 'function') poblarSucursales();
        const cargados = (sesionPistoleo.mitadesCargadas || [auditorMitad]).join(' + ');
        msg.innerText = `✅ Base cargada y cruzada (${cargados}): ${sesionPistoleo.items.length} refs (${unidadesTotales} und.) en ${sesionPistoleo.sucursal}.`;
      } else {
        sesionPistoleo = sesionNueva;
        guardarSesionPistoleoLocal();
        restaurarUIPistoleo();
        msg.innerText = '⚠️ Guardado local (revisa conexión con Sheets): ' + (res.error || '');
      }
    })
    .catch(() => {
      sesionPistoleo = sesionNueva;
      guardarSesionPistoleoLocal();
      restaurarUIPistoleo();
      msg.innerText = '⚠️ Trabajando en modo local sin conexión a la nube.';
    });
    enfocarPistola();
  };
  reader.readAsArrayBuffer(file);
}

async function unirseASesionVivo() {
  const msg = document.getElementById('msgCargaLike');
  msg.innerText = '📡 Conectando y cruzando avances desde Google Sheets...';
  try {
    const resp = await fetch(API_URL);
    const data = await resp.json();
    if (!data.sesionVivo || !data.sesionVivo.items || data.sesionVivo.items.length === 0) {
      msg.innerText = '⚠️ Aún no hay inventario cargado en la nube. Sube el archivo con el botón verde.';
      return;
    }
    if (sesionPistoleo && sesionPistoleo.sucursal === data.sesionVivo.sucursal) {
      sesionPistoleo = consolidarSesionesInventarioTotal(sesionPistoleo, data.sesionVivo);
    } else {
      sesionPistoleo = consolidarSesionesInventarioTotal(null, data.sesionVivo);
    }
    guardarSesionPistoleoLocal();
    restaurarUIPistoleo();
    if (typeof poblarSucursales === 'function') poblarSucursales();
    const cargados = (sesionPistoleo.mitadesCargadas || []).join(' + ');
    msg.innerText = `✅ Conectado y cruzado (${cargados || 'En vivo'}) en ${sesionPistoleo.sucursal} (${sesionPistoleo.items.length} refs).`;
    enfocarPistola();
  } catch (e) {
    msg.innerText = '⚠️ Error de conexión al sincronizar en vivo.';
  }
}

function enviarDisparoEnVivo(payload) {
  const auditorMitad = obtenerAuditorActivoPistoleo();
  fetch(API_URL, {
    method: 'POST',
    body: JSON.stringify({ accion: 'sync_disparo_vivo', auditor: auditorMitad, ...payload })
  })
  .then(r => r.json())
  .then(res => {
    if (res.ok && res.sesion && sesionPistoleo) {
      fusionarProgresoEnVivo(res.sesion);
    }
  }).catch(() => {});
}

function fusionarProgresoEnVivo(remoto) {
  if (!sesionPistoleo || !remoto || remoto.sucursal !== sesionPistoleo.sucursal) return;
  const antes = JSON.stringify({
    items: sesionPistoleo.items.map(i => [i.codigo, i.cantFisica, i.serialesEscaneados, i.foto1, i.foto2]),
    sobrantes: sesionPistoleo.sobrantes,
    cruces: sesionPistoleo.cruces
  });

  sesionPistoleo = consolidarSesionesInventarioTotal(sesionPistoleo, remoto);

  const despues = JSON.stringify({
    items: sesionPistoleo.items.map(i => [i.codigo, i.cantFisica, i.serialesEscaneados, i.foto1, i.foto2]),
    sobrantes: sesionPistoleo.sobrantes,
    cruces: sesionPistoleo.cruces
  });

  if (antes !== despues) {
    guardarSesionPistoleoLocal();
    actualizarKPIsPistoleo();
  }
}

function guardarSesionPistoleoLocal() {
  if (sesionPistoleo) localStorage.setItem('htc_sesion_pistoleo', JSON.stringify(sesionPistoleo));
}

function reiniciarSesionPistoleo() {
  if (!confirm('¿Seguro que deseas borrar el conteo actual en memoria para iniciar una tienda nueva?')) return;
  localStorage.removeItem('htc_sesion_pistoleo');
  sesionPistoleo = null;
  document.getElementById('zonaTrabajoPistoleo').classList.add('d-none');
  document.getElementById('panelFotoInmediataPistoleo').classList.add('d-none');
  document.getElementById('msgCargaLike').innerText = '';
}

function restaurarUIPistoleo() {
  if (!sesionPistoleo) return;
  document.getElementById('zonaTrabajoPistoleo').classList.remove('d-none');
  document.getElementById('badgeTiendaPistoleo').innerText = '🏪 TIENDA: ' + sesionPistoleo.sucursal;
  actualizarKPIsPistoleo();
}

function reproducirBeep(tipo) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (tipo === 'OK') { osc.frequency.value = 880; gain.gain.value = 0.12; }
    else if (tipo === 'FOTO') { osc.frequency.value = 620; gain.gain.value = 0.18; }
    else { osc.frequency.value = 260; gain.gain.value = 0.2; }
    osc.start();
    setTimeout(() => { osc.stop(); ctx.close(); }, tipo === 'OK' ? 90 : 240);
  } catch (e) {}
}

function procesarDisparoPistola(valorRaw) {
  const lecturaNorm = normalizarClavePistoleo(valorRaw);
  const lecturaSinParentesis = normalizarClavePistoleo(String(valorRaw || '').split('(')[0]);
  if (!lecturaNorm || !sesionPistoleo) return;

  const auditorActual = obtenerAuditorActivoPistoleo();
  const alerta = document.getElementById('alertaUltimoPistoleo');

  const itemPorSerialEscaneado = sesionPistoleo.items.find(x =>
    (x.serialesEscaneados || []).some(s => normalizarClavePistoleo(s) === lecturaNorm)
  );

  if (itemPorSerialEscaneado) {
    reproducirBeep('ALERTA');
    alerta.className = 'alert alert-danger small fw-bold mb-0 py-2 rounded-3 d-flex justify-content-between align-items-center gap-2';
    alerta.innerHTML = `
      <span>⚠️ <strong>SERIAL YA REGISTRADO:</strong> <code>${lecturaNorm}</code> (${itemPorSerialEscaneado.descripcion}). Verificar si es doble disparo.</span>
      <button type="button" class="btn btn-outline-danger btn-sm fw-bold flex-shrink-0" onclick="forzarSobranteManual('${lecturaNorm.replace(/'/g, "\\'")}', '${itemPorSerialEscaneado.codigo.replace(/'/g, "\\'")}')">+1 Sobrante</button>
    `;
    return;
  }

  const item =
    sesionPistoleo.items.find(x =>
      (x.serialesTeoricos || []).some(s => normalizarClavePistoleo(s) === lecturaNorm)
    ) ||
    sesionPistoleo.items.find(x => {
      const codItem = normalizarClavePistoleo(x.codigo);
      return codItem === lecturaNorm || (lecturaSinParentesis && codItem === lecturaSinParentesis);
    });

  if (item) {
    if (item.cantFisica < item.cantTeorica) {
      if (!item.fisicoPorAuditor) item.fisicoPorAuditor = {};
      item.fisicoPorAuditor[auditorActual] = Number(item.fisicoPorAuditor[auditorActual] || 0) + 1;

      const codItemNorm = normalizarClavePistoleo(item.codigo);
      const serialDisparado = (lecturaNorm !== codItemNorm && lecturaSinParentesis !== codItemNorm) ? lecturaNorm : '';
      if (serialDisparado && !item.serialesEscaneados.includes(serialDisparado)) {
        item.serialesEscaneados.push(serialDisparado);
      }
      recalcularFisicoItem(item);

      const faltaFotoRef = !item.foto1 || !item.foto2;
      if (item.dias >= MIN_DIAS_COMITE && pedirFotosActivo && faltaFotoRef) {
        reproducirBeep('FOTO');
        alerta.className = 'alert alert-warning small fw-bold mb-0 py-2 rounded-3';
        alerta.innerHTML = `📸 <strong>${item.codigo}</strong> (${item.dias} días) — Registra Estado, Observación y 2 Fotos (${item.cantFisica}/${item.cantTeorica} und.)`;
        abrirPanelFotoInmediata(item);
      } else {
        reproducirBeep('OK');
        alerta.className = 'alert alert-success small fw-bold mb-0 py-2 rounded-3';
        const tagObs = item.dias >= MIN_DIAS_COMITE ? ` · ≥${MIN_DIAS_COMITE}d ${pedirFotosActivo ? '(Fotos OK)' : '(Modo solo conteo)'}` : ` · ${item.dias}d`;
        alerta.innerHTML = `✅ <strong>${item.codigo}</strong> - ${item.descripcion} (${item.cantFisica}/${item.cantTeorica} und.${tagObs})`;
      }

      guardarSesionPistoleoLocal();
      actualizarKPIsPistoleo();
      enviarDisparoEnVivo({
        tipo: 'ITEM_OK',
        codigo: item.codigo,
        serial: serialDisparado,
        estado: item.estado,
        observacion: item.observacion
      });
    } else {
      reproducirBeep('ALERTA');
      alerta.className = 'alert alert-danger small fw-bold mb-0 py-2 rounded-3 d-flex justify-content-between align-items-center gap-2';
      alerta.innerHTML = `
        <span>⚠️ <strong>CÓDIGO YA REGISTRADO (${item.cantFisica}/${item.cantTeorica}):</strong> <code>${item.codigo}</code> - ${item.descripcion}. Verificar.</span>
        <button type="button" class="btn btn-outline-danger btn-sm fw-bold flex-shrink-0" onclick="forzarSobranteManual('${lecturaNorm.replace(/'/g, "\\'")}', '${item.codigo.replace(/'/g, "\\'")}')">+1 Sobrante</button>
      `;
    }
  } else {
    const sobYaExiste = sesionPistoleo.sobrantes.find(s =>
      normalizarClavePistoleo(s.codigo) === lecturaNorm || normalizarClavePistoleo(s.serial) === lecturaNorm
    );
    reproducirBeep('ALERTA');
    if (sobYaExiste) {
      alerta.className = 'alert alert-danger small fw-bold mb-0 py-2 rounded-3 d-flex justify-content-between align-items-center gap-2';
      alerta.innerHTML = `
        <span>⚠️ <strong>SOBRANTE YA REGISTRADO:</strong> <code>${lecturaNorm}</code> (${sobYaExiste.sobrante} und.). Verificar.</span>
        <button type="button" class="btn btn-outline-danger btn-sm fw-bold flex-shrink-0" onclick="forzarSobranteManual('${lecturaNorm.replace(/'/g, "\\'")}', '')">+1 Más</button>
      `;
    } else {
      registrarSobrante(lecturaNorm, 'Producto no registrado en teórico LIKE', lecturaNorm, 0);
      alerta.className = 'alert alert-info small fw-bold mb-0 py-2 rounded-3';
      alerta.innerHTML = `➕ <strong>SOBRANTE NUEVO:</strong> Código/Serial <code>${lecturaNorm}</code> no figura en LIKE. Usa <strong>🔄 Cruzar</strong> si equivale a otro código.`;
      guardarSesionPistoleoLocal();
      actualizarKPIsPistoleo();
    }
  }
}

function forzarSobranteManual(lectura, codigoRef) {
  if (!sesionPistoleo) return;
  const item = codigoRef ? sesionPistoleo.items.find(x => x.codigo === codigoRef) : null;
  if (item) registrarSobrante(item.codigo, item.descripcion, lectura !== item.codigo ? lectura : '', item.costoUnit);
  else registrarSobrante(lectura, 'Producto no registrado en teórico LIKE', lectura, 0);

  const alerta = document.getElementById('alertaUltimoPistoleo');
  alerta.className = 'alert alert-info small fw-bold mb-0 py-2 rounded-3';
  alerta.innerHTML = `➕ <strong>SOBRANTE CONFIRMADO:</strong> Se sumó 1 unidad adicional de <code>${lectura}</code>.`;
  guardarSesionPistoleoLocal();
  actualizarKPIsPistoleo();
  enfocarPistola();
}

function registrarSobrante(codigo, descripcion, serial, costoUnit) {
  const existente = sesionPistoleo.sobrantes.find(s => s.codigo === codigo && s.serial === serial);
  if (existente) {
    existente.sobrante += 1;
    existente.valorSobrante = existente.sobrante * existente.costoUnit;
  } else {
    sesionPistoleo.sobrantes.push({
      codigo, descripcion, serial, sobrante: 1,
      costoUnit: Number(costoUnit || 0), valorSobrante: Number(costoUnit || 0)
    });
  }
  enviarDisparoEnVivo({ tipo: 'SOBRANTE', codigo, descripcion, serial, costoUnit });
}

function eliminarSobranteIdx(idx) {
  if (!sesionPistoleo) return;
  const item = sesionPistoleo.sobrantes[idx];
  if (!item) return;
  if (item.sobrante > 1) {
    item.sobrante -= 1;
    item.valorSobrante = item.sobrante * item.costoUnit;
  } else {
    sesionPistoleo.sobrantes.splice(idx, 1);
  }
  guardarSesionPistoleoLocal();
  actualizarKPIsPistoleo();
  enviarDisparoEnVivo({ tipo: 'ELIMINAR_SOB', idxSob: idx });
  enfocarPistola();
}

function abrirPanelFotoInmediata(item) {
  itemPistoleoFotoActual = item;
  document.getElementById('panelFotoInmediataPistoleo').classList.remove('d-none');
  document.getElementById('pFotoTitulo').innerText = `${item.codigo} - ${item.descripcion} (${item.dias} días · ${item.cantFisica}/${item.cantTeorica} und.)`;
  document.getElementById('pImg1').src = (item.foto1 && item.foto1 !== 'OK') ? item.foto1 : 'https://via.placeholder.com/250x180?text=Foto+1';
  document.getElementById('pImg2').src = (item.foto2 && item.foto2 !== 'OK') ? item.foto2 : 'https://via.placeholder.com/250x180?text=Foto+2';
  document.getElementById('txtObsAdicional').value = item.obsAdicional || '';

  const esEstandar = ['Bueno / funcional', 'Funcional con novedad', 'Baja'].includes(item.estado);
  if (esEstandar) seleccionarEstadoToma(item.estado, item.observacion);
  else if (item.esEstadoOtro) {
    document.getElementById('txtEstadoPersonalizado').value = item.estado || '';
    document.getElementById('txtObsPersonalizada').value = item.observacion || '';
    seleccionarEstadoToma('Otro');
  } else seleccionarEstadoToma('Bueno / funcional', item.observacion);

  document.getElementById('msgFotoPistoleo').innerText = item.foto1 && item.foto2 ? '✓ Este lote ya tiene sus 2 fotos.' : '';
}

function seleccionarEstadoToma(estadoNombre, obsPrevia = '') {
  if (!itemPistoleoFotoActual) return;
  const mapClases = {
    'Bueno / funcional': { id: 'btnEst_Bueno', cls: 'activo-bueno' },
    'Funcional con novedad': { id: 'btnEst_Novedad', cls: 'activo-novedad' },
    'Baja': { id: 'btnEst_Baja', cls: 'activo-baja' },
    'Otro': { id: 'btnEst_Otro', cls: 'activo-pendiente' }
  };
  Object.entries(mapClases).forEach(([est, info]) => {
    const btn = document.getElementById(info.id);
    if (btn) btn.className = 'btn-estado-toma' + (est === estadoNombre ? ' ' + info.cls : '');
  });

  const bloqueEst = document.getElementById('bloqueObsEstandar');
  const bloqueOtro = document.getElementById('bloqueObsOtro');
  if (estadoNombre === 'Otro') {
    itemPistoleoFotoActual.esEstadoOtro = true;
    bloqueEst.classList.add('d-none');
    bloqueOtro.classList.remove('d-none');
    document.getElementById('txtEstadoPersonalizado').focus();
  } else {
    itemPistoleoFotoActual.esEstadoOtro = false;
    itemPistoleoFotoActual.estado = estadoNombre;
    bloqueOtro.classList.add('d-none');
    bloqueEst.classList.remove('d-none');
    const opciones = CATALOGO_ESTADOS_TOMA[estadoNombre] || [];
    const sel = document.getElementById('selectObsEstandar');
    sel.innerHTML = opciones.map(op => `<option value="${op}">${op}</option>`).join('');
    if (obsPrevia && opciones.includes(obsPrevia)) sel.value = obsPrevia;
  }
  actualizarObservacionItemPistoleo();
}

function actualizarObservacionItemPistoleo() {
  if (!itemPistoleoFotoActual) return;
  if (itemPistoleoFotoActual.esEstadoOtro) {
    const estCustom = document.getElementById('txtEstadoPersonalizado').value.trim();
    const obsCustom = document.getElementById('txtObsPersonalizada').value.trim();
    itemPistoleoFotoActual.estado = estCustom || 'Otro';
    itemPistoleoFotoActual.observacion = obsCustom || 'Sin observación adicional';
  } else {
    const baseObs = document.getElementById('selectObsEstandar').value;
    const extra = document.getElementById('txtObsAdicional').value.trim();
    itemPistoleoFotoActual.obsAdicional = extra;
    itemPistoleoFotoActual.observacion = extra ? `${baseObs} (${extra})` : baseObs;
  }
  guardarSesionPistoleoLocal();
  actualizarKPIsPistoleo();
}

function cerrarPanelEvaluacionPistoleo() {
  document.getElementById('panelFotoInmediataPistoleo').classList.add('d-none');
  enfocarPistola();
}

function aplicarFotoCamaraPistoleo(numFoto, base64) {
  if (!itemPistoleoFotoActual) return;
  if (numFoto === 1) {
    itemPistoleoFotoActual.foto1 = base64;
    document.getElementById('pImg1').src = base64;
  } else {
    itemPistoleoFotoActual.foto2 = base64;
    document.getElementById('pImg2').src = base64;
  }
  guardarSesionPistoleoLocal();
  actualizarKPIsPistoleo();
  document.getElementById('msgFotoPistoleo').innerText =
    itemPistoleoFotoActual.foto1 && itemPistoleoFotoActual.foto2
      ? '✓ ¡2 fotos y estado listos!'
      : `✓ Foto ${numFoto} capturada desde cámara USB.`;
}

async function capturarFotoPistoleoLocal(numFoto, inputEl) {
  const file = inputEl.files[0];
  if (!file || !itemPistoleoFotoActual) return;
  const msg = document.getElementById('msgFotoPistoleo');
  msg.innerText = `⚡ Procesando Foto ${numFoto}...`;
  try {
    const base64 = await comprimirImagenRapida(file, 640, 0.58);
    inputEl.value = '';
    aplicarFotoCamaraPistoleo(numFoto, base64);
  } catch (e) {
    msg.innerText = '⚠️ Error al procesar la foto.';
  }
}

function actualizarKPIsPistoleo() {
  if (!sesionPistoleo) return;
  let totalTeorico = 0, totalFisico = 0, faltUnd = 0, faltValor = 0;

  sesionPistoleo.items.forEach(it => {
    totalTeorico += it.cantTeorica;
    totalFisico += it.cantFisica;
    const diff = Math.max(0, it.cantTeorica - it.cantFisica);
    if (diff > 0) { faltUnd += diff; faltValor += diff * it.costoUnit; }
  });

  const sobUnd = sesionPistoleo.sobrantes.reduce((acc, s) => acc + s.sobrante, 0);
  const sobValor = sesionPistoleo.sobrantes.reduce((acc, s) => acc + s.valorSobrante, 0);
  const obs120Items = sesionPistoleo.items.filter(it => it.cantFisica > 0 && it.dias >= MIN_DIAS_COMITE);

  document.getElementById('progresoPistoleoTxt').innerText = `${totalFisico} / ${totalTeorico} unidades pistoleadas`;
  document.getElementById('kpiPistOk').innerText = totalFisico;
  document.getElementById('kpiPistFaltValor').innerText = '$' + faltValor.toLocaleString('es-CO');
  document.getElementById('kpiPistFaltCant').innerText = `${faltUnd} und.`;
  document.getElementById('kpiPistSobCant').innerText = sobUnd;
  document.getElementById('kpiPistSobValor').innerText = '$' + sobValor.toLocaleString('es-CO');

  const faltItems = sesionPistoleo.items.filter(it => it.cantTeorica > it.cantFisica);
  document.getElementById('badgeSubFalt').innerText = faltItems.length;
  document.getElementById('badgeSubSob').innerText = sesionPistoleo.sobrantes.length;
  document.getElementById('badgeSubObs120').innerText = obs120Items.length;

  mostrarSublistaPistoleo(sublistaPistoleoVista);
}

function mostrarSublistaPistoleo(tipo) {
  sublistaPistoleoVista = tipo;
  const cont = document.getElementById('contenedorSublistaPistoleo');
  const btnF = document.getElementById('btnSubFaltantes');
  const btnS = document.getElementById('btnSubSobrantes');
  const btnO = document.getElementById('btnSubObs120');

  btnF.className = tipo === 'FALTANTES' ? 'btn btn-danger btn-sm flex-fill fw-bold rounded-3' : 'btn btn-outline-danger btn-sm flex-fill fw-bold rounded-3';
  btnS.className = tipo === 'SOBRANTES' ? 'btn btn-primary btn-sm flex-fill fw-bold rounded-3' : 'btn btn-outline-primary btn-sm flex-fill fw-bold rounded-3';
  btnO.className = tipo === 'OBS120' ? 'btn btn-warning text-dark btn-sm flex-fill fw-bold rounded-3' : 'btn btn-outline-warning text-dark btn-sm flex-fill fw-bold rounded-3';

  if (tipo === 'FALTANTES') {
    const faltantes = sesionPistoleo.items.filter(it => it.cantTeorica > it.cantFisica);
    if (faltantes.length === 0) {
      cont.innerHTML = '<div class="text-success small fw-bold text-center py-3">🎉 ¡Cero faltantes! Todo el inventario teórico está cuadrado.</div>';
      return;
    }
    cont.innerHTML = faltantes.map(f => {
      const diff = f.cantTeorica - f.cantFisica;
      const cobro = diff * f.costoUnit;
      const serialesPend = f.serialesTeoricos.filter(s => !f.serialesEscaneados.includes(s)).join(', ');
      return `
        <div class="d-flex justify-content-between align-items-center py-2 px-2 border-bottom bg-white rounded-2 mb-1 small">
          <div>
            <span class="badge bg-dark">${f.codigo}</span>
            <strong class="ms-1">${f.descripcion}</strong>
            <div class="text-muted" style="font-size: 0.7rem;">
              Teórico: ${f.cantTeorica} · Físico: ${f.cantFisica} · <span class="text-danger fw-bold">Faltan: ${diff}</span>
              ${serialesPend ? `<br>Seriales: <span class="font-monospace">${serialesPend}</span>` : ''}
            </div>
          </div>
          <div class="text-end flex-shrink-0">
            <div class="fw-bold text-danger">$${cobro.toLocaleString('es-CO')}</div>
            <small class="text-muted" style="font-size: 0.65rem;">Para cobro</small>
          </div>
        </div>
      `;
    }).join('');
  } else if (tipo === 'SOBRANTES') {
    const crucesHechos = sesionPistoleo.cruces || [];
    if (sesionPistoleo.sobrantes.length === 0 && crucesHechos.length === 0) {
      cont.innerHTML = '<div class="text-muted small text-center py-3">No se han registrado sobrantes en esta tienda.</div>';
      return;
    }
    const htmlSobrantes = sesionPistoleo.sobrantes.map((s, idx) => `
      <div class="d-flex justify-content-between align-items-center py-2 px-2 border-bottom bg-white rounded-2 mb-1 small gap-2">
        <div>
          <span class="badge bg-primary">${s.codigo}</span>
          <strong class="ms-1">${s.descripcion}</strong>
          ${s.serial ? `<div class="text-muted font-monospace" style="font-size: 0.7rem;">Serial: ${s.serial}</div>` : ''}
        </div>
        <div class="d-flex align-items-center gap-1 flex-shrink-0">
          <span class="badge bg-info text-dark">+${s.sobrante}</span>
          <button type="button" class="btn btn-warning text-dark btn-sm py-0 px-2 fw-bold" style="font-size:0.68rem;" onclick="abrirCruceSobrante(${idx})">🔄 Cruzar</button>
          <button type="button" class="btn btn-outline-danger btn-sm py-0 px-2" style="font-size:0.68rem;" onclick="eliminarSobranteIdx(${idx})">✕</button>
        </div>
      </div>
    `).join('');

    const htmlCruces = crucesHechos.length > 0 ? `
      <div class="mt-2 pt-2 border-top">
        <small class="fw-bold text-success d-block mb-1" style="font-size:0.7rem;">✅ Cruces conciliados en esta sesión (${crucesHechos.length}):</small>
        ${crucesHechos.map(c => `
          <div class="py-1 px-2 bg-success-subtle border border-success rounded-2 mb-1" style="font-size:0.7rem;">
            🔄 Sobrante <strong>${c.codigoSobrante}</strong> cruzado con <strong>${c.codigoFaltante}</strong> (${c.descripcionFaltante})
          </div>
        `).join('')}
      </div>
    ` : '';

    cont.innerHTML = htmlSobrantes + htmlCruces;
  } else {
    const obsItems = sesionPistoleo.items.filter(it => it.cantFisica > 0 && it.dias >= MIN_DIAS_COMITE);
    if (obsItems.length === 0) {
      cont.innerHTML = `<div class="text-muted small text-center py-3">Aún no has pistoleado productos con &ge; ${MIN_DIAS_COMITE} días.</div>`;
      return;
    }
    cont.innerHTML = obsItems.map(it => `
      <div class="d-flex justify-content-between align-items-center py-2 px-2 border-bottom bg-white rounded-2 mb-1 small" style="cursor:pointer;" onclick="reabrirEvaluacionCodigo('${it.codigo}')">
        <div>
          <span class="badge bg-dark">${it.codigo}</span>
          <span class="badge bg-warning text-dark">${it.estado}</span>
          <strong class="ms-1">${it.descripcion}</strong>
          <div class="text-muted" style="font-size: 0.7rem;">${it.dias}d · ${it.observacion}</div>
        </div>
        <div class="text-end flex-shrink-0">
          <span class="badge ${it.foto1 && it.foto2 ? 'bg-success' : 'bg-danger'}">${it.foto1 && it.foto2 ? '2/2 Fotos' : 'Falta foto'}</span>
        </div>
      </div>
    `).join('');
  }
}

function abrirCruceSobrante(idxSob) {
  if (!sesionPistoleo) return;
  const sob = sesionPistoleo.sobrantes[idxSob];
  if (!sob) return;
  const faltantes = sesionPistoleo.items.filter(it => it.cantTeorica > it.cantFisica);
  if (faltantes.length === 0) return alert('No hay productos faltantes pendientes en esta tienda para cruzar.');

  const palabrasSob = sob.descripcion.toLowerCase().split(' ').filter(p => p.length > 2);
  const ordenados = [...faltantes].sort((a, b) => {
    const scoreA = palabrasSob.filter(p => a.descripcion.toLowerCase().includes(p)).length;
    const scoreB = palabrasSob.filter(p => b.descripcion.toLowerCase().includes(p)).length;
    return scoreB - scoreA;
  });

  const cont = document.getElementById('contenedorSublistaPistoleo');
  cont.innerHTML = `
    <div class="p-2 bg-warning-subtle border border-warning rounded-3 mb-2">
      <div class="d-flex justify-content-between align-items-center mb-1">
        <strong class="text-dark small">🔄 Cruzar sobrante: <code>${sob.codigo}</code> (${sob.descripcion})</strong>
        <button type="button" class="btn-close btn-sm" onclick="mostrarSublistaPistoleo('SOBRANTES')"></button>
      </div>
      <input type="text" id="inputFiltroCruce" class="form-control form-control-sm mb-2 fw-semibold"
        placeholder="Pistolea o escribe el SERIAL, código o nombre del producto que sí está..."
        oninput="filtrarOpcionesCruce(this.value)"
        onkeydown="if(event.key==='Enter'){ const visibles = [...document.querySelectorAll('.opcion-cruce-item:not(.d-none)')]; if(visibles.length===1) visibles[0].click(); }">
      <div id="listaOpcionesCruce" class="d-flex flex-column gap-1" style="max-height: 210px; overflow-y: auto;">
        ${ordenados.map(f => {
          const serialesPend = f.serialesTeoricos.filter(s => !f.serialesEscaneados.includes(s));
          const serialesTxt = serialesPend.join(', ');
          const dataSearch = `${f.codigo} ${f.descripcion} ${serialesTxt}`.toLowerCase();
          return `
            <button type="button" class="btn btn-light border text-start btn-sm d-flex justify-content-between align-items-center opcion-cruce-item"
              data-texto="${dataSearch}"
              onclick="ejecutarCruceInventario(${idxSob}, '${f.codigo.replace(/'/g, "\\'")}')">
              <div>
                <strong>${f.codigo}</strong> · ${f.descripcion} <small class="text-danger">(Faltan: ${f.cantTeorica - f.cantFisica})</small>
                ${serialesTxt ? `<div class="text-muted font-monospace" style="font-size:0.68rem;">Serial: ${serialesTxt}</div>` : ''}
              </div>
              <span class="badge bg-success flex-shrink-0 ms-2">Aplicar Cruce →</span>
            </button>
          `;
        }).join('')}
      </div>
    </div>
  `;
  setTimeout(() => { document.getElementById('inputFiltroCruce')?.focus(); }, 50);
}

function filtrarOpcionesCruce(txt) {
  const q = txt.trim().toLowerCase();
  document.querySelectorAll('.opcion-cruce-item').forEach(btn => {
    btn.classList.toggle('d-none', q && !btn.dataset.texto.includes(q));
  });
}

function ejecutarCruceInventario(idxSob, codigoFaltante) {
  if (!sesionPistoleo) return;
  const sob = sesionPistoleo.sobrantes[idxSob];
  const itemFalt = sesionPistoleo.items.find(x => x.codigo === codigoFaltante);
  if (!sob || !itemFalt || itemFalt.cantFisica >= itemFalt.cantTeorica) return;

  itemFalt.cantFisica += 1;
  const notaCruce = `Cruce conciliado vs sobrante ${sob.codigo}${sob.serial && sob.serial !== sob.codigo ? ' (Serial: ' + sob.serial + ')' : ''}`;
  itemFalt.observacion = itemFalt.observacion ? `${itemFalt.observacion} | ${notaCruce}` : notaCruce;

  if (!sesionPistoleo.cruces) sesionPistoleo.cruces = [];
  const cruceInfo = {
    sucursal: sesionPistoleo.sucursal,
    codigoSobrante: sob.codigo,
    serialSobrante: sob.serial,
    codigoFaltante: itemFalt.codigo,
    descripcionFaltante: itemFalt.descripcion,
    costoUnit: itemFalt.costoUnit
  };
  sesionPistoleo.cruces.push(cruceInfo);

  if (sob.sobrante > 1) { sob.sobrante -= 1; sob.valorSobrante = sob.sobrante * sob.costoUnit; }
  else sesionPistoleo.sobrantes.splice(idxSob, 1);

  const alerta = document.getElementById('alertaUltimoPistoleo');
  alerta.className = 'alert alert-success small fw-bold mb-0 py-2 rounded-3';
  alerta.innerHTML = `🔄 <strong>CRUCE CONCILIADO:</strong> Sobrante <code>${sob.codigo}</code> cruzado con <code>${itemFalt.codigo}</code> (${itemFalt.descripcion}). Faltante eliminado del cobro.`;

  guardarSesionPistoleoLocal();
  actualizarKPIsPistoleo();
  mostrarSublistaPistoleo('SOBRANTES');
  enviarDisparoEnVivo({ tipo: 'CRUCE', idxSob, codigoFaltante, cruceInfo });
  enfocarPistola();
}

function reabrirEvaluacionCodigo(cod) {
  if (!sesionPistoleo) return;
  const it = sesionPistoleo.items.find(x => x.codigo === cod);
  if (it) abrirPanelFotoInmediata(it);
}

function toggleEscanerCamara() {
  const box = document.getElementById('contenedorCamaraQR');
  if (box.classList.contains('d-none')) {
    box.classList.remove('d-none');
    html5QrScanner = new Html5Qrcode('readerQR');
    html5QrScanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 140 } },
      (decodedText) => { procesarDisparoPistola(decodedText); detenerEscanerCamara(); },
      () => {}
    ).catch(() => {
      alert('No se pudo acceder a la cámara.');
      box.classList.add('d-none');
    });
  } else detenerEscanerCamara();
}

function detenerEscanerCamara() {
  const box = document.getElementById('contenedorCamaraQR');
  if (box) box.classList.add('d-none');
  if (html5QrScanner) {
    html5QrScanner.stop().then(() => html5QrScanner.clear()).catch(() => {});
    html5QrScanner = null;
  }
}

function exportarActaPistoleoCSV() {
  if (!sesionPistoleo) return;
  let csv = 'Tipo;Sucursal;Codigo;Descripcion;Seriales;Teorico;Fisico;Diferencia;Costo_Unit;Valor_Total;Estado_Toma;Observacion\n';
  sesionPistoleo.items.forEach(it => {
    const diff = it.cantTeorica - it.cantFisica;
    if (diff > 0) {
      const ser = it.serialesTeoricos.filter(s => !it.serialesEscaneados.includes(s)).join(', ');
      csv += `"FALTANTE COBRO";"${sesionPistoleo.sucursal}";"${it.codigo}";"${it.descripcion}";"${ser}";${it.cantTeorica};${it.cantFisica};${diff};${it.costoUnit};${diff * it.costoUnit};"No encontrado";"Faltante en auditoria fisica"\n`;
    }
    if (it.cantFisica > 0 && it.dias >= MIN_DIAS_COMITE) {
      const serEsc = (it.serialesEscaneados.length > 0 ? it.serialesEscaneados : it.serialesTeoricos).join(', ');
      csv += `"OBSOLESCENCIA >=${MIN_DIAS_COMITE}D";"${sesionPistoleo.sucursal}";"${it.codigo}";"${it.descripcion}";"${serEsc}";${it.cantTeorica};${it.cantFisica};0;${it.costoUnit};${it.costoUnit * it.cantFisica};"${it.estado}";"${it.observacion}"\n`;
    }
  });
  sesionPistoleo.sobrantes.forEach(s => {
    csv += `"SOBRANTE";"${sesionPistoleo.sucursal}";"${s.codigo}";"${s.descripcion}";"${s.serial}";0;${s.sobrante};${s.sobrante};${s.costoUnit};${s.valorSobrante};"Sobrante";"Encontrado fisicamente sin saldo en LIKE"\n`;
  });
  (sesionPistoleo.cruces || []).forEach(c => {
    csv += `"CRUCE CONCILIADO";"${c.sucursal}";"${c.codigoFaltante}";"${c.descripcionFaltante}";"${c.serialSobrante}";1;1;0;${c.costoUnit};0;"Cruce OK";"Cruzado fisicamente contra sobrante ${c.codigoSobrante}"\n`;
  });
  const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Acta_Auditoria_${sesionPistoleo.sucursal}.csv`;
  a.click();
}

async function cerrarYEnviarAuditoriaTienda() {
  if (!sesionPistoleo) return;
  const btn = document.getElementById('btnCerrarTiendaSync');
  const msg = document.getElementById('msgCierrePistoleo');
  btn.disabled = true;
  msg.innerText = 'Sincronizando último estado y guardando cierre en Sheets...';

  try {
    const rPre = await fetch(API_URL);
    const dPre = await rPre.json();
    if (dPre.sesionVivo) fusionarProgresoEnVivo(dPre.sesionVivo);
  } catch (e) {}

  const faltantes = sesionPistoleo.items
    .filter(it => it.cantTeorica > it.cantFisica)
    .map(it => {
      const diff = it.cantTeorica - it.cantFisica;
      return {
        codigo: it.codigo,
        descripcion: it.descripcion,
        seriales: it.serialesTeoricos.filter(s => !it.serialesEscaneados.includes(s)).join(', '),
        cantTeorica: it.cantTeorica,
        cantFisica: it.cantFisica,
        faltante: diff,
        costoUnit: it.costoUnit,
        valorCobro: diff * it.costoUnit
      };
    });

  const lotesComite = sesionPistoleo.items
    .filter(it => it.cantFisica > 0 && it.dias >= MIN_DIAS_COMITE)
    .map(it => ({
      sucursal: sesionPistoleo.sucursal,
      codigo: it.codigo,
      descripcion: it.descripcion,
      cantidad: it.cantFisica,
      seriales: (it.serialesEscaneados.length > 0 ? it.serialesEscaneados : it.serialesTeoricos).join(', '),
      dias: it.dias,
      costoUnit: it.costoUnit,
      costoTotal: it.costoUnit * it.cantFisica,
      estado: it.estado || 'Bueno / funcional',
      observacion: it.observacion || 'Caja deteriorada y con polvo.',
      foto1: (it.foto1 && it.foto1 !== 'OK') ? it.foto1 : '',
      foto2: (it.foto2 && it.foto2 !== 'OK') ? it.foto2 : ''
    }));

  try {
    const resp = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({
        accion: 'guardar_auditoria_pistoleo',
        sucursal: sesionPistoleo.sucursal,
        auditor: obtenerAuditorActivoPistoleo(),
        faltantes,
        sobrantes: sesionPistoleo.sobrantes,
        lotesComite
      })
    });
    const res = await resp.json();
    if (res.ok) {
      msg.innerText = `✅ ¡Cierre guardado! Faltantes: ${res.faltantesGuardados} · Sobrantes: ${res.sobrantesGuardados} · Nuevos Comité: ${res.insertadosComite}`;
      cargarDatos();
    } else {
      msg.innerText = '⚠️ Error al guardar: ' + (res.error || 'Intenta nuevamente');
    }
  } catch (e) {
    msg.innerText = '⚠️ Error de red al enviar el cierre.';
  } finally {
    btn.disabled = false;
  }
}