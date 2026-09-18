/* =====================================================================
   Módulo de ASISTENCIA del panel de Protección Civil (admin.html)
   =====================================================================
   Todo lo que se ve aquí sale de Supabase (esquema protcivil) a través
   del puente https://pc-api.alcaldiadecharallave.com, que comprueba la
   sesión de Firebase de quien mira y su rol. El navegador NUNCA tiene una
   llave de Supabase: si el puente dice que no, aquí no se ve nada.

   Quien solo VE (rol "admin") no tiene botones de cambiar datos. Aunque
   los tuviera, el puente y la base lo rechazarían: estos botones son una
   comodidad, no el candado.

   Todo lo que se pinta pasa por esc(): nombres, notas y novedades los
   escribe gente, y nada de eso puede convertirse en código en el panel.
   ===================================================================== */
(function () {
    'use strict';

    var API = 'https://pc-api.alcaldiadecharallave.com';
    var ZONA = 'America/Caracas';
    var LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    var LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
    var XLSX_JS = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';
    var JSPDF_JS = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    var AUTOTABLE_JS = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js';
    var COLORES_GRUPO = ['#dbeafe', '#fde68a', '#dcfce7', '#fce7f3', '#e0e7ff', '#ffedd5', '#ccfbf1', '#f3e8ff'];

    var st = {
        raiz: null, obtenerFicha: null, yo: null, pestana: 'vivo',
        funcionarios: [], estaciones: [], grupos: [], tipos: [], config: null,
        reloj: null, mapas: []
    };

    /* ------------------------------------------------------------ utilidades */

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function $(sel, raiz) { return (raiz || st.raiz).querySelector(sel); }
    function $$(sel, raiz) { return Array.prototype.slice.call((raiz || st.raiz).querySelectorAll(sel)); }

    function cargarScript(url) {
        return new Promise(function (ok, mal) {
            if (document.querySelector('script[src="' + url + '"]')) {
                var e = document.querySelector('script[src="' + url + '"]');
                if (e.dataset.listo) return ok();
                e.addEventListener('load', function () { ok(); });
                e.addEventListener('error', function () { mal(new Error('No cargó ' + url)); });
                return;
            }
            var s = document.createElement('script');
            s.src = url;
            s.onload = function () { s.dataset.listo = '1'; ok(); };
            s.onerror = function () { mal(new Error('No se pudo cargar una biblioteca. Revisa la conexión.')); };
            document.head.appendChild(s);
        });
    }
    function cargarLeaflet() {
        if (!document.querySelector('link[href="' + LEAFLET_CSS + '"]')) {
            var l = document.createElement('link');
            l.rel = 'stylesheet'; l.href = LEAFLET_CSS;
            document.head.appendChild(l);
        }
        return window.L ? Promise.resolve() : cargarScript(LEAFLET_JS);
    }

    /* Todas las llamadas pasan por aquí: ficha de Firebase fresca en cada
       una (Firebase la renueva sola) y errores en palabras claras. */
    async function api(ruta, op) {
        op = op || {};
        var ficha = await st.obtenerFicha();
        var h = { Authorization: 'Bearer ' + ficha, 'Content-Type': 'application/json' };
        if (op.prefer) h.Prefer = op.prefer;
        var r;
        try {
            r = await fetch(API + ruta, { method: op.metodo || 'GET', headers: h, body: op.cuerpo === undefined ? undefined : JSON.stringify(op.cuerpo) });
        } catch (e) {
            throw new Error('Sin conexión con el servicio de asistencia. Revisa el internet e intenta de nuevo.');
        }
        var texto = await r.text();
        var d = null;
        try { d = texto ? JSON.parse(texto) : null; } catch (e) { d = texto; }
        if (!r.ok) {
            var m = d && (d.message || d.error);
            if (r.status === 401) m = 'Tu sesión venció. Recarga la página y vuelve a entrar.';
            throw new Error(m || ('El servicio respondió con un error (' + r.status + ').'));
        }
        return d;
    }
    /* Una consulta con cientos de identificadores en la dirección se pasaría
       del largo que aceptan los servidores: se pide en tandas. */
    async function enTandas(ids, armarRuta) {
        var todo = [];
        for (var i = 0; i < ids.length; i += 80) {
            todo = todo.concat(await api(armarRuta(ids.slice(i, i + 80).join(','))) || []);
        }
        return todo;
    }
    function rpc(nombre, parametros) { return api('/rest/v1/rpc/' + nombre, { metodo: 'POST', cuerpo: parametros || {} }); }
    function q(v) { return encodeURIComponent(v); }

    /* ------------------------------------------------------------ fechas */

    function fechaHora(iso) {
        if (!iso) return '—';
        return new Date(iso).toLocaleString('es-VE', { timeZone: ZONA, weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    }
    function hora(iso) {
        if (!iso) return '—';
        return new Date(iso).toLocaleTimeString('es-VE', { timeZone: ZONA, hour: 'numeric', minute: '2-digit' });
    }
    function fechaCorta(iso) {
        if (!iso) return '—';
        return new Date(iso).toLocaleDateString('es-VE', { timeZone: ZONA, day: '2-digit', month: '2-digit', year: 'numeric' });
    }
    /* "YYYY-MM-DD" del día en Venezuela. */
    function hoy(desplazamientoDias) {
        var d = new Date(Date.now() - 4 * 3600e3 + (desplazamientoDias || 0) * 864e5);
        return d.toISOString().slice(0, 10);
    }
    function sumarDias(fecha, n) {
        var d = new Date(fecha + 'T12:00:00Z');
        d.setUTCDate(d.getUTCDate() + n);
        return d.toISOString().slice(0, 10);
    }
    function inicioDe(fecha) { return fecha + 'T00:00:00-04:00'; }
    function horasEntre(a, b) {
        if (!a || !b) return null;
        return Math.max(0, (new Date(b) - new Date(a)) / 3600e3);
    }
    function horasBonitas(h) {
        if (h == null) return '—';
        var hh = Math.floor(h), mm = Math.round((h - hh) * 60);
        if (mm === 60) { hh++; mm = 0; }
        return hh + ' h' + (mm ? ' ' + mm + ' min' : '');
    }
    /* Para un <input type="datetime-local"> en hora de Venezuela. */
    function aLocal(iso) {
        var d = new Date(new Date(iso).getTime() - 4 * 3600e3);
        return d.toISOString().slice(0, 16);
    }
    function deLocal(valor) { return valor ? valor + ':00-04:00' : null; }

    /* ------------------------------------------------------------ nombres */

    function persona(id) { return st.funcionarios.find(function (f) { return f.id === id; }); }
    function nombreDe(f) { return f ? (f.nombres + ' ' + f.apellidos) : 'Persona desconocida'; }
    function grupoDe(id) { return st.grupos.find(function (g) { return g.id === id; }); }
    function estacionDe(id) { return st.estaciones.find(function (e) { return e.id === id; }); }
    function tipoDe(id) { return st.tipos.find(function (t) { return t.id === id; }); }
    function colorGrupo(id) {
        var i = st.grupos.findIndex(function (g) { return g.id === id; });
        return COLORES_GRUPO[(i < 0 ? 0 : i) % COLORES_GRUPO.length];
    }
    var ESTADO_OP = {
        en_estacion: ['En la estación', 'p-verde'],
        en_emergencia: ['En emergencia', 'p-rojo'],
        en_comision: ['En comisión', 'p-azul']
    };
    function pillEstadoOp(e) {
        var x = ESTADO_OP[e] || ESTADO_OP.en_estacion;
        return '<span class="pill ' + x[1] + '">' + x[0] + '</span>';
    }
    function pillServicio(s) {
        if (!s.fin) return '<span class="pill p-verde">De guardia</span>';
        if (s.estado === 'anulado') return '<span class="pill p-gris">Anulada</span>';
        if (s.estado === 'por_revisar') return '<span class="pill p-naranja">Por revisar</span>';
        return '<span class="pill p-azul">Completa</span>';
    }
    function claveAlAzar() {
        var a = new Uint32Array(1), c;
        do {
            crypto.getRandomValues(a);
            c = String(a[0] % 1000000).padStart(6, '0');
        } while (/^(\d)\1+$/.test(c) || c === '123456' || c === '654321');
        return c;
    }

    /* ------------------------------------------------------------ ventana emergente */

    function ventana(titulo, cuerpoHtml, botones, ancha) {
        var capa = document.createElement('div');
        capa.className = 'pc-modal abierto';
        capa.innerHTML = '<div class="tarjeta' + (ancha ? ' ancha' : '') + '" role="dialog" aria-modal="true">' +
            '<div class="hd"><span>' + esc(titulo) + '</span><button type="button" data-cerrar aria-label="Cerrar">✕</button></div>' +
            '<div class="bd">' + cuerpoHtml + '<div class="msg-error" data-error></div></div>' +
            '<div class="ft"></div></div>';
        var pie = capa.querySelector('.ft');
        function cerrar() { capa.remove(); }
        (botones || [{ texto: 'Cerrar', estilo: 'background:#e2e8f0;color:#0f172a' }]).forEach(function (b) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = b.texto;
            btn.setAttribute('style', b.estilo || 'background:#1c3f94;color:#fff');
            btn.onclick = async function () {
                if (!b.accion) { cerrar(); return; }
                capa.querySelector('[data-error]').textContent = '';
                btn.disabled = true;
                var textoOriginal = btn.textContent;
                btn.textContent = 'Un momento…';
                try {
                    var sigue = await b.accion(capa);
                    if (sigue !== false) cerrar();
                } catch (e) {
                    capa.querySelector('[data-error]').textContent = e.message || String(e);
                } finally {
                    btn.disabled = false;
                    btn.textContent = textoOriginal;
                }
            };
            pie.appendChild(btn);
        });
        capa.querySelector('[data-cerrar]').onclick = cerrar;
        capa.addEventListener('click', function (e) { if (e.target === capa) cerrar(); });
        document.body.appendChild(capa);
        return capa;
    }
    function aviso(tipo, texto) {
        var z = $('#pcAviso');
        if (!z) return;
        z.innerHTML = texto ? '<div class="aviso ' + tipo + '">' + esc(texto) + '</div>' : '';
        if (texto && tipo === 'bien') setTimeout(function () { if (z.textContent === texto) z.innerHTML = ''; }, 6000);
    }
    function valor(capa, sel) { var e = capa.querySelector(sel); return e ? e.value.trim() : ''; }

    /* ------------------------------------------------------------ montaje */

    var PESTANAS = [
        ['vivo', '🟢 En vivo'], ['personal', '👥 Personal'], ['guardias', '🗓️ Guardias'], ['registros', '📋 Registros'],
        ['reportes', '📊 Reportes'], ['estaciones', '📍 Estaciones'], ['libro', '📖 Libro de guardia'],
        ['ajustes', '⚙️ Ajustes'], ['bitacora', '🕵️ Bitácora']
    ];

    async function montar(contenedor, obtenerFicha) {
        st.raiz = contenedor;
        st.obtenerFicha = obtenerFicha;
        contenedor.innerHTML = '<div class="cargando">Conectando con la asistencia…</div>';
        try {
            st.yo = await api('/yo');
        } catch (e) {
            contenedor.innerHTML = '<div class="aviso error">' + esc(e.message) + '</div>';
            return;
        }
        contenedor.innerHTML =
            '<div class="pestanas" role="tablist">' + PESTANAS.map(function (p) {
                return '<button type="button" role="tab" data-pestana="' + p[0] + '">' + p[1] + '</button>';
            }).join('') + '</div>' +
            (st.yo.puede_escribir ? '' : '<div class="aviso info">Tu cuenta puede ver la asistencia, pero no cambiarla.</div>') +
            '<div id="pcAviso"></div><div id="pcZona"></div>';
        $$('[data-pestana]').forEach(function (b) {
            b.onclick = function () { abrir(b.dataset.pestana); };
        });
        var desdeEnlace = (location.hash.match(/^#asistencia-([a-z]+)$/) || [])[1];
        await abrir(PESTANAS.some(function (p) { return p[0] === desdeEnlace; }) ? desdeEnlace : 'vivo');
    }

    async function recargarCatalogos() {
        var r = await Promise.all([
            api('/rest/v1/funcionarios?select=id,cedula,nombres,apellidos,cargo,condicion,grupo_id,estacion_id,telefono,debe_cambiar_clave,dispositivo_autorizado,dispositivo_nombre,activo,creado_en&order=apellidos,nombres'),
            api('/rest/v1/estaciones?select=*&order=nombre'),
            api('/rest/v1/grupos?select=*&order=nombre'),
            api('/rest/v1/tipos_guardia?select=*&order=nombre'),
            api('/rest/v1/config?select=*&id=eq.1')
        ]);
        st.funcionarios = r[0] || []; st.estaciones = r[1] || []; st.grupos = r[2] || [];
        st.tipos = r[3] || []; st.config = (r[4] || [])[0] || null;
    }

    function limpiarMapas() {
        st.mapas.forEach(function (m) { try { m.remove(); } catch (e) { } });
        st.mapas = [];
    }

    async function abrir(p) {
        st.pestana = p;
        if (st.reloj) { clearInterval(st.reloj); st.reloj = null; }
        limpiarMapas();
        aviso('', '');
        $$('[data-pestana]').forEach(function (b) {
            var on = b.dataset.pestana === p;
            b.classList.toggle('on', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        if (history.replaceState) history.replaceState(null, '', '#asistencia-' + p);
        var z = $('#pcZona');
        z.innerHTML = '<div class="cargando">Cargando…</div>';
        try {
            await recargarCatalogos();
            await ({ vivo: vivo, personal: personal, guardias: guardias, registros: registros, reportes: reportes,
                     estaciones: estaciones, libro: libro, ajustes: ajustes, bitacora: bitacora })[p](z);
        } catch (e) {
            z.innerHTML = '<div class="aviso error">' + esc(e.message || String(e)) + '</div>';
        }
    }

    /* ================================================================ EN VIVO */

    async function vivo(z) {
        var desde24 = new Date(Date.now() - 24 * 3600e3).toISOString();
        var r = await Promise.all([
            api('/rest/v1/servicios?select=*&fin=is.null&order=inicio'),
            api('/rest/v1/marcajes?select=id,funcionario_id,tipo,momento,dentro,distancia_m,sin_conexion,manual,revision,latitud,longitud,estacion_id&momento=gte.' + q(desde24) + '&order=momento.desc&limit=80'),
            api('/rest/v1/servicios?select=id&estado=eq.por_revisar&limit=1000'),
            api('/rest/v1/intentos_entrada?select=cedula,motivo,momento&exito=eq.false&momento=gte.' + q(desde24) + '&order=momento.desc&limit=200')
        ]);
        var abiertos = r[0] || [], marcajes = r[1] || [], porRevisar = (r[2] || []).length, fallidos = r[3] || [];
        var estados = [];
        if (abiertos.length) {
            estados = await api('/rest/v1/estados?select=servicio_id,estado,momento,latitud,longitud,nota&servicio_id=in.(' +
                abiertos.map(function (s) { return s.id; }).join(',') + ')&order=momento.desc');
        }
        var ultimoEstado = {};
        (estados || []).forEach(function (e) { if (!ultimoEstado[e.servicio_id]) ultimoEstado[e.servicio_id] = e; });
        var enEmergencia = abiertos.filter(function (s) { return (ultimoEstado[s.id] || {}).estado === 'en_emergencia'; }).length;
        var inicioHoy = new Date(inicioDe(hoy())).getTime();
        var hoyN = marcajes.filter(function (m) { return new Date(m.momento).getTime() >= inicioHoy; }).length;
        var activos = st.funcionarios.filter(function (f) { return f.activo; });
        var sinTelefono = activos.filter(function (f) { return !f.dispositivo_autorizado; }).length;
        var bloqueos = fallidos.filter(function (i) { return i.motivo === 'bloqueado'; }).length;

        z.innerHTML =
            '<div class="cifras">' +
                cifra(abiertos.length, 'De guardia ahora', 'verde') +
                cifra(enEmergencia, 'En emergencia', enEmergencia ? 'rojo' : '') +
                cifra(hoyN, 'Marcajes hoy', '') +
                cifra(porRevisar, 'Guardias por revisar', porRevisar ? 'naranja' : '') +
                cifra(activos.length, 'Personal activo', '') +
                cifra(sinTelefono, 'Aún sin entrar a la app', sinTelefono ? 'naranja' : '') +
            '</div>' +
            (bloqueos ? '<div class="aviso error">En las últimas 24 horas hubo ' + bloqueos + ' intento(s) de entrada bloqueados por claves erradas. Revisa la Bitácora.</div>' : '') +
            '<div class="dos-col">' +
                '<div class="caja"><h4>De guardia ahora</h4>' + tablaEnServicio(abiertos, ultimoEstado) + '</div>' +
                '<div class="caja"><h4>Mapa</h4><div class="mapa" id="pcMapaVivo"></div>' +
                    '<p class="muted" style="margin:6px 0 0">Círculos: las estaciones y su radio. Puntos: la última ubicación conocida de quien está de guardia.</p></div>' +
            '</div>' +
            '<div class="caja" style="margin-top:16px"><h4>Últimos marcajes (24 horas)</h4>' + feedMarcajes(marcajes) + '</div>' +
            '<p class="muted" style="margin-top:8px">Se actualiza solo cada 30 segundos.</p>';
        engancharFotos(z);
        dibujarMapaVivo(abiertos, ultimoEstado, marcajes);
        st.reloj = setInterval(function () {
            if (st.pestana === 'vivo' && document.visibilityState === 'visible' && !document.querySelector('.pc-modal')) {
                limpiarMapas();
                vivo(z).catch(function () { });
            }
        }, 30000);
    }
    function cifra(n, etiqueta, color) {
        return '<div class="cifra ' + (color || '') + '"><div class="n">' + esc(n) + '</div><div class="l">' + esc(etiqueta) + '</div></div>';
    }
    function tablaEnServicio(abiertos, ultimoEstado) {
        if (!abiertos.length) return '<div class="vacio">Nadie está de guardia en este momento.</div>';
        return '<div class="tabla-scroll"><table><thead><tr><th>Funcionario</th><th>Desde</th><th>Estado</th></tr></thead><tbody>' +
            abiertos.map(function (s) {
                var f = persona(s.funcionario_id), e = ultimoEstado[s.id];
                return '<tr><td><b>' + esc(nombreDe(f)) + '</b><br><span class="muted">' + esc((f && f.cargo) || '') + '</span></td>' +
                    '<td>' + esc(fechaHora(s.inicio)) + '<br><span class="muted">' + esc(horasBonitas(horasEntre(s.inicio, new Date().toISOString()))) + '</span></td>' +
                    '<td>' + pillEstadoOp(e && e.estado) + (e && e.nota ? '<br><span class="muted">' + esc(e.nota) + '</span>' : '') + '</td></tr>';
            }).join('') + '</tbody></table></div>';
    }
    function feedMarcajes(marcajes) {
        if (!marcajes.length) return '<div class="vacio">No hubo marcajes en las últimas 24 horas.</div>';
        return '<ul class="feed">' + marcajes.map(function (m) {
            var f = persona(m.funcionario_id), est = estacionDe(m.estacion_id);
            return '<li><span class="hora">' + esc(hora(m.momento)) + '</span><span style="flex:1">' +
                '<b>' + esc(nombreDe(f)) + '</b> marcó <b>' + (m.tipo === 'entrada' ? 'entrada' : 'salida') + '</b>' +
                (est ? ' en ' + esc(est.nombre) : '') +
                (m.distancia_m != null ? ' <span class="muted">(a ' + esc(Math.round(m.distancia_m)) + ' m)</span>' : '') + ' ' +
                (m.manual ? '<span class="pill p-azul">A mano</span> ' : '') +
                (m.sin_conexion ? '<span class="pill p-gris">Sin señal</span> ' : '') +
                (m.revision === 'por_revisar' ? '<span class="pill p-naranja">Por revisar</span> ' : '') +
                (m.manual ? '' : '<button type="button" class="btn-mini" data-foto="' + esc(m.id) + '">📷 Foto</button>') +
                '</span></li>';
        }).join('') + '</ul>';
    }
    function engancharFotos(z) {
        $$('[data-foto]', z).forEach(function (b) {
            b.onclick = function () { verFoto(b.dataset.foto); };
        });
    }
    async function verFoto(marcajeId) {
        var capa = ventana('Foto del marcaje', '<div class="cargando">Cargando la foto…</div>');
        try {
            var foto = await rpc('pc_admin_foto', { p_marcaje_id: marcajeId });
            var bd = capa.querySelector('.bd');
            if (typeof foto === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(foto)) {
                bd.innerHTML = '<img class="foto" alt="Foto tomada al marcar" src="' + foto + '">';
            } else {
                bd.innerHTML = '<div class="vacio">Este marcaje no tiene foto (o ya se borró: las fotos se guardan ' +
                    esc(st.config ? st.config.dias_fotos : 120) + ' días).</div>';
            }
        } catch (e) {
            capa.querySelector('.bd').innerHTML = '<div class="aviso error">' + esc(e.message) + '</div>';
        }
    }
    async function dibujarMapaVivo(abiertos, ultimoEstado, marcajes) {
        try { await cargarLeaflet(); } catch (e) { return; }
        var caja = document.getElementById('pcMapaVivo');
        /* Si mientras cargaba Leaflet se volvió a pintar la pestaña (doble
           toque, o la actualización de cada 30 s), ese mapa ya lo dibujó otro. */
        if (!caja || caja._leaflet_id) return;
        var mapa = L.map(caja);
        st.mapas.push(mapa);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
        var puntos = [];
        st.estaciones.filter(function (e) { return e.activa; }).forEach(function (e) {
            L.circle([e.latitud, e.longitud], { radius: e.radio_m, color: '#f7941d', weight: 2, fillOpacity: .12 })
                .addTo(mapa).bindTooltip(e.nombre);
            puntos.push([e.latitud, e.longitud]);
        });
        abiertos.forEach(function (s) {
            var e = ultimoEstado[s.id];
            var lat = e && e.latitud, lng = e && e.longitud;
            if (lat == null) {
                var m = marcajes.find(function (x) { return x.funcionario_id === s.funcionario_id && x.tipo === 'entrada' && x.latitud != null; });
                if (m) { lat = m.latitud; lng = m.longitud; }
            }
            if (lat == null) return;
            var emergencia = e && e.estado === 'en_emergencia';
            L.circleMarker([lat, lng], { radius: 8, color: '#fff', weight: 2, fillColor: emergencia ? '#dc2626' : '#1c3f94', fillOpacity: 1 })
                .addTo(mapa).bindTooltip(nombreDe(persona(s.funcionario_id)) + (emergencia ? ' · en emergencia' : ''));
            puntos.push([lat, lng]);
        });
        if (puntos.length) mapa.fitBounds(puntos, { padding: [30, 30], maxZoom: 16 });
        else mapa.setView([10.2269, -66.8553], 13);   // Charallave
    }

    /* ================================================================ PERSONAL */

    async function personal(z) {
        var puede = st.yo.puede_escribir;
        z.innerHTML =
            '<h3>Personal</h3><p class="sub">Quienes usan la app de asistencia. La clave inicial se entrega en mano y la app obliga a cambiarla la primera vez.</p>' +
            '<div class="fila-herr">' +
                '<input type="search" id="pcBuscarPersonal" placeholder="Buscar por nombre, cédula, cargo o grupo…">' +
                '<select id="pcFiltroActivo"><option value="activos">Solo activos</option><option value="todos">Todos</option><option value="inactivos">Solo inactivos</option></select>' +
                '<button type="button" class="btn btn-verde" id="pcExcelPersonal">📊 Excel</button>' +
                (puede ? '<button type="button" class="btn btn-azul" id="pcNuevoFuncionario">+ Nuevo funcionario</button>' : '') +
            '</div><div id="pcTablaPersonal"></div>';
        function pintar() {
            var txt = $('#pcBuscarPersonal').value.trim().toLowerCase();
            var filtro = $('#pcFiltroActivo').value;
            var lista = st.funcionarios.filter(function (f) {
                if (filtro === 'activos' && !f.activo) return false;
                if (filtro === 'inactivos' && f.activo) return false;
                if (!txt) return true;
                var g = grupoDe(f.grupo_id);
                return [f.nombres, f.apellidos, f.cedula, f.cargo, g && g.nombre].join(' ').toLowerCase().indexOf(txt) >= 0;
            });
            $('#pcTablaPersonal').innerHTML = !lista.length ? '<div class="vacio">No hay nadie con ese filtro.</div>' :
                '<p class="muted">' + lista.length + ' persona(s)</p><div class="tabla-scroll"><table><thead><tr>' +
                '<th>Nombre</th><th>Cédula</th><th>Cargo</th><th>Grupo</th><th>App</th><th>Clave</th>' + (puede ? '<th>Acciones</th>' : '') +
                '</tr></thead><tbody>' + lista.map(function (f) {
                    var g = grupoDe(f.grupo_id);
                    return '<tr' + (f.activo ? '' : ' style="opacity:.55"') + '><td><b>' + esc(nombreDe(f)) + '</b>' +
                        (f.condicion === 'voluntario' ? ' <span class="pill p-azul">Voluntario</span>' : '') +
                        (f.activo ? '' : ' <span class="pill p-gris">Inactivo</span>') + '</td>' +
                        '<td>' + esc(Number(f.cedula).toLocaleString('es-VE')) + '</td><td>' + esc(f.cargo || '—') + '</td>' +
                        '<td>' + (g ? '<span class="pill" style="background:' + colorGrupo(g.id) + ';color:#0f172a">' + esc(g.nombre) + '</span>' : '<span class="muted">Sin grupo</span>') + '</td>' +
                        '<td>' + (f.dispositivo_autorizado ? '<span class="pill p-verde">Entró</span><br><span class="muted">' + esc(f.dispositivo_nombre || '') + '</span>' : '<span class="pill p-gris">Aún no</span>') + '</td>' +
                        '<td>' + (f.debe_cambiar_clave ? '<span class="pill p-naranja">Inicial (debe cambiarla)</span>' : '<span class="pill p-verde">Propia</span>') + '</td>' +
                        (puede ? '<td style="white-space:nowrap"><button type="button" class="btn-mini" data-editar="' + esc(f.id) + '">Editar</button>' +
                            '<button type="button" class="btn-mini naranja" data-resetear="' + esc(f.id) + '">Nueva clave</button>' +
                            (f.dispositivo_autorizado ? '<button type="button" class="btn-mini" data-liberar="' + esc(f.id) + '">Liberar teléfono</button>' : '') + '</td>' : '') +
                        '</tr>';
                }).join('') + '</tbody></table></div>';
            $$('[data-editar]').forEach(function (b) { b.onclick = function () { formFuncionario(persona(b.dataset.editar)); }; });
            $$('[data-resetear]').forEach(function (b) { b.onclick = function () { resetearClave(persona(b.dataset.resetear)); }; });
            $$('[data-liberar]').forEach(function (b) { b.onclick = function () { liberarTelefono(persona(b.dataset.liberar)); }; });
        }
        $('#pcBuscarPersonal').oninput = pintar;
        $('#pcFiltroActivo').onchange = pintar;
        $('#pcExcelPersonal').onclick = function () { excelPersonal().catch(function (e) { aviso('error', e.message); }); };
        if (puede) $('#pcNuevoFuncionario').onclick = function () { formFuncionario(null); };
        pintar();
    }

    function opciones(lista, elegido, etiquetaVacia, texto) {
        return '<option value="">' + esc(etiquetaVacia) + '</option>' + lista.map(function (x) {
            return '<option value="' + esc(x.id) + '"' + (x.id === elegido ? ' selected' : '') + '>' + esc(texto(x)) + '</option>';
        }).join('');
    }

    function formFuncionario(f) {
        var nuevo = !f;
        f = f || { activo: true, condicion: 'fijo' };
        var clave = nuevo ? claveAlAzar() : '';
        ventana(nuevo ? 'Nuevo funcionario' : 'Editar a ' + nombreDe(f),
            '<div class="g2"><div class="campo"><label>Cédula</label><input id="fCedula" inputmode="numeric" value="' + esc(f.cedula || '') + '"></div>' +
            '<div class="campo"><label>Cargo</label><input id="fCargo" value="' + esc(f.cargo || '') + '"></div></div>' +
            '<div class="g2"><div class="campo"><label>Nombres</label><input id="fNombres" value="' + esc(f.nombres || '') + '"></div>' +
            '<div class="campo"><label>Apellidos</label><input id="fApellidos" value="' + esc(f.apellidos || '') + '"></div></div>' +
            '<div class="g2"><div class="campo"><label>Condición</label><select id="fCondicion"><option value="fijo"' + (f.condicion === 'fijo' ? ' selected' : '') + '>Fijo</option>' +
                '<option value="voluntario"' + (f.condicion === 'voluntario' ? ' selected' : '') + '>Voluntario</option></select></div>' +
            '<div class="campo"><label>Teléfono</label><input id="fTelefono" inputmode="tel" value="' + esc(f.telefono || '') + '"></div></div>' +
            '<div class="g2"><div class="campo"><label>Grupo de guardia</label><select id="fGrupo">' + opciones(st.grupos.filter(function (g) { return g.activo || g.id === f.grupo_id; }), f.grupo_id, 'Sin grupo', function (g) { return g.nombre; }) + '</select></div>' +
            '<div class="campo"><label>Estación</label><select id="fEstacion">' + opciones(st.estaciones, f.estacion_id, 'Sin estación fija', function (e) { return e.nombre; }) + '</select></div></div>' +
            (nuevo ? '<div class="campo"><label>Clave inicial</label><input id="fClave" inputmode="numeric" value="' + esc(clave) + '">' +
                '<div class="ayuda">Se generó al azar. Anótala y entrégala en mano: la app le pedirá cambiarla la primera vez que entre.</div></div>'
                : '<div class="campo"><label><input type="checkbox" id="fActivo"' + (f.activo ? ' checked' : '') + '> Activo (si lo desactivas, no puede entrar ni marcar)</label></div>'),
            [{ texto: 'Cancelar', estilo: 'background:#e2e8f0;color:#0f172a' },
             { texto: nuevo ? 'Crear funcionario' : 'Guardar cambios', accion: async function (c) {
                var datos = {
                    p_id: nuevo ? null : f.id, p_cedula: valor(c, '#fCedula'), p_nombres: valor(c, '#fNombres'), p_apellidos: valor(c, '#fApellidos'),
                    p_cargo: valor(c, '#fCargo') || null, p_condicion: valor(c, '#fCondicion'), p_grupo_id: valor(c, '#fGrupo') || null,
                    p_estacion_id: valor(c, '#fEstacion') || null, p_telefono: valor(c, '#fTelefono') || null,
                    p_activo: nuevo ? true : c.querySelector('#fActivo').checked, p_clave_inicial: nuevo ? valor(c, '#fClave') : null
                };
                if (!datos.p_nombres || !datos.p_apellidos) throw new Error('Faltan los nombres y los apellidos.');
                await rpc('pc_admin_guardar_funcionario', datos);
                if (nuevo) mostrarClave(datos.p_nombres + ' ' + datos.p_apellidos, datos.p_clave_inicial, 'Funcionario creado');
                else aviso('bien', 'Cambios guardados.');
                await abrir('personal');
            } }]);
    }
    function mostrarClave(nombre, clave, titulo) {
        ventana(titulo, '<p>Clave inicial de <b>' + esc(nombre) + '</b>:</p><div class="clave-grande">' + esc(clave) + '</div>' +
            '<p class="muted">Anótala ahora: no se vuelve a mostrar. Entrégala en mano. La primera vez que entre a la app, se le pedirá cambiarla por una suya.</p>');
    }
    function resetearClave(f) {
        var clave = claveAlAzar();
        ventana('Nueva clave para ' + nombreDe(f),
            '<p>Se le pondrá una clave inicial nueva. Su sesión en el teléfono se cierra y, al entrar, la app le pedirá cambiarla.</p>' +
            '<div class="campo"><label>Clave inicial nueva</label><input id="rClave" inputmode="numeric" value="' + esc(clave) + '"></div>',
            [{ texto: 'Cancelar', estilo: 'background:#e2e8f0;color:#0f172a' },
             { texto: 'Poner esta clave', estilo: 'background:#ea580c;color:#fff', accion: async function (c) {
                var nueva = valor(c, '#rClave');
                await rpc('pc_admin_resetear_clave', { p_funcionario_id: f.id, p_clave_nueva: nueva });
                mostrarClave(nombreDe(f), nueva, 'Clave cambiada');
                await abrir('personal');
            } }]);
    }
    function liberarTelefono(f) {
        ventana('Liberar el teléfono de ' + nombreDe(f),
            '<p>Su cuenta está atada a: <b>' + esc(f.dispositivo_nombre || 'un teléfono') + '</b>.</p>' +
            '<p>Si se le dañó o cambió de teléfono, libéralo: podrá entrar desde el nuevo, y el anterior deja de servir al instante.</p>',
            [{ texto: 'Cancelar', estilo: 'background:#e2e8f0;color:#0f172a' },
             { texto: 'Liberar teléfono', accion: async function () {
                await rpc('pc_admin_liberar_telefono', { p_funcionario_id: f.id });
                aviso('bien', 'Teléfono liberado. Ya puede entrar desde otro.');
                await abrir('personal');
            } }]);
    }
    async function excelPersonal() {
        await cargarScript(XLSX_JS);
        var enc = ['Apellidos', 'Nombres', 'Cédula', 'Cargo', 'Condición', 'Grupo', 'Estación', 'Teléfono', 'Entró a la app', 'Teléfono vinculado', 'Clave', 'Activo'];
        var filas = st.funcionarios.map(function (f) {
            var g = grupoDe(f.grupo_id), e = estacionDe(f.estacion_id);
            return [f.apellidos, f.nombres, f.cedula, f.cargo || '', f.condicion, g ? g.nombre : '', e ? e.nombre : '', f.telefono || '',
                    f.dispositivo_autorizado ? 'Sí' : 'No', f.dispositivo_nombre || '', f.debe_cambiar_clave ? 'Inicial' : 'Propia', f.activo ? 'Sí' : 'No'].map(seguroExcel);
        });
        guardarExcel('Personal de Protección Civil - App de asistencia', [['Personal', enc, filas]], 'Personal_Asistencia_PC');
    }

    /* ================================================================ GUARDIAS */

    async function guardias(z) {
        var puede = st.yo.puede_escribir;
        var mes = (location.hash.match(/mes=(\d{4}-\d{2})/) || [])[1] || hoy().slice(0, 7);
        z.innerHTML =
            '<div class="dos-col">' +
                '<div class="caja"><h4>Tipos de guardia</h4><p class="muted" style="margin-top:-4px">24x48, 24x72, oficina… Los define el jefe.</p>' +
                    '<div id="pcTipos"></div>' + (puede ? '<button type="button" class="btn btn-azul" id="pcNuevoTipo" style="margin-top:8px">+ Tipo de guardia</button>' : '') + '</div>' +
                '<div class="caja"><h4>Grupos</h4><p class="muted" style="margin-top:-4px">Guardia A, B, C… Cada funcionario se asigna a un grupo desde Personal.</p>' +
                    '<div id="pcGrupos"></div>' + (puede ? '<button type="button" class="btn btn-azul" id="pcNuevoGrupo" style="margin-top:8px">+ Grupo</button>' : '') + '</div>' +
            '</div>' +
            '<div class="caja" style="margin-top:16px"><h4>Calendario de guardias</h4>' +
                '<div class="fila-herr"><input type="month" id="pcMes" value="' + esc(mes) + '"></div><div id="pcCalendario"><div class="cargando">Armando el calendario…</div></div></div>';
        $('#pcTipos').innerHTML = !st.tipos.length ? '<div class="vacio">Todavía no hay tipos de guardia. Crea el primero (por ejemplo, 24x48).</div>' :
            '<div class="tabla-scroll"><table><thead><tr><th>Nombre</th><th>Cómo es</th><th>Tolerancia</th>' + (puede ? '<th></th>' : '') + '</tr></thead><tbody>' +
            st.tipos.map(function (t) {
                return '<tr' + (t.activo ? '' : ' style="opacity:.55"') + '><td><b>' + esc(t.nombre) + '</b></td><td>' + esc(describirTipo(t)) + '</td><td>' + esc(t.tolerancia_min) + ' min</td>' +
                    (puede ? '<td><button type="button" class="btn-mini" data-tipo="' + esc(t.id) + '">Editar</button></td>' : '') + '</tr>';
            }).join('') + '</tbody></table></div>';
        $('#pcGrupos').innerHTML = !st.grupos.length ? '<div class="vacio">Todavía no hay grupos.</div>' :
            '<div class="tabla-scroll"><table><thead><tr><th>Grupo</th><th>Tipo</th><th>Personas</th>' + (puede ? '<th></th>' : '') + '</tr></thead><tbody>' +
            st.grupos.map(function (g) {
                var t = tipoDe(g.tipo_guardia_id);
                var n = st.funcionarios.filter(function (f) { return f.grupo_id === g.id && f.activo; }).length;
                return '<tr' + (g.activo ? '' : ' style="opacity:.55"') + '><td><span class="pill" style="background:' + colorGrupo(g.id) + ';color:#0f172a">' + esc(g.nombre) + '</span></td>' +
                    '<td>' + esc(t ? t.nombre : '—') + (g.fecha_referencia ? '<br><span class="muted">Entró el ' + esc(fechaCorta(g.fecha_referencia + 'T12:00:00Z')) + '</span>' : '') + '</td>' +
                    '<td class="num">' + n + '</td>' + (puede ? '<td><button type="button" class="btn-mini" data-grupo="' + esc(g.id) + '">Editar</button></td>' : '') + '</tr>';
            }).join('') + '</tbody></table></div>';
        if (puede) {
            $('#pcNuevoTipo').onclick = function () { formTipo(null); };
            $('#pcNuevoGrupo').onclick = function () { formGrupo(null); };
            $$('[data-tipo]').forEach(function (b) { b.onclick = function () { formTipo(tipoDe(b.dataset.tipo)); }; });
            $$('[data-grupo]').forEach(function (b) { b.onclick = function () { formGrupo(grupoDe(b.dataset.grupo)); }; });
        }
        $('#pcMes').onchange = function () { pintarCalendario($('#pcMes').value).catch(function (e) { aviso('error', e.message); }); };
        await pintarCalendario(mes);
    }
    function describirTipo(t) {
        var ini = String(t.hora_inicio || '').slice(0, 5);
        if (t.modalidad === 'rotativa') return t.horas_servicio + ' h de servicio y ' + t.horas_descanso + ' h de descanso, desde las ' + ini;
        var dias = ['', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
        return (t.dias_semana || []).map(function (d) { return dias[d]; }).join(', ') + ' de ' + ini + ' a ' + String(t.hora_fin || '').slice(0, 5);
    }
    async function pintarCalendario(mes) {
        var desde = mes + '-01';
        var ultimo = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).getUTCDate();
        var hasta = mes + '-' + String(ultimo).padStart(2, '0');
        var programadas = await rpc('pc_admin_cuadrante', { p_desde: desde, p_hasta: hasta });
        var porDia = {};
        (programadas || []).forEach(function (g) {
            /* Una guardia de 24 h aparece en el día en que EMPIEZA. */
            var d = new Date(new Date(g.inicio).getTime() - 4 * 3600e3).toISOString().slice(0, 10);
            (porDia[d] = porDia[d] || []).push(g);
        });
        var primerDia = new Date(desde + 'T12:00:00Z').getUTCDay();   // 0 = domingo
        var hueco = (primerDia + 6) % 7;                                // la semana empieza el lunes
        var html = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'].map(function (d) { return '<div class="cab">' + d + '</div>'; }).join('');
        for (var i = 0; i < hueco; i++) html += '<div class="dia fuera"></div>';
        for (var dia = 1; dia <= ultimo; dia++) {
            var fecha = mes + '-' + String(dia).padStart(2, '0');
            html += '<div class="dia' + (fecha === hoy() ? ' hoy' : '') + '"><b>' + dia + '</b>' + (porDia[fecha] || []).map(function (g) {
                return '<span class="g" style="background:' + colorGrupo(g.grupo_id) + '" title="' + esc(g.grupo + ' · ' + g.tipo_guardia + ' · ' + hora(g.inicio) + ' a ' + fechaHora(g.fin)) + '">' +
                    esc(hora(g.inicio) + ' ' + g.grupo) + '</span>';
            }).join('') + '</div>';
        }
        $('#pcCalendario').innerHTML = !st.grupos.length ? '<div class="vacio">Cuando haya grupos con su tipo de guardia y su fecha de referencia, aquí se verá el calendario del mes.</div>' :
            '<div class="tabla-scroll"><div class="calendario" style="min-width:560px">' + html + '</div></div>';
    }
    function formTipo(t) {
        var nuevo = !t;
        t = t || { modalidad: 'rotativa', horas_servicio: 24, horas_descanso: 48, hora_inicio: '07:00', tolerancia_min: 15, activo: true, dias_semana: [1, 2, 3, 4, 5], hora_fin: '16:00' };
        var dias = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
        var capa = ventana(nuevo ? 'Nuevo tipo de guardia' : 'Editar ' + t.nombre,
            '<div class="g2"><div class="campo"><label>Nombre</label><input id="tNombre" placeholder="Ej: 24x48" value="' + esc(t.nombre || '') + '"></div>' +
            '<div class="campo"><label>Cómo es</label><select id="tModalidad"><option value="rotativa"' + (t.modalidad === 'rotativa' ? ' selected' : '') + '>Rotativa (X horas de servicio, Y de descanso)</option>' +
                '<option value="semanal"' + (t.modalidad === 'semanal' ? ' selected' : '') + '>Semanal (ciertos días, de una hora a otra)</option></select></div></div>' +
            '<div id="tRotativa" class="g3"><div class="campo"><label>Horas de servicio</label><input id="tServicio" type="number" min="1" max="96" value="' + esc(t.horas_servicio || 24) + '"></div>' +
                '<div class="campo"><label>Horas de descanso</label><input id="tDescanso" type="number" min="0" max="336" value="' + esc(t.horas_descanso == null ? 48 : t.horas_descanso) + '"></div>' +
                '<div class="campo"><label>Empieza a las</label><input id="tInicioR" type="time" value="' + esc(String(t.hora_inicio || '07:00').slice(0, 5)) + '"></div></div>' +
            '<div id="tSemanal"><div class="campo"><label>Días</label><div class="dias-sem">' + dias.map(function (d, i) {
                return '<label><input type="checkbox" value="' + (i + 1) + '"' + ((t.dias_semana || []).indexOf(i + 1) >= 0 ? ' checked' : '') + '> ' + d + '</label>';
            }).join('') + '</div></div><div class="g2"><div class="campo"><label>Entrada</label><input id="tInicioS" type="time" value="' + esc(String(t.hora_inicio || '08:00').slice(0, 5)) + '"></div>' +
                '<div class="campo"><label>Salida</label><input id="tFin" type="time" value="' + esc(String(t.hora_fin || '16:00').slice(0, 5)) + '"></div></div></div>' +
            '<div class="g2"><div class="campo"><label>Tolerancia para llegar (minutos)</label><input id="tTolerancia" type="number" min="0" max="240" value="' + esc(t.tolerancia_min) + '"></div>' +
            '<div class="campo"><label>&nbsp;</label><label><input type="checkbox" id="tActivo"' + (t.activo ? ' checked' : '') + '> Activo</label></div></div>',
            [{ texto: 'Cancelar', estilo: 'background:#e2e8f0;color:#0f172a' },
             { texto: 'Guardar', accion: async function (c) {
                var rot = valor(c, '#tModalidad') === 'rotativa';
                var datos = { nombre: valor(c, '#tNombre'), modalidad: rot ? 'rotativa' : 'semanal', tolerancia_min: Number(valor(c, '#tTolerancia')) || 0, activo: c.querySelector('#tActivo').checked };
                if (!datos.nombre) throw new Error('Ponle un nombre (por ejemplo, 24x48).');
                if (rot) {
                    datos.horas_servicio = Number(valor(c, '#tServicio')); datos.horas_descanso = Number(valor(c, '#tDescanso'));
                    datos.hora_inicio = valor(c, '#tInicioR'); datos.dias_semana = null; datos.hora_fin = null;
                } else {
                    datos.dias_semana = $$('.dias-sem input:checked', c).map(function (x) { return Number(x.value); });
                    if (!datos.dias_semana.length) throw new Error('Marca al menos un día.');
                    datos.hora_inicio = valor(c, '#tInicioS'); datos.hora_fin = valor(c, '#tFin');
                    datos.horas_servicio = null; datos.horas_descanso = null;
                }
                await guardarCatalogo('tipos_guardia', nuevo ? null : t.id, datos);
                aviso('bien', 'Tipo de guardia guardado.');
                await abrir('guardias');
            } }]);
        function alternar() {
            var rot = valor(capa, '#tModalidad') === 'rotativa';
            capa.querySelector('#tRotativa').style.display = rot ? '' : 'none';
            capa.querySelector('#tSemanal').style.display = rot ? 'none' : '';
        }
        capa.querySelector('#tModalidad').onchange = alternar;
        alternar();
    }
    function formGrupo(g) {
        var nuevo = !g;
        g = g || { activo: true };
        ventana(nuevo ? 'Nuevo grupo' : 'Editar ' + g.nombre,
            '<div class="g2"><div class="campo"><label>Nombre</label><input id="gNombre" placeholder="Ej: Guardia A" value="' + esc(g.nombre || '') + '"></div>' +
            '<div class="campo"><label>Tipo de guardia</label><select id="gTipo">' + opciones(st.tipos, g.tipo_guardia_id, 'Elige…', function (t) { return t.nombre; }) + '</select></div></div>' +
            '<div class="g2"><div class="campo"><label>Estación</label><select id="gEstacion">' + opciones(st.estaciones, g.estacion_id, 'Cualquiera', function (e) { return e.nombre; }) + '</select></div>' +
            '<div class="campo"><label>Un día en que este grupo entró de guardia</label><input id="gFecha" type="date" value="' + esc(g.fecha_referencia || '') + '">' +
                '<div class="ayuda">En las guardias rotativas, de este día sale todo el calendario.</div></div></div>' +
            '<label><input type="checkbox" id="gActivo"' + (g.activo ? ' checked' : '') + '> Activo</label>',
            [{ texto: 'Cancelar', estilo: 'background:#e2e8f0;color:#0f172a' },
             { texto: 'Guardar', accion: async function (c) {
                var datos = { nombre: valor(c, '#gNombre'), tipo_guardia_id: valor(c, '#gTipo'), estacion_id: valor(c, '#gEstacion') || null,
                              fecha_referencia: valor(c, '#gFecha') || null, activo: c.querySelector('#gActivo').checked };
                if (!datos.nombre) throw new Error('Ponle un nombre al grupo.');
                if (!datos.tipo_guardia_id) throw new Error('Elige el tipo de guardia.');
                var t = tipoDe(datos.tipo_guardia_id);
                if (t && t.modalidad === 'rotativa' && !datos.fecha_referencia) throw new Error('En una guardia rotativa hace falta un día en que el grupo entró de guardia.');
                await guardarCatalogo('grupos', nuevo ? null : g.id, datos);
                aviso('bien', 'Grupo guardado.');
                await abrir('guardias');
            } }]);
    }
    function guardarCatalogo(tabla, id, datos) {
        return id ? api('/rest/v1/' + tabla + '?id=eq.' + q(id), { metodo: 'PATCH', cuerpo: datos, prefer: 'return=minimal' })
                  : api('/rest/v1/' + tabla, { metodo: 'POST', cuerpo: datos, prefer: 'return=minimal' });
    }

    /* ================================================================ REGISTROS */

    async function registros(z) {
        var puede = st.yo.puede_escribir;
        z.innerHTML =
            '<h3>Registros de guardias</h3><p class="sub">Cada guardia trabajada, de la entrada a la salida, con sus marcajes y sus fotos. Aquí se revisa lo que quedó pendiente.</p>' +
            '<div class="fila-herr">' +
                '<label class="muted">Desde <input type="date" id="rDesde" value="' + hoy(-7) + '"></label>' +
                '<label class="muted">Hasta <input type="date" id="rHasta" value="' + hoy() + '"></label>' +
                '<select id="rPersona">' + opciones(st.funcionarios, null, 'Todo el personal', nombreDe) + '</select>' +
                '<select id="rEstado"><option value="">Todos los estados</option><option value="por_revisar">Por revisar</option><option value="abierta">De guardia ahora</option><option value="valido">Completas</option><option value="anulado">Anuladas</option></select>' +
                '<button type="button" class="btn btn-suave" id="rBuscar">Buscar</button>' +
                (puede ? '<button type="button" class="btn btn-azul" id="rManual">+ Marcaje a mano</button>' : '') +
            '</div><div id="rTabla"><div class="cargando">Buscando…</div></div>';
        $('#rBuscar').onclick = function () { pintarRegistros().catch(function (e) { aviso('error', e.message); }); };
        if (puede) $('#rManual').onclick = formMarcajeManual;
        await pintarRegistros();
    }
    async function pintarRegistros() {
        var desde = $('#rDesde').value, hasta = $('#rHasta').value, quien = $('#rPersona').value, estado = $('#rEstado').value;
        var ruta = '/rest/v1/servicios?select=*&inicio=gte.' + q(inicioDe(desde)) + '&inicio=lt.' + q(inicioDe(sumarDias(hasta, 1))) + '&order=inicio.desc&limit=500';
        if (quien) ruta += '&funcionario_id=eq.' + q(quien);
        if (estado === 'abierta') ruta += '&fin=is.null';
        else if (estado) ruta += '&estado=eq.' + q(estado);
        var servicios = await api(ruta) || [];
        var marcajes = [];
        if (servicios.length) {
            marcajes = await enTandas(servicios.map(function (s) { return s.id; }), function (ids) {
                return '/rest/v1/marcajes?select=id,servicio_id,tipo,momento,dentro,distancia_m,sin_conexion,hora_confiable,manual,motivo_manual,revision,estacion_id,precision_m&servicio_id=in.(' + ids + ')';
            });
        }
        var porServicio = {};
        marcajes.forEach(function (m) { (porServicio[m.servicio_id] = porServicio[m.servicio_id] || {})[m.tipo] = m; });
        var puede = st.yo.puede_escribir;
        var total = servicios.reduce(function (s, x) { return s + (x.estado !== 'anulado' ? (horasEntre(x.inicio, x.fin) || 0) : 0); }, 0);
        $('#rTabla').innerHTML = !servicios.length ? '<div class="vacio">No hay guardias en esas fechas con ese filtro.</div>' :
            '<p class="muted">' + servicios.length + ' guardia(s) · ' + esc(horasBonitas(total)) + ' trabajadas (sin contar las anuladas)' + (servicios.length === 500 ? ' · se muestran las 500 más recientes: acorta las fechas para ver el resto' : '') + '</p>' +
            '<div class="tabla-scroll"><table><thead><tr><th>Funcionario</th><th>Entrada</th><th>Salida</th><th>Horas</th><th>Estado</th>' + (puede ? '<th></th>' : '') + '</tr></thead><tbody>' +
            servicios.map(function (s) {
                var ms = porServicio[s.id] || {};
                return '<tr><td><b>' + esc(nombreDe(persona(s.funcionario_id))) + '</b></td>' +
                    '<td>' + celdaMarcaje(s.inicio, ms.entrada) + '</td>' +
                    '<td>' + (s.fin ? celdaMarcaje(s.fin, ms.salida, s.cierre) : '<span class="muted">Aún de guardia</span>') + '</td>' +
                    '<td class="num">' + esc(horasBonitas(horasEntre(s.inicio, s.fin))) + '</td>' +
                    '<td>' + pillServicio(s) + (s.nota ? '<br><span class="muted">' + esc(s.nota) + '</span>' : '') + '</td>' +
                    (puede ? '<td><button type="button" class="btn-mini" data-revisar="' + esc(s.id) + '">Revisar</button></td>' : '') + '</tr>';
            }).join('') + '</tbody></table></div>';
        engancharFotos($('#rTabla'));
        $$('[data-revisar]').forEach(function (b) {
            b.onclick = function () { formRevisar(servicios.find(function (s) { return s.id === b.dataset.revisar; })); };
        });
    }
    function celdaMarcaje(momento, m, cierre) {
        var h = esc(fechaHora(momento));
        if (!m) return h + (cierre === 'automatico' ? '<br><span class="pill p-naranja">No marcó salida</span>' : cierre === 'manual' ? '<br><span class="pill p-azul">Corregida por el jefe</span>' : '');
        var est = estacionDe(m.estacion_id);
        return h + '<br><span class="muted">' + (m.manual ? 'A mano: ' + esc(m.motivo_manual || '') :
            (est ? esc(est.nombre) + ' · ' : '') + (m.distancia_m != null ? 'a ' + esc(Math.round(m.distancia_m)) + ' m' : '')) + '</span> ' +
            (m.sin_conexion ? '<span class="pill p-gris">Sin señal</span> ' : '') +
            (m.revision === 'por_revisar' ? '<span class="pill p-naranja">Hora dudosa</span> ' : '') +
            (m.manual ? '' : '<button type="button" class="btn-mini" data-foto="' + esc(m.id) + '">📷</button>');
    }
    function formRevisar(s) {
        var f = persona(s.funcionario_id);
        ventana('Revisar la guardia de ' + nombreDe(f),
            '<p class="muted">Entrada: ' + esc(fechaHora(s.inicio)) + (s.fin ? ' · Salida: ' + esc(fechaHora(s.fin)) : ' · Aún de guardia') + '</p>' +
            '<div class="g2"><div class="campo"><label>Decisión</label><select id="vEstado"><option value="valido">Darla por buena</option><option value="anulado">Anularla (no cuenta)</option></select></div>' +
            '<div class="campo"><label>Hora de salida (si hay que ponerla o corregirla)</label><input id="vFin" type="datetime-local" value="' + (s.fin && s.cierre !== 'automatico' ? esc(aLocal(s.fin)) : '') + '"></div></div>' +
            '<div class="campo"><label>Nota (obligatoria: explica la decisión)</label><textarea id="vNota" placeholder="Ej: Salió a las 7:00 a. m., según el libro de guardia.">' + esc(s.nota && s.estado !== 'por_revisar' ? s.nota : '') + '</textarea></div>',
            [{ texto: 'Cancelar', estilo: 'background:#e2e8f0;color:#0f172a' },
             { texto: 'Guardar revisión', accion: async function (c) {
                await rpc('pc_admin_revisar_servicio', { p_servicio_id: s.id, p_estado: valor(c, '#vEstado'), p_nota: valor(c, '#vNota'), p_fin: deLocal(valor(c, '#vFin')) });
                aviso('bien', 'Revisión guardada.');
                await pintarRegistros();
            } }]);
    }
    function formMarcajeManual() {
        ventana('Marcaje a mano',
            '<p class="muted">Para cuando el teléfono se dañó o se quedó sin batería. Queda marcado como hecho a mano, con tu nombre y el motivo.</p>' +
            '<div class="campo"><label>Funcionario</label><select id="mPersona">' + opciones(st.funcionarios.filter(function (f) { return f.activo; }), null, 'Elige…', nombreDe) + '</select></div>' +
            '<div class="g2"><div class="campo"><label>Tipo</label><select id="mTipo"><option value="entrada">Entrada</option><option value="salida">Salida</option></select></div>' +
            '<div class="campo"><label>Fecha y hora</label><input id="mMomento" type="datetime-local" value="' + esc(aLocal(new Date().toISOString())) + '"></div></div>' +
            '<div class="campo"><label>Motivo</label><textarea id="mMotivo" placeholder="Ej: Se le dañó el teléfono."></textarea></div>',
            [{ texto: 'Cancelar', estilo: 'background:#e2e8f0;color:#0f172a' },
             { texto: 'Registrar', accion: async function (c) {
                if (!valor(c, '#mPersona')) throw new Error('Elige al funcionario.');
                var r = await rpc('pc_admin_marcaje_manual', { p_funcionario_id: valor(c, '#mPersona'), p_tipo: valor(c, '#mTipo'),
                                                               p_momento: deLocal(valor(c, '#mMomento')), p_motivo: valor(c, '#mMotivo') });
                if (r && r.ok === false) throw new Error(r.mensaje || 'No se pudo registrar.');
                aviso('bien', 'Marcaje registrado.');
                await pintarRegistros();
            } }]);
    }

    /* ================================================================ REPORTES */

    async function reportes(z) {
        z.innerHTML =
            '<h3>Reportes</h3><p class="sub">Cada guardia programada contra lo que de verdad se marcó, y las horas trabajadas de cada persona. Sirve para nómina y para las horas de los voluntarios.</p>' +
            '<div class="fila-herr">' +
                '<label class="muted">Desde <input type="date" id="pDesde" value="' + hoy().slice(0, 8) + '01"></label>' +
                '<label class="muted">Hasta <input type="date" id="pHasta" value="' + hoy() + '"></label>' +
                '<button type="button" class="btn btn-suave" id="pVer">Ver</button>' +
                '<button type="button" class="btn btn-verde" id="pExcel">📊 Excel</button>' +
                '<button type="button" class="btn btn-naranja" id="pPdf">🖨️ PDF</button>' +
            '</div><div id="pZona"></div>';
        var datos = null;
        async function cargar() {
            $('#pZona').innerHTML = '<div class="cargando">Calculando…</div>';
            datos = await armarReporte($('#pDesde').value, $('#pHasta').value);
            pintarReporte(datos);
        }
        $('#pVer').onclick = function () { cargar().catch(function (e) { aviso('error', e.message); }); };
        $('#pExcel').onclick = function () { (datos ? excelReporte(datos) : Promise.resolve()).catch(function (e) { aviso('error', e.message); }); };
        $('#pPdf').onclick = function () { (datos ? pdfReporte(datos) : Promise.resolve()).catch(function (e) { aviso('error', e.message); }); };
        await cargar();
    }
    /* Junta el cumplimiento (de la base) con las horas trabajadas de cada
       persona. Es una función aparte para poder probarla sin navegador. */
    async function armarReporte(desde, hasta) {
        if (!desde || !hasta || hasta < desde) throw new Error('Revisa las fechas: "hasta" no puede ser antes de "desde".');
        var r = await Promise.all([
            rpc('pc_admin_cumplimiento', { p_desde: desde, p_hasta: hasta }),
            api('/rest/v1/servicios?select=funcionario_id,inicio,fin,estado&inicio=gte.' + q(inicioDe(desde)) + '&inicio=lt.' + q(inicioDe(sumarDias(hasta, 1))) + '&limit=5000')
        ]);
        return resumirReporte(desde, hasta, r[0] || [], r[1] || [], st.funcionarios);
    }
    function resumirReporte(desde, hasta, detalle, servicios, funcionarios) {
        var porPersona = {};
        function fila(id) {
            if (!porPersona[id]) {
                var f = funcionarios.find(function (x) { return x.id === id; });
                porPersona[id] = { id: id, nombre: f ? f.apellidos + ', ' + f.nombres : 'Desconocido', cedula: f ? f.cedula : '', condicion: f ? f.condicion : '',
                                   programadas: 0, cumplio: 0, tarde: 0, falto: 0, en_curso: 0, guardias: 0, horas: 0, por_revisar: 0 };
            }
            return porPersona[id];
        }
        detalle.forEach(function (d) {
            var p = fila(d.funcionario_id);
            if (d.estado === 'programada') return;
            p.programadas++;
            if (d.estado === 'cumplio') p.cumplio++;
            else if (d.estado === 'tarde') p.tarde++;
            else if (d.estado === 'falto') p.falto++;
            else if (d.estado === 'en_curso') p.en_curso++;
        });
        servicios.forEach(function (s) {
            if (s.estado === 'anulado') return;
            var p = fila(s.funcionario_id);
            p.guardias++;
            if (s.estado === 'por_revisar') p.por_revisar++;
            p.horas += horasEntre(s.inicio, s.fin) || 0;
        });
        var resumen = Object.keys(porPersona).map(function (k) { return porPersona[k]; })
            .sort(function (a, b) { return a.nombre.localeCompare(b.nombre, 'es'); });
        return { desde: desde, hasta: hasta, detalle: detalle, resumen: resumen };
    }
    function pintarReporte(d) {
        var tot = d.resumen.reduce(function (t, p) {
            t.cumplio += p.cumplio; t.tarde += p.tarde; t.falto += p.falto; t.horas += p.horas; return t;
        }, { cumplio: 0, tarde: 0, falto: 0, horas: 0 });
        $('#pZona').innerHTML =
            '<div class="cifras">' + cifra(tot.cumplio, 'Guardias a tiempo', 'verde') + cifra(tot.tarde, 'Llegó tarde', tot.tarde ? 'naranja' : '') +
                cifra(tot.falto, 'Faltas', tot.falto ? 'rojo' : '') + cifra(Math.round(tot.horas), 'Horas trabajadas', '') + '</div>' +
            (!d.resumen.length ? '<div class="vacio">No hay guardias programadas ni trabajadas en esas fechas. Revisa que los grupos tengan su tipo de guardia y su fecha de referencia.</div>' :
            '<div class="tabla-scroll"><table><thead><tr><th>Funcionario</th><th>Cédula</th><th class="num">Programadas</th><th class="num">A tiempo</th><th class="num">Tarde</th><th class="num">Faltas</th><th class="num">Guardias trabajadas</th><th class="num">Horas</th></tr></thead><tbody>' +
            d.resumen.map(function (p) {
                return '<tr><td><b>' + esc(p.nombre) + '</b>' + (p.condicion === 'voluntario' ? ' <span class="pill p-azul">Voluntario</span>' : '') +
                    (p.por_revisar ? ' <span class="pill p-naranja">' + p.por_revisar + ' por revisar</span>' : '') + '</td><td>' + esc(p.cedula) + '</td>' +
                    '<td class="num">' + p.programadas + '</td><td class="num">' + p.cumplio + '</td><td class="num">' + p.tarde + '</td><td class="num">' + p.falto + '</td>' +
                    '<td class="num">' + p.guardias + '</td><td class="num">' + esc(horasBonitas(p.horas)) + '</td></tr>';
            }).join('') + '</tbody></table></div>');
    }
    function seguroExcel(v) {
        if (typeof v !== 'string' || !v) return v;
        return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
    }
    function guardarExcel(titulo, hojas, archivo) {
        var wb = XLSX.utils.book_new();
        hojas.forEach(function (h) {
            var aoa = [[titulo], ['Generado el ' + new Date().toLocaleString('es-VE', { timeZone: ZONA })], h[1]].concat(h[2]);
            var ws = XLSX.utils.aoa_to_sheet(aoa);
            ws['!cols'] = h[1].map(function (c) { return { wch: Math.max(12, Math.min(40, String(c).length + 6)) }; });
            ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 2, c: 0 }, e: { r: 2 + h[2].length, c: h[1].length - 1 } }) };
            XLSX.utils.book_append_sheet(wb, ws, h[0]);
        });
        XLSX.writeFile(wb, archivo + '_' + hoy() + '.xlsx');
    }
    var ESTADO_CUMPLIMIENTO = { cumplio: 'A tiempo', tarde: 'Tarde', falto: 'Faltó', en_curso: 'En curso', programada: 'Programada' };
    async function excelReporte(d) {
        await cargarScript(XLSX_JS);
        var titulo = 'Asistencia de Protección Civil · del ' + fechaCorta(d.desde + 'T12:00:00Z') + ' al ' + fechaCorta(d.hasta + 'T12:00:00Z');
        guardarExcel(titulo, [
            ['Resumen', ['Funcionario', 'Cédula', 'Condición', 'Programadas', 'A tiempo', 'Tarde', 'Faltas', 'Guardias trabajadas', 'Horas', 'Por revisar'],
                d.resumen.map(function (p) { return [seguroExcel(p.nombre), p.cedula, p.condicion, p.programadas, p.cumplio, p.tarde, p.falto, p.guardias, Math.round(p.horas * 100) / 100, p.por_revisar]; })],
            ['Detalle', ['Funcionario', 'Cédula', 'Grupo', 'Inicio programado', 'Fin programado', 'Entrada', 'Salida', 'Estado', 'Minutos tarde'],
                d.detalle.map(function (x) {
                    return [seguroExcel(x.funcionario), x.cedula, seguroExcel(x.grupo), fechaHora(x.inicio_programado), fechaHora(x.fin_programado),
                            x.entrada ? fechaHora(x.entrada) : '', x.salida ? fechaHora(x.salida) : '', ESTADO_CUMPLIMIENTO[x.estado] || x.estado, x.minutos_tarde == null ? '' : x.minutos_tarde];
                })]
        ], 'Asistencia_ProteccionCivil');
    }
    async function pdfReporte(d) {
        await cargarScript(JSPDF_JS);
        await cargarScript(AUTOTABLE_JS);
        var doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'letter', orientation: 'landscape' });
        var ancho = 279.4;
        doc.setFillColor(28, 63, 148); doc.rect(0, 0, ancho, 20, 'F');
        doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
        doc.text('REPUBLICA BOLIVARIANA DE VENEZUELA - ESTADO MIRANDA - MUNICIPIO CRISTOBAL ROJAS', ancho / 2, 8, { align: 'center' });
        doc.text('DIRECCION DE PROTECCION CIVIL Y ADMINISTRACION DE DESASTRES', ancho / 2, 14, { align: 'center' });
        doc.setTextColor(28, 63, 148); doc.setFontSize(15);
        doc.text('Reporte de asistencia', 14.2, 30);
        doc.setFontSize(10); doc.setTextColor(40, 40, 40); doc.setFont('helvetica', 'normal');
        doc.text('Del ' + fechaCorta(d.desde + 'T12:00:00Z') + ' al ' + fechaCorta(d.hasta + 'T12:00:00Z') + '   ·   Generado el ' +
                 new Date().toLocaleString('es-VE', { timeZone: ZONA }), 14.2, 36);
        /* Anchos: 70+26+22+30+22+18+20+30+13 = 251 mm, lo que cabe en carta horizontal. */
        doc.autoTable({
            startY: 41, margin: { left: 14.2, right: 14.2 },
            head: [['Funcionario', 'Cédula', 'Condición', 'Programadas', 'A tiempo', 'Tarde', 'Faltas', 'Horas trabajadas', 'Rev.']],
            body: d.resumen.map(function (p) { return [p.nombre, p.cedula, p.condicion, p.programadas, p.cumplio, p.tarde, p.falto, horasBonitas(p.horas), p.por_revisar || '']; }),
            styles: { fontSize: 9, cellPadding: 1.8 }, headStyles: { fillColor: [247, 148, 29], textColor: 255 },
            columnStyles: { 0: { cellWidth: 70 }, 1: { cellWidth: 26 }, 2: { cellWidth: 22 }, 3: { cellWidth: 30, halign: 'right' }, 4: { cellWidth: 22, halign: 'right' },
                            5: { cellWidth: 18, halign: 'right' }, 6: { cellWidth: 20, halign: 'right' }, 7: { cellWidth: 30, halign: 'right' }, 8: { cellWidth: 13, halign: 'right' } }
        });
        var paginas = doc.internal.getNumberOfPages();
        for (var i = 1; i <= paginas; i++) { doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(150, 150, 150); doc.text('Página ' + i + ' de ' + paginas, ancho / 2, 210, { align: 'center' }); }
        doc.save('Asistencia_ProteccionCivil_' + d.desde + '_al_' + d.hasta + '.pdf');
    }

    /* ================================================================ ESTACIONES */

    async function estaciones(z) {
        var puede = st.yo.puede_escribir;
        z.innerHTML =
            '<h3>Estaciones</h3><p class="sub">Los sitios donde se puede marcar. Se marca si el teléfono está dentro del radio (tomando en cuenta el margen de error del GPS).</p>' +
            (puede ? '<div class="fila-herr"><button type="button" class="btn btn-azul" id="eNueva">+ Nueva estación</button></div>' : '') +
            (!st.estaciones.length ? '<div class="aviso info">Todavía no hay estaciones: mientras no haya ninguna, nadie puede marcar. Crea la primera con su ubicación en el mapa.</div>' : '') +
            '<div class="dos-col"><div class="caja">' + (!st.estaciones.length ? '<div class="vacio">Sin estaciones.</div>' :
                '<div class="tabla-scroll"><table><thead><tr><th>Estación</th><th class="num">Radio</th><th>Estado</th>' + (puede ? '<th></th>' : '') + '</tr></thead><tbody>' +
                st.estaciones.map(function (e) {
                    return '<tr><td><b>' + esc(e.nombre) + '</b><br><span class="muted">' + esc(e.latitud.toFixed(6) + ', ' + e.longitud.toFixed(6)) + '</span></td>' +
                        '<td class="num">' + esc(e.radio_m) + ' m</td><td>' + (e.activa ? '<span class="pill p-verde">Activa</span>' : '<span class="pill p-gris">Inactiva</span>') + '</td>' +
                        (puede ? '<td><button type="button" class="btn-mini" data-estacion="' + esc(e.id) + '">Editar</button></td>' : '') + '</tr>';
                }).join('') + '</tbody></table></div>') +
            '</div><div class="caja"><div class="mapa" id="eMapa"></div></div></div>';
        if (puede) {
            $('#eNueva').onclick = function () { formEstacion(null); };
            $$('[data-estacion]').forEach(function (b) { b.onclick = function () { formEstacion(estacionDe(b.dataset.estacion)); }; });
        }
        try { await cargarLeaflet(); } catch (e) { return; }
        var cajaE = document.getElementById('eMapa');
        if (!cajaE || cajaE._leaflet_id) return;
        var mapa = L.map(cajaE);
        st.mapas.push(mapa);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
        var pts = st.estaciones.map(function (e) {
            L.circle([e.latitud, e.longitud], { radius: e.radio_m, color: e.activa ? '#f7941d' : '#94a3b8', fillOpacity: .15 }).addTo(mapa).bindTooltip(e.nombre);
            return [e.latitud, e.longitud];
        });
        if (pts.length) mapa.fitBounds(pts, { padding: [40, 40], maxZoom: 17 }); else mapa.setView([10.2269, -66.8553], 14);
    }
    function formEstacion(e) {
        var nueva = !e;
        e = e || { radio_m: 80, activa: true };
        var capa = ventana(nueva ? 'Nueva estación' : 'Editar ' + e.nombre,
            '<div class="campo"><label>Nombre</label><input id="eNombre" placeholder="Ej: Sede de Protección Civil" value="' + esc(e.nombre || '') + '"></div>' +
            '<p class="muted">Toca el mapa en el sitio exacto de la estación, o escribe las coordenadas.</p>' +
            '<div class="mapa mapa-chico" id="eMapaForm"></div>' +
            '<div class="g3" style="margin-top:10px"><div class="campo"><label>Latitud</label><input id="eLat" inputmode="decimal" value="' + esc(e.latitud == null ? '' : e.latitud) + '"></div>' +
            '<div class="campo"><label>Longitud</label><input id="eLng" inputmode="decimal" value="' + esc(e.longitud == null ? '' : e.longitud) + '"></div>' +
            '<div class="campo"><label>Radio (metros)</label><input id="eRadio" type="number" min="10" max="2000" value="' + esc(e.radio_m) + '"></div></div>' +
            '<label><input type="checkbox" id="eActiva"' + (e.activa ? ' checked' : '') + '> Activa (se puede marcar aquí)</label>',
            [{ texto: 'Cancelar', estilo: 'background:#e2e8f0;color:#0f172a' },
             { texto: 'Guardar', accion: async function (c) {
                var datos = { nombre: valor(c, '#eNombre'), latitud: Number(valor(c, '#eLat').replace(',', '.')), longitud: Number(valor(c, '#eLng').replace(',', '.')),
                              radio_m: Number(valor(c, '#eRadio')), activa: c.querySelector('#eActiva').checked };
                if (!datos.nombre) throw new Error('Ponle un nombre a la estación.');
                if (!isFinite(datos.latitud) || !isFinite(datos.longitud) || !valor(c, '#eLat')) throw new Error('Falta la ubicación: toca el mapa o escribe las coordenadas.');
                await guardarCatalogo('estaciones', nueva ? null : e.id, datos);
                aviso('bien', 'Estación guardada.');
                await abrir('estaciones');
            } }], true);
        cargarLeaflet().then(function () {
            var mapa = L.map(capa.querySelector('#eMapaForm'));
            L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
            var circulo = null;
            function pintar() {
                var la = Number(valor(capa, '#eLat').replace(',', '.')), lo = Number(valor(capa, '#eLng').replace(',', '.')), r = Number(valor(capa, '#eRadio')) || 80;
                if (circulo) { mapa.removeLayer(circulo); circulo = null; }
                if (valor(capa, '#eLat') && isFinite(la) && isFinite(lo)) {
                    circulo = L.circle([la, lo], { radius: r, color: '#f7941d', fillOpacity: .2 }).addTo(mapa);
                    return [la, lo];
                }
                return null;
            }
            var centro = pintar();
            mapa.setView(centro || [10.2269, -66.8553], centro ? 17 : 14);
            mapa.on('click', function (ev) {
                capa.querySelector('#eLat').value = ev.latlng.lat.toFixed(6);
                capa.querySelector('#eLng').value = ev.latlng.lng.toFixed(6);
                pintar();
            });
            ['#eLat', '#eLng', '#eRadio'].forEach(function (s) { capa.querySelector(s).addEventListener('input', pintar); });
            setTimeout(function () { mapa.invalidateSize(); }, 150);
        }).catch(function () { });
    }

    /* ================================================================ LIBRO DE GUARDIA */

    async function libro(z) {
        var puede = st.yo.puede_escribir;
        var notas = await api('/rest/v1/libro_guardia?select=*&order=momento.desc&limit=150') || [];
        var TIPOS = { novedad: 'Novedad', servicio: 'Servicio atendido', salida_unidad: 'Salida de unidad', entrega_guardia: 'Entrega de guardia', correccion: 'Corrección' };
        z.innerHTML =
            '<h3>Libro de guardia</h3><p class="sub">Lo que pasa en cada guardia. No se edita ni se borra: una corrección es una anotación nueva que dice a cuál corrige.</p>' +
            (puede ? '<div class="caja" style="margin-bottom:14px"><div class="fila-herr" style="margin-bottom:8px">' +
                '<select id="lEstacion">' + opciones(st.estaciones, null, 'Sin estación', function (e) { return e.nombre; }) + '</select>' +
                '<select id="lTipo">' + Object.keys(TIPOS).filter(function (k) { return k !== 'correccion'; }).map(function (k) { return '<option value="' + k + '">' + TIPOS[k] + '</option>'; }).join('') + '</select></div>' +
                '<textarea id="lTexto" rows="3" style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;font:inherit;font-size:15px" placeholder="Escribe la novedad…"></textarea>' +
                '<div style="margin-top:8px"><button type="button" class="btn btn-azul" id="lAnotar">Anotar en el libro</button></div></div>' : '') +
            (!notas.length ? '<div class="vacio">El libro está vacío.</div>' : '<ul class="feed" style="max-height:none">' + notas.map(function (n) {
                var e = estacionDe(n.estacion_id);
                return '<li><span class="hora" style="width:120px">' + esc(fechaHora(n.momento)) + '</span><span style="flex:1"><span class="pill ' + (n.tipo === 'correccion' ? 'p-naranja' : 'p-azul') + '">' + esc(TIPOS[n.tipo] || n.tipo) + '</span> ' +
                    (e ? '<span class="muted">' + esc(e.nombre) + '</span> ' : '') + '<br>' + esc(n.texto).replace(/\n/g, '<br>') +
                    '<br><span class="muted">— ' + esc(n.autor_nombre) + '</span>' +
                    (puede ? ' <button type="button" class="btn-mini" data-corregir="' + esc(n.id) + '">Corregir</button>' : '') + '</span></li>';
            }).join('') + '</ul>');
        if (puede) {
            $('#lAnotar').onclick = async function () {
                var texto = $('#lTexto').value.trim();
                if (texto.length < 3) { aviso('error', 'Escribe la novedad antes de anotarla.'); return; }
                try {
                    await rpc('pc_admin_anotar_libro', { p_estacion_id: $('#lEstacion').value || null, p_tipo: $('#lTipo').value, p_texto: texto });
                    aviso('bien', 'Anotado en el libro de guardia.');
                    await abrir('libro');
                } catch (e) { aviso('error', e.message); }
            };
            $$('[data-corregir]').forEach(function (b) {
                b.onclick = function () {
                    var original = notas.find(function (n) { return n.id === b.dataset.corregir; });
                    ventana('Corregir una anotación', '<p class="muted">Original: ' + esc(original.texto) + '</p>' +
                        '<div class="campo"><label>Corrección</label><textarea id="cTexto"></textarea></div>',
                        [{ texto: 'Cancelar', estilo: 'background:#e2e8f0;color:#0f172a' },
                         { texto: 'Anotar la corrección', accion: async function (c) {
                            await rpc('pc_admin_anotar_libro', { p_estacion_id: original.estacion_id, p_tipo: 'correccion', p_texto: valor(c, '#cTexto'), p_corrige_id: original.id });
                            await abrir('libro');
                        } }]);
                };
            });
        }
    }

    /* ================================================================ AJUSTES */

    async function ajustes(z) {
        var c = st.config || {};
        var puede = st.yo.puede_escribir;
        var dis = puede ? '' : ' disabled';
        function num(id, etiqueta, v, ayuda) {
            return '<div class="campo"><label>' + etiqueta + '</label><input id="' + id + '" type="number" value="' + esc(v) + '"' + dis + '>' + (ayuda ? '<div class="ayuda">' + ayuda + '</div>' : '') + '</div>';
        }
        function si(id, etiqueta, v) { return '<label style="display:block;margin:6px 0"><input type="checkbox" id="' + id + '"' + (v ? ' checked' : '') + dis + '> ' + etiqueta + '</label>'; }
        z.innerHTML = '<div class="pc-modal" style="position:static;display:block;background:none;padding:0"><div class="tarjeta ancha" style="margin:0;max-width:none">' +
            '<div class="hd"><span>Reglas de la asistencia</span></div><div class="bd" style="max-height:none">' +
            si('aZona', 'Solo se puede marcar dentro de una estación', c.exigir_zona) +
            si('aFoto', 'La foto es obligatoria al marcar', c.foto_obligatoria) +
            si('aTelefono', 'Una cuenta, un teléfono (si alguien presta su clave, en otro teléfono no entra)', c.un_telefono_por_persona) +
            si('aSinSenal', 'Permitir marcar sin señal (se envía después)', c.permitir_sin_conexion) +
            '<div class="g3" style="margin-top:10px">' +
                num('aPrecision', 'Precisión mínima del GPS (m)', c.precision_maxima_m, 'Si el GPS del teléfono declara un error mayor, no deja marcar.') +
                num('aTolerancia', 'Margen del GPS que se perdona (m)', c.tolerancia_gps_m, 'Se resta de la distancia antes de comparar con el radio.') +
                num('aHorasSinSenal', 'Horas máximas sin señal', c.horas_maximas_sin_conexion, 'Un marcaje sin señal más viejo ya no se acepta.') +
                num('aHorasServicio', 'Horas máximas de una guardia', c.horas_maximas_servicio, 'Si no marcó salida, pasado esto se cierra sola para revisar.') +
                num('aDiasSesion', 'Días que dura la sesión del teléfono', c.dias_sesion, 'Se alarga sola mientras la usa.') +
                num('aDiasFotos', 'Días que se guardan las fotos', c.dias_fotos, 'Luego se borran solas.') +
            '</div><h4 style="margin:14px 0 8px;color:#1c3f94">Versión de la app</h4><div class="g3">' +
                num('aVersionCodigo', 'Número de versión', c.app_version_codigo, 'Si la app tiene un número menor, avisa que hay actualización.') +
                '<div class="campo"><label>Nombre de la versión</label><input id="aVersionNombre" value="' + esc(c.app_version_nombre || '') + '"' + dis + '></div>' +
                '<div class="campo"><label>Enlace de descarga</label><input id="aEnlace" value="' + esc(c.app_enlace || '') + '"' + dis + '></div>' +
            '</div><div class="campo"><label>Novedades de la versión</label><textarea id="aNovedades"' + dis + '>' + esc(c.app_novedades || '') + '</textarea></div>' +
            '</div>' + (puede ? '<div class="ft"><button type="button" id="aGuardar" style="background:#1c3f94;color:#fff">Guardar reglas</button></div>' : '') + '</div></div>';
        if (!puede) return;
        $('#aGuardar').onclick = async function () {
            var n = function (id) { return Number($(id).value); };
            try {
                await api('/rest/v1/config?id=eq.1', { metodo: 'PATCH', prefer: 'return=minimal', cuerpo: {
                    exigir_zona: $('#aZona').checked, foto_obligatoria: $('#aFoto').checked, un_telefono_por_persona: $('#aTelefono').checked,
                    permitir_sin_conexion: $('#aSinSenal').checked, precision_maxima_m: n('#aPrecision'), tolerancia_gps_m: n('#aTolerancia'),
                    horas_maximas_sin_conexion: n('#aHorasSinSenal'), horas_maximas_servicio: n('#aHorasServicio'), dias_sesion: n('#aDiasSesion'),
                    dias_fotos: n('#aDiasFotos'), app_version_codigo: n('#aVersionCodigo'), app_version_nombre: $('#aVersionNombre').value.trim() || '1.0.0',
                    app_enlace: $('#aEnlace').value.trim(), app_novedades: $('#aNovedades').value.trim() || null, actualizado_en: new Date().toISOString() } });
                aviso('bien', 'Reglas guardadas. Aplican desde el próximo marcaje.');
            } catch (e) {
                aviso('error', /check/i.test(e.message) ? 'Algún número está fuera de lo permitido (por ejemplo, la precisión va de 10 a 1000 m).' : e.message);
            }
        };
    }

    /* ================================================================ BITÁCORA */

    var ACCIONES = {
        entro_app: 'Entró a la app', marco_entrada: 'Marcó entrada', marco_salida: 'Marcó salida', marcaje_rechazado: 'Intentó marcar y no se aceptó',
        gps_falso: 'Intentó marcar con GPS falso', cambio_clave: 'Cambió su clave', entrada_otro_telefono: 'Intentó entrar desde otro teléfono',
        estado_en_emergencia: 'Salió a una emergencia', estado_en_estacion: 'Volvió a la estación', estado_en_comision: 'Salió en comisión',
        creo_funcionario: 'Creó un funcionario', edito_funcionario: 'Editó un funcionario', reseteo_clave: 'Puso una clave nueva',
        libero_telefono: 'Liberó un teléfono', marcaje_manual: 'Registró un marcaje a mano', reviso_guardia: 'Revisó una guardia',
        carga_inicial_personal: 'Carga inicial del personal'
    };
    var MOTIVOS = { fuera_de_zona: 'fuera de la estación', impreciso: 'GPS impreciso', sin_gps: 'sin ubicación', sin_estaciones: 'no había estaciones', foto: 'problema con la foto' };
    function describirAccion(b) {
        var base = ACCIONES[b.accion];
        if (!base) {
            var m = /^(estaciones|tipos_guardia|grupos|config|gestores)_(insert|update|delete)$/.exec(b.accion);
            base = m ? ({ insert: 'Creó', update: 'Cambió', delete: 'Borró' }[m[2]] + ' ' + { estaciones: 'una estación', tipos_guardia: 'un tipo de guardia', grupos: 'un grupo', config: 'las reglas', gestores: 'un gestor' }[m[1]]) : b.accion;
        }
        var d = b.detalle || {};
        var extra = [];
        if (d.funcionario) extra.push(d.funcionario);
        if (d.motivo && MOTIVOS[d.motivo]) extra.push(MOTIVOS[d.motivo]);
        if (d.estacion) extra.push(d.estacion);
        if (d.distancia_m != null && b.accion === 'marcaje_rechazado') extra.push('a ' + d.distancia_m + ' m');
        if (d.telefono) extra.push(d.telefono);
        if (d.nota) extra.push('"' + d.nota + '"');
        if (d.motivo && !MOTIVOS[d.motivo] && b.accion === 'marcaje_manual') extra.push('motivo: ' + d.motivo);
        return base + (extra.length ? ' · ' + extra.join(' · ') : '');
    }
    async function bitacora(z) {
        var filas = await api('/rest/v1/bitacora?select=*&order=momento.desc&limit=300') || [];
        var alertas = { gps_falso: 1, entrada_otro_telefono: 1 };
        z.innerHTML = '<h3>Bitácora</h3><p class="sub">Todo lo que se hace en la asistencia, de la app y del panel. No se puede borrar ni modificar.</p>' +
            '<div class="fila-herr"><input type="search" id="bBuscar" placeholder="Buscar por persona o acción…"></div><div id="bLista"></div>';
        function pintar() {
            var t = $('#bBuscar').value.trim().toLowerCase();
            var lista = filas.filter(function (b) { return !t || (b.actor_nombre + ' ' + describirAccion(b)).toLowerCase().indexOf(t) >= 0; });
            $('#bLista').innerHTML = !lista.length ? '<div class="vacio">Nada con ese filtro.</div>' :
                '<div class="tabla-scroll"><table><thead><tr><th>Cuándo</th><th>Quién</th><th>Qué</th></tr></thead><tbody>' + lista.map(function (b) {
                    return '<tr><td style="white-space:nowrap">' + esc(fechaHora(b.momento)) + '</td><td>' + esc(b.actor_nombre || (b.actor_tipo === 'sistema' ? 'Sistema' : '—')) +
                        '<br><span class="muted">' + esc({ gestor: 'Panel', funcionario: 'App', sistema: 'Sistema' }[b.actor_tipo] || '') + '</span></td>' +
                        '<td>' + (alertas[b.accion] ? '<span class="pill p-rojo">Alerta</span> ' : '') + esc(describirAccion(b)) + '</td></tr>';
                }).join('') + '</tbody></table></div>';
        }
        $('#bBuscar').oninput = pintar;
        pintar();
    }

    window.AsistenciaPC = {
        montar: montar,
        detener: function () { if (st.reloj) { clearInterval(st.reloj); st.reloj = null; } limpiarMapas(); },
        /* Expuestas solo para las pruebas automáticas. */
        _prueba: { resumirReporte: resumirReporte, describirAccion: describirAccion, horasBonitas: horasBonitas, claveAlAzar: claveAlAzar,
                   sumarDias: sumarDias, hoy: hoy, seguroExcel: seguroExcel, esc: esc }
    };
})();
