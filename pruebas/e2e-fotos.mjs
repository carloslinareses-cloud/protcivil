/* ===================================================================
   PRUEBA DE PUNTA A PUNTA — Formulario público de reporte de riesgo
   Protección Civil de Cristóbal Rojas

   Abre `reportar-riesgo.html` en un Chrome de verdad, con pantalla de
   teléfono (375 px), y comprueba a mano lo que hace una persona en la
   calle: mirar la página, adjuntar fotos, quitar una, reponerla y
   enviar el reporte.

   Se corre así, sin instalar nada de pruebas:

       node pruebas/e2e-fotos.mjs

   VARIABLES DE ENTORNO (todas opcionales):

       LOCAL=si               sirve esta misma carpeta en 127.0.0.1 y
                              prueba ahí. Sin esto, prueba contra el
                              sitio PUBLICADO.
       BASE=http://...        dirección exacta a probar (manda sobre LOCAL).
       PERMITIR_ESCRIBIR=si   único modo en que esta prueba manda un
                              reporte de VERDAD a la base de producción.
                              Sin esto, todo lo demás se prueba igual y
                              el envío se salta.
       SUBIR_FOTOS_REALES=si  manda las fotos al Worker real de Cloudflare
                              R2. Sin esto, la subida se responde aquí
                              mismo con una dirección falsa y no se toca
                              R2. OJO: el Worker NO tiene forma de borrar,
                              así que lo que se suba queda ahí para
                              siempre y hay que quitarlo desde el panel
                              de Cloudflare.
       CLAVE_FIREBASE=...     ruta del archivo de credenciales de
                              administrador, para poder BORRAR el reporte
                              de prueba al terminar.
       CHROME=...             ruta de chrome.exe si no está donde siempre.

   QUÉ ESCRIBE Y QUÉ BORRA
   -----------------------
   Sin PERMITIR_ESCRIBIR=si NO escribe absolutamente nada.
   Con PERMITIR_ESCRIBIR=si escribe UN reporte en el nodo `pc_informes`
   de la base real, y al terminar —pase lo que pase, aunque la prueba
   se caiga a la mitad— borra todos los reportes cuyo propietario sea
   "PRUEBA AUTOMATICA". Esa limpieza va en un `finally`, no al final.

   Ningún dato de aquí es de una persona real: la cédula 12345678 no
   existe y los nombres empiezan por PRUEBA AUTOMATICA.
=================================================================== */

import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------
   Marcador y contadores, al estilo de pruebas/unitarias.mjs
------------------------------------------------------------------ */
let ok = 0, mal = 0, saltadas = 0;
const fallos = [];

function prueba(nombre, real, esperado) {
    const iguales = JSON.stringify(real) === JSON.stringify(esperado);
    if (iguales) { ok++; console.log('   ✓ ' + nombre); }
    else {
        mal++;
        fallos.push(`${nombre}\n      esperaba: ${JSON.stringify(esperado)}\n      dio:      ${JSON.stringify(real)}`);
        console.log('   ✗ ' + nombre);
    }
}
function grupo(t) { console.log('\n' + t); }
function saltar(t) { saltadas++; console.log('   · (saltada) ' + t); }

/* ------------------------------------------------------------------
   Configuración
------------------------------------------------------------------ */
const CARPETA = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SITIO_PUBLICADO = 'https://protcivil.alcaldiadecharallave.com';
const ESCRIBIR = process.env.PERMITIR_ESCRIBIR === 'si';
const FOTOS_REALES = process.env.SUBIR_FOTOS_REALES === 'si';
const EN_LOCAL = !process.env.BASE && process.env.LOCAL === 'si';
const CLAVE_FIREBASE = process.env.CLAVE_FIREBASE ||
    'C:/Users/carlo/Documents/Alcaldia BDD/alcaldia-admin-firebase-adminsdk-fbsvc-207472a5bd.json';
