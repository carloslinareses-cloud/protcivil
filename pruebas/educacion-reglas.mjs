/* Agrega exclusivamente pc_educacion a las reglas vigentes. Conserva y verifica los demás nodos. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {initializeApp,cert} from 'firebase-admin/app';
import {getDatabase} from 'firebase-admin/database';
const carpeta=path.resolve(import.meta.dirname,'..');
const {CAMPOS,SUMAS}=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(carpeta,'educacion-data.js'),'utf8')).toString('base64'));
const operador="auth != null && root.child('pc_operadores').child(auth.uid).exists() && (root.child('pc_operadores').child(auth.uid).child('rol').val() === 'admin' || root.child('pc_operadores').child(auth.uid).child('rol').val() === 'admin_plus')";
const plus="auth != null && root.child('pc_operadores').child(auth.uid).child('rol').val() === 'admin_plus'";
const requeridos=CAMPOS.filter(c=>c.obligatorio).map(c=>c.clave).concat(['origen','fecha_registro']);
const nodo={'.read':operador,'.indexOn':['fecha_registro','parroquia'],'$id':{
 '.write':`(!data.exists() && newData.exists() && root.child('pc_config').child('formulario_abierto').val() === true) || (newData.exists() && (${operador})) || (!newData.exists() && (${plus}))`,
 '.validate':`(data.exists() || $id.matches(/^-[A-Za-z0-9_-]{19}$/)) && newData.hasChildren(${JSON.stringify(requeridos)}) && ((${operador}) || (newData.child('origen').val() === 'publico' && !newData.hasChild('fecha_edicion') && !newData.hasChild('editado_por')))`,
 origen:{'.validate':"newData.val() === 'publico' || newData.val() === 'interno'"},
 fecha_registro:{'.validate':'newData.isNumber() && newData.val() > 1700000000000 && newData.val() <= now + 60000 && (!data.exists() || newData.val() === data.val())'},
 fecha_edicion:{'.validate':'newData.isNumber() && newData.val() <= now + 60000'},
 editado_por:{'.validate':`${operador} && newData.hasChildren(['uid','nombre']) && newData.child('uid').val() === auth.uid`,uid:{'.validate':'newData.isString() && newData.val().length <= 128'},nombre:{'.validate':'newData.isString() && newData.val().length <= 150'},'$otro':{'.validate':false}},
 '$otro':{'.validate':false}
}};
for(const c of CAMPOS){let regla;
 if(['number','edad','total'].includes(c.tipo))regla=`newData.isNumber() && newData.val() >= 0 && newData.val() <= ${c.tipo==='edad'?120:c.tipo==='total'?200000:100000} && newData.val() % 1 === 0`;
 else if(c.tipo==='si_no')regla="newData.val() === 'Sí' || newData.val() === 'No'";
 else if(c.tipo==='parroquia')regla="newData.val() === 'Charallave' || newData.val() === 'Las Brisas del Tuy'";
 else if(c.tipo==='cedula')regla='newData.isString() && newData.val().matches(/^[VE]?-?[0-9]{4,10}$/)';
 else regla=`newData.isString() && newData.val().length >= ${c.obligatorio?2:1} && newData.val().length <= ${c.max||200}`;
 const suma=SUMAS.find(s=>s[0]===c.clave);if(suma)regla+=` && newData.parent().child('${suma[1]}').isNumber() && newData.parent().child('${suma[2]}').isNumber() && newData.val() === newData.parent().child('${suma[1]}').val() + newData.parent().child('${suma[2]}').val()`;
 nodo.$id[c.clave]={'.validate':regla};
}
fs.writeFileSync(path.join(carpeta,'reglas-educacion.json'),JSON.stringify({pc_educacion:nodo},null,2)+'\n');
if(process.argv.includes('--publicar')){
 initializeApp({credential:cert(JSON.parse(fs.readFileSync('C:/Users/carlo/Documents/Alcaldia BDD/alcaldia-admin-firebase-adminsdk-fbsvc-207472a5bd.json','utf8'))),databaseURL:'https://alcaldia-admin-default-rtdb.firebaseio.com'});
 const db=getDatabase(),antes=await db.getRulesJSON();
 fs.writeFileSync(path.join(os.tmpdir(),'pc-reglas-previas-educacion-20261005.json'),JSON.stringify(antes,null,2));
 const despues=structuredClone(antes);despues.rules.pc_educacion=nodo;
 assert.deepEqual(await db.getRulesJSON(),antes,'Las reglas cambiaron durante la preparación; no se sobrescriben.');
 await db.setRules(JSON.stringify(despues));
 assert.deepEqual(await db.getRulesJSON(),despues);
 const archivo='C:/Users/carlo/Documents/alcaldia-admin/firebase-rules.json';
 const local=JSON.parse(fs.readFileSync(archivo,'utf8'));local.rules.pc_educacion=nodo;fs.writeFileSync(archivo,JSON.stringify(local,null,2)+'\n');
 console.log('Reglas pc_educacion publicadas y verificadas; demás nodos conservados.');
}
console.log('Esquema de reglas: '+CAMPOS.length+' campos de la plantilla.');
process.exit(0);
