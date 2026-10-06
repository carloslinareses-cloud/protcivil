import {initializeApp} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js';
import {getDatabase,ref,push,set,serverTimestamp} from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js';
import {SECCIONES,CAMPOS,OPCIONES,escapar,validar,fotosValidas} from './parque-automotor-data.js';
const app=initializeApp({apiKey:'AIzaSyCEqiu5ypPSGbS6nzju6VZtd2RIRYRDmGU',authDomain:'alcaldia-admin.firebaseapp.com',databaseURL:'https://alcaldia-admin-default-rtdb.firebaseio.com',projectId:'alcaldia-admin'}),db=getDatabase(app),$=id=>document.getElementById(id);
let destino=null,enviando=false;const fotos=[];
function control(c){const [k,et,tipo,ob,max]=c,attrs=`id="${k}" name="${k}" ${ob?'required':''}`;let html;
 if(OPCIONES[tipo])html=`<select ${attrs}><option value="">Seleccionar</option>${OPCIONES[tipo].map(o=>`<option>${o}</option>`).join('')}</select>`;
 else if(tipo==='textarea')html=`<textarea ${attrs} maxlength="${max}" rows="4"></textarea>`;
 else html=`<input ${attrs} type="${['date','time','tel'].includes(tipo)?tipo:'text'}" maxlength="${max}" ${tipo==='cedula'?'inputmode="numeric"':''}>`;
 return `<div class="campo ${tipo==='textarea'?'amplio':''}"><label for="${k}">${et}${ob?' <span class="obligatorio">*</span>':''}</label>${html}</div>`;
}
$('secciones').innerHTML=SECCIONES.map(([s,campos])=>`<section class="seccion"><h2>${s}</h2><div class="campos">${campos.map(control).join('')}</div></section>`).join('');
function iniciarFecha(){ $('municipio').value='Cristóbal Rojas';const partes=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Caracas',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());const valor=t=>partes.find(p=>p.type===t).value;$('fecha').value=valor('year')+'-'+valor('month')+'-'+valor('day');$('hora').value=valor('hour')+':'+valor('minute'); }
iniciarFecha();
function mensaje(texto,error=false){$('mensaje').textContent=texto;$('mensaje').className='mensaje '+(error?'error':'exito');}
function pintarFotos(){
 $('fotos').innerHTML=fotos.map((f,i)=>`<div class="foto-reporte"><img src="${escapar(f.vista)}" alt="Foto ${i+1} del parque automotor"><p>${escapar({procesando:'Preparando…',subiendo:'Subiendo…',lista:'Foto lista',fallo:'No se pudo subir. Reintenta o quita esta foto.'}[f.estado])}</p>${f.estado==='fallo'?`<button type="button" data-reintentar="${i}">Reintentar foto ${i+1}</button>`:''}<button type="button" class="secundario" data-quitar="${i}" ${enviando?'disabled':''}>Quitar foto ${i+1}</button></div>`).join('');
 $('fotos').querySelectorAll('[data-quitar]').forEach(b=>b.onclick=()=>{const [f]=fotos.splice(Number(b.dataset.quitar),1);URL.revokeObjectURL(f.vista);pintarFotos();});
 $('fotos').querySelectorAll('[data-reintentar]').forEach(b=>b.onclick=()=>subir(fotos[Number(b.dataset.reintentar)]));
 $('tomarFoto').disabled=$('seleccionarFoto').disabled=enviando||fotos.length>=10;
}
function comprimir(archivo){return new Promise((ok,mal)=>{const url=URL.createObjectURL(archivo),img=new Image();img.onerror=()=>{URL.revokeObjectURL(url);mal(Error('La imagen no se puede abrir. Elige JPG, PNG o toma una foto nueva.'));};img.onload=()=>{const escala=Math.min(1,1400/Math.max(img.naturalWidth,img.naturalHeight)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.naturalWidth*escala));c.height=Math.max(1,Math.round(img.naturalHeight*escala));const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(url);c.toBlob(b=>b&&b.size<=3*1024*1024?ok(b):mal(Error('La foto sigue siendo demasiado grande. Elige otra imagen.')),'image/jpeg',.72);};img.src=url;});}
async function subir(f){if(!f||!f.blob||!fotos.includes(f))return;f.estado='subiendo';pintarFotos();try{const resp=await fetch('https://fotos.alcaldiadecharallave.com/subir',{method:'POST',headers:{'Content-Type':'image/jpeg'},body:f.blob});if(!resp.ok)throw Error('No se pudo subir');const d=await resp.json();if(fotosValidas({fotos:[d.url]}).length!==1)throw Error('Respuesta de fotografía inválida');f.url=d.url;f.estado='lista';}catch(e){f.estado='fallo';}pintarFotos();}
async function agregar(entrada){const archivos=Array.from(entrada.files||[]);entrada.value='';if(enviando)return;
 for(const archivo of archivos){if(fotos.length>=10){$('mensajeFotos').textContent='Máximo 10 fotos por reporte.';break;}if(!archivo.type.startsWith('image/')||archivo.size>25*1024*1024){$('mensajeFotos').textContent='Selecciona una imagen de hasta 25 MB.';continue;}
  // Reserva el cupo antes de procesar para evitar selecciones concurrentes de más de 10 fotos.
  const f={vista:URL.createObjectURL(archivo),estado:'procesando',blob:null,url:null};fotos.push(f);pintarFotos();
  try{f.blob=await comprimir(archivo);await subir(f);}catch(e){const i=fotos.indexOf(f);if(i>=0)fotos.splice(i,1);URL.revokeObjectURL(f.vista);$('mensajeFotos').textContent=e.message;pintarFotos();}
 }
}
$('tomarFoto').onclick=()=>$('camara').click();$('seleccionarFoto').onclick=()=>$('galeria').click();$('camara').onchange=()=>agregar($('camara'));$('galeria').onchange=()=>agregar($('galeria'));
$('formulario').addEventListener('submit',async e=>{e.preventDefault();if(enviando)return;if(fotos.some(f=>f.estado!=='lista')){mensaje('Espera a que todas las fotos estén listas. Si una falló, reintenta o quítala.',true);return;}
 const d={};for(const c of CAMPOS){let v=$(c.clave).value.trim();if(c.tipo==='cedula')v=v.toUpperCase().replace(/[.\s]/g,'');if(v)d[c.clave]=v;}d.fotos=fotos.map(f=>f.url);const error=validar(d);if(error){mensaje(error,true);return;}
 enviando=true;$('enviar').disabled=true;for(const c of CAMPOS)$(c.clave).disabled=true;pintarFotos();mensaje('Guardando reporte y fotografías…');
 try{destino??=push(ref(db,'pc_parque_automotor'));await set(destino,{...d,origen:'publico',fecha_registro:serverTimestamp()});$('formulario').hidden=true;$('confirmacion').hidden=false;$('confirmacion').scrollIntoView({behavior:'smooth'});}
 catch(e){mensaje('No se pudo guardar. Revisa la conexión o consulta si el formulario está abierto. Tus datos y fotos siguen aquí para reintentar.',true);}
 finally{enviando=false;$('enviar').disabled=false;for(const c of CAMPOS)$(c.clave).disabled=false;pintarFotos();}
});
$('otro').onclick=()=>{destino=null;$('formulario').reset();iniciarFecha();fotos.forEach(f=>URL.revokeObjectURL(f.vista));fotos.splice(0);pintarFotos();$('mensajeFotos').textContent='';mensaje('');$('confirmacion').hidden=true;$('formulario').hidden=false;window.scrollTo({top:0,behavior:'smooth'});};
