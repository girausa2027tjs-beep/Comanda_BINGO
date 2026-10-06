/**
 * Comandas Gira USA Monkeys — backend en Google Apps Script
 * Planilla: PEDIDOS_BINGO (hojas: pedido, detalle_pedido, pedido_estado,
 * estado, producto, usuario, tipo_usuario).
 *
 * Instalación: Extensiones → Apps Script de la planilla, pegar este archivo,
 * Implementar → Nueva implementación → Aplicación web
 *   Ejecutar como: Yo   ·   Acceso: Cualquier usuario
 * y pegar la URL /exec en assets/config.js.
 *
 * Protecciones (mismas ideas que la app del kiosco, y algunas más):
 *  - Hojas y columnas ubicadas por encabezado normalizado (sin tildes,
 *    espacios ni guiones bajos): se puede reordenar columnas sin romper nada.
 *  - Toda escritura ocurre dentro de LockService (un solo escritor a la vez),
 *    así dos vendedores no obtienen el mismo número de pedido ni pisan filas.
 *  - numero_pedido correlativo = máximo existente + 1, calculado dentro del lock.
 *  - Anti-duplicado: cada envío trae un id único (reqId); si llega dos veces
 *    (doble clic, reintento por mala señal) se devuelve el mismo pedido.
 *  - Anti-sobreescritura: cada pedido viaja con una "versión" (huella de su
 *    estado actual). Si otra persona lo cambió entretanto, el cambio se rechaza
 *    y se pide recargar, en vez de pisar el trabajo del otro.
 *  - Precios y totales se calculan en el servidor desde la hoja producto;
 *    lo que mande el navegador como precio se ignora.
 *  - Fechas y horas se escriben como texto para que la planilla no las
 *    reinterprete; textos que empiezan con = + - @ se neutralizan.
 *  - La contraseña (2º apellido) nunca sale del servidor; tras ingresar se
 *    entrega un token de sesión y el servidor deduce quién es el usuario.
 *  - Eliminar es lógico (estado "Eliminado"): nunca se borra la fila.
 *  - POST con Content-Type text/plain para evitar el preflight CORS.
 */

var CONFIG = {
  // Vacío = usa la planilla a la que está vinculado el script.
  SPREADSHEET_ID: '1oPwnDMLjJnB2_puI3IPm9pM6vWLaX7ZN5ONJXQTW4IE',
  // id_usuario (hoja usuario) que pueden entrar como Administrador.
  // Ejemplo: [1, 17]
  ADMIN_IDS: [],
  TZ: 'America/Santiago',
  SESION_SEGUNDOS: 21600,          // 6 horas (máximo de CacheService)
  MAX_LINEAS: 40,
  MAX_CANTIDAD: 99,
  TIPOS_VENTA: ['Efectivo', 'Transferencia']
};

var ESTADO = { CREADO: 1, PREPARACION: 2, ENTREGADO: 3, ELIMINADO: 4 };

/* ------------------------------------------------------------------ */
/* Entrada HTTP                                                        */
/* ------------------------------------------------------------------ */

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action) return responder_(despachar_(p));
  return responder_({ ok: true, servicio: 'comandas', hora: ahora_().hora });
}

function doPost(e) {
  var body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return responder_({ ok: false, error: 'Solicitud inválida.' });
  }
  return responder_(despachar_(body));
}

function despachar_(req) {
  try {
    switch (String(req.action || '')) {
      case 'inicio':        return accionInicio_();
      case 'alumnos':       return accionAlumnos_(req);
      case 'login':         return accionLogin_(req);
      case 'productos':     return accionProductos_(sesion_(req));
      case 'misPedidos':    return accionMisPedidos_(sesion_(req));
      case 'todosPedidos':  return accionTodosPedidos_(sesion_(req, true));
      case 'crear':         return accionCrear_(sesion_(req), req);
      case 'editar':        return accionEditar_(sesion_(req), req);
      case 'estado':        return accionEstado_(sesion_(req), req);
      case 'logout':        CacheService.getScriptCache().remove('ses_' + req.token); return { ok: true };
      default:              return { ok: false, error: 'Acción desconocida.' };
    }
  } catch (err) {
    var msg = (err && err.usuario) ? err.message : 'Error del servidor: ' + (err && err.message);
    return { ok: false, error: msg, codigo: (err && err.codigo) || null };
  }
}

