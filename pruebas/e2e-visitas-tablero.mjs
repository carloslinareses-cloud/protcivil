/* Prueba en Chrome del tablero del control de asistencia (visitas-resultados.html)
   y de su tarjeta en el panel (admin.html), contra la base REAL:
     · crea una cuenta temporal del personal (admin_plus) y 2 visitas de prueba,
     · entra por la página de siempre, mira el panel y el tablero en teléfono,
     · prueba filtros, que una visita nueva aparezca sola (en vivo), Excel y PDF,
     · y borra TODO al final, pase lo que pase.

       node pruebas/e2e-visitas-tablero.mjs
   Deja capturas y descargas en pruebas/.e2e-visitas/ (no se sube). */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const CARPETA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAL = path.join(CARPETA, 'pruebas', '.e2e-visitas');
fs.mkdirSync(SAL, { recursive: true });
for (const f of fs.readdirSync(SAL)) fs.rmSync(path.join(SAL, f), { recursive: true, force: true });   // se vacía (no se borra: puede estar abierta)
const require = createRequire(path.join(CARPETA, '..', 'alcaldia-admin', 'x.js'));
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');
initializeApp({ credential: cert(JSON.parse(fs.readFileSync('C:/Users/carlo/Documents/Alcaldia BDD/alcaldia-admin-firebase-adminsdk-fbsvc-207472a5bd.json', 'utf8'))),
    databaseURL: 'https://alcaldia-admin-default-rtdb.firebaseio.com' });
const auth = getAuth(), db = getDatabase();
const puppeteer = (await import('puppeteer-core')).default;
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.css': 'text/css' };
const MARCA = 'ZZ Tablero ' + Date.now();

