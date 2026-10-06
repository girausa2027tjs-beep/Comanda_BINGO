/* Comandas · Gira USA Monkeys — frontend */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var S = {
    token: null, usuario: null,
    productos: [], prodMap: {},
    carrito: {}, tipoVenta: '',
    edit: null,            // { numero, version, items } cuando se edita un pedido
    reqId: null,           // id de envío (anti-duplicado) del pedido en curso
    mis: [], todos: [],
    filtroMis: 'activos', filtroAdmin: 'activos', ordenAsc: true, buscaAdmin: '',
    timer: null, ocupado: false
  };

  /* ================= Utilidades ================= */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function plata(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('es-CL'); }
  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }
  function guardarSesion(v) { try { v ? sessionStorage.setItem('comandas_ses', JSON.stringify(v)) : sessionStorage.removeItem('comandas_ses'); } catch (e) {} }
  function leerSesion() { try { return JSON.parse(sessionStorage.getItem('comandas_ses') || 'null'); } catch (e) { return null; } }

  var toastT;
  function toast(msg, tipo) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast ver ' + (tipo || '');
    clearTimeout(toastT);
    toastT = setTimeout(function () { t.className = 'toast'; }, tipo === 'mal' ? 5200 : 3200);
  }
  function cargando(on) { $('#cargando').hidden = !on; }

  /* ================= API ================= */

  function api(action, datos, opts) {
    if (!CFG.API_URL) return Promise.reject(new Error('Falta configurar API_URL en assets/config.js'));
    var body = Object.assign({ action: action, token: S.token }, datos || {});
    if (!(opts && opts.silencioso)) cargando(true);
    return fetch(CFG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow'
    }).then(function (r) {
      if (!r.ok) throw new Error('El servidor respondió ' + r.status + '.');
      return r.json();
    }).catch(function (err) {
      if (err instanceof SyntaxError) throw new Error('Respuesta inválida del servidor.');
      if (err && /fetch|network|Failed/i.test(err.message)) throw new Error('Sin conexión. Revisa internet e intenta de nuevo.');
      throw err;
    }).then(function (j) {
      if (!j || !j.ok) {
        var e = new Error((j && j.error) || 'Error desconocido.');
        e.codigo = j && j.codigo;
        if (e.codigo === 'SESION') { salir(e.message); }
        throw e;
      }
      return j;
    }).finally(function () { if (!(opts && opts.silencioso)) cargando(false); });
  }

  /* ================= Ingreso ================= */

  function iniciarLogin(msg) {
    $('#vistaApp').hidden = true;
    $('#vistaLogin').hidden = false;
    $('#errLogin').textContent = msg || '';
    if (!CFG.API_URL) {
      $('#errLogin').textContent = 'Falta pegar la URL de Apps Script en assets/config.js.';
      $('#selCurso').innerHTML = '<option value="">Sin conexión</option>';
      return;
    }
    api('inicio', {}, { silencioso: true }).then(function (r) {
      $('#selCurso').innerHTML = '<option value="">Elige tu curso</option>' +
        r.cursos.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
      $('#tiposUsuario').innerHTML = r.tiposUsuario.map(function (t, i) {
        return '<label><input type="radio" name="tipoUsuario" value="' + esc(t) + '"' + (i === 0 ? ' checked' : '') + '><span>' + esc(t) + '</span></label>';
      }).join('');
    }).catch(function (e) { $('#errLogin').textContent = e.message; });
  }

  $('#selCurso').addEventListener('change', function () {
    var sel = $('#selAlumno');
    sel.disabled = true;
    if (!this.value) { sel.innerHTML = '<option value="">Primero elige el curso</option>'; return; }
    sel.innerHTML = '<option value="">Cargando…</option>';
    api('alumnos', { curso: this.value }, { silencioso: true }).then(function (r) {
      sel.innerHTML = '<option value="">Elige tu nombre</option>' + r.alumnos.map(function (a) {
        return '<option value="' + a.id + '">' + esc(a.nombre) + '</option>';
      }).join('');
      sel.disabled = false;
    }).catch(function (e) { $('#errLogin').textContent = e.message; });
  });

  $('#formLogin').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var err = $('#errLogin');
    var curso = $('#selCurso').value, id = $('#selAlumno').value, clave = $('#inpClave').value.trim();
    if (!curso) return (err.textContent = 'Elige tu curso.');
    if (!id) return (err.textContent = 'Elige el alumno.');
    if (!clave) return (err.textContent = 'Escribe la contraseña.');
    err.textContent = '';
    var tipo = ($('input[name="tipoUsuario"]:checked') || {}).value || '';
    var perfil = $('input[name="perfil"]:checked').value;
    $('#btnIngresar').disabled = true;
    api('login', { id_usuario: Number(id), clave: clave, tipo_usuario: tipo, perfil: perfil })
      .then(function (r) {
        S.token = r.token; S.usuario = r.usuario;
        guardarSesion({ token: r.token, usuario: r.usuario });
        $('#inpClave').value = '';
        entrar();
      })
      .catch(function (e) { err.textContent = e.message; })
      .finally(function () { $('#btnIngresar').disabled = false; });
  });

  function salir(msg) {
    if (S.token && !msg) api('logout', {}, { silencioso: true }).catch(function () {});
    clearInterval(S.timer);
    S.token = null; S.usuario = null; S.carrito = {}; S.edit = null; S.reqId = null;
    guardarSesion(null);
    cerrarModal();
    iniciarLogin(msg);
  }
  $('#btnSalir').addEventListener('click', function () {
    if (Object.keys(S.carrito).length && !confirm('Tienes un pedido sin enviar. ¿Salir igual?')) return;
    salir();
  });

  function entrar() {
    $('#vistaLogin').hidden = true;
    $('#vistaApp').hidden = false;
    var u = S.usuario;
    $('#lblUsuario').textContent = u.nombre + ' · ' + u.curso;
    $('#lblPerfil').textContent = (u.perfil === 'admin' ? 'ADMINISTRADOR' : 'VENDEDOR') + (u.tipo && u.tipo !== 'Alumno' ? ' · ' + u.tipo.toUpperCase() : '');
    var admin = u.perfil === 'admin';
    $('#vistaAdmin').hidden = !admin;
    $('#vistaVendedor').hidden = admin;
    $('#btnImpresora').hidden = !admin;
    api('productos', {}, { silencioso: true }).then(function (r) {
      S.productos = r.productos;
      S.prodMap = {};
      r.productos.forEach(function (p) { S.prodMap[p.id] = p; });
      if (!admin) renderProductos();
    }).catch(function (e) { toast(e.message, 'mal'); });
    if (admin) cargarTodos(); else { mostrarTab('venta'); cargarMis(true); }
    clearInterval(S.timer);
    S.timer = setInterval(refrescar, Math.max(5, CFG.REFRESCO_SEGUNDOS || 15) * 1000);
  }

  function refrescar() {
    if (document.hidden || !S.token || S.ocupado || !$('#modal').hidden) return;
    if (S.usuario.perfil === 'admin') cargarTodos(true); else cargarMis(true);
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refrescar(); });

  /* ================= VENDEDOR: nueva venta ================= */

  $$('.tab').forEach(function (b) { b.addEventListener('click', function () { mostrarTab(b.dataset.tab); }); });
  function mostrarTab(t) {
    $$('.tab').forEach(function (b) { b.classList.toggle('activo', b.dataset.tab === t); });
    $('#panelVenta').hidden = t !== 'venta';
    $('#panelMis').hidden = t !== 'mis';
    actualizarCarrito();
    if (t === 'mis') cargarMis(true);
  }

  function productosVisibles() {
    var lista = S.productos.slice();
    // En edición, también se muestran productos del pedido que hoy están inactivos.
    if (S.edit) S.edit.items.forEach(function (it) {
      if (!S.prodMap[it.id]) lista.push({ id: it.id, nombre: it.nombre, precio: it.precio, foto: '', activo: false });
    });
    var q = norm($('#buscaProd').value);
    return q ? lista.filter(function (p) { return norm(p.nombre).indexOf(q) >= 0; }) : lista;
  }

  function precioDe(id) {
    if (S.edit) { var prev = S.edit.items.filter(function (i) { return i.id === id; })[0]; if (prev) return prev.precio; }
    return S.prodMap[id] ? S.prodMap[id].precio : 0;
  }
  function nombreDe(id) {
    if (S.prodMap[id]) return S.prodMap[id].nombre;
    var all = (S.edit ? S.edit.items : []).concat(S.todos.reduce(function (a, p) { return a.concat(p.items); }, []));
    var f = all.filter(function (i) { return i.id === id; })[0];
    return f ? f.nombre : 'Producto ' + id;
  }

  function renderProductos() {
    var lista = productosVisibles();
    var g = $('#gridProductos');
    if (!lista.length) { g.innerHTML = '<div class="vacio">No hay productos que coincidan.</div>'; return; }
    g.innerHTML = lista.map(function (p) {
      var c = S.carrito[p.id] || 0;
      var foto = p.foto ? ' style="background-image:url(\'' + esc(p.foto).replace(/'/g, '%27') + '\')"' : '';
      return '<article class="prod' + (c ? ' elegido' : '') + '" data-id="' + p.id + '">' +
        '<div class="prod-foto"' + foto + '>' + (c ? '<span class="cant-badge">' + c + '</span>' : '') + '</div>' +
        '<div class="prod-info"><div class="prod-nombre">' + esc(p.nombre) + '</div>' +
        '<div class="prod-precio">' + plata(precioDe(p.id)) + '</div>' +
        (p.activo === false ? '<div class="prod-inactivo">No disponible para nuevos pedidos</div>' : '') + '</div>' +
        '<div class="stepper"><button type="button" class="menos" aria-label="Quitar uno de ' + esc(p.nombre) + '">−</button>' +
        '<output>' + c + '</output>' +
        '<button type="button" class="mas" aria-label="Agregar uno de ' + esc(p.nombre) + '"' + (p.activo === false && !c ? ' disabled' : '') + '>+</button></div>' +
        '</article>';
    }).join('');
  }

  $('#gridProductos').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    var card = b.closest('.prod'); var id = Number(card.dataset.id);
    cambiarCant(id, b.classList.contains('mas') ? 1 : -1);
    renderProductos();
  });
  $('#buscaProd').addEventListener('input', renderProductos);
  // Si cambian mesa o cliente, es un envío distinto (nuevo id anti-duplicado).
  ['#inpMesa', '#inpCliente'].forEach(function (s) {
    $(s).addEventListener('input', function () { S.reqId = null; this.classList.remove('invalido'); });
  });

  function cambiarCant(id, d) {
    var n = Math.max(0, Math.min(99, (S.carrito[id] || 0) + d));
    if (n) S.carrito[id] = n; else delete S.carrito[id];
    S.reqId = null;        // el contenido cambió: es un envío nuevo
    actualizarCarrito();
  }

  function totalCarrito() {
    return Object.keys(S.carrito).reduce(function (s, id) { return s + precioDe(Number(id)) * S.carrito[id]; }, 0);
  }

  function actualizarCarrito() {
    var n = Object.keys(S.carrito).reduce(function (s, id) { return s + S.carrito[id]; }, 0);
    var visible = !$('#panelVenta').hidden && (n > 0 || !!S.edit);
    $('#barraCarrito').hidden = !visible;
    $('#carritoCant').textContent = n + (n === 1 ? ' producto' : ' productos');
    $('#carritoTotal').textContent = plata(totalCarrito());
    $('#btnRevisar').textContent = S.edit ? 'Revisar cambios' : 'Revisar pedido';
  }

  function validarCabecera() {
    var mesa = $('#inpMesa'), cli = $('#inpCliente'), ok = true;
    [mesa, cli].forEach(function (i) { i.classList.remove('invalido'); });
    if (!mesa.value.trim()) { mesa.classList.add('invalido'); ok = false; }
    else if (!/^[0-9A-Za-z\- ]+$/.test(mesa.value.trim())) { mesa.classList.add('invalido'); toast('La mesa solo admite números y letras.', 'mal'); return false; }
    if (cli.value.trim().length < 2) { cli.classList.add('invalido'); ok = false; }
    if (!ok) { toast('Completa el número de mesa y el nombre del cliente.', 'mal'); (mesa.value.trim() ? cli : mesa).focus(); }
    return ok;
  }

  $('#btnRevisar').addEventListener('click', function () {
    if (!validarCabecera()) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (!Object.keys(S.carrito).length) return toast('Agrega al menos un producto.', 'mal');
    abrirResumen();
  });

  function lineasCarritoHTML() {
    var ids = Object.keys(S.carrito).map(Number);
    if (!ids.length) return '<div class="vacio">El pedido está vacío.</div>';
    return '<ul class="lineas">' + ids.map(function (id) {
      var c = S.carrito[id], pr = precioDe(id);
      return '<li class="linea" data-id="' + id + '"><div class="linea-nombre">' + esc(nombreDe(id)) + '<small>' + plata(pr) + ' c/u</small></div>' +
        '<div class="mini-stepper"><button type="button" class="quitar" data-d="-99" aria-label="Eliminar">🗑</button>' +
        '<button type="button" data-d="-1" aria-label="Menos">−</button><output>' + c + '</output>' +
        '<button type="button" data-d="1" aria-label="Más">+</button></div>' +
        '<div class="linea-sub">' + plata(pr * c) + '</div></li>';
    }).join('') + '</ul>';
  }

  function abrirResumen() {
    var tv = S.tipoVenta;
    var cuerpo = function () {
      return '<div class="detalle-cabeza"><div><div class="pedido-meta">Cliente</div><div class="pedido-cliente">' + esc($('#inpCliente').value.trim()) + '</div></div>' +
        '<div class="pedido-mesa"><small>MESA</small><b>' + esc($('#inpMesa').value.trim()) + '</b></div></div>' +
        lineasCarritoHTML() +
        '<div class="total-grande"><span>Total</span><b>' + plata(totalCarrito()) + '</b></div>' +
        '<div class="campo"><span>Tipo de venta *</span><div class="chips" id="chipsVenta">' +
        ['Efectivo', 'Transferencia'].map(function (t) {
          return '<label><input type="radio" name="tv" value="' + t + '"' + (tv === t ? ' checked' : '') + '><span>' + (t === 'Efectivo' ? '💵 ' : '🏦 ') + t + '</span></label>';
        }).join('') + '</div></div>';
    };
    abrirModal(S.edit ? 'Editar pedido #' + S.edit.numero : 'Confirmar pedido', cuerpo(),
      '<button class="btn btn-borde" data-cerrar>Seguir agregando</button>' +
      '<button class="btn btn-rojo" id="btnConfirmar">' + (S.edit ? 'Guardar cambios' : 'Crear pedido') + '</button>');

    var mc = $('#modalCuerpo');
    mc.onclick = function (ev) {
      var b = ev.target.closest('.mini-stepper button'); if (!b) return;
      var id = Number(b.closest('.linea').dataset.id);
      cambiarCant(id, Number(b.dataset.d));
      tv = ($('input[name="tv"]:checked') || {}).value || tv;
      mc.innerHTML = cuerpo();
      renderProductos();
    };
    mc.onchange = function (ev) { if (ev.target.name === 'tv') { tv = ev.target.value; S.tipoVenta = tv; } };

    $('#btnConfirmar').onclick = function () {
      var tipo = ($('input[name="tv"]:checked') || {}).value;
      if (!tipo) return toast('Selecciona Efectivo o Transferencia.', 'mal');
      if (!Object.keys(S.carrito).length) return toast('Agrega al menos un producto.', 'mal');
      S.tipoVenta = tipo;
      enviarPedido(this);
    };
  }

  function enviarPedido(btn) {
    var items = Object.keys(S.carrito).map(function (id) { return { id: Number(id), cantidad: S.carrito[id] }; });
    var datos = { mesa: $('#inpMesa').value.trim(), cliente: $('#inpCliente').value.trim(), tipoVenta: S.tipoVenta, items: items };
    btn.disabled = true; S.ocupado = true;
    var p;
    if (S.edit) {
      p = api('editar', Object.assign(datos, { numero: S.edit.numero, version: S.edit.version }));
    } else {
      if (!S.reqId) S.reqId = uuid();          // se conserva si hay que reintentar
      p = api('crear', Object.assign(datos, { reqId: S.reqId }));
    }
    p.then(function (r) {
      toast(S.edit ? 'Pedido #' + r.numero + ' actualizado ✔' : 'Pedido #' + r.numero + ' creado ✔', 'ok');
      limpiarVenta();
      cerrarModal();
      cargarMis(true);
    }).catch(function (e) {
      toast(e.message, 'mal');
      if (e.codigo === 'VERSION') { limpiarVenta(); cerrarModal(); mostrarTab('mis'); }
    }).finally(function () { btn.disabled = false; S.ocupado = false; });
  }

  function limpiarVenta() {
    S.carrito = {}; S.edit = null; S.reqId = null; S.tipoVenta = '';
    $('#inpMesa').value = ''; $('#inpCliente').value = ''; $('#buscaProd').value = '';
    $('#bannerEdicion').hidden = true;
    renderProductos(); actualizarCarrito();
  }

  $('#btnCancelarEdicion').addEventListener('click', function () { limpiarVenta(); mostrarTab('mis'); });

  /* ================= VENDEDOR: mis pedidos ================= */

  function cargarMis(silencioso) {
    return api('misPedidos', {}, { silencioso: silencioso }).then(function (r) {
      S.mis = r.pedidos;
      renderMis();
    }).catch(function (e) { if (!silencioso) toast(e.message, 'mal'); });
  }

  $('#filtrosMis').addEventListener('click', function (ev) {
    var b = ev.target.closest('.chip'); if (!b) return;
    S.filtroMis = b.dataset.f;
    $$('#filtrosMis .chip').forEach(function (c) { c.classList.toggle('activo', c === b); });
    renderMis();
  });

  function pasaFiltro(p, f) {
    if (f === 'todos') return true;
    if (f === 'activos') return p.estado === 'Creado' || p.estado === 'En preparación';
    return p.estado === f;
  }

  function renderMis() {
    var activos = S.mis.filter(function (p) { return pasaFiltro(p, 'activos'); }).length;
    $('#cntMis').textContent = activos;
    var lista = S.mis.filter(function (p) { return pasaFiltro(p, S.filtroMis); });
    $('#listaMis').innerHTML = lista.length ? lista.map(function (p) { return tarjetaPedido(p, 'vendedor'); }).join('')
      : '<div class="vacio">No hay pedidos en esta vista.</div>';
  }

  function historialHTML(p) {
    return '<ul class="historial">' + p.historial.map(function (h, i) {
      return '<li class="' + (i === p.historial.length - 1 ? 'actual' : '') + '">' + esc(h.estado) + ' ' + esc(h.hora.slice(0, 5)) +
        (h.fecha !== p.fecha ? ' (' + esc(h.fecha) + ')' : '') + '</li>';
    }).join('') + '</ul>';
  }

  function tarjetaPedido(p, modo) {
    var acc = '';
    if (modo === 'vendedor') {
      if (p.estado === 'Creado') acc += '<button class="btn btn-azul btn-chico" data-acc="editar">✏️ Editar</button>';
      if (p.estado === 'En preparación') acc += '<button class="btn btn-verde btn-chico" data-acc="entregar">✔ Marcar entregado</button>';
      if (p.estado !== 'Eliminado') acc += '<button class="btn btn-peligro btn-chico" data-acc="eliminar">Eliminar</button>';
    } else {
      if (p.estado === 'Creado') acc += '<button class="btn btn-oro btn-chico" data-acc="preparar">🍳 A preparación + imprimir</button>';
      acc += '<button class="btn btn-borde btn-chico" data-acc="imprimir">🖨️ ' + (p.historial.some(function (h) { return h.estado === 'En preparación'; }) ? 'Reimprimir' : 'Imprimir') + '</button>';
    }
    var tipoCls = norm(p.tipoVenta) === 'efectivo' ? ' efectivo' : '';
    return '<article class="pedido" data-num="' + p.numero + '" data-estado="' + esc(p.estado) + '">' +
      '<div class="pedido-cabeza"><div class="pedido-num"><small>' + esc(p.fecha) + ' · ' + esc(p.hora.slice(0, 5)) + '</small>#' + p.numero + '</div>' +
      '<div class="pedido-mesa"><small>MESA</small><b>' + esc(p.mesa) + '</b></div></div>' +
      '<div class="pedido-cliente">' + esc(p.cliente) + '</div>' +
      (modo === 'admin' ? '<div class="pedido-meta">Vende: ' + esc(p.usuario) + (p.tipoUsuario && p.tipoUsuario !== 'Alumno' ? ' (' + esc(p.tipoUsuario) + ')' : '') + '</div>' : '') +
      '<ul class="pedido-items">' + p.items.map(function (i) {
        return '<li><span><b>' + i.cantidad + '×</b> ' + esc(i.nombre) + '</span><span>' + plata(i.subtotal) + '</span></li>';
      }).join('') + '</ul>' +
      '<div class="pedido-total"><span class="estado" data-e="' + esc(p.estado) + '">' + esc(p.estado) + '</span>' +
      '<span><span class="tipo-venta' + tipoCls + '">' + esc(p.tipoVenta) + '</span> ' + plata(p.total) + '</span></div>' +
      historialHTML(p) +
      (acc ? '<div class="acciones">' + acc + '</div>' : '') +
      '</article>';
  }

  $('#listaMis').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-acc]'); if (!b) return;
    var p = S.mis.filter(function (x) { return x.numero === Number(b.closest('.pedido').dataset.num); })[0];
    if (!p) return;
    var acc = b.dataset.acc;
    if (acc === 'editar') return editarPedidoVendedor(p);
    if (acc === 'entregar') return cambiarEstado(p, 3, '¿Marcar el pedido #' + p.numero + ' como ENTREGADO?');
    if (acc === 'eliminar') return cambiarEstado(p, 4, '¿Eliminar el pedido #' + p.numero + ' (' + p.cliente + ')? Quedará marcado como Eliminado.');
  });

  function editarPedidoVendedor(p) {
    if (Object.keys(S.carrito).length && !S.edit && !confirm('Tienes una venta sin enviar. Se reemplazará por el pedido #' + p.numero + '. ¿Continuar?')) return;
    S.edit = { numero: p.numero, version: p.version, items: p.items };
    S.carrito = {};
    p.items.forEach(function (i) { S.carrito[i.id] = i.cantidad; });
    S.tipoVenta = p.tipoVenta;
    $('#inpMesa').value = p.mesa; $('#inpCliente').value = p.cliente;
    $('#lblEditNum').textContent = '#' + p.numero;
    $('#bannerEdicion').hidden = false;
    mostrarTab('venta');
    renderProductos();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cambiarEstado(p, nuevo, pregunta) {
    if (pregunta && !confirm(pregunta)) return Promise.resolve(null);
    S.ocupado = true;
    return api('estado', { numero: p.numero, version: p.version, nuevo: nuevo })
      .then(function (r) { toast('Pedido #' + p.numero + ': ' + r.estado + ' (' + r.hora.slice(0, 5) + ')', 'ok'); return r; })
      .catch(function (e) { toast(e.message, 'mal'); return null; })
      .finally(function () {
        S.ocupado = false;
        if (S.usuario.perfil === 'admin') return cargarTodos(true);
        return cargarMis(true);
      });
  }

  /* ================= ADMINISTRADOR ================= */

  function cargarTodos(silencioso) {
    return api('todosPedidos', {}, { silencioso: silencioso }).then(function (r) {
      S.todos = r.pedidos;
      renderAdmin();
      $('#lblActualizado').textContent = 'Actualizado a las ' + r.hora + ' · se refresca solo cada ' + (CFG.REFRESCO_SEGUNDOS || 15) + ' s';
    }).catch(function (e) { if (!silencioso) toast(e.message, 'mal'); });
  }

  $('#filtrosAdmin').addEventListener('click', function (ev) {
    var b = ev.target.closest('.chip'); if (!b) return;
    S.filtroAdmin = b.dataset.f;
    $$('#filtrosAdmin .chip').forEach(function (c) { c.classList.toggle('activo', c === b); });
    renderAdmin();
  });
  $('#buscaAdmin').addEventListener('input', function () { S.buscaAdmin = norm(this.value); renderAdmin(); });
  $('#btnOrden').addEventListener('click', function () {
    S.ordenAsc = !S.ordenAsc;
    this.textContent = S.ordenAsc ? '↑ Más antiguo primero' : '↓ Más reciente primero';
    renderAdmin();
  });

  function renderAdmin() {
    var vig = S.todos.filter(function (p) { return p.estado !== 'Eliminado'; });
    var cuenta = function (e) { return S.todos.filter(function (p) { return p.estado === e; }).length; };
    var suma = function (f) { return vig.filter(f).reduce(function (s, p) { return s + p.total; }, 0); };
    $('#resumenAdmin').innerHTML =
      kpi('Creados', cuenta('Creado')) + kpi('En preparación', cuenta('En preparación')) + kpi('Entregados', cuenta('Entregado')) +
      kpi('Total vendido', plata(suma(function () { return true; }))) +
      kpi('Efectivo', plata(suma(function (p) { return norm(p.tipoVenta) === 'efectivo'; }))) +
      kpi('Transferencia', plata(suma(function (p) { return norm(p.tipoVenta) === 'transferencia'; })));

    var q = S.buscaAdmin;
    var lista = S.todos.filter(function (p) {
      if (!pasaFiltro(p, S.filtroAdmin)) return false;
      if (!q) return true;
      return norm(['#' + p.numero, p.numero, 'mesa ' + p.mesa, p.cliente, p.usuario].join(' ')).indexOf(q) >= 0;
    });
    lista.sort(function (a, b) { return S.ordenAsc ? a.numero - b.numero : b.numero - a.numero; });
    $('#listaAdmin').innerHTML = lista.length ? lista.map(function (p) { return tarjetaPedido(p, 'admin'); }).join('')
      : '<div class="vacio">No hay pedidos en esta vista.</div>';
  }
  function kpi(t, v) { return '<div class="kpi"><span>' + t + '</span><b>' + v + '</b></div>'; }

  $('#listaAdmin').addEventListener('click', function (ev) {
    var card = ev.target.closest('.pedido'); if (!card) return;
    var p = S.todos.filter(function (x) { return x.numero === Number(card.dataset.num); })[0];
    if (!p) return;
    var b = ev.target.closest('[data-acc]');
    if (b && b.dataset.acc === 'imprimir') return imprimir(p, true);
    if (b && b.dataset.acc === 'preparar') return prepararEImprimir(p);
    abrirDetalleAdmin(p);
  });

  function prepararEImprimir(p) {
    return cambiarEstado(p, 2, null).then(function (r) {
      if (!r) return;
      var actualizado = S.todos.filter(function (x) { return x.numero === p.numero; })[0] || p;
      cerrarModal();
      imprimir(actualizado, false);
    });
  }

  function imprimir(p, reimpresion) {
    return Impresora.imprimir(p, { reimpresion: reimpresion })
      .then(function () { if (Impresora.config().modo !== 'navegador') toast('Ticket #' + p.numero + ' enviado a la impresora 🖨️', 'ok'); })
      .catch(function (e) {
        toast('No se pudo imprimir: ' + (e && e.message ? e.message : e) + '. Revisa la impresora.', 'mal');
      });
  }

  function abrirDetalleAdmin(p) {
    var editable = p.estado === 'Creado' || p.estado === 'En preparación';
    var lineas = p.items.map(function (i) { return { id: i.id, nombre: i.nombre, precio: i.precio, cantidad: i.cantidad }; });
    var original = JSON.stringify(lineas.map(function (l) { return [l.id, l.cantidad]; }));
    var sucio = function () { return JSON.stringify(lineas.map(function (l) { return [l.id, l.cantidad]; })) !== original; };
    var total = function () { return lineas.reduce(function (s, l) { return s + l.precio * l.cantidad; }, 0); };

    function cuerpo() {
      var opciones = S.productos.filter(function (pr) { return !lineas.some(function (l) { return l.id === pr.id; }); });
      return '<div class="detalle-cabeza"><div><div class="pedido-meta">' + esc(p.fecha) + ' ' + esc(p.hora) + ' · Vende ' + esc(p.usuario) +
        (p.tipoUsuario && p.tipoUsuario !== 'Alumno' ? ' (' + esc(p.tipoUsuario) + ')' : '') + '</div>' +
        '<div class="pedido-cliente">' + esc(p.cliente) + '</div>' +
        '<div><span class="estado" data-e="' + esc(p.estado) + '">' + esc(p.estado) + '</span> <span class="tipo-venta' + (norm(p.tipoVenta) === 'efectivo' ? ' efectivo' : '') + '">' + esc(p.tipoVenta) + '</span></div>' +
        historialHTML(p) + '</div>' +
        '<div class="pedido-mesa"><small>MESA</small><b>' + esc(p.mesa) + '</b></div></div>' +
        (lineas.length ? '<ul class="lineas">' + lineas.map(function (l, ix) {
          return '<li class="linea" data-ix="' + ix + '"><div class="linea-nombre">' + esc(l.nombre) + '<small>' + plata(l.precio) + ' c/u</small></div>' +
            (editable ? '<div class="mini-stepper"><button type="button" class="quitar" data-d="x" aria-label="Eliminar producto">🗑</button>' +
              '<button type="button" data-d="-1" aria-label="Menos">−</button><output>' + l.cantidad + '</output>' +
              '<button type="button" data-d="1" aria-label="Más">+</button></div>'
              : '<div class="mini-stepper"><output>' + l.cantidad + ' ×</output></div>') +
            '<div class="linea-sub">' + plata(l.precio * l.cantidad) + '</div></li>';
        }).join('') + '</ul>' : '<div class="vacio">Sin productos. Agrega al menos uno para guardar.</div>') +
        (editable ? '<div class="agregar-prod"><select id="selAgregar" aria-label="Producto para agregar"><option value="">+ Agregar producto…</option>' +
          opciones.map(function (o) { return '<option value="' + o.id + '">' + esc(o.nombre) + ' · ' + plata(o.precio) + '</option>'; }).join('') +
          '</select><button class="btn btn-navy btn-chico" type="button" id="btnAgregar">Agregar</button></div>' : '') +
        '<div class="total-grande"><span>Total</span><b>' + plata(total()) + '</b></div>' +
        (sucio() ? '<p class="nota">Hay cambios sin guardar. Guarda antes de pasar a preparación o imprimir.</p>' : '') +
        '<div class="ticket-preview">' + Impresora.htmlTicket(p, { reimpresion: false }) + '</div>';
    }
    function pie() {
      var h = '';
      if (editable) h += '<button class="btn btn-azul" id="btnGuardarAdm"' + (sucio() && lineas.length ? '' : ' disabled') + '>Guardar cambios</button>';
      if (p.estado === 'Creado') h += '<button class="btn btn-oro" id="btnPrepAdm"' + (sucio() ? ' disabled' : '') + '>🍳 Pasar a En preparación e imprimir</button>';
      h += '<button class="btn btn-borde" id="btnImpAdm"' + (sucio() ? ' disabled' : '') + '>🖨️ ' + (p.estado === 'Creado' ? 'Imprimir' : 'Reimprimir') + '</button>';
      return h;
    }
    function pintar() {
      $('#modalCuerpo').innerHTML = cuerpo();
      $('#modalPie').innerHTML = pie();
      enlazarPie();
    }
    function enlazarPie() {
      var g = $('#btnGuardarAdm');
      if (g) g.onclick = function () {
        g.disabled = true; S.ocupado = true;
        api('editar', { numero: p.numero, version: p.version, items: lineas.map(function (l) { return { id: l.id, cantidad: l.cantidad }; }) })
          .then(function (r) {
            toast('Pedido #' + p.numero + ' actualizado ✔', 'ok');
            return cargarTodos(true).then(function () {
              var nuevo = S.todos.filter(function (x) { return x.numero === p.numero; })[0];
              if (nuevo) abrirDetalleAdmin(nuevo); else cerrarModal();
            });
          })
          .catch(function (e) {
            toast(e.message, 'mal');
            if (e.codigo === 'VERSION') { cerrarModal(); cargarTodos(true); } else g.disabled = false;
          })
          .finally(function () { S.ocupado = false; });
      };
      var pr = $('#btnPrepAdm');
      if (pr) pr.onclick = function () { pr.disabled = true; prepararEImprimir(p); };
      var im = $('#btnImpAdm');
      if (im) im.onclick = function () { imprimir(p, p.estado !== 'Creado'); };
    }

    abrirModal('Pedido #' + p.numero, '', '', true);
    pintar();

    var mc = $('#modalCuerpo');
    mc.onclick = function (ev) {
      if (ev.target.id === 'btnAgregar') {
        var id = Number($('#selAgregar').value);
        if (!id) return toast('Elige un producto para agregar.', 'mal');
        var pr = S.prodMap[id];
        lineas.push({ id: id, nombre: pr.nombre, precio: pr.precio, cantidad: 1 });
        return pintar();
      }
      var b = ev.target.closest('.mini-stepper button'); if (!b) return;
      var ix = Number(b.closest('.linea').dataset.ix);
      if (b.dataset.d === 'x') {
        if (lineas.length === 1) return toast('El pedido debe tener al menos un producto.', 'mal');
        lineas.splice(ix, 1);
      } else {
        lineas[ix].cantidad = Math.max(1, Math.min(99, lineas[ix].cantidad + Number(b.dataset.d)));
      }
      pintar();
    };
    mc.onchange = null;
  }

  /* ================= Impresora ================= */

  $('#btnImpresora').addEventListener('click', abrirImpresora);

  function abrirImpresora() {
    function cuerpo() {
      var c = Impresora.config(), e = Impresora.estado();
      var modos = [['navegador', 'Instalada en el equipo (driver)'], ['usb', 'USB directo'], ['serial', 'Puerto serie / COM'], ['bluetooth', 'Bluetooth']];
      return '<div class="estado-impresora ' + (e.ok ? 'ok' : 'no') + '">' + esc(e.texto) + '</div>' +
        '<div class="campo"><span>Conexión con SPRT POS 58/80</span><div class="chips">' + modos.map(function (m) {
          var dis = !Impresora.soporte(m[0]);
          return '<label title="' + (dis ? 'No disponible en este navegador' : '') + '"><input type="radio" name="modoImp" value="' + m[0] + '"' + (c.modo === m[0] ? ' checked' : '') + (dis ? ' disabled' : '') + '><span' + (dis ? ' style="opacity:.45"' : '') + '>' + m[1] + '</span></label>';
        }).join('') + '</div></div>' +
        '<div class="campo"><span>Ancho de papel</span><div class="chips">' + [58, 80].map(function (w) {
          return '<label><input type="radio" name="papelImp" value="' + w + '"' + (c.papel === w ? ' checked' : '') + '><span>' + w + ' mm</span></label>';
        }).join('') + '</div></div>' +
        (c.modo === 'serial' ? '<label class="campo"><span>Velocidad (baudios)</span><select id="selBaud">' + [9600, 19200, 38400, 115200].map(function (b) {
          return '<option' + (Number(c.baudios) === b ? ' selected' : '') + '>' + b + '</option>';
        }).join('') + '</select></label>' : '') +
        '<p class="nota">' + (c.modo === 'navegador'
          ? 'Instala el driver de la SPRT POS58, déjala como impresora y elige su tamaño de papel. Para imprimir sin diálogo, abre Chrome con <b>--kiosk-printing</b> y deja la SPRT como predeterminada.'
          : 'Conecta la impresora y presiona "Conectar". El navegador mostrará la lista de dispositivos: elige la SPRT POS58. ' +
            (c.modo === 'usb' ? 'En Windows, si la impresora tiene el driver instalado, el modo USB directo puede no tener acceso; en ese caso usa "Instalada en el equipo".' : '')) + '</p>';
    }
    abrirModal('Impresora térmica', cuerpo(),
      '<button class="btn btn-borde" id="btnPruebaImp">Imprimir prueba</button><button class="btn btn-navy" id="btnConectarImp">Conectar</button>');
    var mc = $('#modalCuerpo');
    function repintar() {
      mc.innerHTML = cuerpo();
      $('#btnConectarImp').hidden = Impresora.config().modo === 'navegador';
    }
    repintar();
    mc.onclick = null;
    mc.onchange = function (ev) {
      if (ev.target.name === 'modoImp') Impresora.guardar({ modo: ev.target.value });
      if (ev.target.name === 'papelImp') Impresora.guardar({ papel: Number(ev.target.value) });
      if (ev.target.id === 'selBaud') Impresora.guardar({ baudios: Number(ev.target.value) });
      repintar();
    };
    $('#btnConectarImp').onclick = function () {
      Impresora.conectar().then(function () { toast('Impresora conectada ✔', 'ok'); repintar(); })
        .catch(function (e) { toast('No se conectó: ' + (e.message || e), 'mal'); repintar(); });
    };
    $('#btnPruebaImp').onclick = function () {
      Impresora.prueba().then(function () { repintar(); }).catch(function (e) { toast('Error al imprimir: ' + (e.message || e), 'mal'); });
    };
  }

  /* ================= Modal ================= */

  function abrirModal(titulo, cuerpo, pie, ancha) {
    $('#modalTitulo').textContent = titulo;
    $('#modalCuerpo').innerHTML = cuerpo;
    $('#modalPie').innerHTML = pie;
    $('#modalPie').hidden = !pie && !ancha;
    $('.modal-caja').classList.toggle('ancha', !!ancha);
    $('#modal').hidden = false;
    var f = $('#modal [data-cerrar].btn-x'); if (f) f.focus();
  }
  function cerrarModal() {
    $('#modal').hidden = true;
    var mc = $('#modalCuerpo'); mc.onclick = null; mc.onchange = null; mc.innerHTML = '';
  }
  $('#modal').addEventListener('click', function (ev) { if (ev.target.closest('[data-cerrar]')) cerrarModal(); });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && !$('#modal').hidden) cerrarModal(); });

  /* ================= Arranque ================= */

  var ses = leerSesion();
  if (ses && ses.token && CFG.API_URL) {
    S.token = ses.token; S.usuario = ses.usuario;
    entrar();
    iniciarLoginSilencioso();
  } else {
    iniciarLogin();
  }
  // Precarga cursos por si la sesión guardada expiró y hay que volver al ingreso.
  function iniciarLoginSilencioso() {
    api('inicio', {}, { silencioso: true }).then(function (r) {
      $('#selCurso').innerHTML = '<option value="">Elige tu curso</option>' + r.cursos.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
      $('#tiposUsuario').innerHTML = r.tiposUsuario.map(function (t, i) {
        return '<label><input type="radio" name="tipoUsuario" value="' + esc(t) + '"' + (i === 0 ? ' checked' : '') + '><span>' + esc(t) + '</span></label>';
      }).join('');
    }).catch(function () {});
  }
})();
