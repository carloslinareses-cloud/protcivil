/* ============================================================
   pc-api — el puente del panel de Protección Civil
   https://pc-api.alcaldiadecharallave.com
   ============================================================

   El panel de Protección Civil (admin.html) entra con Firebase. La
   asistencia con GPS vive en Supabase (esquema protcivil). Este Worker
   une las dos cosas para que la asistencia se vea DENTRO del mismo panel,
   sin una segunda clave:

     1. El navegador manda la ficha de sesión de Firebase de la persona
        (Authorization: Bearer <idToken>).
     2. Aquí se comprueba de verdad: la firma con las llaves públicas de
        Google, que sea del proyecto alcaldia-admin, que no esté vencida.
     3. Se lee el rol de esa persona en pc_operadores (con su propia ficha,
        así que las reglas de Firebase siguen mandando).
     4. Solo si el rol alcanza, se hace la consulta a Supabase con la
        cuenta PUENTE (su clave solo la tiene este Worker) y con el nombre
        de la persona real en la cabecera x-pc-actor, que es el que queda
        en la bitácora y en el libro de guardia.

   Qué deja pasar (y nada más):
     GET   /yo                               quién soy y qué puedo hacer
     GET   /rest/v1/<tabla de lectura>       con los filtros de PostgREST
     POST  /rest/v1/rpc/pc_admin_*           las funciones del gestor
     POST/PATCH /rest/v1/<catálogo>          estaciones, tipos de guardia,
                                             grupos y configuración
   Las de lectura las puede usar quien VE; todo lo que cambia datos, solo
   quien ESCRIBE (ROLES_ESCRIBEN).

   Configuración (wrangler.jsonc): SUPABASE_URL, SUPABASE_ANON,
   PUENTE_CORREO, ROLES_LEEN, ROLES_ESCRIBEN. Secreto: PUENTE_CLAVE.
   ============================================================ */

export const PROYECTO_FIREBASE = 'alcaldia-admin';
export const EMISOR = 'https://securetoken.google.com/' + PROYECTO_FIREBASE;
const URL_LLAVES = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const URL_RTDB = 'https://alcaldia-admin-default-rtdb.firebaseio.com';
export const SITIOS_PERMITIDOS = ['https://protcivil.alcaldiadecharallave.com'];

export const TABLAS_LECTURA = ['funcionarios', 'estaciones', 'tipos_guardia', 'grupos', 'config', 'servicios',
    'marcajes', 'estados', 'libro_guardia', 'bitacora', 'intentos_entrada'];
export const CATALOGOS = ['estaciones', 'tipos_guardia', 'grupos', 'config'];
export const FUNCIONES_LECTURA = ['pc_admin_foto', 'pc_admin_cumplimiento', 'pc_admin_cuadrante'];
const TOPE_CUERPO = 256 * 1024;

/* ---------------- utilidades ---------------- */

function base64urlABytes(texto) {
    const b64 = texto.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((texto.length + 3) % 4);
    const crudo = atob(b64);
    const bytes = new Uint8Array(crudo.length);
    for (let i = 0; i < crudo.length; i++) bytes[i] = crudo.charCodeAt(i);
    return bytes;
}
function base64urlATexto(texto) {
    return new TextDecoder().decode(base64urlABytes(texto));
}
export function textoABase64(texto) {
    const bytes = new TextEncoder().encode(texto);
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
}

function respuesta(cuerpo, estado, origen, extra = {}) {
    const h = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', ...extra });
    if (origen) { h.set('Access-Control-Allow-Origin', origen); h.set('Vary', 'Origin'); }
    return new Response(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo), { status: estado, headers: h });
}
const fallo = (mensaje, estado, origen) => respuesta({ error: mensaje }, estado, origen);

/* ---------------- la ficha de Firebase ---------------- */

let llavesEnMemoria = null;   // { llaves: Map(kid -> CryptoKey), vence }

