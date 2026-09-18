/* ==================================================================
   Pruebas del puente pc-api (worker-gestor/worker.js)

       node pruebas/pc-api.mjs              corre las pruebas
       node pruebas/pc-api.mjs --mutantes   rompe cada candado y exige
                                            que alguna prueba lo note

   No toca nada real: fabrica fichas de Firebase firmadas con una llave
   propia y responde aquí mismo lo que contestarían Google (las llaves),
   Firebase (el rol) y Supabase. Se prueba el archivo de verdad: se
   importa tal cual (o una copia rota, para los mutantes).
   ================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FUENTE = fs.readFileSync(path.join(RAIZ, 'worker-gestor', 'worker.js'), 'utf8');
const SITIO = 'https://protcivil.alcaldiadecharallave.com';
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON: 'llave-anon', PUENTE_CORREO: 'puente@x', PUENTE_CLAVE: 'clave-puente',
              ROLES_LEEN: 'admin_plus,admin', ROLES_ESCRIBEN: 'admin_plus' };

/* ---------- llaves y fichas de mentira ---------- */
const par = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const otroPar = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', par.publicKey)), kid: 'llave1', alg: 'RS256', use: 'sig' };
const b64u = (bytes) => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const AHORA = Date.UTC(2026, 8, 18, 15, 0, 0);
async function ficha(datos = {}, cab = {}, llave = par.privateKey) {
    const s = Math.floor(AHORA / 1000);
    const c = b64u(Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'llave1', typ: 'JWT', ...cab })));
    const d = b64u(Buffer.from(JSON.stringify({ aud: 'alcaldia-admin', iss: 'https://securetoken.google.com/alcaldia-admin',
        sub: 'uid-carlos', email: 'carlos@x.com', iat: s - 60, exp: s + 3000, auth_time: s - 600, ...datos })));
    const firma = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', llave, Buffer.from(c + '.' + d)));
    return c + '.' + d + '.' + b64u(firma);
}

/* ---------- el mundo de afuera, fingido ---------- */
function mundo(perfiles) {
    const llamadas = [];
    const traer = async (url, op = {}) => {
        llamadas.push({ url, op });
        if (url.startsWith('https://www.googleapis.com/')) return new Response(JSON.stringify({ keys: [jwk] }));
        if (url.startsWith('https://alcaldia-admin-default-rtdb.firebaseio.com/pc_operadores/')) {
            const uid = decodeURIComponent(url.split('/pc_operadores/')[1].split('.json')[0]);
            return new Response(JSON.stringify(perfiles[uid] ?? null));
        }
        if (url.startsWith(ENV.SUPABASE_URL + '/auth/v1/token')) return new Response(JSON.stringify({ access_token: 'ficha-puente', expires_in: 3600 }));
        if (url.startsWith(ENV.SUPABASE_URL + '/rest/v1/')) return new Response(JSON.stringify({ reenviado: true }), { status: 200 });
        return new Response('no', { status: 404 });
    };
    return { traer, llamadas };
}
const PERFILES = { 'uid-carlos': { rol: 'admin_plus', nombre: 'Carlos Núñez' }, 'uid-jefe': { rol: 'admin', nombre: 'Jefe de Guardia' },
                   'uid-operador': { rol: 'operador', nombre: 'Operador' }, 'uid-nuevo': { rol: 'admin_plus', nombre: 'Nuevo', cambio_obligatorio: true } };

function peticion(ruta, { metodo = 'GET', token, origen = SITIO, cuerpo, cabeceras = {} } = {}) {
    const h = { ...cabeceras };
    if (origen) h.Origin = origen;
    if (token) h.Authorization = 'Bearer ' + token;
    return new Request('https://pc-api.alcaldiadecharallave.com' + ruta, { method: metodo, headers: h, body: cuerpo });
}