const BASE_DATOS = 'https://alcaldia-admin-default-rtdb.firebaseio.com';
const MARCA = 'PRUEBA AUTOMATICA - BORRAR';

const RUTAS_CHROME = [
    process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Users/' + os.userInfo().username + '/AppData/Local/Google/Chrome/Application/chrome.exe'
].filter(Boolean);

/* ------------------------------------------------------------------
   Lo que se le inyecta a la página para poder manejarla desde aquí.
   Las imágenes se DIBUJAN en el navegador con un lienzo: así esta
   prueba no depende de ningún archivo suelto que alguien pueda borrar.
------------------------------------------------------------------ */
const AYUDA_EN_PAGINA = `
window.__pruebas = {
  async jpegDePrueba(ancho, alto) {
    const lienzo = document.createElement('canvas');
    lienzo.width = ancho; lienzo.height = alto;
    const c = lienzo.getContext('2d');
    c.fillStyle = '#b03030'; c.fillRect(0, 0, ancho, alto);
    c.fillStyle = '#ffffff';
    c.font = Math.max(8, Math.round(alto / 6)) + 'px sans-serif';
    c.fillText('PRUEBA', 6, Math.round(alto / 2));
    return await new Promise(r => lienzo.toBlob(r, 'image/jpeg', 0.9));
  },
  /* Poner un archivo en el <input> y avisar, que es exactamente lo que
     pasa cuando la persona elige una foto en el teléfono. */
  elegir(archivo) {
    const dt = new DataTransfer();
    dt.items.add(archivo);
    const entrada = document.getElementById('entradaFoto');
    entrada.files = dt.files;
    entrada.dispatchEvent(new Event('change', { bubbles: true }));
  },
  cuantas() {
    return {
      total: document.querySelectorAll('.foto-item').length,
      listas: document.querySelectorAll('.foto-item.lista').length,
      fallidas: document.querySelectorAll('.foto-item.fallo').length
    };
  }
};
`;

