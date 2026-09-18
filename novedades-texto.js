/* novedades-texto.js — el formato de las Novedades relevantes de Protección
   Civil, en UN solo lugar. Lo usan el formulario (novedades.html) para armar
   el mensaje de WhatsApp al enviar, y el tablero (novedades-resultados.html)
   para volver a mandarlo o copiarlo después. Si cambia el formato, se cambia
   aquí y sale igual en los dos. */
(function () {
    const SITUACION = 'por orden de la alcaldesa Lcda. Yuhismar Hernández y el Director de Protección Civil del municipio Cristóbal Rojas Lcdo. Rafael Soto se hace de su conocimiento la siguiente novedad:';

    /* "14:05" -> "2:05 pm". Vacío si no hay hora. */
    function horaBonita(hhmm) {
        const m = /^(\d{2}):(\d{2})$/.exec(hhmm || '');
        if (!m) return '';
        let h = Number(m[1]);
        const sufijo = h >= 12 ? 'pm' : 'am';
        h = h % 12 || 12;
        return h + ':' + m[2] + ' ' + sufijo;
    }

    /* "2026-09-18" -> "18/09/2026". */
    function fechaBonita(iso) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
        return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
    }

    /* El mensaje de WhatsApp, con el mismo formato de la hoja que ya
       usan (los asteriscos son las negritas de WhatsApp). Las partes de
       paciente, acompañante, centro de salud y personal solo salen si
       se llenó algo en ellas: una novedad sin paciente no manda una
       lista de campos vacíos. */
    function textoWhatsappNovedad(d) {
        const L = [];
        const v = (x) => (x == null ? '' : String(x)).trim();
        const hay = (obj) => obj && Object.values(obj).some(x => v(x) !== '');
        L.push('*Novedades relevantes*', '');
        L.push('• Zedan: Capital', '• Zoedan: Miranda', '• Municipio: Cristóbal Rojas');
        L.push('• Parroquia: ' + v(d.parroquia));
        L.push('• Fecha: ' + fechaBonita(d.fecha));
        L.push('• Hora inicio: ' + horaBonita(d.hora_inicio));
        L.push('• Hora finalizado: ' + horaBonita(d.hora_fin));
        L.push('• Comuna: ' + v(d.comuna));
        L.push('• Cuadrante: ' + v(d.cuadrante), '');
        L.push('• Situación: ' + SITUACION);
        L.push('• *Tipo de actividad:* ' + v(d.tipo_actividad), '');
        L.push('• *Reseña:* ' + v(d.resena), '');
        const p = d.paciente || {};
        if (hay(p)) {
            L.push('• *Paciente*');
            L.push('• *Nombre y apellido:* ' + v(p.nombre));
            L.push('• *CI:* ' + v(p.cedula));
            L.push('• *Edad:* ' + v(p.edad));
            L.push('• *IDX:* ' + v(p.idx));
            L.push('• *Signos vitales:*');
            L.push('• *T/A:* ' + v(p.ta));
            L.push('• *Pulso:* ' + v(p.pulso));
            L.push('• *SpO2:* ' + v(p.spo2));
            L.push('• Temperatura: ' + v(p.temperatura), '');
        }
        const a = d.acompanante || {};
        if (hay(a)) {
            L.push('• *Acompañante:*');
            L.push('• *Nombre y apellido:* ' + v(a.nombre));
            L.push('• *C.I:* ' + v(a.cedula));
            L.push('• *Dirección:* ' + v(a.direccion));
            L.push('• *TLF:* ' + v(a.telefono), '');
        }
        const t = d.traslado || {};
        if (hay(t)) {
            L.push('• *Ubicación del centro hospitalario donde se encuentra el paciente:* ' + v(t.centro_hospitalario));
            L.push('• *Médico que refiere:* ' + v(t.medico_refiere));
            L.push('• *Destino del paciente:* ' + v(t.destino));
            L.push('• *Qué servicio recibe:* ' + v(t.servicio));
            L.push('• *Médico que recibe:* ' + v(t.medico_recibe), '');
        }
        const c = d.conductor || {}, pm = d.paramedico || {};
        if (hay(c) || hay(pm)) {
            L.push('• *Personal actuante*');
            L.push('• *Conductor:*');
            L.push('• *Nombre y apellido:* ' + v(c.nombre));
            L.push('• *CI:* ' + v(c.cedula));
            L.push('• *TLF:* ' + v(c.telefono));
            L.push('• *Paramédico:*');
            L.push('• *Nombre y apellido:* ' + v(pm.nombre));
            L.push('• *CI:* ' + v(pm.cedula));
            L.push('• *TLF:* ' + v(pm.telefono), '');
        }
        L.push('• *Unidad:* ' + v(d.unidad));
        L.push('• Placa: ' + v(d.placa), '');
        L.push('• *Nota:* ' + v(d.nota), '');
        L.push('• Estatus', v(d.estatus));
        return L.join('\n');
    }

    window.NovedadesTexto = { SITUACION: SITUACION, horaBonita: horaBonita, fechaBonita: fechaBonita, textoWhatsappNovedad: textoWhatsappNovedad };
})();
