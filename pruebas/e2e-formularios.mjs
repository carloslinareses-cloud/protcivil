/* ==================================================================
   Prueba de punta a punta del menú y los formularios nuevos
   (Novedades relevantes y Jornada social), en un Chrome de verdad con
   pantalla de teléfono (375 px).

       node pruebas/e2e-formularios.mjs

   VARIABLES DE ENTORNO (opcionales):
       PERMITIR_ESCRIBIR=si   manda de verdad una novedad y una jornada de
                              prueba a la base de producción, comprueba que
                              llegaron y las BORRA al terminar (hace falta
                              la clave de administrador de Firebase).
       CLAVE_FIREBASE=...     ruta de esa clave (si no está donde siempre).
       CHROME=...             ruta de chrome.exe si no está donde siempre.

   Sin PERMITIR_ESCRIBIR no toca la base: todo lo demás se prueba igual.
   Sirve esta misma carpeta en 127.0.0.1, así prueba lo que hay en el
   disco, no lo publicado.
   ================================================================== */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const CARPETA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ESCRIBIR = process.env.PERMITIR_ESCRIBIR === 'si';
const CLAVE_FIREBASE = process.env.CLAVE_FIREBASE ||
    'C:/Users/carlo/Documents/Alcaldia BDD/alcaldia-admin-firebase-adminsdk-fbsvc-207472a5bd.json';
const MARCA = 'ZZ Prueba automática ' + Date.now();
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.css': 'text/css' };

let ok = 0, mal = 0, saltadas = 0;
const fallos = [];
function prueba(nombre, real, esperado) {
    const bien = JSON.stringify(real) === JSON.stringify(esperado);
    if (bien) ok++; else { mal++; fallos.push(nombre + '  → esperaba ' + JSON.stringify(esperado) + ', dio ' + JSON.stringify(real)); }
    console.log((bien ? '   ✓ ' : '   ✗ ') + nombre);
}
function saltar(nombre, motivo) { saltadas++; console.log('   · (saltada) ' + nombre + ' (' + motivo + ')'); }