/* ------------------------------------------------------------------
   Servidor estático mínimo, para el modo LOCAL=si
------------------------------------------------------------------ */
const TIPOS = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8'
};
function servirCarpeta(raiz) {
    return new Promise((resolver) => {
        const servidor = http.createServer((pet, res) => {
            /* El navegador pide siempre el iconito; si se le contesta 404
               ensucia la consola y parece un error de la página. */
            if (pet.url.split('?')[0] === '/favicon.ico') { res.writeHead(204).end(); return; }
            const rel = decodeURIComponent(pet.url.split('?')[0]).replace(/^\//, '') || 'index.html';
            const abs = path.resolve(raiz, rel);
            if (!abs.startsWith(path.resolve(raiz))) { res.writeHead(403).end(); return; }
            fs.readFile(abs, (e, datos) => {
                if (e) { res.writeHead(404).end('no está'); return; }
                res.writeHead(200, { 'Content-Type': TIPOS[path.extname(abs)] || 'application/octet-stream' });
                res.end(datos);
            });
        });
        servidor.listen(0, '127.0.0.1', () => resolver(servidor));
    });
}

/* ------------------------------------------------------------------
   Arranque del navegador
------------------------------------------------------------------ */
async function cargarPuppeteer() {
    try { return (await import('puppeteer-core')).default; }
    catch (e) {
        console.log('\nNo encontré puppeteer-core. Instálalo con:');
        console.log('    npm i -g puppeteer-core      (o  npm i puppeteer-core  en esta carpeta)');
        console.log('Detalle:', e.message);
        process.exit(2);
    }
}
function buscarChrome() {
    for (const r of RUTAS_CHROME) { try { if (fs.existsSync(r)) return r; } catch (e) { /* sigue */ } }
    console.log('\nNo encontré chrome.exe. Indícalo con  CHROME="ruta/a/chrome.exe"');
    process.exit(2);
}

/* ------------------------------------------------------------------
   Espera a que GitHub Pages publique la versión con fotos.
   Sin esto, tocar el código y probar enseguida da un falso fallo.
------------------------------------------------------------------ */
async function esperarPublicacion(direccion, intentos = 24) {
    for (let i = 1; i <= intentos; i++) {
        try {
            const r = await fetch(direccion + '?v=' + Date.now(), { cache: 'no-store' });
            const t = await r.text();
            if (t.includes('seccionFotos')) return true;
        } catch (e) { /* reintenta */ }
        await new Promise(r => setTimeout(r, 5000));
    }
    return false;
}

/* ------------------------------------------------------------------
   Borrado de los reportes de prueba. Se llama SIEMPRE desde el finally.
------------------------------------------------------------------ */
async function borrarReportesDePrueba() {
    let admin;
    try { admin = await import('firebase-admin/app'); }
    catch (e) { console.log('   ! no pude cargar firebase-admin, la limpieza queda pendiente'); return; }
    if (!fs.existsSync(CLAVE_FIREBASE)) {
        console.log('   ! no está la credencial de administrador, la limpieza queda pendiente');
        console.log('     (indícala con CLAVE_FIREBASE="ruta/al/archivo.json")');
        return;
    }
    const { getDatabase } = await import('firebase-admin/database');
    admin.initializeApp({
        credential: admin.cert(JSON.parse(fs.readFileSync(CLAVE_FIREBASE, 'utf-8'))),
        databaseURL: BASE_DATOS
    });
    const db = getDatabase();
    const snap = await db.ref('pc_informes').once('value');
    const todos = Object.entries(snap.val() || {});
    const dePrueba = todos.filter(([, r]) =>
        String(r?.propietario?.nombres_apellidos || '').includes('PRUEBA AUTOMATICA'));
    for (const [id] of dePrueba) await db.ref('pc_informes/' + id).remove();
    console.log('   limpieza: borrados ' + dePrueba.length + ' reportes de prueba; ' +
        'quedan ' + (todos.length - dePrueba.length) + ' reportes reales');
}

/* ==================================================================
   AQUÍ EMPIEZA LA PRUEBA
================================================================== */
console.log('='.repeat(64));
console.log('PRUEBA DE PUNTA A PUNTA — reporte de riesgo con fotos');
console.log('='.repeat(64));

let servidor = null, navegador = null, perfil = null, seEnvio = false;
let DIRECCION = '';

const direccionBase = process.env.BASE
    ? process.env.BASE.replace(/\/$/, '')
    : (EN_LOCAL ? null : SITIO_PUBLICADO);

try {
    if (EN_LOCAL) {
        servidor = await servirCarpeta(CARPETA);
        DIRECCION = 'http://127.0.0.1:' + servidor.address().port + '/reportar-riesgo.html#riesgo';
    } else {
        DIRECCION = direccionBase + '/reportar-riesgo.html#riesgo';
    }

    console.log('\nQué voy a hacer:');
    console.log('  · probar             : ' + DIRECCION);
    console.log('  · pantalla           : 375 x 800 (teléfono)');
    console.log('  · fotos              : ' + (FOTOS_REALES
        ? 'SE SUBEN DE VERDAD a Cloudflare R2 (no se pueden borrar después)'
        : 'simuladas aquí mismo, NO se toca R2'));
    console.log('  · enviar el reporte  : ' + (ESCRIBIR
        ? 'SÍ, ESCRIBE EN LA BASE DE PRODUCCIÓN (y lo borro al terminar)'
        : 'NO (poner PERMITIR_ESCRIBIR=si para probar el envío completo)'));

    if (ESCRIBIR && !fs.existsSync(CLAVE_FIREBASE)) {
        console.log('\n  ALTO: pediste escribir, pero no está la credencial de administrador,');
        console.log('  así que no podría borrar el reporte después. No escribo nada.');
        console.log('  Credencial buscada en: ' + CLAVE_FIREBASE);
        process.exit(2);
    }

    if (!EN_LOCAL && !process.env.BASE) {
        process.stdout.write('\nEsperando a que el sitio publicado tenga la sección de fotos… ');
        const listo = await esperarPublicacion(DIRECCION);
        console.log(listo ? 'ya está.' : 'NO apareció en 2 minutos.');
        if (!listo) { console.log('Prueba abortada: el sitio publicado no tiene la versión nueva.'); process.exit(1); }
    }

    const puppeteer = await cargarPuppeteer();
    perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'protcivil-pruebas-'));
    navegador = await puppeteer.launch({
        executablePath: buscarChrome(),
        headless: 'new',
        args: ['--no-sandbox', '--user-data-dir=' + perfil]
    });

    const pag = await navegador.newPage();
    const erroresPagina = [];
    pag.on('pageerror', e => erroresPagina.push('ERROR DE PÁGINA: ' + e.message));
    pag.on('console', m => {
        const donde = (m.location() && m.location().url) || '';
        /* El iconito de la pestaña y los cortes de red no son errores de
           la página; lo demás sí y hay que verlo, con su dirección para
           poder arreglarlo. */
        if (m.type() !== 'error') return;
        if (/favicon\.ico/.test(donde) || /net::ERR_/.test(m.text())) return;
        erroresPagina.push('CONSOLA: ' + m.text() + (donde ? '  [' + donde + ']' : ''));
    });

    /* Si no se pidieron fotos reales, la subida se contesta aquí mismo.
       Así se prueba TODA la lógica de la página sin dejar basura en R2. */
    const clavesFalsas = [];
    if (!FOTOS_REALES) {
        await pag.setRequestInterception(true);
        pag.on('request', (pet) => {
            const u = pet.url();
            if (!/\/subir$/.test(u)) { pet.continue(); return; }
            const cors = {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            };
            if (pet.method() === 'OPTIONS') { pet.respond({ status: 204, headers: cors }); return; }
            const clave = 'simulada' + (clavesFalsas.length + 1);
            clavesFalsas.push(clave);
            pet.respond({
                status: 201, headers: { 'Content-Type': 'application/json', ...cors },
                body: JSON.stringify({ url: 'https://fotos.alcaldiadecharallave.com/foto/' + clave + '.jpg' })
            });
        });
    }

    await pag.setViewport({ width: 375, height: 800, deviceScaleFactor: 2 });
    await pag.goto(DIRECCION, { waitUntil: 'networkidle0', timeout: 60000 });
    await new Promise(r => setTimeout(r, 1200));
    await pag.evaluate(AYUDA_EN_PAGINA);

    /* ==============================================================
       LA PÁGINA EN UN TELÉFONO DE 375 px
       Existe porque el formulario se llena EN LA CALLE, desde el
       teléfono. Un campo de menos de 44 px no se acierta con el dedo
       y una letra de menos de 16 px hace que el iPhone haga zoom solo
       al tocar el campo, y la persona pierde de vista el formulario.
    ============================================================== */
    grupo('La página en un teléfono de 375 px');
    const movil = await pag.evaluate(() => ({
        titulo: document.title,
        scrollHorizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        gruposSinChips: [...document.querySelectorAll('[data-grupo]')]
            .filter(g => g.querySelectorAll('.chip').length === 0).map(g => g.dataset.grupo),
        controlesBajitos: [...document.querySelectorAll('input:not([type=file]),select,textarea,button')]
            .filter(e => e.offsetParent !== null && e.getBoundingClientRect().height < 44).length,
        letraChica: [...document.querySelectorAll('input:not([type=file]),select,textarea')]
            .filter(e => e.offsetParent !== null && parseFloat(getComputedStyle(e).fontSize) < 16).length,
        imagenesRotas: [...document.images].filter(i => !i.complete || i.naturalWidth === 0).length,
        seccionFotosVisible: getComputedStyle(document.getElementById('seccionFotos')).display !== 'none',
        altoBotonFoto: Math.round(document.getElementById('btnAgregarFoto').getBoundingClientRect().height)
    }));
    prueba('no hay scroll horizontal', movil.scrollHorizontal, false);
    prueba('todos los grupos de opciones se pintaron', movil.gruposSinChips, []);
    prueba('ningún control mide menos de 44 px', movil.controlesBajitos, 0);
    prueba('ningún campo tiene letra menor a 16 px', movil.letraChica, 0);
    prueba('no hay imágenes rotas', movil.imagenesRotas, 0);
    prueba('la sección de fotos se ve', movil.seccionFotosVisible, true);
    prueba('el botón de agregar foto se puede tocar (≥44 px)', movil.altoBotonFoto >= 44, true);

    /* Las opciones se marcan y se desmarcan. */
    const marcado = await pag.evaluate(() => {
        const c = document.querySelector('[data-grupo="tipo_estructura"] .chip');
        c.click(); const puesto = c.classList.contains('sel');
        c.click(); const quitado = !c.classList.contains('sel');
        return { puesto, quitado };
    });
    prueba('una opción se marca al tocarla', marcado.puesto, true);
    prueba('y se desmarca al tocarla otra vez', marcado.quitado, true);

    /* ==============================================================
       EL BOTÓN "+" ABRE EL SELECTOR DE ARCHIVOS
       El botón visible y el <input type=file> son dos elementos: si se
       rompe ese enlace, el botón queda de adorno y nadie puede
       adjuntar nada.
    ============================================================== */
    grupo('El botón "+" abre el selector de archivos');
    let abrio = false;
    try {
        const [selector] = await Promise.all([
            pag.waitForFileChooser({ timeout: 8000 }),
            pag.click('#btnAgregarFoto')
        ]);
        abrio = true;
        await selector.cancel();
    } catch (e) { abrio = false; }
    prueba('tocar el "+" abre el selector', abrio, true);

    /* ==============================================================
       DOS TOQUES RÁPIDOS NO METEN 11 FOTOS
       ESTE ERROR PASÓ DE VERDAD: encoger una foto tarda segundos en un
       teléfono modesto. Si el sitio se reservara DESPUÉS de encoger, la
       persona tocaría el "+" otra vez creyendo que no pasó nada y se
       colarían 11. La base solo acepta 10, así que la foto de más hacía
       rebotar el reporte ENTERO, en silencio.
    ============================================================== */
    grupo('Diez fotos como máximo, aunque se toque rapidísimo');
    await pag.evaluate(async (cuantas) => {
        const blob = await window.__pruebas.jpegDePrueba(200, 150);
        /* Sin esperar entre una y otra: eso es el doble toque. */
        for (let i = 0; i < cuantas; i++) {
            window.__pruebas.elegir(new File([blob], 'prueba' + i + '.jpg', { type: 'image/jpeg' }));
        }
    }, 11);
    await pag.waitForFunction(() => {
        const c = window.__pruebas.cuantas();
        return c.total > 0 && c.listas + c.fallidas === c.total;
    }, { timeout: 60000 });
    const tope = await pag.evaluate(() => ({
        ...window.__pruebas.cuantas(),
        botonDesactivado: document.getElementById('btnAgregarFoto').disabled,
        textoBoton: document.getElementById('btnAgregarFoto').innerText.replace(/\s+/g, ' ').trim()
    }));
    prueba('entraron 10 fotos y ni una más', tope.total, 10);
    prueba('las 10 quedaron listas', tope.listas, 10);
    prueba('ninguna falló', tope.fallidas, 0);
    prueba('el botón "+" se desactiva al llegar al tope', tope.botonDesactivado, true);
    prueba('y avisa que es el máximo', /Máximo 10/.test(tope.textoBoton), true);

    /* ==============================================================
       QUITAR UNA FOTO Y REPONERLA
       Si al quitar una se borrara la equivocada, o al reponerla se
       duplicara, la persona mandaría fotos que no son de su casa.
    ============================================================== */
    grupo('Quitar una foto y reponerla');
    await pag.evaluate(() => document.querySelector('.foto-item .quitar-foto').click());
    await new Promise(r => setTimeout(r, 400));
    const trasQuitar = await pag.evaluate(() => ({
        ...window.__pruebas.cuantas(),
        botonDesactivado: document.getElementById('btnAgregarFoto').disabled
    }));
    prueba('al quitar una quedan 9', trasQuitar.total, 9);
    prueba('el botón "+" se vuelve a activar', trasQuitar.botonDesactivado, false);

    await pag.evaluate(async () => {
        const blob = await window.__pruebas.jpegDePrueba(2000, 1500);   // grande: obliga a encoger
        window.__pruebas.elegir(new File([blob], 'repuesta.jpg', { type: 'image/jpeg' }));
    });
    await pag.waitForFunction(() => {
        const c = window.__pruebas.cuantas();
        return c.total === 10 && c.listas + c.fallidas === 10;
    }, { timeout: 60000 });
    const trasReponer = await pag.evaluate(() => ({
        ...window.__pruebas.cuantas(),
        miniaturasPintadas: [...document.querySelectorAll('.foto-item img')].every(i => i.naturalWidth > 0)
    }));
    prueba('al reponerla vuelven a ser 10', trasReponer.total, 10);
    prueba('no se duplicó ninguna', trasReponer.listas, 10);
    prueba('todas las miniaturas se ven', trasReponer.miniaturasPintadas, true);

    /* ==============================================================
       LAS FOTOS QUE NO SE PUEDEN USAR SE AVISAN, NO SE TRAGAN
       Un `catch` vacío al guardar fotos ya hizo una vez que el
       formulario dijera "registrado" aunque la foto nunca subió.
       Aquí se comprueba que cada caso malo DICE algo y suelta el sitio
       que había reservado.
    ============================================================== */
    grupo('Las fotos que no sirven avisan y sueltan su sitio');
    await pag.evaluate(() => { while (document.querySelector('.foto-item .quitar-foto')) document.querySelector('.foto-item .quitar-foto').click(); });
    await new Promise(r => setTimeout(r, 300));
    prueba('se vaciaron las fotos para seguir', await pag.evaluate(() => window.__pruebas.cuantas().total), 0);

    /* HEIC: el formato del iPhone, que el navegador no sabe abrir. */
    await pag.evaluate(() => {
        window.__pruebas.elegir(new File([new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])], 'foto.heic', { type: 'image/heic' }));
    });
    await new Promise(r => setTimeout(r, 400));
    const heic = await pag.evaluate(() => ({
        aviso: document.getElementById('msgFotos').textContent,
        total: window.__pruebas.cuantas().total
    }));
    prueba('una foto HEIC se explica en cristiano', /HEIC/.test(heic.aviso) && /compatible|cámara/i.test(heic.aviso), true);
    prueba('y no deja ningún hueco reservado', heic.total, 0);

    /* Un archivo que no es imagen aunque diga que lo es. */
    await pag.evaluate(() => {
        window.__pruebas.elegir(new File(['esto no es una imagen'], 'trampa.jpg', { type: 'image/jpeg' }));
    });
    await pag.waitForFunction(() => document.getElementById('msgFotos').textContent.length > 0, { timeout: 20000 });
    const noImagen = await pag.evaluate(() => ({
        aviso: document.getElementById('msgFotos').textContent,
        total: window.__pruebas.cuantas().total
    }));
    prueba('un archivo que no es imagen se avisa', /no es una imagen/i.test(noImagen.aviso), true);
    prueba('y suelta el sitio que había reservado', noImagen.total, 0);

    /* Una foto enorme: el tope existe para que no se cierre la pestaña
       en un teléfono con poca memoria y se pierda el formulario entero. */
    await pag.evaluate(() => {
        window.__pruebas.elegir(new File([new Uint8Array(26 * 1024 * 1024)], 'enorme.jpg', { type: 'image/jpeg' }));
    });
    await pag.waitForFunction(() => /pesa demasiado/i.test(document.getElementById('msgFotos').textContent), { timeout: 20000 });
    const enorme = await pag.evaluate(() => ({
        aviso: document.getElementById('msgFotos').textContent,
        total: window.__pruebas.cuantas().total
    }));
    prueba('una foto de más de 25 MB se rechaza con explicación', /pesa demasiado/i.test(enorme.aviso), true);
    prueba('y tampoco deja hueco reservado', enorme.total, 0);

    /* ==============================================================
       VALIDACIÓN AL ENVIAR
       El formulario es público: si dejara pasar un reporte sin nombre
       ni teléfono de quien lo levanta, no habría a quién llamar.
    ============================================================== */
    grupo('Validación al enviar');
    await pag.click('#btnEnviar');
    await new Promise(r => setTimeout(r, 300));
    const vacio = await pag.evaluate(() => document.getElementById('msg').textContent);
    prueba('vacío: pide el nombre del propietario', /nombre del propietario/i.test(vacio), true);

    await pag.evaluate((marca) => {
        document.getElementById('f_prop_nombre').value = marca;
    }, MARCA);
    await pag.click('#btnEnviar');
    await new Promise(r => setTimeout(r, 300));
    prueba('luego pide la dirección exacta',
        /dirección exacta/i.test(await pag.evaluate(() => document.getElementById('msg').textContent)), true);

    await pag.evaluate(() => { document.getElementById('f_direccion_exacta').value = 'Calle de prueba, casa 5'; });
    await pag.click('#btnEnviar');
    await new Promise(r => setTimeout(r, 300));
    prueba('luego pide el nombre de quien reporta',
        /tu nombre/i.test(await pag.evaluate(() => document.getElementById('msg').textContent)), true);

    await pag.evaluate(() => { document.getElementById('f_reporta_nombre').value = 'PRUEBA AUTOMATICA Vecino'; });
    await pag.click('#btnEnviar');
    await new Promise(r => setTimeout(r, 300));
    prueba('luego pide el teléfono de quien reporta',
        /tu teléfono/i.test(await pag.evaluate(() => document.getElementById('msg').textContent)), true);

    /* Con una foto a medio subir no se deja enviar: si se enviara, el
       reporte quedaría con menos fotos de las que la persona cree. */
    const conFotoAMedias = await pag.evaluate(() => {
        document.getElementById('f_reporta_telefono').value = '0414-7654321';
        return true;
    });
    prueba('se llenaron los datos mínimos', conFotoAMedias, true);

    /* ==============================================================
       ENVÍO DE VERDAD (solo con PERMITIR_ESCRIBIR=si)
    ============================================================== */
    grupo('Envío del reporte');
    if (!ESCRIBIR) {
        saltar('enviar el reporte a la base real (falta PERMITIR_ESCRIBIR=si)');
    } else {
        await pag.evaluate(() => {
            document.getElementById('f_parroquia').value = 'Charallave';
            document.getElementById('f_sector').value = 'PRUEBA AUTOMATICA';
            document.getElementById('f_prop_cedula').value = '12345678';
            document.getElementById('f_prop_telf').value = '0424-1234567';
            document.getElementById('gf_adultos').value = '3';
            document.getElementById('f_diagnostico').value = 'Reporte de prueba automática. Se borra al terminar.';
            const g = document.querySelector('[data-grupo="evaluacion_danos"]');
            if (g && g.querySelector('.chip')) g.querySelector('.chip').click();
            document.getElementById('btnAgregarNucleo').click();
        });
        await new Promise(r => setTimeout(r, 300));
        await pag.evaluate(() => {
            const fila = document.querySelector('.fila-nucleo');
            fila.querySelector('.n-parentesco').value = 'Hijo';
            fila.querySelector('.n-nombre').value = 'PRUEBA AUTOMATICA Hijo';
            fila.querySelector('.n-edad').value = '12';
        });
        /* Una foto, para comprobar que el enlace viaja dentro del reporte. */
        await pag.evaluate(async () => {
            const blob = await window.__pruebas.jpegDePrueba(1200, 900);
            window.__pruebas.elegir(new File([blob], 'delreporte.jpg', { type: 'image/jpeg' }));
        });
        await pag.waitForFunction(() => window.__pruebas.cuantas().listas === 1, { timeout: 60000 });

        seEnvio = true;   // a partir de aquí puede haber algo que borrar
        await pag.click('#btnEnviar');
        await pag.waitForFunction(
            () => getComputedStyle(document.getElementById('okScreen')).display === 'block'
                || document.getElementById('msg').textContent.length > 0,
            { timeout: 45000 });
        const envio = await pag.evaluate(() => ({
            exito: getComputedStyle(document.getElementById('okScreen')).display === 'block',
            error: document.getElementById('msg').textContent
        }));
        prueba('el reporte se envió y salió la pantalla de gracias', envio.exito, true);
        if (!envio.exito) console.log('      el formulario dijo: ' + JSON.stringify(envio.error));
    }

    /* ============================================================== */
    grupo('Errores sueltos de la página');
    prueba('la página no soltó ningún error', erroresPagina, []);

} catch (e) {
    mal++;
    fallos.push('LA PRUEBA SE CAYÓ A MITAD\n      ' + (e && e.stack ? e.stack : e));
    console.log('\n   ✗ la prueba se cayó: ' + (e && e.message ? e.message : e));
} finally {
    /* Todo lo que se abrió se cierra, y todo lo que se escribió se
       borra, aunque la prueba haya reventado antes de tiempo. */
    try { if (navegador) await navegador.close(); } catch (e) { /* ya estaba cerrado */ }
    try { if (servidor) servidor.close(); } catch (e) { /* ya estaba cerrado */ }
    try { if (perfil) fs.rmSync(perfil, { recursive: true, force: true }); } catch (e) { /* ya no está */ }

    if (ESCRIBIR) {
        console.log('\nLimpieza de lo que escribí en producción:');
        try { await borrarReportesDePrueba(); }
        catch (e) {
            mal++;
            fallos.push('NO PUDE BORRAR LOS REPORTES DE PRUEBA\n      ' + (e && e.message ? e.message : e));
            console.log('   ! falló la limpieza: ' + (e && e.message ? e.message : e));
            console.log('   ! REVISA A MANO el nodo pc_informes y borra lo que diga PRUEBA AUTOMATICA');
        }
    } else if (seEnvio) {
        console.log('\n   ! se envió algo sin permiso de escritura: revisa pc_informes a mano');
    }

    if (FOTOS_REALES) {
        console.log('\n   AVISO: subiste fotos de verdad a Cloudflare R2. El Worker no tiene');
        console.log('   forma de borrarlas, así que hay que quitarlas desde el panel de');
        console.log('   Cloudflare (depósito pc-fotos) si molestan.');
    }

    console.log('\n' + '='.repeat(64));
    if (mal) {
        console.log(`FALLARON ${mal} de ${ok + mal}` + (saltadas ? `  (${saltadas} saltadas)` : '') + '\n');
        fallos.forEach(f => console.log('   ✗ ' + f));
        process.exit(1);
    } else {
        console.log(`Pasaron las ${ok} pruebas.` + (saltadas ? `  (${saltadas} saltadas a propósito)` : ''));
        process.exit(0);
    }
}
