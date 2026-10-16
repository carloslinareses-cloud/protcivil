import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {initializeApp,cert,deleteApp} from 'firebase-admin/app';
import {getDatabase} from 'firebase-admin/database';
import {CAMPOS,FAMILIA,TIPOS} from '../solicitud-inspeccion-data.mjs';
const carpeta=path.resolve(import.meta.dirname,'..');
const personal="auth != null && root.child('pc_operadores').child(auth.uid).exists() && (root.child('pc_operadores').child(auth.uid).child('rol').val() === 'admin' || root.child('pc_operadores').child(auth.uid).child('rol').val() === 'admin_plus') && root.child('pc_operadores').child(auth.uid).child('cambio_obligatorio').val() !== true";
function regla(c){const [k,,t,ob,max,valor]=c;let r;
 if(['edad','cantidad'].includes(t))r=`newData.isNumber() && newData.val() >= 0 && newData.val() <= ${t==='edad'?120:10000} && newData.val() % 1 === 0`;
 else if(t==='fijo')r='newData.val() === '+JSON.stringify(valor);
 else if(t==='parroquia')r="newData.val() === 'Charallave' || newData.val() === 'Las Brisas del Tuy'";
 else if(t==='tipo')r=TIPOS.map(v=>'newData.val() === '+JSON.stringify(v)).join(' || ');
 else if(t==='sexo')r=['Femenino','Masculino','No indicado'].map(v=>'newData.val() === '+JSON.stringify(v)).join(' || ');
 else if(t==='cedula')r='newData.isString() && newData.val().matches(/^[VE]?-?[0-9]{4,10}$/)';
 else if(t==='tel')r='newData.isString() && newData.val().length <= 30 && newData.val().matches(/^[+0-9][0-9 ()-]{6,29}$/)';
 else r=`newData.isString() && newData.val().length >= ${ob?2:1} && newData.val().length <= ${max||200}`;
 return {'.validate':r};
}
const nodo={'.read':personal,'.indexOn':['fecha_registro','parroquia','tipo_inspeccion'],'$id':{
 '.write':'!data.exists() && newData.exists()',
 '.validate':`$id.matches(/^-[A-Za-z0-9_-]{19}$/) && newData.hasChildren(${JSON.stringify(CAMPOS.filter(c=>c.obligatorio).map(c=>c.clave).concat(['origen','fecha_registro']))})`,
 origen:{'.validate':"newData.val() === 'publico'"},
 fecha_registro:{'.validate':'newData.isNumber() && newData.val() >= now - 600000 && newData.val() <= now + 60000'},
 '$otro':{'.validate':false}
}};
for(const c of CAMPOS)nodo.$id[c.clave]=regla([c.clave,c.etiqueta,c.tipo,c.obligatorio,c.max,c.valor]);
nodo.$id.familia={'.validate':"newData.hasChildren() && (newData.parent().child('tipo_inspeccion').val() === 'Casa' || newData.parent().child('tipo_inspeccion').val() === 'Apartamento')",'$indice':{
 '.validate':"$indice.matches(/^[0-9]$/) || $indice.matches(/^[1-4][0-9]$/)",
 '$otro':{'.validate':false}
}};
nodo.$id.familia.$indice['.validate']='('+nodo.$id.familia.$indice['.validate']+") && newData.hasChildren(['parentesco','nombre'])";
for(const c of FAMILIA)nodo.$id.familia.$indice[c[0]]=regla(c);
fs.writeFileSync(path.join(carpeta,'reglas-solicitud-inspeccion.json'),JSON.stringify({pc_solicitudes_inspeccion:nodo},null,2)+'\n');
if(process.argv.includes('--publicar')){
 const origen='C:/Users/carlo/Documents/Alcaldia BDD/';const app=initializeApp({credential:cert(JSON.parse(fs.readFileSync(origen+fs.readdirSync(origen).find(n=>/^alcaldia-admin-firebase-adminsdk-.*\.json$/.test(n)),'utf8'))),databaseURL:'https://alcaldia-admin-default-rtdb.firebaseio.com'});
 try{const db=getDatabase(app),antes=await db.getRulesJSON();
  fs.writeFileSync(path.join(os.tmpdir(),'pc-reglas-previas-inspeccion-20261016.json'),JSON.stringify(antes,null,2));
  const despues=structuredClone(antes);despues.rules.pc_solicitudes_inspeccion=nodo;
  assert.deepEqual(await db.getRulesJSON(),antes,'Las reglas cambiaron durante la preparación.');
  await db.setRules(JSON.stringify(despues)).catch(e=>{throw Error(String(e.message||'No se pudieron publicar las reglas'));});assert.deepEqual(await db.getRulesJSON(),despues);
  const archivo='C:/Users/carlo/Documents/alcaldia-admin/firebase-rules.json',local=JSON.parse(fs.readFileSync(archivo,'utf8'));local.rules.pc_solicitudes_inspeccion=nodo;fs.writeFileSync(archivo,JSON.stringify(local,null,2)+'\n');
  console.log('Reglas de solicitud de inspección publicadas y verificadas. Los demás nodos se conservaron.');
 }finally{await deleteApp(app);}
}
