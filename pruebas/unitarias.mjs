/* ==========================================================================
   PRUEBAS UNITARIAS — Protección Civil Cristóbal Rojas
   ==========================================================================

   Se corren sin instalar absolutamente nada:

       cd C:/Users/carlo/Documents/protcivil
       node pruebas/unitarias.mjs

   Sale con código 0 si todo pasó, y con código 1 si algo falló (así un día
   se puede enganchar a un git hook o a una acción de GitHub).

   CÓMO ESTÁN HECHAS
   -----------------
   Las páginas de este repositorio son HTML sueltos con el JavaScript metido
   dentro, sin módulos ni exportaciones. Para probar una función de adentro
   se LEE el archivo y se SACA el trozo de código real, y ese trozo es el que
   se ejecuta. No hay ni una sola copia pegada a mano: una copia pegada
   MENTIRÍA, porque seguiría pasando la prueba aunque el original se rompa.
   Si alguien le cambia el nombre a una función o la borra, estas pruebas
   revientan al arrancar con un mensaje claro, que es justo lo que se quiere.

   QUÉ PROTEGEN
   ------------
   Cada bloque dice arriba qué error REAL evita. Los tres gordos, que ya
   pasaron de verdad:
     1. con dos toques rápidos al "+" entraban 11 fotos y la 11 se descartaba
        en silencio (la base solo acepta 10: el reporte entero rebotaba);
     2. un enlace de foto de otro dominio acababa metido en un src del
        tablero de los funcionarios;
     3. un texto que empieza por = + - o @ lo abre Excel como fórmula.
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import { webcrypto } from 'node:crypto';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, '..');
const leer = (relativo) => fs.readFileSync(path.join(RAIZ, relativo), 'utf-8');

/* ==========================================================================
   MARCADOR
   ========================================================================== */
let ok = 0, mal = 0, omitidas = 0;
const fallos = [];

function prueba(nombre, real, esperado) {
    if (JSON.stringify(real) === JSON.stringify(esperado)) { ok++; return; }
    mal++;
    fallos.push(`${nombre}\n      esperaba: ${JSON.stringify(esperado)}\n      dio:      ${JSON.stringify(real)}`);
}
function grupo(titulo) { console.log('\n' + titulo); }
function omitir(motivo) { omitidas++; console.log('   (omitida) ' + motivo); }

/* Para las funciones que devuelven una promesa: se comprueba que RECHACE y
   con qué explicación, porque el texto del error es lo que ve la persona. */
async function pruebaRechaza(nombre, promesa, textoEsperado) {
    let mensaje = null;
    try { await promesa; } catch (e) { mensaje = e.message; }
    prueba(nombre, mensaje, textoEsperado);
}

/* ==========================================================================
   HERRAMIENTAS PARA SACAR CÓDIGO DE LOS HTML

   Un recorrido carácter a carácter que sabe distinguir texto entre comillas,
   comentarios y expresiones regulares. Hace falta: la función esc() del
   tablero lleva dentro /[&<>"']/g, y contar llaves a lo bruto se perdería
   con esas comillas sueltas.
   ========================================================================== */

/* Si lo último que se vio fue uno de estos, la barra abre una expresión
   regular; si fue un nombre o un paréntesis de cierre, es una división. */
