/* =====================================================================
   Pruebas de la base de asistencia de Protección Civil (Supabase).

       node pruebas/asistencia-base.mjs              corre las pruebas
       node pruebas/asistencia-base.mjs --mutantes   además rompe a propósito
                                                     cada candado y comprueba
                                                     que alguna prueba lo note

   Cómo funciona: manda a Supabase, en UNA sola transacción, el archivo
   sql/asistencia.sql (sin su "commit") seguido de asistencia-base.sql.
   Las pruebas terminan con un error a propósito, así que la base deshace
   todo: no queda ni la estructura (si todavía no estaba) ni un solo dato
   de prueba. Del error se leen los resultados.

   Hace falta el token de administración de Supabase guardado en la
   bóveda de Windows (supabase-alcaldia / sbp_token). Nunca se escribe en
   un archivo.
   ===================================================================== */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { leerSecreto } from 'file:///C:/Users/carlo/Documents/admin-alcaldia/scripts/boveda.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const ESQUEMA = readFileSync(join(aqui, '..', 'sql', 'asistencia.sql'), 'utf8');
const PRUEBAS = readFileSync(join(aqui, 'asistencia-base.sql'), 'utf8');
const PROYECTO = 'tfbzghjjfcaqmkzsxrrs';

const TOKEN = leerSecreto('supabase-alcaldia', 'sbp_token');
if (!TOKEN) {
    console.error('No hay token de Supabase en la bóveda (supabase-alcaldia / sbp_token).');
    process.exit(2);
}

/* Cada mutante rompe UN candado. Si todas las pruebas siguen en verde con
   el candado roto, esas pruebas no lo estaban vigilando. */
const MUTANTES = [
    ['sin candado de zona', 'if not o_dentro and v_cfg.exigir_zona then', 'if false then'],
    ['sin margen del GPS', 'o_dentro := (o_distancia - v_gracia) <= v_radio;', 'o_dentro := o_distancia <= v_radio;'],
    ['sin tope de imprecisión', 'if p_precision is not null and p_precision > v_cfg.precision_maxima_m then', 'if false then'],
    ['acepta GPS falso', 'if coalesce(p_gps_simulado, false) then', 'if false then'],
    ['sin bloqueo por claves erradas', 'if v_fallos >= 5 then', 'if false then'],
    ['sin atar la cuenta al teléfono', 'elsif v_f.dispositivo_autorizado <> v_disp then', 'elsif false then'],
    ['la ficha sirve tras liberar el teléfono',
        'if v_cfg.un_telefono_por_persona and v_f.dispositivo_autorizado is distinct from v_s.dispositivo then', 'if false then'],
    ['cambiar la clave sin la actual',
        "if coalesce(p_clave_actual, '') = '' or v_f.clave_hash <> extensions.crypt(p_clave_actual, v_f.clave_hash) then", 'if false then'],
    ['acepta claves fáciles', "if p_clave ~ '^(.)\\1+$' or p_clave in ('123456',", "if false and p_clave in ('123456',"],
    ['sin reintento sin duplicar', 'if p_id_local is not null then\n    select * into v_previo', 'if false then\n    select * into v_previo'],
    ['sin foto obligatoria', 'if v_foto.o_bytes is null and v_cfg.foto_obligatoria then', 'if false then'],
    ['acepta cualquier archivo como foto',
        "elsif octet_length(o_bytes) < 500 or substring(o_bytes from 1 for 3) <> '\\xffd8ff'::bytea then", 'elsif false then'],
    ['acepta horas del futuro sin señal', "if p_momento > now() + interval '5 minutes' then", 'if false then'],
    ['hora dudosa no queda por revisar', "v_revision := 'por_revisar';", "v_revision := 'ok';"],
    ['el gestor ve la huella de las claves',
        'grant select (id, cedula, nombres, apellidos, cargo, condicion, grupo_id, estacion_id, telefono,\n              debe_cambiar_clave, dispositivo_autorizado, dispositivo_nombre, activo, creado_en, actualizado_en)\n  on protcivil.funcionarios to authenticated;',
        'grant select on protcivil.funcionarios to authenticated;'],
    ['cualquier cuenta es gestor', 'select exists (select 1 from protcivil.gestores g where g.user_id = auth.uid() and g.activo);',
        'select auth.uid() is not null;'],
    ['el teléfono llama funciones internas',
        'revoke all on all functions in schema protcivil from public, anon, authenticated;',
        'grant execute on all functions in schema protcivil to anon;'],
    ['los marcajes se pueden cambiar', "if (to_jsonb(new) - 'servicio_id') is distinct from (to_jsonb(old) - 'servicio_id') then", 'if false then'],
    ['la guardia olvidada inventa horas', 'set fin = inicio, cierre = \'automatico\'', 'set fin = inicio + interval \'24 hours\', cierre = \'automatico\''],
    ['24x48 mal calculado', "v_ciclo := make_interval(hours => g.horas_servicio + g.horas_descanso);",
        'v_ciclo := make_interval(hours => g.horas_descanso);'],
    ['cualquier cuenta puede fingir el nombre con la cabecera', 'if v_g.es_puente then', 'if true then'],
    ['"¿puedo marcar?" sin revisar la sesión', "  select * into v_ses from protcivil.sesion_de(p_token);\n  if v_ses.o_sesion_id is null then\n    return protcivil.fallo('sesion', 'Tu sesión venció o se cerró. Vuelve a entrar.');\n  end if;\n  select * into v_sitio",
        "  select * into v_sitio"],
    ['llegar tarde cuenta como a tiempo', "when s.id is not null and s.inicio > gp.inicio + make_interval(mins => gp.tolerancia_min) then 'tarde'",
        "when false then 'tarde'"]
];