function responder_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function fallo_(msg, codigo) {
  var e = new Error(msg); e.usuario = true; e.codigo = codigo || null; return e;
}

/* ------------------------------------------------------------------ */
/* Acciones públicas (antes de ingresar)                               */
/* ------------------------------------------------------------------ */

function accionInicio_() {
  var us = leerTabla_('usuario');
  var cursos = {};
  us.filas.forEach(function (f) { var c = txt_(f.curso); if (c) cursos[c] = true; });
  var tipos = leerTabla_('tipousuario').filas
    .map(function (f) { return txt_(f.tipousuario); }).filter(String);
  return { ok: true, cursos: Object.keys(cursos).sort(), tiposUsuario: tipos };
}

function accionAlumnos_(req) {
  var curso = txt_(req.curso);
  if (!curso) throw fallo_('Selecciona un curso.');
  var lista = leerTabla_('usuario').filas
    .filter(function (f) { return txt_(f.curso) === curso; })
    .map(function (f) { return { id: num_(f.idusuario), nombre: nombreUsuario_(f) }; })
    .sort(function (a, b) { return a.nombre.localeCompare(b.nombre, 'es'); });
  return { ok: true, alumnos: lista };
}

function accionLogin_(req) {
  var id = num_(req.id_usuario);
  var clave = normalizarClave_(req.clave);
  var fila = leerTabla_('usuario').filas.filter(function (f) { return num_(f.idusuario) === id; })[0];
  // Mensaje genérico: no revela si falló el alumno o la clave.
  if (!fila || !clave || normalizarClave_(fila.segundoapellido) !== clave) {
    Utilities.sleep(600);
    throw fallo_('Alumno o contraseña incorrectos.');
  }
  var tipos = leerTabla_('tipousuario').filas.map(function (f) { return txt_(f.tipousuario); });
  var tipo = txt_(req.tipo_usuario);
  if (tipos.length && tipos.indexOf(tipo) < 0) tipo = tipos[0];

  var esAdmin = CONFIG.ADMIN_IDS.map(Number).indexOf(id) >= 0;
  var perfil = (req.perfil === 'admin') ? 'admin' : 'vendedor';
  if (perfil === 'admin' && !esAdmin) throw fallo_('Este usuario no tiene perfil Administrador.');

  var usuario = {
    id: id,
    nombre: nombreUsuario_(fila),
    curso: txt_(fila.curso),
    tipo: tipo,
    perfil: perfil,
    puedeAdmin: esAdmin
  };
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('ses_' + token, JSON.stringify(usuario), CONFIG.SESION_SEGUNDOS);
  return { ok: true, token: token, usuario: usuario };
}

/* ------------------------------------------------------------------ */
/* Sesión                                                              */
/* ------------------------------------------------------------------ */

function sesion_(req, soloAdmin) {
  var t = String(req.token || '');
  var raw = t ? CacheService.getScriptCache().get('ses_' + t) : null;
  if (!raw) throw fallo_('Tu sesión expiró. Vuelve a ingresar.', 'SESION');
  var u = JSON.parse(raw);
  // renueva la sesión mientras se use
  CacheService.getScriptCache().put('ses_' + t, raw, CONFIG.SESION_SEGUNDOS);
  if (soloAdmin && u.perfil !== 'admin') throw fallo_('Solo el Administrador puede hacer esto.');
  return u;
}

/* ------------------------------------------------------------------ */
/* Lectura                                                             */
/* ------------------------------------------------------------------ */

function accionProductos_(u) {
  var prods = catalogo_();
  var lista = Object.keys(prods).map(function (k) { return prods[k]; })
    .filter(function (p) { return p.activo; })
    .sort(function (a, b) { return a.nombre.localeCompare(b.nombre, 'es'); });
  return { ok: true, productos: lista };
}

function accionMisPedidos_(u) {
  var todos = cargarPedidos_();
  var mios = todos.filter(function (p) { return p.usuario === u.nombre; });
  mios.sort(function (a, b) { return b.numero - a.numero; });
  return { ok: true, pedidos: mios, hora: ahora_().hora };
}

function accionTodosPedidos_(u) {
  var todos = cargarPedidos_();
  todos.sort(function (a, b) { return a.numero - b.numero; });
  return { ok: true, pedidos: todos, hora: ahora_().hora };
}