let ok = 0, mal = 0;
function prueba(nombre, real, esperado) {
    const bien = JSON.stringify(real) === JSON.stringify(esperado);
    bien ? ok++ : mal++;
    console.log((bien ? '   ✓ ' : '   ✗ ') + nombre + (bien ? '' : '  → esperaba ' + JSON.stringify(esperado) + ', dio ' + JSON.stringify(real)));
}
const esperar = ms => new Promise(r => setTimeout(r, ms));
const servidor = await new Promise(ok => {
    const s = http.createServer((pet, res) => {
        const rel = decodeURIComponent(pet.url.split('?')[0]).replace(/^\//, '') || 'index.html';
        const abs = path.resolve(CARPETA, rel);
        if (!abs.startsWith(path.resolve(CARPETA))) { res.writeHead(403).end(); return; }
        fs.readFile(abs, (e, d) => { if (e) { res.writeHead(404).end(); return; } res.writeHead(200, { 'Content-Type': TIPOS[path.extname(abs)] || 'application/octet-stream' }); res.end(d); });
    });
    s.listen(0, '127.0.0.1', () => ok(s));
});
const BASE = 'http://127.0.0.1:' + servidor.address().port;
const navegador = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
const errores = [];
let uid = null; const ids = [];

try {
    const correo = 'zz-prueba-tablero-' + Date.now() + '@example.com', clave = 'P' + crypto.randomBytes(10).toString('base64url') + '7';
    uid = (await auth.createUser({ email: correo, password: clave })).uid;
    await db.ref('pc_operadores/' + uid).set({ nombre: 'ZZ Prueba tablero', rol: 'admin_plus', cambio_obligatorio: false });
    for (const v of [{ parroquia: 'Charallave', nombre: 'ZZ Visita Charallave', motivo: MARCA, edad: 40, cedula: 'V-12345678', telefono: '0424-1234567' },
                     { parroquia: 'Las Brisas del Tuy', nombre: 'ZZ Visita Brisas', motivo: MARCA, correo: 'zz@example.com', direccion: 'Tierra Blanca' }]) {
        const r = db.ref('pc_visitas').push(); ids.push(r.key);
        await r.set({ origen: 'publico', ...v, fecha_registro: Date.now() });
    }
    const p = await navegador.newPage();
    await p.setViewport({ width: 375, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    p.on('pageerror', e => errores.push(e.message)); p.on('dialog', d => d.accept());
    const cdp = await p.createCDPSession();
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: SAL });

    console.log('\nPanel de Protección Civil');
    await p.goto(BASE + '/index.html', { waitUntil: 'networkidle0' });
    await p.type('#email', correo); await p.type('#password', clave);
    await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }).catch(() => null), p.click('#loginForm button[type=submit]')]);
    await esperar(2500);
    prueba('entra al panel', p.url().endsWith('/admin.html'), true);
    await p.waitForFunction(() => document.getElementById('r_visitas_total') && document.getElementById('r_visitas_total').textContent !== '–', { timeout: 20000 }).catch(() => null);
    const tarjeta = await p.evaluate(() => ({ titulo: [...document.querySelectorAll('.resumen b')].map(b => b.textContent).includes('Control de asistencia (visitas)'),
        total: Number(document.getElementById('r_visitas_total').textContent), extra: document.getElementById('r_visitas_extra').textContent }));
    prueba('el panel tiene la tarjeta del control de asistencia', tarjeta.titulo, true);
    prueba('la tarjeta cuenta las visitas y las separa por sede', tarjeta.total >= 2 && /^\d+ · \d+$/.test(tarjeta.extra), true);

    console.log('\nTablero (teléfono de 375 px)');
    await p.goto(BASE + '/visitas-resultados.html', { waitUntil: 'networkidle0' });
    await p.waitForFunction(() => document.querySelectorAll('#tbody tr').length > 0, { timeout: 20000 }).catch(() => null);
    const r0 = await p.evaluate(() => ({ desborde: document.documentElement.scrollWidth - innerWidth, qr: document.querySelectorAll('.compartir-qr img').length,
        cortos: [...document.querySelectorAll('.enlace-corto')].map(e => e.textContent) }));
    prueba('nada se sale de la pantalla del teléfono', r0.desborde <= 0, true);
    prueba('un QR y un enlace corto por sede', [r0.qr, r0.cortos], [2, ['tinyurl.com/asistenciapccharallave', 'tinyurl.com/asistenciapcbrisas']]);
    await p.type('#buscador', MARCA); await esperar(400);
    prueba('buscar muestra las 2 visitas de prueba', await p.$$eval('#tbody tr', t => t.length), 2);
    await p.select('#filtroSede', 'Las Brisas del Tuy'); await esperar(400);
    prueba('filtrar por sede deja solo la de Las Brisas', await p.$$eval('#tbody tr', t => t.map(x => x.textContent.includes('ZZ Visita Brisas'))), [true]);
    await p.select('#filtroSede', ''); await esperar(300);
    // En vivo: una visita nueva aparece sin recargar.
    const nueva = db.ref('pc_visitas').push(); ids.push(nueva.key);
    await nueva.set({ origen: 'publico', parroquia: 'Charallave', nombre: 'ZZ Llegó en vivo', motivo: MARCA, fecha_registro: Date.now() });
    await p.waitForFunction(() => document.getElementById('tbody').textContent.includes('ZZ Llegó en vivo'), { timeout: 15000 }).catch(() => null);
    prueba('una visita nueva aparece sola, sin recargar', await p.$eval('#tbody', e => e.textContent.includes('ZZ Llegó en vivo')), true);
    await p.screenshot({ path: path.join(SAL, 'tablero-375.png'), fullPage: true });

    const bajar = async (boton, patron) => {
        const antes = new Set(fs.readdirSync(SAL)); await p.click(boton);
        for (let t = 0; t < 30; t++) { await esperar(500); const f = fs.readdirSync(SAL).find(x => !antes.has(x) && patron.test(x) && !x.endsWith('.crdownload')); if (f) return path.join(SAL, f); }
        return null;
    };
    const xlsx = await bajar('#btnExcel', /\.xlsx$/);
    prueba('baja el Excel', !!xlsx, true);
    const pdf = await bajar('#btnPdf', /\.pdf$/);
    prueba('baja el PDF como la hoja de papel', !!pdf, true);
    fs.writeFileSync(path.join(SAL, 'descargas.json'), JSON.stringify({ xlsx, pdf }));
    prueba('ninguna página soltó un error', errores, []);
} catch (e) {
    mal++; console.log('   ✗ la prueba se cortó: ' + (e.stack || e.message));
} finally {
    await navegador.close().catch(() => {});
    servidor.close();
    for (const id of ids) await db.ref('pc_visitas/' + id).remove();
    const bit = (await db.ref('pc_bitacora').orderByChild('uid').equalTo(uid || '-').once('value')).val() || {};
    for (const k of Object.keys(bit)) await db.ref('pc_bitacora/' + k).remove();
    if (uid) { await db.ref('pc_operadores/' + uid).remove(); await auth.deleteUser(uid).catch(() => {}); }
    const quedan = ((await db.ref('pc_visitas').once('value')).val() || {});
    prueba('no quedó nada de prueba', Object.values(quedan).filter(v => String(v.motivo || '').startsWith('ZZ Tablero')).length, 0);
    await db.app.delete();
    console.log(`\n${mal ? '✗' : '✓'} ${ok} bien, ${mal} mal`);
    process.exitCode = mal ? 1 : 0;
}