async function correrPruebas(W) {
    const res = [];
    const prueba = (nombre, bien) => res.push([nombre, !!bien]);
    const nuevo = () => { W.olvidarLlaves(); W.olvidarRoles(); W.olvidarPuente(); return mundo(PERFILES); };
    const llamar = async (m, p) => W.atender(p, ENV, m.traer, AHORA);
    let m = nuevo(), r, d;

    r = await llamar(m, peticion('/yo', { token: await ficha() }));
    d = await r.json();
    prueba('una ficha buena de un Administrador Plus entra y puede escribir', r.status === 200 && d.puede_escribir === true && d.nombre === 'Carlos Núñez');
    prueba('la respuesta lleva el permiso para nuestro sitio (CORS)', r.headers.get('Access-Control-Allow-Origin') === SITIO);

    m = nuevo(); r = await llamar(m, peticion('/yo', { token: await ficha({ aud: 'otro-proyecto', iss: 'https://securetoken.google.com/otro-proyecto' }) }));
    prueba('una ficha de otro proyecto de Firebase no entra', r.status === 401);
    m = nuevo(); r = await llamar(m, peticion('/yo', { token: await ficha({ exp: Math.floor(AHORA / 1000) - 10 }) }));
    prueba('una ficha vencida no entra', r.status === 401);
    m = nuevo(); r = await llamar(m, peticion('/yo', { token: await ficha({}, {}, otroPar.privateKey) }));
    prueba('una ficha firmada con otra llave no entra', r.status === 401);
    const buena = await ficha();
    const partes = buena.split('.');
    const alterada = partes[0] + '.' + b64u(Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(partes[1], 'base64url')), sub: 'uid-carlos', email: 'otro@x' }))) + '.' + partes[2];
    m = nuevo(); r = await llamar(m, peticion('/yo', { token: alterada }));
    prueba('una ficha con los datos cambiados a mano no entra', r.status === 401);
    m = nuevo(); r = await llamar(m, peticion('/yo', { token: await ficha({}, { alg: 'none' }) }));
    prueba('una ficha que dice "sin firma" no entra', r.status === 401);
    m = nuevo(); r = await llamar(m, peticion('/yo', { token: await ficha({}, { kid: 'desconocida' }) }));
    prueba('una ficha con una llave que Google no publica no entra', r.status === 401);
    m = nuevo(); r = await llamar(m, peticion('/yo', {}));
    prueba('sin ficha no entra', r.status === 401);

    m = nuevo(); r = await llamar(m, peticion('/yo', { token: await ficha({ sub: 'uid-operador' }) }));
    prueba('un operador sin rol de administrador no ve la asistencia', r.status === 403);
    m = nuevo(); r = await llamar(m, peticion('/yo', { token: await ficha({ sub: 'uid-nuevo' }) }));
    prueba('quien todavía debe cambiar su clave no entra', r.status === 403);
    m = nuevo(); r = await llamar(m, peticion('/yo', { token: await ficha({ sub: 'uid-desconocido' }) }));
    prueba('una cuenta de Firebase que no es de Protección Civil no entra', r.status === 403);

    m = nuevo(); r = await llamar(m, peticion('/rest/v1/servicios?select=id', { token: await ficha({ sub: 'uid-jefe' }) }));
    prueba('un Administrador puede ver (lectura reenviada)', r.status === 200 && (await r.json()).reenviado === true);
    m = nuevo(); r = await llamar(m, peticion('/rest/v1/rpc/pc_admin_liberar_telefono', { metodo: 'POST', token: await ficha({ sub: 'uid-jefe' }), cuerpo: '{}' }));
    prueba('un Administrador no puede cambiar datos (liberar teléfono)', r.status === 403);
    m = nuevo(); r = await llamar(m, peticion('/rest/v1/estaciones', { metodo: 'POST', token: await ficha({ sub: 'uid-jefe' }), cuerpo: '{}' }));
    prueba('un Administrador no puede crear estaciones', r.status === 403);
    m = nuevo(); r = await llamar(m, peticion('/rest/v1/rpc/pc_admin_foto', { metodo: 'POST', token: await ficha({ sub: 'uid-jefe' }), cuerpo: '{}' }));
    prueba('un Administrador sí puede ver la foto de un marcaje', r.status === 200);
    m = nuevo(); r = await llamar(m, peticion('/rest/v1/rpc/pc_admin_liberar_telefono', { metodo: 'POST', token: await ficha(), cuerpo: '{}' }));
    prueba('un Administrador Plus sí puede liberar un teléfono', r.status === 200);

    for (const [ruta, metodo, nombre] of [
        ['/rest/v1/sesiones', 'GET', 'leer las fichas de sesión'], ['/rest/v1/fotos', 'GET', 'leer la tabla de fotos'],
        ['/rest/v1/rpc/pc_marcar', 'POST', 'marcar como si fuera un teléfono'], ['/rest/v1/funcionarios', 'DELETE', 'borrar funcionarios'],
        ['/rest/v1/funcionarios', 'PATCH', 'cambiar funcionarios directo (sin la función)'], ['/auth/v1/admin/users', 'GET', 'tocar las cuentas de Supabase'],
        ['/rest/v1/rpc/registrar_marcaje', 'POST', 'llamar funciones internas']]) {
        m = nuevo(); r = await llamar(m, peticion(ruta, { metodo, token: await ficha(), cuerpo: metodo === 'GET' ? undefined : '{}' }));
        prueba('no deja ' + nombre, r.status === 404 && !m.llamadas.some(l => l.url.startsWith(ENV.SUPABASE_URL + '/rest/')));
    }

    m = nuevo(); r = await llamar(m, peticion('/yo', { token: await ficha(), origen: 'https://sitio-malo.com' }));
    prueba('desde otro sitio no atiende', r.status === 403);
    m = nuevo(); r = await llamar(m, peticion('/yo', { token: await ficha(), origen: null }));
    prueba('sin sitio de origen (curl) no atiende', r.status === 403);
    m = nuevo(); r = await llamar(m, peticion('/yo', { metodo: 'OPTIONS' }));
    prueba('la consulta previa del navegador se contesta con los permisos', r.status === 204 && /Authorization/.test(r.headers.get('Access-Control-Allow-Headers') || ''));

    m = nuevo();
    r = await llamar(m, peticion('/rest/v1/rpc/pc_admin_anotar_libro', { metodo: 'POST', token: await ficha(), cuerpo: '{"p_texto":"x"}',
        cabeceras: { 'x-pc-actor': Buffer.from('Impostor').toString('base64'), 'Content-Profile': 'public' } }));
    const reenvio = m.llamadas.find(l => l.url.startsWith(ENV.SUPABASE_URL + '/rest/v1/rpc/'));
    const h = reenvio ? reenvio.op.headers : {};
    prueba('a Supabase va la persona real en la cabecera, no lo que mandó el navegador',
        !!reenvio && Buffer.from(h['x-pc-actor'], 'base64').toString('utf8') === 'Carlos Núñez (carlos@x.com)');
    prueba('a Supabase va la ficha de la cuenta puente, nunca la de Firebase', h.Authorization === 'Bearer ficha-puente');
    prueba('siempre se consulta el esquema de Protección Civil', h['Content-Profile'] === 'protcivil' && h['Accept-Profile'] === 'protcivil');
    await llamar(m, peticion('/rest/v1/servicios', { token: await ficha() }));
    prueba('la cuenta puente entra una sola vez y se reutiliza', m.llamadas.filter(l => l.url.includes('/auth/v1/token')).length === 1);
    prueba('el rol se consulta una vez por minuto, no en cada clic', m.llamadas.filter(l => l.url.includes('/pc_operadores/')).length === 1);

    m = nuevo(); r = await llamar(m, peticion('/rest/v1/rpc/pc_admin_anotar_libro', { metodo: 'POST', token: await ficha(), cuerpo: 'x'.repeat(300 * 1024) }));
    prueba('un envío demasiado grande se rechaza', r.status === 413);
    return res;
}