function cargarPedidos_() {
  var prods = catalogo_();
  var est = estados_();
  var tp = leerTabla_('pedido');
  var td = leerTabla_('detallepedido');
  var te = leerTabla_('pedidoestado');

  var det = {};
  td.filas.forEach(function (f) {
    var n = num_(f.numeropedido); if (!n) return;
    var idp = num_(f.idproducto);
    var pr = prods[idp];
    (det[n] = det[n] || []).push({
      id: idp,
      nombre: pr ? pr.nombre : ('Producto ' + idp),
      cantidad: num_(f.cantidad),
      subtotal: num_(f.subtotal),
      precio: num_(f.cantidad) ? Math.round(num_(f.subtotal) / num_(f.cantidad)) : 0
    });
  });

  var hist = {};
  te.filas.forEach(function (f) {
    var n = num_(f.idpedido); if (!n) return;
    var id = num_(f.idestado);
    (hist[n] = hist[n] || []).push({
      id: id,
      estado: est.porId[id] || String(id),
      fecha: fechaTxt_(f.fechacambioestado),
      hora: horaTxt_(f.horacambioestado)
    });
  });

  return tp.filas.filter(function (f) { return num_(f.numeropedido) > 0; }).map(function (f) {
    var n = num_(f.numeropedido);
    var estadoNombre = txt_(f.estadoactual);
    var p = {
      numero: n,
      fecha: fechaTxt_(f.fechapedido),
      hora: horaTxt_(f.horapedido),
      mesa: txt_(f.nromesa),
      cliente: txt_(f.nombrecliente),
      total: num_(f.totalpedido),
      tipoVenta: txt_(f.tipoventa),
      usuario: txt_(f.usuario),
      tipoUsuario: txt_(f.tipousuario),
      estado: estadoNombre,
      idEstado: est.porNombre[normalizar_(estadoNombre)] || 0,
      items: det[n] || [],
      historial: hist[n] || []
    };
    p.version = huella_(p);
    return p;
  });
}

/* ------------------------------------------------------------------ */
/* Escritura                                                           */
/* ------------------------------------------------------------------ */

function accionCrear_(u, req) {
  var datos = validarCabecera_(req, true);
  var reqId = String(req.reqId || '').replace(/[^\w-]/g, '').slice(0, 64);
  if (!reqId) throw fallo_('Falta identificador de envío.');

  return conLock_(function () {
    var cache = CacheService.getScriptCache();
    var previo = cache.get('req_' + reqId);
    if (previo) return { ok: true, numero: Number(previo), repetido: true };

    var lineas = armarLineas_(req.items, catalogo_(), null);
    var total = lineas.reduce(function (s, l) { return s + l.subtotal; }, 0);

    var tp = leerTabla_('pedido');
    var max = 0;
    tp.filas.forEach(function (f) { max = Math.max(max, num_(f.numeropedido)); });
    // también revisa el log de estados por si se borró una fila a mano
    leerTabla_('pedidoestado').filas.forEach(function (f) { max = Math.max(max, num_(f.idpedido)); });
    var numero = max + 1;
    var t = ahora_();
    var est = estados_();

    agregarFilas_('pedido', [{
      numeropedido: numero, fechapedido: t.fecha, horapedido: t.hora,
      nromesa: datos.mesa, nombrecliente: datos.cliente, totalpedido: total,
      tipoventa: datos.tipoVenta, usuario: u.nombre, tipousuario: u.tipo,
      estadoactual: est.porId[ESTADO.CREADO]
    }], ['fechapedido', 'horapedido', 'nromesa']);

    agregarFilas_('detallepedido', lineas.map(function (l) {
      return { numeropedido: numero, idproducto: l.id, cantidad: l.cantidad, subtotal: l.subtotal };
    }));

    agregarFilas_('pedidoestado', [{
      idpedido: numero, idestado: ESTADO.CREADO,
      fechacambioestado: t.fecha, horacambioestado: t.hora
    }], ['fechacambioestado', 'horacambioestado']);

    SpreadsheetApp.flush();
    cache.put('req_' + reqId, String(numero), 21600);
    return { ok: true, numero: numero, total: total };
  });
}