function servirCarpeta(raiz) {
    return new Promise((resolver) => {
        const s = http.createServer((pet, res) => {
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
        s.listen(0, '127.0.0.1', () => resolver(s));
    });
}
function buscarChrome() {
    const opciones = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
    const hallado = opciones.find(p => fs.existsSync(p));
    if (!hallado) throw new Error('No encontré Chrome. Pásale la ruta con CHROME=...');
    return hallado;
}

/* Lo que se exige en teléfono: nada se sale de lado, los campos se pueden
   tocar con el dedo (44 px) y la letra de los campos es de 16 px (menos
   que eso hace que el iPhone haga zoom solo al tocar). */
async function revisarTelefono(pagina, nombre) {
    const r = await pagina.evaluate(() => {
        const visibles = [...document.querySelectorAll('input, select, textarea, button, a.menu-opcion')]
            .filter(e => e.offsetParent !== null && e.type !== 'hidden');
        return {
            desborde: document.documentElement.scrollWidth - window.innerWidth,
            bajitos: visibles.filter(e => e.getBoundingClientRect().height < 43.5 && !e.closest('.cne-slot a, .cne-slot button'))
                .map(e => e.id || e.className || e.tagName).slice(0, 5),
            letraChica: visibles.filter(e => /INPUT|SELECT|TEXTAREA/.test(e.tagName) && parseFloat(getComputedStyle(e).fontSize) < 16)
                .map(e => e.id).slice(0, 5)
        };
    });
    prueba(nombre + ': nada se sale de lado en 375 px', r.desborde <= 0, true);
    prueba(nombre + ': todo se puede tocar con el dedo (44 px)', r.bajitos, []);
    prueba(nombre + ': letra de 16 px en los campos', r.letraChica, []);
}

const texto = (pagina, sel) => pagina.$eval(sel, e => e.textContent.trim());
const visible = (pagina, sel) => pagina.$eval(sel, e => !!(e.offsetParent || e.getClientRects().length));
/* Escribir sin sacar el foco: así la consulta al CNE (que se dispara al
   salir del campo) no llega a correr y el nombre no se autocompleta. */
const poner = (pagina, sel, valor) => pagina.$eval(sel, (e, v) => {
    e.value = v; e.dispatchEvent(new Event('input', { bubbles: true }));
}, valor);

const servidor = await servirCarpeta(CARPETA);
const BASE = 'http://127.0.0.1:' + servidor.address().port;
let puppeteer;
try { puppeteer = (await import('puppeteer-core')).default; }
catch (e) { console.log('Falta puppeteer-core:  npm i -g puppeteer-core'); process.exit(2); }
const navegador = await puppeteer.launch({ executablePath: buscarChrome(), headless: 'new', args: ['--no-sandbox'] });
const errores = [];
async function paginaNueva() {
    const p = await navegador.newPage();
    await p.setViewport({ width: 375, height: 740, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    p.on('pageerror', e => errores.push(e.message));
    p.on('dialog', d => d.accept());
    return p;
}
const escritos = [];

try {
    /* ---------------- El menú, en el enlace de siempre ---------------- */
    console.log('\nEl menú (reportar-riesgo.html)');
    let p = await paginaNueva();
    await p.goto(BASE + '/reportar-riesgo.html', { waitUntil: 'networkidle0' });
    prueba('al entrar se ve el menú, no el formulario de riesgo', [await visible(p, '#vistaMenu'), await visible(p, '#vistaRiesgo')], [true, false]);
    prueba('el menú ofrece los tres formularios', await p.$$eval('.menu-opcion b', bs => bs.map(b => b.textContent)),
        ['Reportar un riesgo', 'Novedades relevantes', 'Jornada social']);
    await revisarTelefono(p, 'Menú');
    await p.click('#irRiesgo');
    await p.waitForFunction(() => !document.getElementById('vistaRiesgo').hidden);
    prueba('"Reportar un riesgo" abre el formulario de siempre', await visible(p, '#btnEnviar'), true);
    await p.type('#f_prop_nombre', 'Persona de prueba');
    await p.click('#vistaRiesgo .volver');
    await p.waitForFunction(() => !document.getElementById('vistaMenu').hidden);
    prueba('"← Otros formularios" vuelve al menú', await visible(p, '#irNovedades'), true);
    await p.click('#irRiesgo');
    await p.waitForFunction(() => !document.getElementById('vistaRiesgo').hidden);
    prueba('al volver al riesgo, lo escrito sigue ahí (no se recargó)', await p.$eval('#f_prop_nombre', e => e.value), 'Persona de prueba');
    await p.goto(BASE + '/reportar-riesgo.html#formularios', { waitUntil: 'networkidle0' });
    await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle0' }), p.click('#irNovedades')]);
    prueba('"Novedades relevantes" abre su formulario', p.url().endsWith('/novedades.html'), true);
    await p.close();

    /* ---------------- Novedades relevantes ---------------- */
    console.log('\nNovedades relevantes (novedades.html)');
    p = await paginaNueva();
    await p.goto(BASE + '/novedades.html', { waitUntil: 'networkidle0' });
    await p.evaluate(() => localStorage.clear());
    await p.reload({ waitUntil: 'networkidle0' });
    await revisarTelefono(p, 'Novedades');
    prueba('la fecha viene puesta con el día de hoy', /^\d{4}-\d{2}-\d{2}$/.test(await p.$eval('#n_fecha', e => e.value)), true);
    prueba('la unidad y la placa vienen puestas', [await p.$eval('#n_unidad', e => e.value), await p.$eval('#n_placa', e => e.value)], ['Súper Duty', 'A93CR9A']);
    prueba('muestra la situación con la alcaldesa y el director', /Yuhismar Hernández.*Rafael Soto/.test(await texto(p, '#textoSituacion')), true);
    await p.click('#btnEnviar');
    prueba('vacía: pide el tipo de actividad', await texto(p, '#msg'), 'Falta el tipo de actividad.');
    await poner(p, '#n_tipo', MARCA);
    await poner(p, '#n_resena', 'Novedad de prueba automática: se borra sola al terminar.');
    await poner(p, '#n_pac_cedula', 'abc');
    await p.click('#btnEnviar');
    prueba('una cédula del paciente que no se entiende se señala', /cédula del paciente/.test(await texto(p, '#msg')), true);
    await poner(p, '#n_pac_cedula', '');
    await p.click('#btnEnviar');
    prueba('luego pide el nombre de quien envía', await texto(p, '#msg'), 'Falta tu nombre.');
    await p.reload({ waitUntil: 'networkidle0' });
    prueba('al recargar, lo escrito vuelve (borrador en el teléfono)', await p.$eval('#n_tipo', e => e.value), MARCA);
    prueba('y avisa que lo recuperó', await visible(p, '#avisoBorrador'), true);
    if (ESCRIBIR) {
        await poner(p, '#n_rep_nombre', 'ZZ Prueba');
        await poner(p, '#n_rep_telefono', '0000-0000000');
        await poner(p, '#n_pac_nombre', 'ZZ Paciente');
        await poner(p, '#n_pac_ta', '120/80');
        await p.click('#btnEnviar');
        await p.waitForFunction(() => getComputedStyle(document.getElementById('okScreen')).display === 'block', { timeout: 20000 });
        escritos.push(['pc_novedades', 'tipo_actividad', MARCA]);
        prueba('se registra y muestra la pantalla de éxito', await visible(p, '#okScreen'), true);
        const wa = decodeURIComponent(await p.$eval('#btnWhatsapp', a => a.href));
        prueba('el botón de WhatsApp lleva el mensaje con el formato de la hoja',
            wa.includes('*Novedades relevantes*') && wa.includes('• *Tipo de actividad:* ' + MARCA) && wa.includes('• *T/A:* 120/80'), true);
        prueba('al registrarse se borra el borrador', await p.evaluate(() => localStorage.getItem('pc_borrador_novedad_v1')), null);
    } else {
        saltar('registrar una novedad de verdad', 'falta PERMITIR_ESCRIBIR=si');
    }
    await p.close();

    /* ---------------- Jornada social ---------------- */
    console.log('\nJornada social (jornada-social.html)');
    p = await paginaNueva();
    await p.goto(BASE + '/jornada-social.html', { waitUntil: 'networkidle0' });
    await p.evaluate(() => localStorage.clear());
    await p.reload({ waitUntil: 'networkidle0' });
    await revisarTelefono(p, 'Jornada');
    prueba('arranca con una persona para llenar', await p.$$eval('#lista .persona', l => l.length), 1);
    await p.click('#btnAgregar');
    prueba('"Agregar persona" suma otra tarjeta', await texto(p, '#contador'), '2 personas');
    await p.click('#btnEnviar');
    prueba('sin lugar lo pide', await texto(p, '#msg'), 'Falta el lugar de la jornada.');
    await poner(p, '#j_lugar', MARCA);
    await poner(p, '#jp_cedula_1', '12345678');
    await p.click('#btnEnviar');
    prueba('una persona con cédula pero sin nombre se señala con su número', await texto(p, '#msg'), 'Persona 1: falta el nombre.');
    await poner(p, '#jp_nombre_1', 'ZZ Persona Uno');
    await poner(p, '#jp_edad_1', '44');
    await poner(p, '#jp_ta_1', '130/85');
    await p.click('#btnEnviar');
    prueba('luego pide el nombre de quien registra', await texto(p, '#msg'), 'Falta tu nombre.');
    await p.reload({ waitUntil: 'networkidle0' });
    prueba('al recargar vuelven el lugar y las personas', [await p.$eval('#j_lugar', e => e.value), await p.$$eval('#lista .persona', l => l.length)], [MARCA, 2]);
    const nombreRecuperado = await p.$$eval('#lista .persona input[data-campo="nombre"]', l => l[0].value);
    prueba('con sus datos', nombreRecuperado, 'ZZ Persona Uno');
    if (ESCRIBIR) {
        await poner(p, '#j_rep_nombre', 'ZZ Prueba');
        await poner(p, '#j_rep_telefono', '0000-0000000');
        await p.click('#btnEnviar');
        await p.waitForFunction(() => getComputedStyle(document.getElementById('okScreen')).display === 'block', { timeout: 20000 });
        escritos.push(['pc_jornadas', 'lugar', MARCA]);
        prueba('se registra: la segunda tarjeta vacía se salta y cuenta 1 persona', /1 persona atendida/.test(await texto(p, '#okTexto')), true);
    } else {
        saltar('registrar una jornada de verdad', 'falta PERMITIR_ESCRIBIR=si');
    }
    await p.close();

    console.log('\nErrores sueltos de las páginas');
    prueba('ninguna página soltó un error', errores, []);
} finally {
    await navegador.close();
    servidor.close();
    /* Lo que se escribió de verdad, se comprueba en la base y se borra. */
    if (escritos.length) {
        const require = createRequire(path.join(CARPETA, '..', 'alcaldia-admin', 'x.js'));
        const { initializeApp, cert } = require('firebase-admin/app');
        const { getDatabase } = require('firebase-admin/database');
        initializeApp({ credential: cert(JSON.parse(fs.readFileSync(CLAVE_FIREBASE, 'utf8'))), databaseURL: 'https://alcaldia-admin-default-rtdb.firebaseio.com' });
        const db = getDatabase();
        console.log('\nLo que llegó a la base (y se borra)');
        for (const [nodo, campo, valor] of escritos) {
            const snap = await db.ref(nodo).orderByChild(campo).equalTo(valor).once('value');
            prueba(nodo + ': llegó exactamente un registro', snap.numChildren(), 1);
            const r = Object.values(snap.val() || {})[0] || {};
            if (nodo === 'pc_jornadas') prueba('la jornada guardó 1 persona con su edad como número', [r.total, (r.personas || [])[0] && r.personas[0].edad], [1, 44]);
            if (nodo === 'pc_novedades') prueba('la novedad quedó marcada como del público', r.origen, 'publico');
            for (const id of Object.keys(snap.val() || {})) await db.ref(nodo + '/' + id).remove();
            const queda = await db.ref(nodo).orderByChild(campo).equalTo(valor).once('value');
            prueba(nodo + ': no quedó nada de prueba', queda.numChildren(), 0);
        }
        await db.app.delete();
    }
}

console.log('\n' + '='.repeat(64));
if (mal) {
    console.log(`FALLARON ${mal} de ${ok + mal} pruebas.`);
    fallos.forEach(f => console.log('   ✗ ' + f));
    process.exitCode = 1;
} else {
    console.log(`Pasaron las ${ok} pruebas.` + (saltadas ? `  (${saltadas} saltadas a propósito)` : ''));
}
