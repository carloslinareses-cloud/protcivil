// Auto-actualizar caché.
//
// Problema que resuelve: cuando se publica una versión nueva, el navegador del
// empleado sigue mostrando la vieja hasta que alguien hace Ctrl+Shift+R. La
// mayoría no sabe hacer eso, así que se quedan trabajando con una página vieja.
//
// Cómo funciona ahora:
//   1. Revisa al ENTRAR, cada 2 minutos, y cada vez que se vuelve a la pestaña.
//      (La versión anterior revisaba UNA sola vez al cargar, así que un tablero
//      abierto toda la jornada nunca se enteraba de una publicación nueva.)
//   2. Si no hay nada escrito sin guardar, recarga sola y en silencio.
//   3. Si el usuario tiene algo escrito, NO recarga: le muestra un aviso con un
//      botón "Actualizar". Un clic, sin atajos de teclado.
//   4. Antes de recargar fuerza al navegador a rebajar el HTML, para que la
//      recarga no vuelva a servir lo cacheado.
//
// Compara el ETag / Last-Modified que envía GitHub Pages. No estampa versión.
(function autoFresh() {
    var RUTA = location.pathname;
    var CLAVE = '__cbAll';
    var CADA = 120000;   // 2 minutos
    var ESPERA = 6000;   // si tarda más, se deja para la próxima ronda
    var avisando = false;

    // ¿Hay algo escrito que se perdería al recargar? Solo cuenta el texto que la
    // persona tipeó: los clics y los filtros vacíos no bloquean la actualización.
    function hayTextoSinGuardar() {
        var campos = document.querySelectorAll('textarea, input');
        for (var i = 0; i < campos.length; i++) {
            var el = campos[i];
            if (el.type === 'file') { if (el.files && el.files.length) return true; continue; }
            if (['button', 'submit', 'reset', 'hidden', 'checkbox', 'radio'].indexOf(el.type) >= 0) continue;
            if (el.offsetParent === null) continue;              // está oculto
            if (String(el.value || '').trim() !== '') return true;
        }
        return false;
    }

    function recargarDeVerdad() {
        // cache:'reload' obliga al navegador a refrescar su copia del HTML antes
        // de recargar; si no, location.reload() puede volver a servir la vieja.
        fetch(RUTA, { cache: 'reload' })
            .catch(function () { })
            .then(function () { location.reload(); });
    }

    function mostrarAviso() {
        if (avisando || document.getElementById('__afBanner')) return;
        avisando = true;
        var b = document.createElement('div');
        b.id = '__afBanner';
        b.setAttribute('role', 'status');
        b.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:18px;z-index:2147483647;' +
            'background:#0a2351;color:#fff;padding:12px 16px;border-radius:12px;display:flex;align-items:center;' +
            'gap:12px;box-shadow:0 10px 30px rgba(0,0,0,.35);font-family:system-ui,"Segoe UI",Arial,sans-serif;' +
            'font-size:14px;max-width:92vw;';
        var txt = document.createElement('span');
        txt.textContent = 'Hay una versión nueva de la página.';
        var btn = document.createElement('button');
        btn.textContent = 'Actualizar';
        btn.style.cssText = 'background:#f59e0b;color:#3b2000;border:none;border-radius:8px;padding:9px 16px;' +
            'font-weight:800;font-size:14px;cursor:pointer;white-space:nowrap;';
        btn.onclick = recargarDeVerdad;
        var x = document.createElement('button');
        x.textContent = '✕';
        x.title = 'Ahora no';
        x.style.cssText = 'background:none;border:none;color:#cbd5e1;font-size:16px;cursor:pointer;padding:0 2px;';
        x.onclick = function () { b.remove(); avisando = false; };
        b.appendChild(txt); b.appendChild(btn); b.appendChild(x);
        (document.body || document.documentElement).appendChild(b);
    }

    async function revisar() {
        if (avisando) return;
        try {
            var ctrl = new AbortController();
            var to = setTimeout(function () { ctrl.abort(); }, ESPERA);
            var r = await Promise.all([
                fetch(RUTA, { cache: 'no-store', signal: ctrl.signal }),     // lo que hay publicado
                fetch(RUTA, { cache: 'force-cache', signal: ctrl.signal })   // lo que tiene el navegador
            ]);
            clearTimeout(to);
            var tn = r[0].headers.get('etag') || r[0].headers.get('last-modified');
            var tc = r[1].headers.get('etag') || r[1].headers.get('last-modified');
            if (!tn || !tc || tn === tc) return;                 // ya está al día
            if (sessionStorage.getItem(CLAVE) === tn) return;    // esta versión ya se atendió

            if (hayTextoSinGuardar()) {
                mostrarAviso();                                  // no se le borra lo que escribió
                return;
            }
            sessionStorage.setItem(CLAVE, tn);                   // evita bucles de recarga
            recargarDeVerdad();
        } catch (e) { /* sin conexión, abortado o file:// — se reintenta luego */ }
    }

    revisar();
    setInterval(revisar, CADA);
    // Al volver a la pestaña: es el momento típico en que alguien retoma el
    // trabajo, y conviene que ya esté al día antes de que siga.
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) revisar();
    });
})();
