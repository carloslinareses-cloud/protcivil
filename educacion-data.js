/* Campos de PLANTILLA EDUCACION.xlsx. Una sola lista para formulario, ficha y exportaciones. */
export const SECCIONES = [
    ['Datos del plantel', [
        ['plantel', 'Nombre del plantel', 'text', true, 200],
        ['codigo_plantel', 'Código del plantel', 'text', false, 80],
        ['direccion', 'Dirección exacta', 'textarea', true, 600],
        ['parroquia', 'Parroquia', 'parroquia', true],
        ['comunidad', 'Comunidad', 'text', true, 200],
        ['sala_autogobierno', 'Sala de autogobierno', 'text', false, 200],
        ['cuadrante_paz', 'Cuadrante de paz', 'text', false, 120],
        ['iapem', 'IAPEM', 'si_no'], ['guardia_pueblo', 'Guardia del Pueblo', 'si_no'],
        ['policia_municipal', 'Policía Municipal', 'si_no'], ['pcad', 'P.C.A.D.', 'si_no']
    ]],
    ['Datos del director o directora', [
        ['director_nombre', 'Nombre y apellido', 'text', true, 150],
        ['director_cedula', 'C.I.', 'cedula', false, 15],
        ['director_edad', 'Edad', 'edad'], ['director_telefono', 'Teléfono', 'tel', false, 30]
    ]],
    ['Población estudiantil', [
        ['estudiantes_ninos', 'Niños', 'number'], ['estudiantes_ninas', 'Niñas', 'number'],
        ['estudiantes_total', 'Total', 'total'], ['estudiantes_matricula', 'Matrícula general', 'number']
    ]],
    ['Modalidad especial', [
        ['especial_varones', 'Varones', 'number'], ['especial_hembras', 'Hembras', 'number'],
        ['especial_total', 'Total', 'total'], ['especial_matricula', 'Matrícula general', 'number']
    ]],
    ['Modalidad joven y adulta', [
        ['adultos_varones', 'Varones', 'number'], ['adultos_hembras', 'Hembras', 'number'],
        ['adultos_total', 'Total', 'total'], ['adultos_matricula', 'Matrícula general', 'number']
    ]],
    ['Personal', [ ['madres_cocineras', 'Madres cocineras', 'number'], ['personal_obrero', 'Personal obrero', 'number'] ]],
    ['Personal administrativo', [
        ['personal_inicial', 'Inicial', 'number'], ['personal_primaria', 'Primaria', 'number'],
        ['personal_media_general', 'Media general', 'number'], ['personal_media_tecnica', 'Media técnica', 'number']
    ]],
    ['Personal directivo', [
        ['personal_director', 'Director', 'number'], ['personal_subdirector', 'Subdirector', 'number'],
        ['personal_coordinador', 'Coordinador', 'number']
    ]],
    ['Brigadas', [
        ['tiene_brigadas', 'El plantel cuenta con brigadas', 'si_no'],
        ['brigadas_conformacion', 'Conformación', 'textarea', false, 1000]
    ]],
    ['Capacitados', [
        ['capacitados_ninos', 'Niños', 'number'], ['capacitados_ninas', 'Niñas', 'number'],
        ['capacitados_total', 'Total general', 'total'], ['taller', 'Nombre del taller', 'text', false, 300]
    ]],
    ['Personal actuante', [
        ['responsable', 'Responsable', 'text', true, 150], ['oficial', 'Oficial', 'text', false, 150],
        ['auxiliar', 'Auxiliar', 'text', false, 150], ['conductor', 'Conductor', 'text', false, 150]
    ]],
    ['Reseña', [ ['resena', 'Reseña', 'textarea', false, 6000] ]]
];
export const CAMPOS = SECCIONES.flatMap(([seccion, campos]) => campos.map(c => ({ clave:c[0], etiqueta:c[1], tipo:c[2], obligatorio:!!c[3], max:c[4], seccion })));
export const SUMAS = [ ['estudiantes_total','estudiantes_ninos','estudiantes_ninas'], ['especial_total','especial_varones','especial_hembras'], ['adultos_total','adultos_varones','adultos_hembras'], ['capacitados_total','capacitados_ninos','capacitados_ninas'] ];
export const escapar = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function validar(datos) {
    for (const c of CAMPOS) {
        const v=datos[c.clave];
        if(c.obligatorio && (typeof v!=='string' || v.trim().length<2)) return `Completa ${c.etiqueta.toLowerCase()}.`;
        if(v===undefined) continue;
        if(['number','edad','total'].includes(c.tipo) && (!Number.isInteger(v)||v<0||v>(c.tipo==='edad'?120:c.tipo==='total'?200000:100000))) return `Revisa ${c.etiqueta.toLowerCase()}: usa un número entero válido.`;
        if(c.max && String(v).length>c.max) return `${c.etiqueta}: el máximo es ${c.max} caracteres.`;
        if(c.tipo==='si_no' && !['Sí','No'].includes(v)) return `Selecciona Sí o No en ${c.etiqueta}.`;
        if(c.tipo==='parroquia' && !['Charallave','Las Brisas del Tuy'].includes(v)) return 'Selecciona una parroquia.';
        if(c.tipo==='cedula' && !/^[VE]?-?[0-9]{4,10}$/.test(v)) return 'Revisa la cédula del director o directora.';
    }
    for (const [total,a,b] of SUMAS) if(datos[total]!==undefined && (datos[a]===undefined||datos[b]===undefined||datos[total]!==datos[a]+datos[b])) return 'Revisa los totales de población y capacitación.';
    return '';
}
export const fecha = t => { const d=new Date(t),zona={timeZone:'America/Caracas'}; return d.toLocaleDateString('es-VE',{...zona,weekday:'long',day:'numeric',month:'long',year:'numeric'})+' ? '+d.toLocaleDateString('es-VE',{...zona,day:'2-digit',month:'2-digit',year:'numeric'})+' ? '+d.toLocaleTimeString('es-VE',{...zona,hour:'2-digit',minute:'2-digit'}); };
