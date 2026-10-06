/* Una sola lista de campos para formulario, ficha y exportaciones. */
export const SECCIONES = [
  ['Abastecimiento', [['bomba','Bomba donde surtió combustible','text',true,160],['tipo_bomba','Tipo de bomba','tipo_bomba',true,20]]],
  ['Funcionario que reporta', [['nombre','Nombre','text',true,100],['apellido','Apellido','text',true,100],['cedula','C. I.','cedula',true,15],['telefono','Teléfono','tel',true,30]]],
  ['Lugar y momento del reporte', [['municipio','Municipio','text',true,100],['fecha','Fecha','date',true,10],['hora','Hora','time',true,5]]],
  ['Unidad', [['unidad','Unidad: ambulancia o moto','unidad',true,20],['marca','Marca','text',true,100],['placa','Placa','text',true,30],['combustible','Combustible','text',false,200],['aceite','Aceite','text',false,200]]],
  ['Nota', [['nota','Nota','textarea',false,3000]]]
];
export const CAMPOS=SECCIONES.flatMap(([seccion,campos])=>campos.map(([clave,etiqueta,tipo,obligatorio,max])=>({clave,etiqueta,tipo,obligatorio,max,seccion})));
export const OPCIONES={tipo_bomba:['Subsidiada','Internacional'],unidad:['Ambulancia','Moto']};
export const escapar=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const fotosValidas=r=>(Array.isArray(r?.fotos)?r.fotos:[]).filter(u=>typeof u==='string'&&/^https:\/\/fotos\.alcaldiadecharallave\.com\/foto\/[a-z0-9]{32}\.(jpg|png|webp)$/.test(u)).slice(0,10);
export function validar(d){
  for(const c of CAMPOS){const v=d[c.clave];if(c.obligatorio&&(typeof v!=='string'||!v.trim()))return 'Completa '+c.etiqueta.toLowerCase()+'.';if(v===undefined)continue;
    if(typeof v!=='string'||v.length>c.max)return 'Revisa '+c.etiqueta.toLowerCase()+'.';
    if(OPCIONES[c.tipo]&&!OPCIONES[c.tipo].includes(v))return 'Selecciona '+c.etiqueta.toLowerCase()+'.';
    if(c.tipo==='cedula'&&!/^[VE]?-?[0-9]{4,10}$/.test(v))return 'Revisa la cédula del funcionario.';
    if(c.tipo==='tel'&&!/^[+0-9() .-]{7,30}$/.test(v))return 'Revisa el teléfono del funcionario.';
    if(c.tipo==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T12:00:00Z'))||new Date(v+'T12:00:00Z').toISOString().slice(0,10)!==v))return 'Revisa la fecha del reporte.';
    if(c.tipo==='time'&&!/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(v))return 'Revisa la hora del reporte.';
  }
  if(d.fotos&&(!Array.isArray(d.fotos)||d.fotos.length>10||fotosValidas(d).length!==d.fotos.length))return 'Revisa las fotografías adjuntas.';
  return '';
}
export const fecha=t=>{const d=new Date(t),z={timeZone:'America/Caracas'};return d.toLocaleDateString('es-VE',{...z,weekday:'long',day:'numeric',month:'long',year:'numeric'})+' · '+d.toLocaleDateString('es-VE',{...z,day:'2-digit',month:'2-digit',year:'numeric'})+' · '+d.toLocaleTimeString('es-VE',{...z,hour:'2-digit',minute:'2-digit'});};
export const fechaReporte=v=>v?fecha(v+'T12:00:00-04:00').split(' · ').slice(0,2).join(' · '):'Sin información';
