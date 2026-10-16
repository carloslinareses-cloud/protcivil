// Fuente: Documents/SOLICITUD DE INSPECCION.docx. Las cantidades desconocidas no se convierten en cero.
export const TIPOS=['Apartamento','Casa','Local comercial','Institución educativa','Ente público','Árbol'];
export const SECCIONES=[
 ['Datos generales de ubicación',[
  ['estado','Estado','fijo',true,80,'Miranda'],['municipio','Municipio','fijo',true,100,'Cristóbal Rojas'],
  ['parroquia','Parroquia','parroquia',true],['sector','Sector','text',false,160],['comunidad','Comunidad','text',true,160],['calle','Calle','text',false,200],
  ['cuadrante_paz','Cuadrante de paz','text',false,120],['telefono_cuadrante','Teléfono del cuadrante','tel',false,30],['sala_autogobierno','Sala de autogobierno','text',false,200],['direccion','Dirección exacta','textarea',true,1000]
 ]],
 ['Datos del solicitante',[
  ['solicitante_nombre','Nombres y apellidos','text',true,150],['solicitante_cedula','Cédula','cedula',true,15],['solicitante_edad','Edad','edad'],['solicitante_telefono','Teléfono','tel',true,30],['ocupacion','Ocupación','text',false,200]
 ]],
 ['Grupo familiar · cantidades',[
  ['adultos','Adultos','cantidad'],['ninos','Niños','cantidad'],['lactantes','Lactantes','cantidad'],['adolescentes','Adolescentes','cantidad'],['tercera_edad','Personas de tercera edad','cantidad'],['discapacidad','Personas con discapacidad','cantidad']
 ]],
 ['Tipo de inspección',[
  ['tipo_inspeccion','Tipo de inspección','tipo',true]
 ]],
 ['Diagnóstico · motivo de la solicitud',[
  ['diagnostico','Describe el motivo de la inspección','textarea',true,6000]
 ]]
];
export const CAMPOS=SECCIONES.flatMap(([seccion,lista])=>lista.map(([clave,etiqueta,tipo,obligatorio,max,valor])=>({clave,etiqueta,tipo,obligatorio:!!obligatorio,max,valor,seccion})));
export const FAMILIA=[['parentesco','Parentesco','text',true,80],['nombre','Nombres y apellidos','text',true,150],['edad','Edad','edad'],['sexo','Sexo','sexo'],['cedula','Cédula','cedula',false,15],['plantel','Nombre del plantel','text',false,200]];
export const escapar=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const esVivienda=tipo=>['Apartamento','Casa'].includes(tipo);
export const fecha=t=>new Date(t).toLocaleDateString('es-VE',{timeZone:'America/Caracas',weekday:'long',day:'numeric',month:'long',year:'numeric'})+' · '+new Date(t).toLocaleDateString('es-VE',{timeZone:'America/Caracas',day:'2-digit',month:'2-digit',year:'numeric'});
export const dia=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Caracas',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
export function validar(d){
 for(const c of CAMPOS){const v=d[c.clave];if(c.obligatorio&&(v===undefined||String(v).trim().length<2))return 'Completa '+c.etiqueta.toLowerCase()+'.';if(v===undefined)continue;
  if(['edad','cantidad'].includes(c.tipo)){if(!Number.isInteger(v)||v<0||v>(c.tipo==='edad'?120:10000))return 'Revisa '+c.etiqueta.toLowerCase()+': escribe un número entero válido.';}
  else if(typeof v!=='string'||!v.trim()||(c.max&&v.length>c.max))return 'Revisa '+c.etiqueta.toLowerCase()+'.';
  if(c.tipo==='fijo'&&v!==c.valor)return 'Revisa '+c.etiqueta.toLowerCase()+'.';
  if(c.tipo==='parroquia'&&!['Charallave','Las Brisas del Tuy'].includes(v))return 'Selecciona una parroquia.';
  if(c.tipo==='tipo'&&!TIPOS.includes(v))return 'Selecciona un tipo de inspección.';
  if(c.tipo==='cedula'&&!/^[VE]?-?\d{4,10}$/.test(v))return 'Revisa la cédula del solicitante.';
  if(c.tipo==='tel'&&!/^[+\d][\d ()-]{6,29}$/.test(v))return 'Revisa '+c.etiqueta.toLowerCase()+'.';
 }
 const familia=d.familia||[];if(!Array.isArray(familia)||familia.length>50)return 'Puedes registrar hasta 50 integrantes del núcleo familiar.';
 if(familia.length&&!esVivienda(d.tipo_inspeccion))return 'El núcleo familiar corresponde a inspecciones de apartamento o casa.';
 for(const [i,p] of familia.entries())for(const [k,et,t,ob,max] of FAMILIA){const v=p[k];if(ob&&(!v||String(v).trim().length<2))return `Integrante ${i+1}: completa ${et.toLowerCase()}.`;if(v===undefined)continue;if(t==='edad'?(!Number.isInteger(v)||v<0||v>120):(typeof v!=='string'||!v.trim()||(max&&v.length>max)))return `Integrante ${i+1}: revisa ${et.toLowerCase()}.`;if(t==='cedula'&&!/^[VE]?-?\d{4,10}$/.test(v))return `Integrante ${i+1}: revisa la cédula.`;if(t==='sexo'&&!['Femenino','Masculino','No indicado'].includes(v))return `Integrante ${i+1}: revisa el sexo registrado.`;}
 return '';
}
