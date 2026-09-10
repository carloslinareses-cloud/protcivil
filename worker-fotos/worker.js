/* ============================================================
   Worker de fotos — Protección Civil Cristóbal Rojas
   ============================================================

   Guarda en Cloudflare R2 las fotos que la gente adjunta en el
   formulario público de reporte de riesgo, y las devuelve luego
   para verlas en el tablero.

       POST /subir        el cuerpo son los bytes de la imagen.
                          Devuelve  { "url": "https://.../foto/<clave>" }

       GET  /foto/<clave> devuelve la imagen.

   El depósito (bucket) es PRIVADO: no tiene dominio público
   propio. La única forma de ver una foto es por este Worker, con
   la clave exacta, que son 32 caracteres al azar y no se pueden
   adivinar ni listar.

   Cuidados que tiene, porque cualquiera en internet puede llamar
   este endpoint:
     - Solo acepta lo que de verdad es una imagen (se revisan los
       primeros bytes del archivo, no el nombre ni lo que diga el
       navegador). Así nadie lo usa para alojar programas.
     - Máximo 3 MB por foto.
     - Solo responde a los sitios de la Alcaldía (revisa el Origin).
     - Al devolverla, fuerza el tipo de contenido y la muestra
       como imagen. Aunque alguien lograra colar otra cosa, el
       navegador nunca la ejecutaría.

   Para publicarlo hace falta, del lado de Cloudflare:
     1. Activar R2 en el panel (una sola vez, gratis hasta 10 GB).
     2. Crear el depósito  pc-fotos
     3. Publicar este Worker con el enlace (binding)  DEPOSITO -> pc-fotos
   ============================================================ */

const SITIOS_PERMITIDOS = [
    'https://protcivil.alcaldiadecharallave.com',
    'https://carloslinareses-cloud.github.io'
];

const TAMANO_MAXIMO = 3 * 1024 * 1024;   // 3 MB
const CLAVE_LARGO = 32;

/* Los primeros bytes delatan lo que es el archivo de verdad. */
const FIRMAS = [
    { tipo: 'image/jpeg', ext: 'jpg', bytes: [0xFF, 0xD8, 0xFF] },
    { tipo: 'image/png', ext: 'png', bytes: [0x89, 0x50, 0x4E, 0x47] },
    { tipo: 'image/webp', ext: 'webp', bytes: [0x52, 0x49, 0x46, 0x46] }   // "RIFF", se confirma abajo
];

function reconocerImagen(bytes) {
    for (const f of FIRMAS) {
        if (f.bytes.every((b, i) => bytes[i] === b)) {
            /* WEBP es "RIFF....WEBP": hay que mirar también el byte 8. */
            if (f.ext === 'webp') {
                const marca = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
                if (marca !== 'WEBP') continue;
            }
            return f;
        }
    }
    return null;
}

function claveAlAzar() {
    const letras = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const azar = crypto.getRandomValues(new Uint8Array(CLAVE_LARGO));
    let s = '';
    for (const n of azar) s += letras[n % letras.length];
    return s;
}

function cabecerasCors(peticion) {
    const origen = peticion.headers.get('Origin') || '';
    const permitido = SITIOS_PERMITIDOS.includes(origen) ? origen : SITIOS_PERMITIDOS[0];
    return {
        'Access-Control-Allow-Origin': permitido,
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin'
    };
}

function respuestaJson(datos, estado, peticion) {
    return new Response(JSON.stringify(datos), {
        status: estado,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...cabecerasCors(peticion) }
    });
}