const ABRE_REGEX = /[({[,;:!&|?+\-*%~^=<>]/;
const PALABRAS_ANTES_DE_REGEX = ['return', 'typeof', 'case', 'new', 'delete', 'void', 'instanceof', 'in', 'of', 'do', 'else', 'yield', 'await'];

function saltarRegex(texto, i) {
    let j = i + 1, enClase = false;
    while (j < texto.length) {
        const c = texto[j];
        if (c === '\\') { j += 2; continue; }
        if (c === '[') enClase = true;
        else if (c === ']') enClase = false;
        else if (c === '/' && !enClase) { j++; break; }
        else if (c === '\n') break;
        j++;
    }
    while (j < texto.length && /[a-z]/.test(texto[j])) j++;   // las banderas: g, i, u…
    return j;
}

function empiezaExpresionRegular(texto, i) {
    const anterior = texto.slice(0, i).replace(/\s+$/, '');
    const ultimo = anterior.slice(-1);
    if (!ultimo || ABRE_REGEX.test(ultimo)) return true;
    const palabra = (anterior.match(/[A-Za-z_$][A-Za-z0-9_$]*$/) || [''])[0];
    return PALABRAS_ANTES_DE_REGEX.includes(palabra);
}

/* Desde la llave de apertura hasta la que la cierra de verdad. */
function bloqueDeLlaves(texto, posLlave) {
    let i = posLlave, profundidad = 0, comilla = null;
    while (i < texto.length) {
        const c = texto[i], d = texto[i + 1];
        if (comilla) {
            if (c === '\\') { i += 2; continue; }
            if (c === comilla) comilla = null;
            i++; continue;
        }
        if (c === '/' && d === '*') { const fin = texto.indexOf('*/', i + 2); i = fin < 0 ? texto.length : fin + 2; continue; }
        if (c === '/' && d === '/') { const fin = texto.indexOf('\n', i); i = fin < 0 ? texto.length : fin + 1; continue; }
        if (c === '/' && empiezaExpresionRegular(texto, i)) { i = saltarRegex(texto, i); continue; }
        if (c === '"' || c === "'" || c === '`') { comilla = c; i++; continue; }
        if (c === '{') profundidad++;
        else if (c === '}') { profundidad--; if (profundidad === 0) return texto.slice(posLlave, i + 1); }
        i++;
    }
    throw new Error('no se encontró la llave que cierra el bloque');
}

/* Una función declarada con "function nombre(...)", entera y tal cual está.
   El "async" de delante, si lo lleva, se recoge también: sin él el trozo no
   se puede ni ejecutar. */
function sacarFuncion(fuente, nombre, deQueArchivo) {
    const encontrado = new RegExp('(?:async\\s+)?function\\s+' + nombre + '\\s*\\(').exec(fuente);
    if (!encontrado) throw new Error(`No encontré la función ${nombre}() en ${deQueArchivo}. ¿Le cambiaron el nombre o la borraron? Las pruebas no pueden inventarse una copia.`);
    const llave = fuente.indexOf('{', encontrado.index);
    return fuente.slice(encontrado.index, llave) + bloqueDeLlaves(fuente, llave);
}

/* El cuerpo de un manejador anónimo: se le pasa la expresión regular que
   marca su cabecera y termina en la llave de apertura. */
function sacarCuerpo(fuente, cabecera, queEs, deQueArchivo) {
    const encontrado = cabecera.exec(fuente);
    if (!encontrado) throw new Error(`No encontré ${queEs} en ${deQueArchivo}. Si se movió o se reescribió, hay que actualizar esta prueba, no borrarla.`);
    const llave = encontrado.index + encontrado[0].length - 1;
    return bloqueDeLlaves(fuente, llave).slice(1, -1);
}

function sacarTrozo(fuente, expresion, queEs, deQueArchivo) {
    const encontrado = expresion.exec(fuente);
    if (!encontrado) throw new Error(`No encontré ${queEs} en ${deQueArchivo}.`);
    return encontrado;
}

/* Ejecuta el código sacado del archivo con las piezas de fuera fingidas, y
   devuelve las funciones que se le pidan. */
function ejecutar(codigo, queDevolver, alrededores = {}) {
    const nombres = Object.keys(alrededores);
    const fabrica = new Function(...nombres, codigo + '\n;return { ' + queDevolver.join(', ') + ' };');
    return fabrica(...nombres.map(n => alrededores[n]));
}

/* ==========================================================================
   BLOQUE 1 — EL WORKER DE LAS FOTOS  (worker-fotos/worker.js)

   Este endpoint está abierto a todo internet: cualquiera puede llamarlo.
   Lo único que impide que se use de alojamiento gratuito con el nombre de
   la Alcaldía es que se miren los PRIMEROS BYTES del archivo, no el nombre
   ni lo que diga el navegador (que se falsifican en dos segundos).

   Del worker se toma todo lo que hay ANTES de "export default", que son las
   constantes y las tres funciones sueltas. Se ejecuta tal cual, sin tocar.
   ========================================================================== */
const fuenteWorker = leer('worker-fotos/worker.js');
const preambuloWorker = fuenteWorker.slice(0, fuenteWorker.indexOf('export default'));
if (preambuloWorker.length < 100) throw new Error('El worker cambió de forma: ya no hay un "export default" al final.');

const W = ejecutar(
    preambuloWorker,
    ['SITIOS_PERMITIDOS', 'TAMANO_MAXIMO', 'CLAVE_LARGO', 'FIRMAS', 'reconocerImagen', 'claveAlAzar', 'cabecerasCors'],
    { crypto: webcrypto }
);

const bytes = (...n) => new Uint8Array(n);
const deTexto = (s) => new Uint8Array([...s].map(c => c.charCodeAt(0)));

grupo('Worker · reconocer una imagen de verdad por sus primeros bytes');
prueba('un JPEG de cámara',
    W.reconocerImagen(bytes(0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46)),
    { tipo: 'image/jpeg', ext: 'jpg', bytes: [0xFF, 0xD8, 0xFF] });
prueba('un JPEG con la variante EXIF (FF D8 FF E1)',
    W.reconocerImagen(bytes(0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x10))?.ext, 'jpg');
prueba('un PNG',
    W.reconocerImagen(bytes(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A))?.ext, 'png');
prueba('un WEBP de verdad (RIFF….WEBP)',
    W.reconocerImagen(deTexto('RIFF\u0020\u0000\u0000\u0000WEBPVP8 '))?.ext, 'webp');

/* Lo que NO se puede colar */
prueba('un texto plano no es una imagen',
    W.reconocerImagen(deTexto('Hola, esto no es una foto')), null);
prueba('un archivo vacío no es una imagen',
    W.reconocerImagen(new Uint8Array(0)), null);
prueba('un SVG NO pasa: es un documento que puede traer guiones dentro',
    W.reconocerImagen(deTexto('<svg xmlns="http://www.w3.org/2000/svg">')), null);
prueba('un RIFF que no es WEBP (un sonido WAVE) se rechaza',
    W.reconocerImagen(deTexto('RIFF\u0024\u0000\u0000\u0000WAVEfmt ')), null);
prueba('un RIFF cortado no revienta, solo se rechaza',
    W.reconocerImagen(deTexto('RIFF')), null);
prueba('un GIF tampoco: no está en la lista',
    W.reconocerImagen(deTexto('GIF89a')), null);
prueba('un ejecutable de Windows (MZ)',
    W.reconocerImagen(deTexto('MZ\u0090\u0000')), null);
prueba('un PDF',
    W.reconocerImagen(deTexto('%PDF-1.7')), null);
prueba('un ZIP disfrazado',
    W.reconocerImagen(bytes(0x50, 0x4B, 0x03, 0x04)), null);
prueba('el JPEG al que le falta el tercer byte',
    W.reconocerImagen(bytes(0xFF, 0xD8)), null);
/* Al JPEG se le vigila el largo de la firma (la línea de arriba), pero al
   PNG no se le vigilaba. Se comprobó rompiendo el worker a propósito: si la
   firma del PNG se acorta de 89 50 4E 47 a 89 50, TODAS las pruebas seguían
   en verde, y sin embargo un archivo cualquiera con esos dos bytes delante
   pasaba a colarse como imagen. El endpoint está abierto a todo internet y
   lo único que lo defiende son estos bytes, así que las dos pruebas de
   abajo son las que cierran ese hueco. */
prueba('el PNG al que le faltan los bytes tercero y cuarto',
    W.reconocerImagen(bytes(0x89, 0x50)), null);
prueba('un archivo que solo copia los dos primeros bytes del PNG no se cuela',
    W.reconocerImagen(new Uint8Array([0x89, 0x50, 0x00, 0x00, ...deTexto('esto es un guion, no una foto')])), null);

grupo('Worker · el nombre al azar con el que se guarda la foto');
const clave1 = W.claveAlAzar(), clave2 = W.claveAlAzar();
prueba('mide 32 caracteres', clave1.length, 32);
prueba('y el largo sale de la constante, no de un número suelto', clave1.length, W.CLAVE_LARGO);
prueba('solo minúsculas y números', /^[a-z0-9]{32}$/.test(clave1), true);
prueba('dos seguidas nunca son iguales', clave1 === clave2, false);
prueba('cien seguidas son cien distintas',
    new Set(Array.from({ length: 100 }, () => W.claveAlAzar())).size, 100);

/* Si alguien "mejora" el alfabeto metiendo mayúsculas o un guion, las fotos
   se subirían bien y después NO se podrían ver nunca: la ruta /foto/ las
   rechazaría con un 404 y nadie entendería por qué. Por eso la regla de la
   ruta se saca del propio worker y se comprueba contra la clave generada. */
const patronRuta = new RegExp(
    sacarTrozo(fuenteWorker, /if \(!\/(.+?)\/\.test\(clave\)\)/, 'la comprobación de la ruta /foto/', 'worker.js')[1]
);
grupo('Worker · la clave que se genera tiene que servir para ver la foto');
for (const f of W.FIRMAS) {
    prueba('una foto ' + f.ext + ' se puede volver a pedir',
        patronRuta.test(W.claveAlAzar() + '.' + f.ext), true);
}
prueba('una ruta inventada no vale', patronRuta.test('nosequenombre.jpg'), false);
prueba('una clave con mayúsculas no vale', patronRuta.test('A'.repeat(32) + '.jpg'), false);
prueba('una extensión que no guardamos no vale', patronRuta.test(clave1 + '.gif'), false);
prueba('con carpetas por medio tampoco', patronRuta.test('otra/' + clave1 + '.jpg'), false);

grupo('Worker · a quién le contesta (CORS)');
const peticionDe = (origen) => ({ headers: { get: (n) => (n === 'Origin' ? origen : null) } });
prueba('a nuestro sitio le responde con su propio nombre',
    W.cabecerasCors(peticionDe('https://protcivil.alcaldiadecharallave.com'))['Access-Control-Allow-Origin'],
    'https://protcivil.alcaldiadecharallave.com');
prueba('a un sitio ajeno NO le devuelve su nombre',
    W.cabecerasCors(peticionDe('https://sitio-malo.example'))['Access-Control-Allow-Origin'],
    W.SITIOS_PERMITIDOS[0]);
prueba('sin cabecera Origin tampoco se abre',
    W.cabecerasCors(peticionDe(null))['Access-Control-Allow-Origin'], W.SITIOS_PERMITIDOS[0]);
prueba('nunca contesta con el comodín *',
    W.cabecerasCors(peticionDe('https://sitio-malo.example'))['Access-Control-Allow-Origin'] === '*', false);
prueba('avisa que la respuesta depende del Origin (si no, la caché la mezcla)',
    W.cabecerasCors(peticionDe(null))['Vary'], 'Origin');
prueba('todos los sitios permitidos son https',
    W.SITIOS_PERMITIDOS.every(s => s.startsWith('https://')), true);
prueba('y ninguno es un comodín',
    W.SITIOS_PERMITIDOS.includes('*'), false);
prueba('el tope de peso son 3 MB', W.TAMANO_MAXIMO, 3 * 1024 * 1024);

/* ==========================================================================
   BLOQUE 2 — EL TABLERO  (informes-resultados.html)

   Todo lo que se pinta aquí lo escribió un desconocido en el formulario
   público. Este tablero lo abre un funcionario con su sesión iniciada: un
   enlace o una etiqueta que se cuele aquí se ejecuta DENTRO de esa sesión.
   ========================================================================== */
const fuenteTablero = leer('informes-resultados.html');
const T = ejecutar(
    [
        sacarFuncion(fuenteTablero, 'esc', 'informes-resultados.html'),
        sacarFuncion(fuenteTablero, 'fotosValidas', 'informes-resultados.html'),
        sacarFuncion(fuenteTablero, 'seguroExcel', 'informes-resultados.html'),
        sacarFuncion(fuenteTablero, 'celdaCodigo', 'informes-resultados.html')
    ].join('\n\n'),
    ['esc', 'fotosValidas', 'seguroExcel', 'celdaCodigo']
);

/* Una clave inventada, con la pinta exacta que tienen las de verdad. */
const CLAVE = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
const nuestra = (ext = 'jpg') => 'https://fotos.alcaldiadecharallave.com/foto/' + CLAVE + '.' + ext;

grupo('Tablero · qué enlaces de foto se aceptan');
prueba('el nuestro, del dominio de la Alcaldía',
    T.fotosValidas({ fotos: [nuestra()] }), [nuestra()]);
prueba('el del worker de Cloudflare',
    T.fotosValidas({ fotos: ['https://pc-fotos.alcaldia.workers.dev/foto/' + CLAVE + '.png'] }).length, 1);
prueba('también .webp',
    T.fotosValidas({ fotos: [nuestra('webp')] }).length, 1);

grupo('Tablero · qué enlaces se rechazan (aquí vive el agujero de seguridad)');
prueba('otro dominio cualquiera',
    T.fotosValidas({ fotos: ['https://sitio-malo.example/foto/' + CLAVE + '.jpg'] }), []);
prueba('http sin la s',
    T.fotosValidas({ fotos: ['http://fotos.alcaldiadecharallave.com/foto/' + CLAVE + '.jpg'] }), []);
prueba('javascript: (esto es lo que acaba ejecutándose en la sesión del funcionario)',
    T.fotosValidas({ fotos: ['javascript:alert(1)'] }), []);
prueba('data: con una imagen dentro tampoco',
    T.fotosValidas({ fotos: ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='] }), []);
prueba('el truco de colgar nuestro dominio delante del suyo',
    T.fotosValidas({ fotos: ['https://pc-fotos.workers.dev.sitio-malo.example/foto/' + CLAVE + '.jpg'] }), []);
prueba('el mismo truco con el dominio de la Alcaldía',
    T.fotosValidas({ fotos: ['https://fotos.alcaldiadecharallave.com.sitio-malo.example/foto/' + CLAVE + '.jpg'] }), []);
prueba('una clave más corta de 32',
    T.fotosValidas({ fotos: ['https://fotos.alcaldiadecharallave.com/foto/' + CLAVE.slice(1) + '.jpg'] }), []);
prueba('una clave más larga de 32',
    T.fotosValidas({ fotos: ['https://fotos.alcaldiadecharallave.com/foto/' + CLAVE + 'x.jpg'] }), []);
prueba('una extensión que no es de imagen',
    T.fotosValidas({ fotos: ['https://fotos.alcaldiadecharallave.com/foto/' + CLAVE + '.svg'] }), []);
prueba('sin extensión',
    T.fotosValidas({ fotos: ['https://fotos.alcaldiadecharallave.com/foto/' + CLAVE] }), []);
prueba('con algo pegado detrás',
    T.fotosValidas({ fotos: [nuestra() + '?x=<script>'] }), []);
prueba('con un salto de línea y otra cosa detrás',
    T.fotosValidas({ fotos: [nuestra() + '\nhttps://sitio-malo.example'] }), []);
prueba('con espacios delante',
    T.fotosValidas({ fotos: ['  ' + nuestra()] }), []);

grupo('Tablero · lo que llega mal formado no puede tumbar la página');
prueba('sin el campo fotos', T.fotosValidas({}), []);
prueba('fotos en null', T.fotosValidas({ fotos: null }), []);
prueba('fotos que no es una lista sino un texto', T.fotosValidas({ fotos: nuestra() }), []);
prueba('fotos que es un objeto', T.fotosValidas({ fotos: { 0: nuestra() } }), []);
prueba('dentro de la lista, cosas que no son textos',
    T.fotosValidas({ fotos: [null, 7, {}, [], nuestra()] }), [nuestra()]);
prueba('nunca pinta más de 10 aunque lleguen 12',
    T.fotosValidas({ fotos: Array.from({ length: 12 }, () => nuestra()) }).length, 10);
prueba('las buenas se quedan aunque vengan mezcladas con malas',
    T.fotosValidas({ fotos: ['https://sitio-malo.example/x.jpg', nuestra(), 'javascript:1'] }).length, 1);

grupo('Tablero · escapar el texto antes de pintarlo');
prueba('una etiqueta', T.esc('<script>'), '&lt;script&gt;');
prueba('las comillas dobles', T.esc('a"b'), 'a&quot;b');
prueba('la comilla simple (los atributos de este tablero van con comilla simple)',
    T.esc("a'b"), 'a&#39;b');
prueba('el ampersand', T.esc('Luz & Fuerza'), 'Luz &amp; Fuerza');
prueba('primero el ampersand, para no escapar dos veces mal',
    T.esc('&lt;'), '&amp;lt;');
prueba('el ataque clásico de salirse de un atributo',
    T.esc('" onerror="alert(1)'), '&quot; onerror=&quot;alert(1)');
prueba('un nombre con apóstrofo, que es de verdad',
    T.esc("MARÍA D'ANGELO"), 'MARÍA D&#39;ANGELO');
prueba('nulo no escribe "null" en pantalla', T.esc(null), '');
prueba('indefinido tampoco', T.esc(undefined), '');
prueba('un número se convierte en texto', T.esc(0), '0');
prueba('un texto normal no se toca', T.esc('Grieta en la pared'), 'Grieta en la pared');

grupo('Tablero · la primera celda de cada fila');
prueba('un informe con código', T.celdaCodigo({ codigo: 'PCCR-RS-2026-01' }), '<b>PCCR-RS-2026-01</b>');
prueba('uno del público todavía sin código',
    T.celdaCodigo({ origen: 'publico' }), '<span class="etq-publico">Reporte del público</span>');
prueba('uno interno sin código', T.celdaCodigo({}), '<span class="sin-codigo">sin código</span>');
prueba('el código también se escapa',
    T.celdaCodigo({ codigo: '<img src=x onerror=alert(1)>' }).includes('<img'), false);
prueba('una foto: en singular',
    T.celdaCodigo({ codigo: 'X', fotos: [nuestra()] }).includes('1 foto adjunta"'), true);
prueba('dos fotos: en plural',
    T.celdaCodigo({ codigo: 'X', fotos: [nuestra(), nuestra('png')] }).includes('2 fotos adjuntas'), true);
prueba('una foto de un dominio ajeno ni se cuenta',
    T.celdaCodigo({ codigo: 'X', fotos: ['https://sitio-malo.example/foto/' + CLAVE + '.jpg'] }),
    '<b>X</b>');

/* --------------------------------------------------------------------------
   Excel. Un texto que empieza con = + - o @ Excel lo abre como FÓRMULA, y
   estos textos los escribe cualquiera desde la calle. El clásico es
   =HYPERLINK("http://…") o un =cmd. Se le pone una comilla delante, que es
   como Excel dice "esto es texto, déjalo quieto".
   -------------------------------------------------------------------------- */
grupo('Excel · neutralizar lo que Excel se tomaría como fórmula');
prueba('el igual', T.seguroExcel('=SUMA(1;1)'), "'=SUMA(1;1)");
prueba('el más', T.seguroExcel('+1234'), "'+1234");
prueba('el menos', T.seguroExcel('-5'), "'-5");
prueba('la arroba', T.seguroExcel('@usuario'), "'@usuario");
prueba('la tabulación', T.seguroExcel('\tcolumna'), "'\tcolumna");
prueba('el retorno de carro', T.seguroExcel('\rlinea'), "'\rlinea");
prueba('el ataque de verdad',
    T.seguroExcel('=HYPERLINK("http://sitio-malo.example","Haga clic")'),
    '\'=HYPERLINK("http://sitio-malo.example","Haga clic")');
prueba('un teléfono con el prefijo internacional también se protege (y se sigue leyendo)',
    T.seguroExcel('+58 424 1234567'), "'+58 424 1234567");

grupo('Excel · lo que NO se debe tocar');
prueba('un texto normal', T.seguroExcel('Grieta en la pared de carga'), 'Grieta en la pared de carga');
prueba('una fecha', T.seguroExcel('05/09/2026'), '05/09/2026');
prueba('un número NEGATIVO de verdad no se toca: no es texto, es número',
    T.seguroExcel(-5), -5);
prueba('un número normal tampoco', T.seguroExcel(3), 3);
prueba('cero tampoco', T.seguroExcel(0), 0);
prueba('el texto vacío se queda vacío', T.seguroExcel(''), '');
prueba('nulo se queda nulo', T.seguroExcel(null), null);
prueba('indefinido se queda indefinido', T.seguroExcel(undefined), undefined);
prueba('una lista se queda igual', T.seguroExcel(['a']), ['a']);
prueba('un texto que YA empieza por comilla no se marca dos veces',
    T.seguroExcel("'ya estaba"), "'ya estaba");
prueba('un guion en medio no molesta', T.seguroExcel('PCCR-RS-2026-01'), 'PCCR-RS-2026-01');

/* --------------------------------------------------------------------------
   El tablero y las reglas de la base tienen que filtrar EXACTAMENTE igual.
   Si una se queda atrás: o se guardan fotos que el tablero no enseña, o el
   tablero enseña enlaces que la base nunca debió aceptar.
   Las reglas viven en el repositorio de la Sala Situacional (mismo proyecto
   de Firebase), así que si esa carpeta no está, la comprobación se salta.
   -------------------------------------------------------------------------- */
grupo('El tablero filtra igual que las reglas de Firebase');
const RUTA_REGLAS = path.join(RAIZ, '..', 'alcaldia-admin', 'firebase-rules.json');
if (!fs.existsSync(RUTA_REGLAS)) {
    omitir('no encuentro firebase-rules.json (está en la carpeta alcaldia-admin, al lado de esta)');
} else {
    const reglas = JSON.parse(fs.readFileSync(RUTA_REGLAS, 'utf-8'));
    const validaFoto = (((reglas.rules || {}).pc_informes || {}).$id || {}).fotos;
    if (!validaFoto || !validaFoto.$i) {
        omitir('las reglas ya no tienen el bloque pc_informes/$id/fotos');
    } else {
        const enLasReglas = sacarTrozo(validaFoto.$i['.validate'], /newData\.val\(\)\.matches\(\/(.+)\/\)/, 'el patrón de las fotos', 'firebase-rules.json')[1];
        const enElTablero = sacarTrozo(fuenteTablero, /const patron = \/(.+)\/;/, 'el patrón de fotosValidas', 'informes-resultados.html')[1];
        prueba('el mismo patrón en los dos sitios', enElTablero, enLasReglas);
        prueba('las reglas solo admiten los índices de 0 a 9, o sea 10 fotos',
            validaFoto.$i['.validate'].includes('$i.matches(/^[0-9]$/)'), true);
    }
}

/* ==========================================================================
   BLOQUE 3 — ENCOGER LA FOTO  (reportar-riesgo.html)

   Una foto de cámara pesa varios megas. Con datos móviles, en la calle, eso
   no sube nunca: por eso se encoge en el propio teléfono antes de mandarla.
   Y hay un tope de 25 MB porque en un teléfono flojo una foto gigantesca
   cierra la pestaña de golpe y se lleva TODO el formulario ya llenado.

   Como aquí no hay navegador, se le fingen las tres piezas que usa:
   URL, Image y el lienzo (canvas). Son piezas del navegador, no lógica
   nuestra: lo que se prueba de verdad es la cuenta del encogido.
   ========================================================================== */
const fuenteForm = leer('reportar-riesgo.html');

let proximaImagen = { ancho: 4000, alto: 3000, falla: false };
let proximoBlob = { tipo: 'image/jpeg', tam: 120000 };
let ultimoLienzo = null, ultimoToBlob = null, urlesSoltadas = [], urlesCreadas = [];

class ImagenFingida {
    set src(valor) {
        this._src = valor;
        this.width = proximaImagen.ancho;
        this.height = proximaImagen.alto;
        queueMicrotask(() => (proximaImagen.falla ? this.onerror() : this.onload()));
    }
    get src() { return this._src; }
}
const urlFingida = {
    createObjectURL: (x) => { const u = 'blob:fingida-' + (urlesCreadas.length + 1); urlesCreadas.push(u); return u; },
    revokeObjectURL: (u) => urlesSoltadas.push(u)
};
const documentoFingido = {
    createElement: (etiqueta) => {
        if (etiqueta !== 'canvas') throw new Error('solo se esperaba un canvas, llegó ' + etiqueta);
        ultimoLienzo = {
            width: 0, height: 0,
            getContext: () => ({ drawImage: () => {} }),
            toBlob: (devolver, tipo, calidad) => { ultimoToBlob = { tipo, calidad }; devolver(proximoBlob); }
        };
        return ultimoLienzo;
    }
};

const { encogerFoto } = ejecutar(
    sacarFuncion(fuenteForm, 'encogerFoto', 'reportar-riesgo.html'),
    ['encogerFoto'],
    { URL: urlFingida, Image: ImagenFingida, document: documentoFingido }
);

const archivoDe = (mb) => ({ size: Math.round(mb * 1024 * 1024), type: 'image/jpeg', name: 'foto.jpg' });

/* Encoger una foto NORMAL no debe fallar nunca. Si un cambio en el código la
   hace fallar, se recoge aquí y la corrida SIGUE: si se dejara reventar, Node
   mata el proceso con un volcado y el resumen no llega a imprimirse, así que
   quien lo mire no sabría cuántas pruebas fallaron ni cuáles. Lo comprobé
   invirtiendo a propósito la comparación de los 25 MB. */
const medidas = () => (ultimoLienzo || { width: 'no se pudo encoger', height: '' });
const salida = () => (ultimoToBlob || { tipo: 'no se pudo encoger', calidad: null });
async function encoger(archivo) {
    ultimoLienzo = null; ultimoToBlob = null;
    try { await encogerFoto(archivo); }
    catch (e) { ultimoLienzo = { width: 'falló al encoger: ' + e.message, height: '' }; }
}

grupo('Encoger la foto · la cuenta del tamaño');
proximaImagen = { ancho: 4000, alto: 3000, falla: false };
await encoger(archivoDe(4));
prueba('una foto apaisada de 4000×3000 baja a 1400×1050',
    [medidas().width, medidas().height], [1400, 1050]);

proximaImagen = { ancho: 3000, alto: 4000, falla: false };
await encoger(archivoDe(4));
prueba('una vertical de 3000×4000 baja a 1050×1400',
    [medidas().width, medidas().height], [1050, 1400]);

proximaImagen = { ancho: 800, alto: 600, falla: false };
await encoger(archivoDe(0.2));
prueba('una foto pequeña NO se agranda (se vería borrosa y pesaría más)',
    [medidas().width, medidas().height], [800, 600]);

proximaImagen = { ancho: 1400, alto: 1400, falla: false };
await encoger(archivoDe(1));
prueba('una que ya mide justo el tope se queda igual',
    [medidas().width, medidas().height], [1400, 1400]);

proximaImagen = { ancho: 4032, alto: 3024, falla: false };
await encoger(archivoDe(5));
prueba('la de un iPhone (4032×3024) sale en números redondos, sin decimales',
    [Number.isInteger(medidas().width), Number.isInteger(medidas().height)], [true, true]);
prueba('y guarda la proporción, no deforma a la gente',
    Math.abs((medidas().width / medidas().height) - (4032 / 3024)) < 0.01, true);

grupo('Encoger la foto · se manda siempre como JPEG comprimido');
prueba('el formato', salida().tipo, 'image/jpeg');
prueba('la calidad', salida().calidad, 0.72);

grupo('Encoger la foto · no se deja memoria colgada');
urlesCreadas = []; urlesSoltadas = [];
proximaImagen = { ancho: 2000, alto: 1500, falla: false };
await encoger(archivoDe(3));
prueba('se suelta el enlace temporal de la foto', urlesSoltadas, urlesCreadas);

grupo('Encoger la foto · lo que se le dice a la persona cuando no se puede');
urlesCreadas = []; urlesSoltadas = [];
await pruebaRechaza('una foto de más de 25 MB se para ANTES de tocarla',
    encogerFoto(archivoDe(30)),
    'Esa foto pesa demasiado (más de 25 MB). Bájale la resolución a la cámara o elige otra.');
prueba('y ni se abre: no se gasta memoria en ella', urlesCreadas.length, 0);

proximaImagen = { ancho: 0, alto: 0, falla: true };
urlesCreadas = []; urlesSoltadas = [];
await pruebaRechaza('un archivo que el navegador no sabe abrir',
    encogerFoto(archivoDe(1)),
    'El archivo no es una imagen válida.');
prueba('aun fallando, suelta la memoria', urlesSoltadas, urlesCreadas);

proximaImagen = { ancho: 1000, alto: 1000, falla: false };
proximoBlob = null;
await pruebaRechaza('si el teléfono no logra generar el JPEG, se dice, no se calla',
    encogerFoto(archivoDe(1)),
    'No se pudo procesar la foto.');
proximoBlob = { tipo: 'image/jpeg', tam: 120000 };

/* ==========================================================================
   BLOQUE 4 — SUBIR LA FOTO AL WORKER  (subirFoto)

   Trampa 10.7 del manual: un error tragado en silencio hacía que el
   formulario dijera "listo" aunque la foto nunca llegó. Aquí se comprueba
   lo contrario: una foto SOLO se marca lista si el servidor lo confirmó
   con una dirección; en cualquier otro caso queda como "fallo", que es lo
   que enciende el "tocar para reintentar" y lo que frena el envío.
   ========================================================================== */
let respuestaDelWorker = null, peticionesAlWorker = [];
const { subirFoto: subirFotoReal, SUBIDA_FOTOS } = ejecutar(
    sacarTrozo(fuenteForm, /const SUBIDA_FOTOS = '.*';/, 'la dirección del worker', 'reportar-riesgo.html')[0] +
    '\n' + sacarFuncion(fuenteForm, 'subirFoto', 'reportar-riesgo.html'),
    ['subirFoto', 'SUBIDA_FOTOS'],
    {
        pintarFotos: () => {},
        fetch: async (direccion, opciones) => {
            peticionesAlWorker.push({ direccion, opciones });
            if (typeof respuestaDelWorker === 'function') return respuestaDelWorker();
            return respuestaDelWorker;
        }
    }
);
const respuestaOk = (datos) => ({ ok: true, status: 201, json: async () => datos });

grupo('Subir la foto · a dónde se manda');
prueba('al worker, por https', SUBIDA_FOTOS.startsWith('https://'), true);
prueba('y a un dominio nuestro',
    /^https:\/\/[a-z0-9.-]*alcaldiadecharallave\.com\//.test(SUBIDA_FOTOS) ||
    /^https:\/\/[a-z0-9.-]*workers\.dev\//.test(SUBIDA_FOTOS), true);

grupo('Subir la foto · solo se marca lista si el servidor lo confirmó');
let laFoto;
peticionesAlWorker = [];
respuestaDelWorker = respuestaOk({ url: nuestra() });
laFoto = { estado: 'procesando', blob: { falso: true }, url: null };
await subirFotoReal(laFoto);
prueba('con respuesta buena, queda lista', laFoto.estado, 'lista');
prueba('y se guarda la dirección que devolvió el servidor', laFoto.url, nuestra());
prueba('se mandó con POST', peticionesAlWorker[0].opciones.method, 'POST');
prueba('y se mandaron los bytes de la foto encogida', peticionesAlWorker[0].opciones.body, { falso: true });

respuestaDelWorker = { ok: false, status: 500, json: async () => ({}) };
laFoto = { estado: 'procesando', blob: {}, url: null };
await subirFotoReal(laFoto);
prueba('si el servidor da error, NO queda lista', laFoto.estado, 'fallo');
prueba('y se queda sin dirección', laFoto.url, null);

respuestaDelWorker = { ok: false, status: 413, json: async () => ({}) };
laFoto = { estado: 'procesando', blob: {}, url: null };
await subirFotoReal(laFoto);
prueba('si la foto pesaba demasiado para el worker, tampoco', laFoto.estado, 'fallo');

/* El cuerpo de una respuesta fallida no se mira siquiera: un portal de wifi
   público o una página de error pueden contestar cualquier cosa con pinta de
   buena. Lo que manda es el código HTTP. */
respuestaDelWorker = { ok: false, status: 403, json: async () => ({ url: 'https://sitio-malo.example/x.jpg' }) };
laFoto = { estado: 'procesando', blob: {}, url: null };
await subirFotoReal(laFoto);
prueba('una respuesta de error NO se cree aunque traiga una dirección dentro', laFoto.estado, 'fallo');
prueba('y esa dirección no se guarda', laFoto.url, null);

respuestaDelWorker = () => { throw new Error('Failed to fetch'); };
laFoto = { estado: 'procesando', blob: {}, url: null };
await subirFotoReal(laFoto);
prueba('sin internet, tampoco (es lo normal en la calle)', laFoto.estado, 'fallo');

respuestaDelWorker = respuestaOk({});
laFoto = { estado: 'procesando', blob: {}, url: null };
await subirFotoReal(laFoto);
prueba('si contesta 201 pero sin dirección, tampoco', laFoto.estado, 'fallo');

respuestaDelWorker = { ok: true, status: 201, json: async () => { throw new Error('no es JSON'); } };
laFoto = { estado: 'procesando', blob: {}, url: null };
await subirFotoReal(laFoto);
prueba('si contesta algo ilegible, tampoco', laFoto.estado, 'fallo');

respuestaDelWorker = respuestaOk({ url: nuestra() });

/* ==========================================================================
   BLOQUE 5 — EL TOPE DE 10 FOTOS  (el "+" del formulario)

   ESTE ES EL ERROR QUE YA PASÓ. Encoger una foto tarda unos segundos en un
   teléfono modesto. Antes, el sitio en la lista se apartaba DESPUÉS de
   encoger: la persona tocaba el "+" dos veces seguidas creyendo que no había
   pasado nada, entraban 11 fotos, y como las reglas de la base solo aceptan
   los índices 0..9, el reporte ENTERO rebotaba al enviarlo.

   La prueba de abajo demuestra que el sitio se aparta ANTES: se llama al
   manejador SIN esperarlo y se mira la lista en ese mismo instante.
   ========================================================================== */
const MAX_FOTOS = Number(sacarTrozo(fuenteForm, /const MAX_FOTOS = (\d+);/, 'el tope de fotos', 'reportar-riesgo.html')[1]);

let fotos = [];
let encogerLento = false, encogerFalla = null, encogidosAMedias = [];
let subidas = [], pintadas = 0;
const elementos = {};
const nuevoElemento = () => ({
    textContent: '', className: '', value: '', disabled: false, style: {},
    focus() { this.enfocado = true; }, scrollIntoView() { this.centrado = true; }
});
const $ = (id) => (elementos[id] || (elementos[id] = nuevoElemento()));

const { alElegirFoto } = ejecutar(
    'let contadorFotos = 0;\nasync function alElegirFoto(ev) {' +
    sacarCuerpo(fuenteForm,
        /\$\('entradaFoto'\)\.addEventListener\(\s*'change'\s*,\s*async\s*\(ev\)\s*=>\s*\{/,
        'el manejador del botón de agregar foto', 'reportar-riesgo.html') +
    '}',
    ['alElegirFoto'],
    {
        $, fotos, MAX_FOTOS,
        pintarFotos: () => { pintadas++; },
        subirFoto: (f) => { subidas.push(f); f.estado = 'lista'; f.url = nuestra(); },
        /* Encoger tarda segundos en un teléfono modesto. Aquí se puede dejar
           a medias a propósito, que es justo cuando aparecía el error. */
        encogerFoto: (archivo) => {
            if (encogerFalla) return Promise.reject(new Error(encogerFalla));
            if (encogerLento) return new Promise(r => encogidosAMedias.push(r));
            return Promise.resolve({ tipo: 'image/jpeg' });
        },
        URL: urlFingida
    }
);

const eligeArchivo = (archivo) => ({ target: { files: archivo ? [archivo] : [], value: 'C:\\falso\\foto.jpg' } });
const fotoNormal = { size: 2_000_000, type: 'image/jpeg', name: 'IMG_2026.jpg' };
const reiniciar = () => {
    fotos.length = 0; subidas = []; pintadas = 0;
    encogerLento = false; encogerFalla = null; encogidosAMedias = [];
    $('msgFotos').textContent = '';
};
/* Suelta los encogidos que se dejaron a medias, para que ninguna promesa
   quede colgada y el resumen final se imprima siempre. */
const terminarDeEncoger = async () => {
    encogerLento = false;
    const pendientes = encogidosAMedias; encogidosAMedias = [];
    pendientes.forEach(soltar => soltar({ tipo: 'image/jpeg' }));
};

grupo('El "+" de las fotos · el tope son 10 y se aparta el sitio ANTES de encoger');
prueba('el tope son 10, que es lo que aguantan las reglas de la base', MAX_FOTOS, 10);

reiniciar();
for (let i = 0; i < 9; i++) fotos.push({ id: 'vieja' + i, estado: 'lista', url: nuestra() });
encogerLento = true;                                     // encoger se queda a medias a propósito
const primerToque = alElegirFoto(eligeArchivo(fotoNormal));   // OJO: sin await, como el toque real
prueba('el sitio queda apartado en el acto, sin esperar a que encoja', fotos.length, 10);
prueba('y se muestra desde ya, marcada como "procesando"', (fotos[9] || {}).estado, 'procesando');
const segundoToque = alElegirFoto(eligeArchivo(fotoNormal));  // el segundo toque, rapidísimo
prueba('EL SEGUNDO TOQUE REBOTA: no entra la foto 11', fotos.length, 10);
prueba('y ni siquiera se pone a encoger la segunda', encogidosAMedias.length, 1);
await terminarDeEncoger();
await primerToque; await segundoToque;
prueba('cuando termina de encoger, siguen siendo 10', fotos.length, 10);
prueba('y solo se subió la que sí entró', subidas.length, 1);

reiniciar();
for (let i = 0; i < MAX_FOTOS; i++) fotos.push({ id: i, estado: 'lista', url: nuestra() });
await alElegirFoto(eligeArchivo(fotoNormal));
prueba('con la lista llena ni se intenta', fotos.length, MAX_FOTOS);
prueba('y no se sube nada', subidas.length, 0);

grupo('El "+" de las fotos · las fotos de iPhone en HEIC');
reiniciar();
await alElegirFoto(eligeArchivo({ size: 3_000_000, type: 'image/heic', name: 'IMG_0001.HEIC' }));
prueba('una HEIC no ocupa un sitio de los 10', fotos.length, 0);
prueba('se explica en cristiano qué hacer',
    $('msgFotos').textContent.includes('HEIC') && $('msgFotos').textContent.includes('Más compatible'), true);
prueba('y se ve como aviso de error', $('msgFotos').className, 'msg err');

reiniciar();
await alElegirFoto(eligeArchivo({ size: 3_000_000, type: '', name: 'foto.heif' }));
prueba('también la reconoce por el nombre cuando el navegador no dice el tipo', fotos.length, 0);

reiniciar();
await alElegirFoto(eligeArchivo({ size: 3_000_000, type: 'image/jpeg', name: 'reheico-en-la-casa.jpg' }));
prueba('pero un JPEG cuyo nombre lleva "heic" por dentro SÍ entra', fotos.length, 1);

grupo('El "+" de las fotos · cuando algo sale mal el sitio se libera');
reiniciar();
encogerFalla = 'Esa foto pesa demasiado (más de 25 MB). Bájale la resolución a la cámara o elige otra.';
await alElegirFoto(eligeArchivo(archivoDe(30)));
prueba('una foto que no se pudo encoger no deja un hueco ocupado para siempre', fotos.length, 0);
prueba('y se dice por qué, no se calla', $('msgFotos').textContent, encogerFalla);
prueba('sin subir nada', subidas.length, 0);

reiniciar();
encogerLento = true;
const preparando = alElegirFoto(eligeArchivo(fotoNormal));
prueba('mientras se prepara, ya se ve en pantalla', fotos.length, 1);
fotos.splice(0, 1);                                    // la persona toca la ✕ mientras tanto
await terminarDeEncoger();
await preparando;
prueba('si la quitó mientras se preparaba, NO se sube a escondidas', subidas.length, 0);

reiniciar();
await alElegirFoto(eligeArchivo(null));
prueba('si no eligió nada (le dio a cancelar), no pasa nada', fotos.length, 0);

reiniciar();
const evento = eligeArchivo(fotoNormal);
await alElegirFoto(evento);
prueba('se limpia el campo para poder volver a elegir LA MISMA foto', evento.target.value, '');

/* ==========================================================================
   BLOQUE 6 — LO QUE SE GUARDA  (armarPayload)

   Dos cosas que las reglas de la base rechazan de plano, y si se colaran
   harían rebotar el reporte entero sin que la persona entienda nada:
     - firmar con "registrado_por" o poner un "codigo" sin sesión iniciada;
     - mandar más de 10 fotos.
   Y una tercera, de las que no dan error pero sí dan un disgusto: mandar el
   enlace de una foto que nunca llegó a subirse.
   ========================================================================== */
const valoresFormulario = {};
const $formulario = (id) => ({ value: valoresFormulario[id] === undefined ? '' : valoresFormulario[id] });
const estadoGrupos = {
    tipo_estructura: new Set(['Vivienda']), evaluacion_danos: new Set(), ubicacion_danos: new Set(),
    losa_techo: new Set(), losa_piso: new Set(), sistema_estructural: new Set(), distribucion_vivienda: new Set()
};

const { armarPayload } = ejecutar(
    [
        sacarTrozo(fuenteForm, /const t = \(id, max\) => .+;/, 'el recortador de textos t()', 'reportar-riesgo.html')[0],
        sacarTrozo(fuenteForm, /const n = \(id\) => .+;/, 'el contador n()', 'reportar-riesgo.html')[0],
        sacarFuncion(fuenteForm, 'armarPayload', 'reportar-riesgo.html')
    ].join('\n'),
    ['armarPayload'],
    { $: $formulario, estadoGrupos, leerNucleo: () => [], fotos, MAX_FOTOS }
);

grupo('Lo que se guarda · no se puede firmar como funcionario');
fotos.length = 0;
valoresFormulario.f_prop_nombre = 'JOSÉ PÉREZ';
let guardado = armarPayload();
prueba('queda marcado como reporte del público', guardado.origen, 'publico');
prueba('NO lleva registrado_por (las reglas lo rechazan sin sesión)', 'registrado_por' in guardado, false);
prueba('NO lleva codigo (ese lo pone Protección Civil al inspeccionar)', 'codigo' in guardado, false);
prueba('la fecha del informe tiene la forma que exigen las reglas',
    /^(19|20)[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.test(guardado.fecha_informe), true);

grupo('Lo que se guarda · solo las fotos que el servidor confirmó');
fotos.length = 0;
fotos.push({ estado: 'lista', url: nuestra() });
fotos.push({ estado: 'fallo', url: null });
fotos.push({ estado: 'subiendo', url: null });
fotos.push({ estado: 'procesando', url: null });
fotos.push({ estado: 'lista', url: nuestra('png') });
guardado = armarPayload();
prueba('van las dos que están listas y ninguna más', guardado.fotos.length, 2);
prueba('y no se cuela ningún enlace vacío', guardado.fotos.every(u => typeof u === 'string' && u), true);

fotos.length = 0;
for (let i = 0; i < 14; i++) fotos.push({ estado: 'lista', url: nuestra() });
prueba('aunque de algún modo hubiera 14, se mandan 10 (la 11 haría rebotar todo)',
    armarPayload().fotos.length, 10);
fotos.length = 0;
prueba('sin fotos, el campo va vacío pero existe', armarPayload().fotos, []);

grupo('Lo que se guarda · los topes de largo que piden las reglas');
valoresFormulario.f_prop_nombre = 'A'.repeat(300);
prueba('el nombre se recorta a 150', armarPayload().propietario.nombres_apellidos.length, 150);
valoresFormulario.f_diagnostico = 'B'.repeat(4000);
prueba('el diagnóstico se recorta a 2000 (la base admite 3000)', armarPayload().diagnostico.length, 2000);
valoresFormulario.f_prop_nombre = '   JOSÉ PÉREZ   ';
prueba('se quitan los espacios de los lados', armarPayload().propietario.nombres_apellidos, 'JOSÉ PÉREZ');

grupo('Lo que se guarda · la edad y el grupo familiar');
valoresFormulario.f_prop_edad = '';
prueba('una edad sin llenar queda en nulo, NO en cero (cero sería inventarle la edad)',
    armarPayload().propietario.edad, null);
valoresFormulario.f_prop_edad = '47';
prueba('una edad llena llega como número', armarPayload().propietario.edad, 47);
valoresFormulario.gf_adultos = '';
prueba('un contador vacío es cero personas', armarPayload().grupo_familiar.adultos, 0);
valoresFormulario.gf_adultos = '-5';
prueba('nunca hay menos de cero personas', armarPayload().grupo_familiar.adultos, 0);
valoresFormulario.gf_adultos = '9999';
prueba('ni más de 999', armarPayload().grupo_familiar.adultos, 999);
valoresFormulario.gf_adultos = 'cuatro';
prueba('si escriben letras, cero', armarPayload().grupo_familiar.adultos, 0);

/* ==========================================================================
   BLOQUE 7 — EL BOTÓN DE ENVIAR

   Trampa 10.7 del manual: nunca decir "enviado" si el servidor no confirmó.
   Y el remate del bloque 4: una foto apartada pero a medio preparar tiene
   que FRENAR el envío, porque si no el reporte sale sin ella y la persona
   se va convencida de que la mandó.
   ========================================================================== */
let payloadDePrueba = null, guardados = [], baseFalla = null;

const { alEnviar } = ejecutar(
    sacarFuncion(fuenteForm, 'err', 'reportar-riesgo.html') +
    '\nasync function alEnviar() {' +
    sacarCuerpo(fuenteForm,
        /\$\('btnEnviar'\)\.addEventListener\(\s*'click'\s*,\s*async\s*\(\)\s*=>\s*\{/,
        'el manejador del botón de enviar', 'reportar-riesgo.html') +
    '}',
    ['alEnviar'],
    {
        $, fotos,
        armarPayload: () => payloadDePrueba,
        ref: (base, ruta) => ({ ruta }),
        push: (nodo) => ({ ruta: nodo.ruta, clave: '-FakeAbcdefghijklmno' }),
        set: async (nodo, datos) => {
            if (baseFalla) throw new Error(baseFalla);
            guardados.push({ ruta: nodo.ruta, datos });
        },
        database: {},
        window: { scrollTo: () => {} }
    }
);

const payloadCompleto = () => ({
    propietario: { nombres_apellidos: 'JOSÉ PÉREZ' },
    ubicacion: { direccion_exacta: 'Calle 5, casa 12' },
    reportado_por: { nombre: 'ANA GÓMEZ', telefono: '0424-1234567' },
    fotos: [], origen: 'publico'
});
const prepararEnvio = () => {
    payloadDePrueba = payloadCompleto();
    guardados = []; baseFalla = null; fotos.length = 0;
    Object.keys(elementos).forEach(k => delete elementos[k]);
};

grupo('Enviar · lo que falta se pide con nombre y apellido');
prepararEnvio(); payloadDePrueba.propietario.nombres_apellidos = '';
await alEnviar();
prueba('sin el nombre del propietario no se manda', guardados.length, 0);
prueba('y se dice cuál falta', $('msg').textContent, 'Falta el nombre del propietario.');
prueba('marcado como error', $('msg').className, 'msg err');
prueba('y el cursor se va al campo que falta', $('f_prop_nombre').enfocado, true);

prepararEnvio(); payloadDePrueba.ubicacion.direccion_exacta = '';
await alEnviar();
prueba('sin dirección exacta no se manda (sin eso no se encuentra la casa)', guardados.length, 0);
prueba('y se dice', $('msg').textContent, 'Falta la dirección exacta.');

prepararEnvio(); payloadDePrueba.reportado_por.nombre = '';
await alEnviar();
prueba('sin saber quién reporta no se manda', guardados.length, 0);

prepararEnvio(); payloadDePrueba.reportado_por.telefono = '';
await alEnviar();
prueba('sin teléfono no se manda (hay que poder devolver la llamada)', guardados.length, 0);

grupo('Enviar · las fotos a medias frenan el envío');
prepararEnvio(); fotos.push({ estado: 'subiendo' });
await alEnviar();
prueba('con una foto subiendo todavía, no se manda', guardados.length, 0);
prueba('y se pide esperar', $('msg').textContent.includes('subiendo'), true);

prepararEnvio(); fotos.push({ estado: 'procesando' });
await alEnviar();
prueba('con una foto recién apartada, tampoco (si no, el reporte saldría sin ella)', guardados.length, 0);

prepararEnvio(); fotos.push({ estado: 'fallo' });
await alEnviar();
prueba('con una foto que falló, no se manda a escondidas', guardados.length, 0);
prueba('y se ofrecen las dos salidas: reintentar o quitarla',
    $('msg').textContent.includes('reintentar') && $('msg').textContent.includes('✕'), true);
prueba('y se lleva a la persona hasta las fotos', $('seccionFotos').centrado, true);

grupo('Enviar · cuando todo está bien');
prepararEnvio(); fotos.push({ estado: 'lista', url: nuestra() });
await alEnviar();
prueba('se guarda una sola vez', guardados.length, 1);
prueba('en el nodo que toca', guardados[0].ruta, 'pc_informes');
prueba('se esconde el formulario', $('formWrap').style.display, 'none');
prueba('y se ve la pantalla de gracias', $('okScreen').style.display, 'block');

grupo('Enviar · si la base falla, NO se dice "enviado" (trampa 10.7)');
prepararEnvio(); baseFalla = 'PERMISSION_DENIED: Permission denied';
await alEnviar();
prueba('no se guardó nada', guardados.length, 0);
prueba('NO se muestra la pantalla de gracias', $('okScreen').style.display, undefined);
prueba('el formulario sigue ahí, con todo lo escrito', $('formWrap').style.display, undefined);
prueba('se avisa que no se pudo', $('msg').textContent.includes('No se pudo enviar'), true);
prueba('y se dice qué pasó, sin tragarse el error',
    $('msg').textContent.includes('PERMISSION_DENIED'), true);
prueba('el botón vuelve a estar disponible para reintentar', $('btnEnviar').disabled, false);
prueba('y vuelve a decir lo que hace', $('btnEnviar').textContent, 'Enviar reporte');

/* ==========================================================================
   BLOQUE 8 — EL WORKER ATENDIENDO PETICIONES DE VERDAD

   Los bloques de arriba prueban las funciones sueltas del worker, pero NO
   el manejador que atiende las peticiones. Y ahí es donde viven los tres
   candados que de verdad protegen el endpoint: el origen, el tamaño y el
   tipo de archivo.

   Este bloque existe porque al romper el código a propósito se descubrió
   que se podía volver a meter el fallo del tamaño —el que dejaba tragarse
   un archivo de 100 MB omitiendo la cabecera Content-Length— y NINGUNA
   prueba se enteraba. Una prueba que no sabe fallar no protege nada.

   El worker se carga de verdad, como módulo, con un depósito de mentira.
   ========================================================================== */
grupo('Worker · el manejador, con los candados puestos');

const rutaTemporal = path.join(os.tmpdir(), 'worker-pruebas-' + process.pid + '.mjs');
fs.writeFileSync(rutaTemporal, fuenteWorker, 'utf-8');
let manejador = null;
try {
    manejador = (await import(pathToFileURL(rutaTemporal).href)).default;
} catch (e) {
    omitir('no se pudo cargar el worker como módulo: ' + e.message);
}

if (manejador) {
    /* Un depósito de mentira: guarda en memoria y no toca Cloudflare. */
    const guardado = new Map();
    const entorno = {
        DEPOSITO: {
            put: async (clave, cuerpo, opciones) => { guardado.set(clave, { cuerpo, opciones }); },
            get: async (clave) => guardado.has(clave)
                ? { body: guardado.get(clave).cuerpo }
                : null
        }
    };

    const BUENO = 'https://protcivil.alcaldiadecharallave.com';
    const jpeg = (n = 100) => {
        const a = new Uint8Array(n);
        a[0] = 0xFF; a[1] = 0xD8; a[2] = 0xFF;
        return a;
    };
    /* Se construye la petición a mano para poder mentir en las cabeceras,
       que es justo lo que haría quien intente abusar del endpoint. */
    function peticion(cuerpo, cabeceras, metodo = 'POST', ruta = '/subir') {
        return new Request('https://fotos.alcaldiadecharallave.com' + ruta, {
            method: metodo,
            headers: cabeceras,
            body: metodo === 'GET' ? undefined : cuerpo
        });
    }
    const llamar = (p) => manejador.fetch(p, entorno);

    const conTodo = await llamar(peticion(jpeg(), {
        Origin: BUENO, 'Content-Type': 'image/jpeg', 'Content-Length': '100'
    }));
    prueba('una foto normal desde nuestra página se guarda', conTodo.status, 201);

    const sinOrigen = await llamar(peticion(jpeg(), { 'Content-Length': '100' }));
    prueba('sin cabecera Origin (un curl pelado) se rechaza', sinOrigen.status, 403);

    const otroOrigen = await llamar(peticion(jpeg(), {
        Origin: 'https://sitio-cualquiera.com', 'Content-Length': '100'
    }));
    prueba('desde otro sitio se rechaza', otroOrigen.status, 403);

    /* AQUÍ ESTÁ EL FALLO QUE NADIE DETECTABA: si no se exige un
       Content-Length válido, basta con omitirlo para que el worker se trague
       el archivo entero en memoria antes de mirarlo. */
    const sinTamano = await llamar(peticion(jpeg(), { Origin: BUENO }));
    prueba('sin declarar el tamaño se rechaza ANTES de leer nada', sinTamano.status, 413);

    const tamanoBasura = await llamar(peticion(jpeg(), { Origin: BUENO, 'Content-Length': 'abc' }));
    prueba('con un tamaño que no es un número se rechaza', tamanoBasura.status, 413);

    const tamanoCero = await llamar(peticion(jpeg(), { Origin: BUENO, 'Content-Length': '0' }));
    prueba('con tamaño cero se rechaza', tamanoCero.status, 413);

    const demasiado = await llamar(peticion(jpeg(), { Origin: BUENO, 'Content-Length': '99999999' }));
    prueba('un archivo de 100 MB se rechaza', demasiado.status, 413);

    const noEsFoto = await llamar(peticion(
        new TextEncoder().encode('esto es un programa, no una foto'),
        { Origin: BUENO, 'Content-Length': '32' }));
    prueba('un archivo que no es imagen se rechaza', noEsFoto.status, 415);

    const preflight = await llamar(peticion(null, { Origin: BUENO }, 'OPTIONS'));
    prueba('el navegador puede preguntar antes (OPTIONS)', preflight.status, 204);

    const cuerpo = await conTodo.json();
    prueba('al guardarla devuelve un enlace de nuestro dominio',
        /^https:\/\/fotos\.alcaldiadecharallave\.com\/foto\/[a-z0-9]{32}\.jpg$/.test(cuerpo.url || ''), true);

    const clave = (cuerpo.url || '').split('/foto/')[1];
    const verla = await llamar(peticion(null, {}, 'GET', '/foto/' + clave));
    prueba('esa foto se puede ver después', verla.status, 200);
    prueba('y se sirve como imagen, nunca como algo ejecutable',
        verla.headers.get('Content-Type'), 'image/jpeg');
    prueba('con el candado que impide que el navegador la interprete',
        verla.headers.get('X-Content-Type-Options'), 'nosniff');

    const inventada = await llamar(peticion(null, {}, 'GET', '/foto/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg'));
    prueba('una clave inventada no devuelve nada', inventada.status, 404);

    const traversal = await llamar(peticion(null, {}, 'GET', '/foto/../../etc/passwd'));
    prueba('no se puede pedir un archivo del servidor', traversal.status, 404);

    fs.rmSync(rutaTemporal, { force: true });
}

/* ==========================================================================
   RESUMEN
   ========================================================================== */
console.log('\n' + '='.repeat(62));
if (mal) {
    console.log(`FALLARON ${mal} de ${ok + mal} pruebas.\n`);
    fallos.forEach(f => console.log('   ✗ ' + f));
    console.log('');
    process.exit(1);
} else {
    console.log(`Pasaron las ${ok} pruebas.` + (omitidas ? `  (${omitidas} omitidas)` : ''));
}
