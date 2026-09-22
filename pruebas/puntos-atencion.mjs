import fs from 'node:fs';
import assert from 'node:assert/strict';

const leer = archivo => fs.readFileSync(new URL(`../${archivo}`, import.meta.url), 'utf8');
const formulario = leer('puntos-atencion.html');
const panel = leer('puntos-atencion-resultados.html');
const menu = leer('reportar-riesgo.html');
const admin = leer('admin.html');

function validarJavascript(html, nombre) {
    const modulos = [...html.matchAll(/<script[^>]*type=["']module["'][^>]*>([\s\S]*?)<\/script>/gi)];
    assert.ok(modulos.length, `${nombre}: falta el módulo JavaScript`);
    for (const [, codigo] of modulos) {
        const sinImports = codigo.replace(/^\s*import\s+.+?;\s*$/gm, '');
        try { new Function(sinImports); }
        catch (error) { throw new Error(`${nombre}: ${error.message}`); }
    }
}

validarJavascript(formulario, 'Formulario');
validarJavascript(panel, 'Panel');

for (const campo of ['nombre', 'edad', 'cedula', 'telefono', 'ta', 'comunidad']) {
    assert.match(formulario, new RegExp(`id=["']${campo}["']`), `Falta el campo ${campo}`);
    assert.ok(panel.includes(`'${campo}'`), `El panel no incluye ${campo}`);
}
assert.match(formulario, /data-cne/, 'La cédula debe consultar el CNE');
assert.match(formulario, /pc_puntos_atencion/, 'El formulario debe guardar en su nodo');
assert.match(panel, /onValue\(ref\(database,'pc_puntos_atencion'\)/, 'El panel debe actualizarse en tiempo real');

for (const punto of ['Punto de La Peñita', 'Punto del Terminal']) {
    assert.ok(formulario.includes(punto), `Falta ${punto} en el formulario`);
    assert.ok(panel.includes(punto), `Falta ${punto} en el panel`);
    assert.ok(menu.includes(punto), `Falta ${punto} en el menú público`);
}
assert.ok(admin.includes("nodo: 'pc_puntos_atencion'"), 'Falta el resumen en el panel administrativo');
assert.ok(panel.includes('asistenciapclapenita') && panel.includes('asistenciapcterminal'), 'Faltan los enlaces cortos');
assert.ok(panel.includes('Excel completo') && panel.includes('PDF como las hojas'), 'Faltan las descargas');

const anchos = [9, 26, 49, 13, 22, 27, 18, 87];
assert.equal(anchos.reduce((a, b) => a + b, 0), 251, 'Las columnas del PDF deben ocupar exactamente 251 mm');
assert.match(panel, /A1:J1/);
assert.match(panel, /A3:J\$\{datos\.length\}/);

console.log('OK: formularios de La Peñita y Terminal, menú, panel, Excel y PDF verificados.');
