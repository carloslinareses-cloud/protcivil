/* cne-dateas.js — Sistema COMPARTIDO de validación de cédula para todos los formularios.
 * Muestra, junto a cada cédula:
 *   - si aparece en el CNE: botón "🗳️ Ver datos del CNE (dónde vota)" -> modal con
 *     identidad + centro de votación + enlace a Dateas.
 *   - si NO aparece: enlace "🔎 verificar en Dateas".
 * Se auto-inyecta el CSS y el modal. Dos formas de usar:
 *   (A) AUTOMÁTICO: poner  data-cne  en el <input> de cédula (opcional
 *       data-cne-nac="#idSelectNacionalidad", data-cne-nombre="#idNombre",
 *       data-cne-fecha="#idFecha"). Sirve también para campos agregados dinámicamente.
 *   (B) EXPLÍCITO (para formularios que YA consultan el CNE): en tu handler llamar
 *       CNEDateas.verBotones(inputCedula, dataCNEoNull, numeroCedula).
 * Endpoint CNE: el mismo de siempre (consultar-cedula). */
(function () {
  if (window.CNEDateas) return;
  var ENDPOINT = 'https://tfbzghjjfcaqmkzsxrrs.supabase.co/functions/v1/consultar-cedula';

  var CSS =
    '.cne-ver{display:inline-block;margin-top:6px;background:#065f46;color:#fff;border:none;border-radius:8px;padding:7px 12px;font-size:12.5px;font-weight:700;cursor:pointer}' +
    '.dateas-ver{display:inline-block;margin-top:6px;background:#7c2d12;color:#fff;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;text-decoration:none}' +
    '.cne-modal{display:none;position:fixed;inset:0;background:rgba(8,15,30,.6);z-index:99999;align-items:flex-start;justify-content:center;padding:18px;overflow:auto}' +
    '.cne-card{background:#fff;border-radius:14px;max-width:460px;width:100%;box-shadow:0 30px 80px rgba(0,0,0,.4);overflow:hidden}' +
    '.cne-hd{background:#0a2351;color:#fff;padding:14px 18px;font-weight:800;font-size:15px;display:flex;align-items:center;justify-content:space-between}' +
    '.cne-hd button{background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:8px;width:30px;height:30px;font-size:15px;cursor:pointer}' +
    '.cne-bd{padding:14px 18px 20px}' +
    '.cne-sec{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#0a6cb0;margin:12px 0 6px;border-bottom:2px solid #f4c20d;padding-bottom:4px}' +
    '.cne-sec:first-child{margin-top:0}' +
    '.cne-row{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13.5px}' +
    '.cne-row span{color:#64748b}.cne-row b{color:#0f172a;text-align:right}';

  function ready(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  function init() {
    if (!document.getElementById('cneDateasCSS')) {
      var st = document.createElement('style'); st.id = 'cneDateasCSS'; st.textContent = CSS; (document.head || document.documentElement).appendChild(st);
    }
    if (document.body && !document.getElementById('cneModal')) {
      var m = document.createElement('div'); m.id = 'cneModal'; m.className = 'cne-modal';
      m.innerHTML = '<div class="cne-card"><div class="cne-hd"><span>🗳️ Datos del CNE</span><button type="button" id="cneClose">✕</button></div><div class="cne-bd" id="cneBody"></div></div>';
      document.body.appendChild(m);
    }
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function digits(n) { return String(n == null ? '' : n).replace(/\D/g, ''); }
  function fechaValida(f) { if (!f || !/^\d{4}-\d{2}-\d{2}$/.test(f) || f === '0000-00-00') return false; var a = parseInt(f.slice(0, 4), 10); return a >= 1900 && a <= 2030; }
  function dateasURL(num) { return 'https://www.google.com/search?q=' + encodeURIComponent(digits(num) + ' dateas.com'); }

  async function consultar(num, nac) {
    num = digits(num); if (num.length < 4 || num.length > 10) return null;
    nac = (String(nac || '').toUpperCase() === 'E') ? 'E' : 'V';
    try {
      var r = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cedula: num, nacionalidad: nac }) });
      if (!r.ok) return null;
      var j = await r.json();
      return (j && !j.error && j.data) ? j.data : null;
    } catch (e) { return null; }
  }

  function mostrar(d) {
    init();
    var c = d.cne || {};
    var nombre = [d.primer_nombre, d.segundo_nombre, d.primer_apellido, d.segundo_apellido].filter(Boolean).join(' ');
    var cedTxt = ((d.nacionalidad === 'E') ? 'E' : 'V') + '-' + (d.cedula || '');
    var fila = function (k, v) { return '<div class="cne-row"><span>' + esc(k) + '</span><b>' + (esc(v) || '—') + '</b></div>'; };
    document.getElementById('cneBody').innerHTML =
      '<div class="cne-sec">Identidad</div>' +
      fila('Nombres y apellidos', nombre) + fila('Cédula', cedTxt) +
      fila('Nacionalidad', d.nacionalidad === 'E' ? 'Extranjero(a)' : 'Venezolano(a)') +
      fila('Fecha de nacimiento', d.fecha_nac) + fila('RIF', d.rif) +
      '<div class="cne-sec">Datos electorales — dónde vota</div>' +
      fila('Estado', c.estado) + fila('Municipio', c.municipio) + fila('Parroquia', c.parroquia) + fila('Centro de votación', c.centro_electoral) +
      '<div style="margin-top:14px;text-align:center"><a href="' + dateasURL(d.cedula) + '" target="_blank" rel="noopener" style="display:inline-block;background:#065f46;color:#fff;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none">🔎 Verificar también en Dateas (dónde vivía)</a></div>';
    var m = document.getElementById('cneModal'); m.style.display = 'flex';
    document.getElementById('cneClose').onclick = function () { m.style.display = 'none'; };
    m.onclick = function (e) { if (e.target === m) m.style.display = 'none'; };
  }

  function insertarDespues(cedulaEl, node) {
    var cont = (cedulaEl.closest && (cedulaEl.closest('.cne-slot') || cedulaEl.closest('div'))) || cedulaEl.parentElement;
    if (cont && cont.parentNode) cont.parentNode.insertBefore(node, cont.nextSibling);
    else if (cont) cont.appendChild(node);
  }
  function verBotonCNE(cedulaEl, d) {
    init();
    if (cedulaEl._dateasA) cedulaEl._dateasA.style.display = 'none';
    var btn = cedulaEl._cneBtn;
    if (!btn) { btn = document.createElement('button'); btn.type = 'button'; btn.className = 'cne-ver'; btn.textContent = '🗳️ Ver datos del CNE (dónde vota)'; insertarDespues(cedulaEl, btn); cedulaEl._cneBtn = btn; }
    btn.onclick = function () { mostrar(d); }; btn.style.display = '';
  }
  function verBotonDateas(cedulaEl, num) {
    if (cedulaEl._cneBtn) cedulaEl._cneBtn.style.display = 'none';
    var a = cedulaEl._dateasA;
    if (!a) { a = document.createElement('a'); a.className = 'dateas-ver'; a.target = '_blank'; a.rel = 'noopener'; a.textContent = '🔎 No aparece en CNE — verificar en Dateas'; insertarDespues(cedulaEl, a); cedulaEl._dateasA = a; }
    a.href = dateasURL(num); a.style.display = '';
  }
  // Para formularios que YA consultan el CNE: pásale la data (o null) y el número.
  function verBotones(cedulaEl, d, num) {
    if (!cedulaEl) return;
    if (d) verBotonCNE(cedulaEl, d); else verBotonDateas(cedulaEl, num);
  }

  // Handler completo (consulta + botones + autocompletado opcional) para forms nuevos.
  function enganchar(cedulaEl, opts) {
    if (!cedulaEl || cedulaEl._cneEnganchado) return; cedulaEl._cneEnganchado = true; opts = opts || {};
    var run = async function () {
      var num = digits(cedulaEl.value); if (num.length < 4 || num.length > 10) return;
      var nac = opts.nacEl ? opts.nacEl.value : 'V';
      var bg = cedulaEl.style.background, ph = cedulaEl.placeholder;
      cedulaEl.style.background = '#fef3c7'; cedulaEl.placeholder = 'Consultando CNE…';
      var d = await consultar(num, nac);
      cedulaEl.placeholder = ph;
      if (d) {
        cedulaEl.style.background = '#dcfce7'; setTimeout(function () { cedulaEl.style.background = bg; }, 1500);
        if (opts.nombreEl && !opts.nombreEl.value.trim()) { opts.nombreEl.value = [d.primer_nombre, d.segundo_nombre, d.primer_apellido, d.segundo_apellido].filter(Boolean).join(' ').trim(); opts.nombreEl.dispatchEvent(new Event('input', { bubbles: true })); }
        if (opts.fechaEl && !opts.fechaEl.value && fechaValida(d.fecha_nac)) { opts.fechaEl.value = d.fecha_nac; opts.fechaEl.dispatchEvent(new Event('change', { bubbles: true })); }
        if (typeof opts.onData === 'function') { try { opts.onData(d); } catch (e) { } }
        verBotonCNE(cedulaEl, d);
      } else { cedulaEl.style.background = bg; verBotonDateas(cedulaEl, num); }
    };
    cedulaEl.addEventListener('blur', run);
  }

  // AUTO-ATTACH: cualquier input[data-cne] (incluye los agregados dinámicamente).
  function sel(el, attr) { var q = el.getAttribute(attr); if (!q) return null; try { return document.querySelector(q); } catch (e) { return null; } }
  function attachAuto(el) {
    if (el._cneEnganchado) return;
    enganchar(el, { nacEl: sel(el, 'data-cne-nac'), nombreEl: sel(el, 'data-cne-nombre'), fechaEl: sel(el, 'data-cne-fecha') });
  }
  function escanear(root) {
    var list = (root || document).querySelectorAll ? (root || document).querySelectorAll('input[data-cne]') : [];
    for (var i = 0; i < list.length; i++) attachAuto(list[i]);
  }
  ready(function () {
    init();
    escanear(document);
    try {
      var mo = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var ad = muts[i].addedNodes;
          for (var j = 0; j < ad.length; j++) {
            var n = ad[j]; if (n.nodeType !== 1) continue;
            if (n.matches && n.matches('input[data-cne]')) attachAuto(n);
            if (n.querySelectorAll) escanear(n);
          }
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) { }
  });

  window.CNEDateas = { consultar: consultar, mostrar: mostrar, dateasURL: dateasURL, verBotones: verBotones, enganchar: enganchar, fechaValida: fechaValida };
})();