function accionEditar_(u, req) {
  var numero = num_(req.numero);
  return conLock_(function () {
    var p = pedidoVigente_(numero, req.version);
    var esAdmin = u.perfil === 'admin';
    if (esAdmin) {
      if (p.idEstado !== ESTADO.CREADO && p.idEstado !== ESTADO.PREPARACION)
        throw fallo_('Solo se editan pedidos en estado Creado o En preparación.');
    } else {
      if (p.usuario !== u.nombre) throw fallo_('Este pedido no es tuyo.');
      if (p.idEstado !== ESTADO.CREADO) throw fallo_('Solo puedes editar pedidos en estado Creado.');
    }

    var lineas = armarLineas_(req.items, catalogo_(), p.items);
    var total = lineas.reduce(function (s, l) { return s + l.subtotal; }, 0);

    var cambios = { totalpedido: total };
    if (!esAdmin) {
      var datos = validarCabecera_(req, true);
      cambios.nromesa = datos.mesa;
      cambios.nombrecliente = datos.cliente;
      cambios.tipoventa = datos.tipoVenta;
    }
    actualizarPedido_(numero, cambios);
    reemplazarDetalle_(numero, lineas);
    SpreadsheetApp.flush();
    return { ok: true, numero: numero, total: total };
  });
}

function accionEstado_(u, req) {
  var numero = num_(req.numero);
  var nuevo = num_(req.nuevo);
  return conLock_(function () {
    var p = pedidoVigente_(numero, req.version);
    var permitido = false;
    if (u.perfil === 'admin') {
      permitido = (p.idEstado === ESTADO.CREADO && nuevo === ESTADO.PREPARACION);
    } else {
      if (p.usuario !== u.nombre) throw fallo_('Este pedido no es tuyo.');
      permitido =
        (p.idEstado === ESTADO.PREPARACION && nuevo === ESTADO.ENTREGADO) ||
        (p.idEstado !== ESTADO.ELIMINADO && nuevo === ESTADO.ELIMINADO);
    }
    if (!permitido) throw fallo_('Ese cambio de estado no está permitido (' + p.estado + ').');

    var t = ahora_();
    var est = estados_();
    actualizarPedido_(numero, { estadoactual: est.porId[nuevo] });
    agregarFilas_('pedidoestado', [{
      idpedido: numero, idestado: nuevo,
      fechacambioestado: t.fecha, horacambioestado: t.hora
    }], ['fechacambioestado', 'horacambioestado']);
    SpreadsheetApp.flush();
    return { ok: true, numero: numero, estado: est.porId[nuevo], hora: t.hora };
  });
}

/** Relee el pedido dentro del lock y comprueba que nadie lo cambió. */
function pedidoVigente_(numero, version) {
  if (!numero) throw fallo_('Pedido inválido.');
  var p = cargarPedidos_().filter(function (x) { return x.numero === numero; })[0];
  if (!p) throw fallo_('El pedido N° ' + numero + ' no existe.');
  if (p.idEstado === ESTADO.ELIMINADO) throw fallo_('El pedido N° ' + numero + ' está eliminado.', 'VERSION');
  if (!version || String(version) !== p.version)
    throw fallo_('El pedido N° ' + numero + ' fue modificado por otra persona. Se recargó la lista; revisa y vuelve a intentar.', 'VERSION');
  return p;
}

function validarCabecera_(req) {
  var mesa = limpiar_(req.mesa, 10);
  var cliente = limpiar_(req.cliente, 60);
  var tipoVenta = CONFIG.TIPOS_VENTA.filter(function (t) {
    return normalizar_(t) === normalizar_(req.tipoVenta);
  })[0];
  if (!mesa) throw fallo_('El número de mesa es obligatorio.');
  if (!/^[0-9A-Za-z\- ]+$/.test(mesa)) throw fallo_('La mesa solo admite números y letras.');
  if (!cliente || cliente.length < 2) throw fallo_('El nombre del cliente es obligatorio.');
  if (!tipoVenta) throw fallo_('Selecciona el tipo de venta (Efectivo o Transferencia).');
  return { mesa: mesa, cliente: cliente, tipoVenta: tipoVenta };
}

/**
 * Valida y agrupa ítems; calcula subtotales con el precio de la hoja.
 * Un producto inactivo solo se acepta si ya venía en el pedido (edición).
 */
