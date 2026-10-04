/* Datos variables del modelo final de Riesgo Controlado proporcionado por Carlos. */
export const CAMPOS_RIESGO = [
 ['codigo','Código del informe','text',30],
 ['establecimiento','Nombre completo del establecimiento','text',140],
 ['rif','RIF','text',15],
 ['representante','Nombre y apellido del representante','text',150],
 ['cedula','Cédula del representante','text',15],
 ['ramo_codigo','Código del ramo','text',40],
 ['ramo_descripcion','Descripción del ramo','textarea',300],
 ['direccion','Dirección del establecimiento','textarea',500],
 ['parroquia','Parroquia','parroquia',30],
 ['fecha_inspeccion','Fecha de inspección','date',10],
 ['fecha_vencimiento','Fecha de vencimiento','date',10]
];
export function validarRiesgo(d){
 for(const [k,et,t,max] of CAMPOS_RIESGO){if(typeof d[k]!=='string'||!d[k].trim())return 'Completa '+et.toLowerCase()+'.';if(d[k].length>max)return et+': máximo '+max+' caracteres.';}
 if(!/^GR\/[0-9]{1,8}\/[0-9]{4}$/.test(d.codigo))return 'Usa un código como GR/916/2026.';
 if(!/^[JGVEP]-[0-9]{8}-[0-9]$/.test(d.rif))return 'Usa un RIF como J-12345678-9.';
 if(!/^[VE]-[0-9]{4,10}$/.test(d.cedula))return 'Usa una cédula con nacionalidad, por ejemplo V-12345678.';
 if(!['Charallave','Las Brisas del Tuy'].includes(d.parroquia))return 'Selecciona una parroquia.';
 for(const k of ['fecha_inspeccion','fecha_vencimiento']){const t=new Date(d[k]+'T12:00:00Z');if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(d[k])||!Number.isFinite(t.getTime())||t.toISOString().slice(0,10)!==d[k])return 'Revisa las fechas del informe.';}
 if(d.fecha_vencimiento<d.fecha_inspeccion)return 'El vencimiento no puede ser anterior a la inspección.';
 return '';
}
export const fechaInforme=v=>/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v)?v.split('-').reverse().join('/'):'__/__/____';