async function llavePublica(kid, ahora, traer) {
    if (!llavesEnMemoria || llavesEnMemoria.vence < ahora || !llavesEnMemoria.llaves.has(kid)) {
        const r = await traer(URL_LLAVES);
        if (!r.ok) throw new Error('No se pudieron leer las llaves de Google.');
        const { keys } = await r.json();
        const llaves = new Map();
        for (const jwk of keys || []) {
            llaves.set(jwk.kid, await crypto.subtle.importKey('jwk', jwk,
                { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
        }
        llavesEnMemoria = { llaves, vence: ahora + 3600 * 1000 };
    }
    return llavesEnMemoria.llaves.get(kid) || null;
}
export function olvidarLlaves() { llavesEnMemoria = null; }

/* Devuelve los datos de la ficha si es auténtica y vigente; si no, null.
   Nunca lanza por una ficha mala: una ficha mala es simplemente "no". */
export async function verificarFichaFirebase(ficha, ahoraMs = Date.now(), traer = fetch) {
    if (typeof ficha !== 'string' || ficha.length > 4096) return null;
    const partes = ficha.split('.');
    if (partes.length !== 3) return null;
    let cabecera, datos;
    try {
        cabecera = JSON.parse(base64urlATexto(partes[0]));
        datos = JSON.parse(base64urlATexto(partes[1]));
    } catch (e) { return null; }
    if (cabecera.alg !== 'RS256' || typeof cabecera.kid !== 'string') return null;
    const ahora = Math.floor(ahoraMs / 1000);
    if (datos.aud !== PROYECTO_FIREBASE || datos.iss !== EMISOR) return null;
    if (typeof datos.sub !== 'string' || !datos.sub || datos.sub.length > 128) return null;
    if (!(datos.exp > ahora) || !(datos.iat <= ahora + 60) || (datos.auth_time && datos.auth_time > ahora + 60)) return null;
    const llave = await llavePublica(cabecera.kid, ahoraMs, traer);
    if (!llave) return null;
    const bien = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', llave, base64urlABytes(partes[2]),
        new TextEncoder().encode(partes[0] + '.' + partes[1]));
    return bien ? datos : null;
}

/* ---------------- el rol en Protección Civil ---------------- */

const rolesEnMemoria = new Map();   // uid -> { perfil, vence }

export async function perfilOperador(uid, ficha, ahora = Date.now(), traer = fetch) {
    const guardado = rolesEnMemoria.get(uid);
    if (guardado && guardado.vence > ahora) return guardado.perfil;
    const r = await traer(URL_RTDB + '/pc_operadores/' + encodeURIComponent(uid) + '.json?auth=' + encodeURIComponent(ficha));
    const perfil = r.ok ? await r.json() : null;
    /* Un minuto de memoria: si le quitan el rol a alguien, deja de entrar
       enseguida, sin que cada clic cueste una consulta a Firebase. */
    rolesEnMemoria.set(uid, { perfil, vence: ahora + 60 * 1000 });
    return perfil;
}
export function olvidarRoles() { rolesEnMemoria.clear(); }

/* ---------------- la cuenta puente ---------------- */

let puente = null;   // { ficha, vence }

async function fichaPuente(env, ahora, traer) {
    if (puente && puente.vence - 120 * 1000 > ahora) return puente.ficha;
    const r = await traer(env.SUPABASE_URL + '/auth/v1/token?grant_type=password', {
        method: 'POST', headers: { apikey: env.SUPABASE_ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: env.PUENTE_CORREO, password: env.PUENTE_CLAVE })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.access_token) throw new Error('La cuenta puente no pudo entrar a Supabase.');
    puente = { ficha: d.access_token, vence: ahora + (Number(d.expires_in) || 3600) * 1000 };
    return puente.ficha;
}
export function olvidarPuente() { puente = null; }

/* ---------------- qué se deja pasar ---------------- */

/* Decide si esta ruta y método se permiten, y si hace falta poder escribir.
   Devuelve null si no se permite. */
export function clasificar(metodo, ruta) {
    if (metodo === 'GET' && ruta === '/yo') return { yo: true, escribe: false };
    const m = /^\/rest\/v1\/(rpc\/)?([a-z_]+)$/.exec(ruta);
    if (!m) return null;
    const esRpc = !!m[1], nombre = m[2];
    if (esRpc) {
        if (metodo !== 'POST' || !nombre.startsWith('pc_admin_')) return null;
        return { escribe: !FUNCIONES_LECTURA.includes(nombre) };
    }
    if (metodo === 'GET' && TABLAS_LECTURA.includes(nombre)) return { escribe: false };
    if ((metodo === 'POST' || metodo === 'PATCH') && CATALOGOS.includes(nombre)) return { escribe: true };
    return null;
}

const lista = (v) => String(v || '').split(',').map(s => s.trim()).filter(Boolean);

export async function atender(peticion, env, traer = fetch, ahora = Date.now()) {
    const url = new URL(peticion.url);
    const origen = peticion.headers.get('Origin');
    const origenOk = origen && SITIOS_PERMITIDOS.concat(lista(env.SITIOS_EXTRA)).includes(origen) ? origen : null;

    if (peticion.method === 'OPTIONS') {
        if (!origenOk) return new Response(null, { status: 403 });
        return new Response(null, { status: 204, headers: {
            'Access-Control-Allow-Origin': origenOk, 'Vary': 'Origin',
            'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type, Prefer',
            'Access-Control-Max-Age': '600' } });
    }
    /* Solo lo usa el panel desde el navegador. Sin el Origin de nuestro
       sitio no se atiende: nadie lo usa desde otra página ni desde curl. */
    if (!origenOk) return fallo('Este servicio solo atiende al panel de Protección Civil.', 403, null);

    const tipo = clasificar(peticion.method, url.pathname);
    if (!tipo) return fallo('Esa operación no está permitida.', 404, origenOk);

    const m = /^Bearer (.+)$/.exec(peticion.headers.get('Authorization') || '');
    const datos = m ? await verificarFichaFirebase(m[1], ahora, traer) : null;
    if (!datos) return fallo('Tu sesión venció. Vuelve a entrar al panel.', 401, origenOk);

    const perfil = await perfilOperador(datos.sub, m[1], ahora, traer);
    const rol = perfil && perfil.rol;
    const leen = lista(env.ROLES_LEEN), escriben = lista(env.ROLES_ESCRIBEN);
    if (!perfil || perfil.cambio_obligatorio || !leen.includes(rol)) {
        return fallo('Tu cuenta no tiene acceso a la asistencia.', 403, origenOk);
    }
    const puedeEscribir = escriben.includes(rol);
    const nombre = String(perfil.nombre || datos.email || 'Operador').slice(0, 100);
    const correo = String(datos.email || '').slice(0, 100);

    if (tipo.yo) return respuesta({ nombre, correo, rol, puede_escribir: puedeEscribir }, 200, origenOk);
    if (tipo.escribe && !puedeEscribir) return fallo('Tu cuenta puede ver la asistencia, pero no cambiarla.', 403, origenOk);

    let cuerpo = null;
    if (peticion.method !== 'GET') {
        cuerpo = await peticion.text();
        if (cuerpo.length > TOPE_CUERPO) return fallo('Lo que se mandó pesa demasiado.', 413, origenOk);
    }

    let ficha;
    try { ficha = await fichaPuente(env, ahora, traer); }
    catch (e) { return fallo('El servicio de asistencia no está disponible. Intenta en un momento.', 502, origenOk); }

    const cabeceras = {
        apikey: env.SUPABASE_ANON,
        Authorization: 'Bearer ' + ficha,
        'Accept-Profile': 'protcivil',
        'Content-Profile': 'protcivil',
        'Content-Type': 'application/json',
        /* La persona real, para la bitácora. La pone ESTE servicio: lo que
           mande el navegador en esa cabecera se descarta. */
        'x-pc-actor': textoABase64(nombre + (correo ? ' (' + correo + ')' : ''))
    };
    const prefer = peticion.headers.get('Prefer');
    if (prefer && /^[a-z=,\- ]{1,60}$/i.test(prefer)) cabeceras.Prefer = prefer;

    const r = await traer(env.SUPABASE_URL + url.pathname + url.search, {
        method: peticion.method, headers: cabeceras, body: cuerpo
    });
    if (r.status === 401) olvidarPuente();
    const texto = await r.text();
    return respuesta(texto || 'null', r.status, origenOk);
}

export default {
    async fetch(peticion, env) {
        try {
            return await atender(peticion, env);
        } catch (e) {
            console.error('pc-api', e && e.stack || e);
            return new Response(JSON.stringify({ error: 'Falló algo en el servicio. Intenta de nuevo.' }), {
                status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
        }
    }
};
