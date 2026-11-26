const API_URL = 'https://script.google.com/macros/s/AKfycbxfufJTUJK4jp9rr2_JHCGIZZCvFVSMi5USIazdQ1H5lMygCc7QnF1OaLuaOqrFcdQ-0w/exec';
const APP_VER = '80';

let MIN_DIAS_COMITE = Number(localStorage.getItem('htc_min_dias_comite') || 120);
let pedirFotosActivo = localStorage.getItem('htc_pedir_fotos_120') !== '0';

const NOMBRES_EVAL = {
  OSMEL: 'Oswal (Gerente General)',
  ANGELICA: 'Angélica (Gerente Administrativa)',
  ORLANDO: 'Orlando (Director Comercial)',
  ANDRES: 'Andrés (Jefe de Bodega)',
  JOHAN_OSCAR: 'Johan y Oscar (Operación)'
};

const CATALOGO_ESTADOS_TOMA = {
  'Bueno / funcional': [
    'Caja deteriorada y con polvo.',
    'Producto en condiciones normales.'
  ],
  'Funcional con novedad': [
    'Empaque abierto o deteriorado.',
    'Producto con rayones o desgaste físico.'
  ],
  'Baja': [
    'Producto averiado, no funcional y no apto para comercialización.',
    'Producto deteriorado, sin posibilidad de comercialización.'
  ],
  'Otro': []
};

let usuarioActivo = localStorage.getItem('htc_usuario') || '';
let vistaActual = 'comite';
let listaComite = [];
let listaFaltantesGlobal = [];
let listaSobrantesGlobal = [];
let serialesModalActuales = [];
let subidasEnCurso = 0;

const modulosCargados = new Set();

function limpiarNumeroLike(val) {
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const str = String(val || '').trim().replace(/\./g, '').replace(',', '.');
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

function normalizarUrlFotoDrive(url) {
  if (!url || typeof url !== 'string') return '';
  if (url.startsWith('data:image')) return url;
  const match = url.match(/(?:\/d\/|id=)([a-zA-Z0-9_-]{20,})/);
  if (match && match[1]) {
    return `https://lh3.googleusercontent.com/d/${match[1]}=w1000`;
  }
  return url;
}

function comprimirImagenRapida(file, maxW = 640, calidad = 0.58) {
  return new Promise((resolve, reject) => {
    const urlObj = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(urlObj);
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, maxW / img.width);
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', calidad));
    };
    img.onerror = reject;
    img.src = urlObj;
  });
}

async function asegurarModuloPestana(nombre) {
  if (modulosCargados.has(nombre)) return;
  const cont = document.getElementById(`contenedor-${nombre}`);
  if (!cont) return;

  const resp = await fetch(`pestanas/${nombre}/${nombre}.html?v=${APP_VER}`);
  cont.innerHTML = await resp.text();

  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `pestanas/${nombre}/${nombre}.js?v=${APP_VER}`;
    script.onload = resolve;
    script.onerror = reject;
    document.body.appendChild(script);
  });

  modulosCargados.add(nombre);
}

window.onload = async () => {
  if (usuarioActivo && NOMBRES_EVAL[usuarioActivo]) {
    await mostrarAppPrincipal();
  } else {
    usuarioActivo = '';
    document.getElementById('pantallaIdentificacion').classList.remove('d-none');
    document.getElementById('appPrincipal').classList.add('d-none');
    document.getElementById('barraFlotanteComite').classList.add('d-none');
  }
  cargarDatos();
};

async function identificarUsuario(rol) {
  usuarioActivo = rol;
  localStorage.setItem('htc_usuario', rol);
  await mostrarAppPrincipal();
}

