/* Prepara la firma privada del modelo y añade solo los dos nodos de Riesgo Controlado. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {initializeApp,cert} from 'firebase-admin/app';
import {getDatabase} from 'firebase-admin/database';
const carpeta=path.resolve(import.meta.dirname,'..');
const {CAMPOS_RIESGO}=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(carpeta,'riesgo-controlado-data.js'),'utf8')).toString('base64'));
const operador="auth != null && root.child('pc_operadores').child(auth.uid).exists() && (root.child('pc_operadores').child(auth.uid).child('rol').val() === 'admin' || root.child('pc_operadores').child(auth.uid).child('rol').val() === 'admin_plus')",plus="auth != null && root.child('pc_operadores').child(auth.uid).child('rol').val() === 'admin_plus'";
const nodo={'.read':operador,'.indexOn':['fecha_registro','codigo'],'$id':{'.write':`(newData.exists() && (${operador})) || (!newData.exists() && (${plus}))`,'.validate':`(data.exists() || $id.matches(/^-[A-Za-z0-9_-]{19}$/)) && newData.hasChildren(${JSON.stringify(CAMPOS_RIESGO.map(c=>c[0]).concat(['origen','fecha_registro','creado_por']))})`,origen:{'.validate':"newData.val() === 'interno'"},fecha_registro:{'.validate':'newData.isNumber() && newData.val() > 1700000000000 && newData.val() <= now + 60000 && (!data.exists() || newData.val() === data.val())'},fecha_edicion:{'.validate':'newData.isNumber() && newData.val() <= now + 60000'},creado_por:{'.validate':'newData.isString() && (data.exists() ? newData.val() === data.val() : newData.val() === auth.uid)'},editado_por:{'.validate':'newData.isString() && newData.val() === auth.uid'},'$otro':{'.validate':false}}};
for(const [k,et,t,max] of CAMPOS_RIESGO){let regla=`newData.isString() && newData.val().length >= 1 && newData.val().length <= ${max}`;if(k==='codigo')regla+=" && newData.val().matches(/^GR\\/[0-9]{1,8}\\/[0-9]{4}$/)";if(k==='rif')regla+=' && newData.val().matches(/^[JGVEP]-[0-9]{8}-[0-9]$/)';if(k==='cedula')regla+=' && newData.val().matches(/^[VE]-[0-9]{4,10}$/)';if(t==='date')regla+=' && newData.val().matches(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/)';if(k==='parroquia')regla+=" && (newData.val() === 'Charallave' || newData.val() === 'Las Brisas del Tuy')";nodo.$id[k]={'.validate':regla};}
const config={'.read':operador,'.write':plus};const fragmento={pc_riesgo_controlado:nodo,pc_riesgo_controlado_config:config};
fs.writeFileSync(path.join(carpeta,'reglas-riesgo-controlado.json'),JSON.stringify(fragmento,null,2)+'\n');
if(process.argv.includes('--publicar')){
 const salida=path.join(os.tmpdir(),'pc-firma-modelo-privada.json');
 const codigo=`import zipfile,json,base64\nfrom pathlib import Path\nwith zipfile.ZipFile(r'C:/Users/carlo/Documents/protcivil form/nuevo/INVERSIONES PARAVELAS, C.A..pptx') as z:\n Path(r'${carpeta.replaceAll('\\','/')}/logos/escudo-riesgo.png').write_bytes(z.read('ppt/media/image2.png'))\n firma='data:image/jpeg;base64,'+base64.b64encode(z.read('ppt/media/image3.jpeg')).decode()\n Path(r'${salida.replaceAll('\\','/')}').write_text(json.dumps({'firmaDataUrl':firma,'modelo':'INVERSIONES PARAVELAS, C.A..pptx','rotacion':270}),encoding='utf-8')\n`;
 const r=spawnSync('python',['-c',codigo],{encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(r.stderr);
 initializeApp({credential:cert(JSON.parse(fs.readFileSync('C:/Users/carlo/Documents/Alcaldia BDD/alcaldia-admin-firebase-adminsdk-fbsvc-207472a5bd.json','utf8'))),databaseURL:'https://alcaldia-admin-default-rtdb.firebaseio.com'});
 const db=getDatabase(),antes=await db.getRulesJSON();fs.writeFileSync(path.join(os.tmpdir(),'pc-reglas-previas-riesgo-20261005.json'),JSON.stringify(antes,null,2));const despues=structuredClone(antes);Object.assign(despues.rules,fragmento);assert.deepEqual(await db.getRulesJSON(),antes,'Las reglas cambiaron durante la preparación.');await db.setRules(JSON.stringify(despues));assert.deepEqual(await db.getRulesJSON(),despues);
 const datos=JSON.parse(fs.readFileSync(salida,'utf8'));await db.ref('pc_riesgo_controlado_config').update(datos);for(const [k,v] of Object.entries(datos))assert.equal((await db.ref('pc_riesgo_controlado_config/'+k).once('value')).val(),v);
 fs.unlinkSync(salida);
 const archivo='C:/Users/carlo/Documents/alcaldia-admin/firebase-rules.json';const local=JSON.parse(fs.readFileSync(archivo,'utf8'));Object.assign(local.rules,fragmento);fs.writeFileSync(archivo,JSON.stringify(local,null,2)+'\n');
 console.log('Riesgo Controlado: firma original privada y reglas publicadas y verificadas; otros nodos conservados.');
}
process.exit(0);
