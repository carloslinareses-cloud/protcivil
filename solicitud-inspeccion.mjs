import {initializeApp} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js';
import {getDatabase,ref,push,set,onValue,serverTimestamp} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js';
import {SECCIONES,CAMPOS,FAMILIA,TIPOS,escapar,esVivienda,validar} from './solicitud-inspeccion-data.mjs?v=20261016';
const app=initializeApp({apiKey:'AIzaSyCEqiu5ypPSGbS6nzju6VZtd2RIRYRDmGU',authDomain:'alcaldia-admin.firebaseapp.com',databaseURL:'https://alcaldia-admin-default-rtdb.firebaseio.com',projectId:'alcaldia-admin'});
const db=getDatabase(app),$=id=>document.getElementById(id);let siguiente=0,enviando=false,destino=null;
function control(c,prefijo=''){
 const [clave,et,t,ob,max,valor]=c,id=prefijo+clave,atrib=`id="${id}" data-campo="${clave}" ${ob?'required':''}`;
 let campo;if(['parroquia','tipo','sexo'].includes(t)){const opciones=t==='parroquia'?['Charallave','Las Brisas del Tuy']:t==='tipo'?TIPOS:['Femenino','Masculino','No indicado'];campo=`<select ${atrib}><option value="">Seleccionar</option>${opciones.map(o=>`<option>${o}</option>`).join('')}</select>`;}
 else if(t==='textarea')campo=`<textarea ${atrib} maxlength="${max}" rows="4"></textarea>`;
 else campo=`<input ${atrib} type="${['edad','cantidad'].includes(t)?'number':t==='tel'?'tel':'text'}" ${['edad','cantidad'].includes(t)?`min="0" max="${t==='edad'?120:10000}" step="1" inputmode="numeric"`:`maxlength="${max||200}"`} ${t==='fijo'?`value="${valor}" readonly`:''} ${t==='cedula'?'inputmode="text" autocapitalize="characters"':''} ${clave==='solicitante_cedula'?'data-cne data-cne-nombre="#solicitante_nombre"':''}>`;
 return `<div class="campo ${t==='textarea'?'amplio':''}"><label for="${id}">${et}${ob?' <span class="obligatorio">*</span>':''}</label>${campo}</div>`;
}
$('secciones').innerHTML=SECCIONES.map(([titulo,campos])=>`<section class="seccion"><h2>${titulo}</h2><div class="campos">${campos.map(c=>control(c)).join('')}</div></section>`).join('');
// Mantengo el núcleo familiar antes del motivo, siguiendo el orden del Word.
$('secciones').lastElementChild.before($('nucleo'));
function vivienda(){const visible=esVivienda($('tipo_inspeccion').value);$('nucleo').hidden=!visible;for(const c of $('familia').querySelectorAll('input,select'))c.disabled=!visible;}
$('tipo_inspeccion').addEventListener('change',vivienda);
$('agregar').onclick=()=>{if($('familia').children.length>=50)return;const n=++siguiente,fs=document.createElement('fieldset');fs.className='familiar';fs.innerHTML=`<legend>Familiar ${n}</legend><div class="campos">${FAMILIA.map(c=>control(c,`f${n}_`)).join('')}</div><div class="acciones"><button class="secundario" type="button" data-quitar>Quitar este familiar</button></div>`;$('familia').append(fs);fs.querySelector('input').focus();$('agregar').disabled=$('familia').children.length>=50;};
$('familia').addEventListener('click',e=>{const b=e.target.closest('[data-quitar]');if(b){b.closest('fieldset').remove();$('agregar').disabled=false;}});
function valor(el,tipo){const v=el.value.trim();return v===''?undefined:['edad','cantidad'].includes(tipo)?Number(v):tipo==='cedula'?v.toUpperCase().replace(/[.\s]/g,''):v;}
function leer(){const d={};for(const c of CAMPOS){const v=valor($(c.clave),c.tipo);if(v!==undefined)d[c.clave]=v;}if(esVivienda(d.tipo_inspeccion)){const familia=[...$('familia').children].map(fs=>Object.fromEntries(FAMILIA.map(([k,,t])=>[k,valor(fs.querySelector(`[data-campo="${k}"]`),t)]).filter(([,v])=>v!==undefined)));if(familia.length)d.familia=familia;}return d;}
function mensaje(t,error=false){$('mensaje').textContent=t;$('mensaje').className='mensaje '+(error?'error':'exito');}
onValue(ref(db,'.info/connected'),s=>{$('conexion').textContent=s.val()===true?'':'Sin conexión con el servidor. Mantén esta página abierta para recuperar la conexión; tus datos siguen en el formulario.';});
$('formulario').addEventListener('submit',async e=>{e.preventDefault();if(enviando)return;const d=leer(),error=validar(d);if(error){mensaje(error,true);return;}enviando=true;$('enviar').disabled=true;mensaje('Enviando solicitud…');try{destino??=push(ref(db,'pc_solicitudes_inspeccion'));await set(destino,{...d,origen:'publico',fecha_registro:serverTimestamp()});$('referencia').textContent=destino.key;$('formulario').hidden=true;$('confirmacion').hidden=false;$('confirmacion').scrollIntoView({behavior:'smooth'});}catch(e){mensaje('No se pudo confirmar el envío. Revisa la conexión y vuelve a intentar desde esta página. Tus datos siguen aquí.'+(e.code==='PERMISSION_DENIED'?' Si persiste, consulta con Protección Civil. Referencia: '+destino.key:''),true);}finally{enviando=false;$('enviar').disabled=false;}});
$('otra').onclick=()=>{$('formulario').reset();$('familia').replaceChildren();destino=null;siguiente=0;$('agregar').disabled=false;vivienda();mensaje('');$('formulario').hidden=false;$('confirmacion').hidden=true;window.scrollTo({top:0,behavior:'smooth'});};