async function mostrarAppPrincipal() {
  document.getElementById('pantallaIdentificacion').classList.add('d-none');
  document.getElementById('appPrincipal').classList.remove('d-none');

  const label = document.getElementById('badgeRolUsuario');
  if (NOMBRES_EVAL[usuarioActivo]) {
    label.innerText = '👤 ' + NOMBRES_EVAL[usuarioActivo];
  }

  const navMenu = document.getElementById('navSegmentedMenu');
  if (usuarioActivo === 'JOHAN_OSCAR') {
    navMenu.classList.remove('modo-comite');
    document.getElementById('btnTabComite').classList.add('d-none');
    document.getElementById('btnTabCarga').classList.remove('d-none');
    document.getElementById('btnTabPistoleo').classList.remove('d-none');
    await cambiarVistaPestana('pistoleo');
  } else {
    navMenu.classList.add('modo-comite');
    document.getElementById('btnTabComite').classList.remove('d-none');
    document.getElementById('btnTabCarga').classList.add('d-none');
    document.getElementById('btnTabPistoleo').classList.add('d-none');
    await cambiarVistaPestana('comite');
  }
}

function cerrarSesionUsuario() {
  if (typeof detenerEscanerCamara === 'function') detenerEscanerCamara();
  localStorage.removeItem('htc_usuario');
  usuarioActivo = '';
  document.getElementById('appPrincipal').classList.add('d-none');
  document.getElementById('barraFlotanteComite').classList.add('d-none');
  document.getElementById('pantallaIdentificacion').classList.remove('d-none');
}

async function cambiarVistaPestana(nombre) {
  vistaActual = nombre;
  await asegurarModuloPestana(nombre);

  const mapas = {
    comite: { cont: 'contenedor-comite', btn: 'btnTabComite' },
    fotos: { cont: 'contenedor-fotos', btn: 'btnTabCarga' },
    pistoleo: { cont: 'contenedor-pistoleo', btn: 'btnTabPistoleo' },
    panel: { cont: 'contenedor-panel', btn: 'btnTabDashboard' }
  };

  Object.entries(mapas).forEach(([clave, info]) => {
    const c = document.getElementById(info.cont);
    const b = document.getElementById(info.btn);
    if (c) c.classList.toggle('d-none', clave !== nombre);
    if (b) b.classList.toggle('active', clave === nombre);
  });

  if (nombre !== 'pistoleo' && typeof detenerEscanerCamara === 'function') detenerEscanerCamara();
  if (nombre === 'comite' && typeof renderComite === 'function') renderComite();
  if (nombre === 'fotos' && typeof renderTablaFotos === 'function') renderTablaFotos();
  if (nombre === 'pistoleo' && typeof inicializarModuloPistoleo === 'function') inicializarModuloPistoleo();
  if (nombre === 'panel' && typeof renderDashboard === 'function') renderDashboard();

  const barra = document.getElementById('barraFlotanteComite');
  const appVisible = !document.getElementById('appPrincipal').classList.contains('d-none');
  const tieneItems = typeof listaFiltrada !== 'undefined' && listaFiltrada.length > 0;
  if (appVisible && nombre === 'comite' && tieneItems && usuarioActivo && usuarioActivo !== 'JOHAN_OSCAR') {
    barra.classList.remove('d-none');
  } else {
    barra.classList.add('d-none');
  }
}

async function cargarDatos() {
  const loader = document.getElementById('loader');
  if (!document.getElementById('appPrincipal').classList.contains('d-none')) {
    loader.classList.remove('d-none');
  }
  try {
    const resp = await fetch(API_URL);
    const data = await resp.json();
    listaComite = (data.comite || [])
      .filter(x => Number(x.dias || 0) >= MIN_DIAS_COMITE)
      .map(x => ({
        ...x,
        foto1: normalizarUrlFotoDrive(x.foto1),
        foto2: normalizarUrlFotoDrive(x.foto2)
      }));
    listaFaltantesGlobal = data.faltantes || [];
    listaSobrantesGlobal = data.sobrantes || [];

    loader.classList.add('d-none');
    if (typeof poblarSucursales === 'function') poblarSucursales();
    if (typeof renderComite === 'function') renderComite();
    if (typeof renderTablaFotos === 'function') renderTablaFotos();
    if (typeof fusionarProgresoEnVivo === 'function' && data.sesionVivo) fusionarProgresoEnVivo(data.sesionVivo);
    if (vistaActual === 'panel' && typeof renderDashboard === 'function') renderDashboard();
  } catch (e) {
    loader.className = 'alert alert-danger text-center rounded-4 py-2 small';
    loader.innerText = 'Error al conectar con Google Sheets.';
  }
}