async function cargar(fuente) {
    const tmp = path.join(os.tmpdir(), 'pc-api-' + Math.random().toString(36).slice(2) + '.mjs');
    fs.writeFileSync(tmp, fuente);
    try { return await import(pathToFileURL(tmp).href); } finally { fs.rmSync(tmp, { force: true }); }
}

const W = await cargar(FUENTE);
const base = await correrPruebas(W);
base.forEach(([n, b]) => console.log((b ? '  ✓ ' : '  ✗ ') + n));
const mal = base.filter(x => !x[1]).length;
console.log(mal ? `\n${mal} de ${base.length} pruebas FALLARON.` : `\nPasaron las ${base.length} pruebas.`);
if (mal) process.exitCode = 1;

if (process.argv.includes('--mutantes') && !mal) {
    const MUTANTES = [
        ['acepta fichas de otro proyecto', "if (datos.aud !== PROYECTO_FIREBASE || datos.iss !== EMISOR) return null;", ''],
        ['acepta fichas vencidas', "if (!(datos.exp > ahora) ||", "if ("],
        ['no revisa la firma', "return bien ? datos : null;", "return datos;"],
        ['acepta cualquier algoritmo', "if (cabecera.alg !== 'RS256' || typeof cabecera.kid !== 'string') return null;", ''],
        ['no revisa el rol', "if (!perfil || perfil.cambio_obligatorio || !leen.includes(rol)) {", "if (false) {"],
        ['deja escribir a quien solo ve', "if (tipo.escribe && !puedeEscribir)", "if (false)"],
        ['deja pasar cualquier tabla', "if (metodo === 'GET' && TABLAS_LECTURA.includes(nombre))", "if (metodo === 'GET')"],
        ['deja llamar cualquier función', "if (metodo !== 'POST' || !nombre.startsWith('pc_admin_')) return null;", "if (metodo !== 'POST') return null;"],
        ['atiende a cualquier sitio', "if (!origenOk) return fallo('Este servicio solo atiende al panel de Protección Civil.', 403, null);", ''],
        ['usa el nombre que manda el navegador', "'x-pc-actor': textoABase64(nombre + (correo ? ' (' + correo + ')' : ''))", "'x-pc-actor': peticion.headers.get('x-pc-actor') || ''"],
        ['sin tope de tamaño', "if (cuerpo.length > TOPE_CUERPO)", "if (false)"]
    ];
    console.log('\nMutantes:');
    let vivos = 0;
    for (const [nombre, a, b] of MUTANTES) {
        if (FUENTE.split(a).length !== 2) { console.log('  ? ' + nombre + ': el texto no aparece una sola vez'); vivos++; continue; }
        let notada;
        try { const r = await correrPruebas(await cargar(FUENTE.replace(a, b))); notada = r.some(x => !x[1]); }
        catch (e) { notada = true; }
        console.log((notada ? '  ✓ ' : '  ✗ ') + nombre + (notada ? '' : ': ¡NADIE LO NOTÓ!'));
        if (!notada) vivos++;
    }
    console.log(vivos ? `\n${vivos} mutante(s) sobrevivieron.` : '\nTodos los mutantes fueron detectados.');
    if (vivos) process.exitCode = 1;
}