export default {
    async fetch(peticion, entorno) {
        const url = new URL(peticion.url);

        if (peticion.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: cabecerasCors(peticion) });
        }

        /* Freno por IP. Sin esto, cualquiera con un bucle de dos líneas
           gasta el cupo diario del plan gratis en minutos y deja SIN subir
           fotos a todo el municipio, justo el día de la emergencia; y de
           paso llena el depósito para siempre.
           Va después del OPTIONS a propósito: el navegador manda un
           preflight por cada foto, y si contara, la gente gastaría el doble.
           El `if` no es adorno: si el Worker se publicara sin el enlace de
           límite configurado, sin él reventaría en CADA subida. */
        if (entorno.LIMITE) {
            const ip = peticion.headers.get('CF-Connecting-IP') || 'sin-ip';
            const { success } = await entorno.LIMITE.limit({ key: ip });
            if (!success) {
                return respuestaJson({ error: 'demasiadas peticiones seguidas, espera un minuto' }, 429, peticion);
            }
        }

        /* ---------- subir una foto ---------- */
        if (peticion.method === 'POST' && url.pathname === '/subir') {
            /* Se EXIGE la cabecera Origin, no basta con que "si viene, sea
               válida": un curl a secas no manda ninguna, y así el endpoint
               quedaba abierto a que lo usaran de alojamiento gratuito con
               el nombre de la alcaldía. El navegador siempre la manda,
               porque el formulario y este servidor son dominios distintos.
               No es una barrera infranqueable —una cabecera se falsifica—
               pero corta el abuso fácil, y el freno por IP hace el resto. */
            const origen = peticion.headers.get('Origin') || '';
            if (!SITIOS_PERMITIDOS.includes(origen)) {
                return respuestaJson({ error: 'origen no autorizado' }, 403, peticion);
            }

            /* Se EXIGE que declare el tamaño y se revisa ANTES de leer nada.
               Si solo se mirara después, bastaría con omitir la cabecera
               (o mandar basura, que da NaN y pasa cualquier comparación)
               para que el Worker se tragara en memoria un archivo de 100 MB
               antes de rechazarlo. El formulario manda un Blob, así que el
               navegador siempre pone esta cabecera. */
            const largoDeclarado = Number(peticion.headers.get('Content-Length'));
            if (!Number.isFinite(largoDeclarado) || largoDeclarado <= 0 || largoDeclarado > TAMANO_MAXIMO) {
                return respuestaJson({ error: 'la foto pesa demasiado o no se pudo medir' }, 413, peticion);
            }

            const cuerpo = new Uint8Array(await peticion.arrayBuffer());
            if (cuerpo.length === 0) {
                return respuestaJson({ error: 'no llegó ninguna foto' }, 400, peticion);
            }
            if (cuerpo.length > TAMANO_MAXIMO) {
                return respuestaJson({ error: 'la foto pesa demasiado' }, 413, peticion);
            }

            const clase = reconocerImagen(cuerpo);
            if (!clase) {
                return respuestaJson({ error: 'el archivo no es una imagen' }, 415, peticion);
            }

            const clave = claveAlAzar() + '.' + clase.ext;
            await entorno.DEPOSITO.put(clave, cuerpo, {
                httpMetadata: { contentType: clase.tipo, cacheControl: 'public, max-age=31536000, immutable' }
            });

            return respuestaJson({ url: url.origin + '/foto/' + clave }, 201, peticion);
        }

        /* ---------- ver una foto ---------- */
        if (peticion.method === 'GET' && url.pathname.startsWith('/foto/')) {
            const clave = url.pathname.slice('/foto/'.length);
            if (!/^[a-z0-9]{32}\.(jpg|png|webp)$/.test(clave)) {
                return new Response('No encontrada', { status: 404 });
            }

            const objeto = await entorno.DEPOSITO.get(clave);
            if (!objeto) return new Response('No encontrada', { status: 404 });

            const tipo = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[clave.split('.').pop()];
            return new Response(objeto.body, {
                headers: {
                    'Content-Type': tipo,
                    'Content-Disposition': 'inline',
                    'X-Content-Type-Options': 'nosniff',
                    'Content-Security-Policy': "default-src 'none'; sandbox",
                    'Cache-Control': 'public, max-age=31536000, immutable',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }

        return new Response('No encontrada', { status: 404 });
    }
};