async function correr(esquema) {
    const cuerpo = esquema.replace(/\ncommit;\s*$/, '\n') + '\n' + PRUEBAS;
    const r = await fetch(`https://api.supabase.com/v1/projects/${PROYECTO}/database/query`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: cuerpo })
    });
    const texto = await r.text();
    let mensaje = texto;
    try { mensaje = JSON.parse(texto).message || texto; } catch { /* queda el texto crudo */ }
    const i = mensaje.indexOf('RESULTADO_PRUEBAS');
    if (i < 0) {
        return { roto: true, detalle: `HTTP ${r.status}: ${mensaje.slice(0, 1500)}` };
    }
    const lineas = mensaje.slice(i + 'RESULTADO_PRUEBAS'.length).split('\n')
        .map(l => l.trim()).filter(l => /^(OK|FALLA) /.test(l));
    const cortar = lineas.findIndex(l => l.includes('CONTEXT:'));
    return { roto: false, lineas: cortar >= 0 ? lineas.slice(0, cortar) : lineas };
}

if (!ESQUEMA.trimEnd().endsWith('commit;')) {
    console.error('sql/asistencia.sql debe terminar en "commit;".');
    process.exit(2);
}

const base = await correr(ESQUEMA);
if (base.roto) {
    console.error('Las pruebas no llegaron a correr:\n' + base.detalle);
    process.exit(1);
}
const fallas = base.lineas.filter(l => l.startsWith('FALLA'));
for (const l of base.lineas) console.log((l.startsWith('OK') ? '  ✓ ' : '  ✗ ') + l.replace(/^(OK|FALLA) /, ''));
console.log(fallas.length
    ? `\n${fallas.length} de ${base.lineas.length} pruebas FALLARON.`
    : `\nPasaron las ${base.lineas.length} pruebas. No quedó ningún dato de prueba en la base.`);

if (process.argv.includes('--mutantes')) {
    if (fallas.length) {
        console.error('\nNo se prueban mutantes con pruebas en rojo.');
        process.exit(1);
    }
    console.log('\nMutantes (cada uno rompe un candado; alguna prueba tiene que notarlo):');
    let vivos = 0;
    for (const [nombre, original, roto] of MUTANTES) {
        const veces = ESQUEMA.split(original).length - 1;
        if (veces !== 1) {
            console.log(`  ? ${nombre}: el texto a romper aparece ${veces} veces; hay que actualizar el mutante.`);
            vivos++;
            continue;
        }
        const res = await correr(ESQUEMA.replace(original, roto));
        if (res.roto) {
            console.log(`  ✓ ${nombre}: la base ni siquiera se instaló (${res.detalle.slice(0, 80)}…)`);
            continue;
        }
        const notadas = res.lineas.filter(l => l.startsWith('FALLA'));
        if (notadas.length) {
            console.log(`  ✓ ${nombre}: lo notaron ${notadas.length} prueba(s)`);
        } else {
            console.log(`  ✗ ${nombre}: ¡NINGUNA prueba lo notó!`);
            vivos++;
        }
    }
    console.log(vivos ? `\n${vivos} mutante(s) sobrevivieron.` : '\nTodos los mutantes fueron detectados.');
    if (vivos) process.exit(1);
}
process.exit(fallas.length ? 1 : 0);