function armarLineas_(items, prods, itemsPrevios) {
  if (!Array.isArray(items) || !items.length) throw fallo_('Agrega al menos un producto.');
  var previos = {};
  (itemsPrevios || []).forEach(function (i) { previos[i.id] = i; });
  var agrupado = {}, orden = [];
  items.forEach(function (it) {
    var id = num_(it && it.id), c = num_(it && it.cantidad);
    if (!id || c <= 0) return;
    if (c !== Math.floor(c)) throw fallo_('Las cantidades deben ser enteras.');
    if (!agrupado[id]) { agrupado[id] = 0; orden.push(id); }
    agrupado[id] += c;
  });
  if (!orden.length) throw fallo_('Agrega al menos un producto.');
  if (orden.length > CONFIG.MAX_LINEAS) throw fallo_('Demasiados productos distintos en un pedido.');
  return orden.map(function (id) {
    var c = agrupado[id];
    if (c > CONFIG.MAX_CANTIDAD) throw fallo_('Cantidad máxima por producto: ' + CONFIG.MAX_CANTIDAD + '.');
    var pr = prods[id];
    if (!pr) throw fallo_('El producto ' + id + ' no existe.');
    if (!pr.activo && !previos[id]) throw fallo_('"' + pr.nombre + '" no está disponible.');
    // Producto ya en el pedido: conserva su precio original aunque luego cambie en la hoja.
    var precio = previos[id] ? previos[id].precio : pr.precio;
    return { id: id, cantidad: c, subtotal: precio * c };
  });
}

/* ------------------------------------------------------------------ */
/* Acceso a hojas por encabezado                                       */
/* ------------------------------------------------------------------ */

function libro_() {
  return CONFIG.SPREADSHEET_ID
    ? SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

function hoja_(clave) {
  var hojas = libro_().getSheets();
  for (var i = 0; i < hojas.length; i++) {
    if (normalizar_(hojas[i].getName()) === clave) return hojas[i];
  }
  throw new Error('No encuentro la hoja "' + clave + '".');
}

/** Devuelve { hoja, cols: {clave: índice0}, filas: [{clave: valor, _fila: n}] } */
function leerTabla_(clave) {
  var h = hoja_(clave);
  var ultimaCol = Math.max(h.getLastColumn(), 1);
  var ultimaFila = h.getLastRow();
  var enc = h.getRange(1, 1, 1, ultimaCol).getValues()[0];
  var cols = {};
  enc.forEach(function (v, i) { var k = normalizar_(v); if (k && !(k in cols)) cols[k] = i; });
  var filas = [];
  if (ultimaFila > 1) {
    var vals = h.getRange(2, 1, ultimaFila - 1, ultimaCol).getValues();
    vals.forEach(function (r, j) {
      if (r.join('') === '') return;
      var o = { _fila: j + 2 };
      Object.keys(cols).forEach(function (k) { o[k] = r[cols[k]]; });
      filas.push(o);
    });
  }
  return { hoja: h, cols: cols, ancho: ultimaCol, filas: filas };
}

function columna_(t, clave) {
  if (!(clave in t.cols)) throw new Error('Falta la columna "' + clave + '" en la hoja ' + t.hoja.getName());
  return t.cols[clave];
}

/** Agrega filas al final, ubicando cada valor en su columna por encabezado. */
function agregarFilas_(claveHoja, objetos, columnasTexto) {
  if (!objetos.length) return;
  var t = leerTabla_(claveHoja);
  var claves = Object.keys(objetos[0]);
  claves.forEach(function (k) { columna_(t, k); });
  var datos = objetos.map(function (o) {
    var fila = new Array(t.ancho).fill('');
    claves.forEach(function (k) { fila[t.cols[k]] = (o[k] === undefined ? '' : o[k]); });
    return fila;
  });
  var inicio = t.hoja.getLastRow() + 1;
  (columnasTexto || []).forEach(function (k) {
    t.hoja.getRange(inicio, t.cols[k] + 1, datos.length, 1).setNumberFormat('@');
  });
  t.hoja.getRange(inicio, 1, datos.length, t.ancho).setValues(datos);
}

/** Cambia solo las celdas indicadas de la fila del pedido. */
function actualizarPedido_(numero, cambios) {
  var t = leerTabla_('pedido');
  var filas = t.filas.filter(function (f) { return num_(f.numeropedido) === numero; });
  if (filas.length !== 1) throw new Error('Pedido ' + numero + ' duplicado o inexistente en la hoja.');
  Object.keys(cambios).forEach(function (k) {
    var celda = t.hoja.getRange(filas[0]._fila, columna_(t, k) + 1);
    if (k === 'nromesa') celda.setNumberFormat('@');
    celda.setValue(cambios[k]);
  });
}

/** Reemplaza las líneas de detalle de un pedido (borra de abajo hacia arriba). */
function reemplazarDetalle_(numero, lineas) {
  var t = leerTabla_('detallepedido');
  var filas = t.filas.filter(function (f) { return num_(f.numeropedido) === numero; })
    .map(function (f) { return f._fila; }).sort(function (a, b) { return b - a; });
  filas.forEach(function (r) { t.hoja.deleteRow(r); });
  agregarFilas_('detallepedido', lineas.map(function (l) {
    return { numeropedido: numero, idproducto: l.id, cantidad: l.cantidad, subtotal: l.subtotal };
  }));
}

function catalogo_() {
  var out = {};
  leerTabla_('producto').filas.forEach(function (f) {
    var id = num_(f.productoid); if (!id) return;
    out[id] = {
      id: id,
      nombre: txt_(f.nombre),
      precio: precio_(f.precio),
      foto: txt_(f.fotourl),
      activo: booleano_(f.activo)
    };
  });
  return out;
}

function estados_() {
  var porId = {}, porNombre = {};
  leerTabla_('estado').filas.forEach(function (f) {
    var id = num_(f.idestado), n = txt_(f.nombreestado);
    if (!id) return;
    porId[id] = n; porNombre[normalizar_(n)] = id;
  });
  return { porId: porId, porNombre: porNombre };
}

function conLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw fallo_('El sistema está ocupado. Intenta de nuevo en unos segundos.');
  try { return fn(); }
  finally { lock.releaseLock(); }
}

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