function ampliarFoto(src) {
  if (!src || src.includes('via.placeholder.com')) return;
  document.getElementById('imgModalGrande').src = normalizarUrlFotoDrive(src);
  new bootstrap.Modal(document.getElementById('modalFoto')).show();
}

function copiarSerialesModal() {
  if (!serialesModalActuales || serialesModalActuales.length === 0) return;
  navigator.clipboard.writeText(serialesModalActuales.join('\n')).then(() => alert('✓ Lista de seriales copiada.'));
}

let streamCamaraWeb = null;
let camaraWebDestino = { numFoto: 1, origen: 'FOTOS' };
let modalCamaraWebInst = null;
let camaraPreferidaId = localStorage.getItem('htc_camara_usb_id') || '';

async function abrirCamaraWeb(numFoto, origen) {
  camaraWebDestino = { numFoto, origen };
  document.getElementById('tituloCamaraWeb').innerText = `📷 Foto ${numFoto}`;

  try {
    const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    tempStream.getTracks().forEach(t => t.stop());

    const dispositivos = await navigator.mediaDevices.enumerateDevices();
    const camaras = dispositivos.filter(d => d.kind === 'videoinput');

    const sel = document.getElementById('selectDispositivoCamara');
    sel.innerHTML = camaras.map((cam, idx) => `<option value="${cam.deviceId}">${cam.label || `Cámara ${idx + 1}`}</option>`).join('');

    let idElegido = camaraPreferidaId;
    if (!idElegido || !camaras.some(c => c.deviceId === idElegido)) {
      const externa = camaras.find(c => !/integrated|built-in|front/i.test(c.label));
      idElegido = externa ? externa.deviceId : (camaras[0]?.deviceId || '');
    }

    sel.value = idElegido;
    await iniciarStreamPorId(idElegido);

    modalCamaraWebInst = new bootstrap.Modal(document.getElementById('modalCamaraWeb'));
    modalCamaraWebInst.show();
  } catch (err) {
    alert('No se detectó cámara o faltan permisos en el navegador.');
  }
}

async function cambiarDispositivoCamara(deviceId) {
  if (!deviceId) return;
  camaraPreferidaId = deviceId;
  localStorage.setItem('htc_camara_usb_id', deviceId);
  await iniciarStreamPorId(deviceId);
}

async function iniciarStreamPorId(deviceId) {
  if (streamCamaraWeb) {
    streamCamaraWeb.getTracks().forEach(track => track.stop());
    streamCamaraWeb = null;
  }
  const video = document.getElementById('videoCamaraWeb');
  const constraints = deviceId
    ? { video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }
    : { video: true, audio: false };
  streamCamaraWeb = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = streamCamaraWeb;
}

function cerrarCamaraWeb() {
  if (streamCamaraWeb) {
    streamCamaraWeb.getTracks().forEach(track => track.stop());
    streamCamaraWeb = null;
  }
  if (modalCamaraWebInst) modalCamaraWebInst.hide();
}

async function capturarFrameCamaraWeb() {
  const video = document.getElementById('videoCamaraWeb');
  if (!video || !video.videoWidth) return;

  const canvas = document.createElement('canvas');
  const MAX_W = 640;
  const scale = Math.min(1, MAX_W / video.videoWidth);
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

  const base64Comprimida = canvas.toDataURL('image/jpeg', 0.62);
  const { numFoto, origen } = camaraWebDestino;
  cerrarCamaraWeb();

  if (origen === 'PISTOLEO' && typeof aplicarFotoCamaraPistoleo === 'function') {
    aplicarFotoCamaraPistoleo(numFoto, base64Comprimida);
  } else if (typeof aplicarFotoCamaraAuditoria === 'function') {
    aplicarFotoCamaraAuditoria(numFoto, base64Comprimida);
  }
}