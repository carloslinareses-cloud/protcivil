/* Publica únicamente el nodo nuevo, conservando las reglas ajenas. */
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {initializeApp,cert} from 'firebase-admin/app';import {getDatabase} from 'firebase-admin/database';
const root=path.resolve(import.meta.dirname,'..');
const {CAMPOS,OPCIONES}=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(root+'/parque-automotor-data.js','utf8')).toString('base64'));
const operador="auth != null && root.child('pc_operadores').child(auth.uid).exists() && (root.child('pc_operadores').child(auth.uid).child('rol').val() === 'admin' || root.child('pc_operadores').child(auth.uid).child('rol').val() === 'admin_plus')";
const requeridos=CAMPOS.filter(c=>c.obligatorio).map(c=>c.clave).concat(['origen','fecha_registro']);
const nodo={'.read':operador,'.indexOn':['fecha_registro','fecha','unidad'],'$id':{
 '.write':`!data.exists() && newData.exists() && root.child('pc_config').child('formulario_abierto').val() === true`,
 '.validate':`$id.matches(/^-[A-Za-z0-9_-]{19}$/) && newData.hasChildren(${JSON.stringify(requeridos)})`,
 origen:{'.validate':"newData.val() === 'publico'"},fecha_registro:{'.validate':'newData.isNumber() && newData.val() > 1700000000000 && newData.val() <= now + 60000'},
 fotos:{'.validate':'newData.hasChildren()', '$i':{'.validate':"$i.matches(/^[0-9]$/) && newData.isString() && newData.val().matches(/^https:\\/\\/fotos\\.alcaldiadecharallave\\.com\\/foto\\/[a-z0-9]{32}\\.(jpg|png|webp)$/)"}},
 '$otro':{'.validate':false}
}};
for(const c of CAMPOS){let regla=`newData.isString() && newData.val().length >= 1 && newData.val().length <= ${c.max}`;
 if(OPCIONES[c.tipo])regla+=` && (${OPCIONES[c.tipo].map(v=>`newData.val() === '${v}'`).join(' || ')})`;
 if(c.tipo==='cedula')regla+=' && newData.val().matches(/^[VE]?-?[0-9]{4,10}$/)';
 if(c.tipo==='tel')regla+=' && newData.val().matches(/^[+0-9() .-]{7,30}$/)';
 if(c.tipo==='date')regla+=' && newData.val().matches(/^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/)';
 if(c.tipo==='time')regla+=' && newData.val().matches(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)';
 nodo.$id[c.clave]={'.validate':regla};
}
fs.writeFileSync(root+'/reglas-parque-automotor.json',JSON.stringify({pc_parque_automotor:nodo},null,2)+'\n');
if(process.argv.includes('--publicar')){
 initializeApp({credential:cert(JSON.parse(fs.readFileSync('C:/Users/carlo/Documents/Alcaldia BDD/alcaldia-admin-firebase-adminsdk-fbsvc-207472a5bd.json','utf8'))),databaseURL:'https://alcaldia-admin-default-rtdb.firebaseio.com'});const db=getDatabase(),antes=await db.getRulesJSON();
 if(antes.rules.pc_parque_automotor)throw Error('El nodo ya tiene reglas. Revisar antes de reemplazarlas.');
 if((await db.ref('pc_parque_automotor').get()).exists())throw Error('El nodo ya tiene datos. No se inicia sobre datos existentes.');
 fs.writeFileSync(path.join(os.tmpdir(),'pc-reglas-previas-parque-20261006.json'),JSON.stringify(antes,null,2));
 const despues=structuredClone(antes);despues.rules.pc_parque_automotor=nodo;assert.deepEqual(await db.getRulesJSON(),antes);
 await db.setRules(JSON.stringify(despues));assert.deepEqual(await db.getRulesJSON(),despues);
 const archivo='C:/Users/carlo/Documents/alcaldia-admin/firebase-rules.json',local=JSON.parse(fs.readFileSync(archivo,'utf8'));local.rules.pc_parque_automotor=nodo;fs.writeFileSync(archivo,JSON.stringify(local,null,2)+'\n');
 console.log('Reglas publicadas y verificadas. Los demás nodos se conservaron.');
}
console.log('Campos del reporte: '+CAMPOS.length);process.exit(0);