function normalizar_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[\s_\-]+/g, '');
}

function normalizarClave_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-zñ]/g, '');
}

function txt_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, CONFIG.TZ, 'dd-MM-yyyy HH:mm:ss');
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
}

function num_(v) {
  if (typeof v === 'number') return v;
  var n = Number(String(v == null ? '' : v).trim());
  return isFinite(n) ? n : 0;
}

function precio_(v) {
  if (typeof v === 'number') return Math.round(v);
  var n = Number(String(v || '').replace(/[^\d]/g, ''));
  return isFinite(n) ? n : 0;
}

function booleano_(v) {
  if (v === true) return true;
  var s = normalizar_(v);
  return s === 'true' || s === 'verdadero' || s === 'si' || s === '1';
}

function nombreUsuario_(f) {
  return (txt_(f.nombres) + ' ' + txt_(f.primerapellido)).trim();
}

/** Quita caracteres de control y neutraliza fórmulas (=, +, -, @). */
function limpiar_(v, max) {
  var s = String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.slice(0, max);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function ahora_() {
  var d = new Date();
  return {
    fecha: Utilities.formatDate(d, CONFIG.TZ, 'dd-MM-yyyy'),
    hora: Utilities.formatDate(d, CONFIG.TZ, 'HH:mm:ss')
  };
}

function fechaTxt_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, CONFIG.TZ, 'dd-MM-yyyy');
  return txt_(v);
}

function horaTxt_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, CONFIG.TZ, 'HH:mm:ss');
  return txt_(v);
}

function huella_(p) {
  var base = JSON.stringify([p.mesa, p.cliente, p.total, p.tipoVenta, p.estado,
    p.items.map(function (i) { return [i.id, i.cantidad, i.subtotal]; }), p.historial.length]);
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, base, Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(bytes).slice(0, 16);
}

/** Ejecútala una vez desde el editor para autorizar permisos y revisar la planilla. */
function probarConfiguracion() {
  ['pedido', 'detallepedido', 'pedidoestado', 'estado', 'producto', 'usuario', 'tipousuario']
    .forEach(function (k) { Logger.log(k + ': ' + Object.keys(leerTabla_(k).cols).join(', ')); });
  Logger.log('Administradores: ' + JSON.stringify(CONFIG.ADMIN_IDS));
}
